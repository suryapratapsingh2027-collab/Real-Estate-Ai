import { Prisma } from '@prisma/client';
import { detectLanguage } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { enqueue } from '../queues/queue';
import { generateReply, summarizeConversation, type HistoryItem } from './ai/aiService';
import { findOrCreateCustomer, getOrCreateConversation } from './customerService';
import { createLead, fieldsFromAi, upsertQualifiedLead, type LeadFields } from './leadService';
import { sendConversationMessage } from './messagingService';
import { realtime, roomsFor } from './realtime';
import { settingsService } from './settingsService';
import { voiceService } from './voiceService';

/** Returns true the first time an event id is seen (idempotency ledger). */
export async function markEventProcessed(provider: string, eventId: string): Promise<boolean> {
  try {
    await prisma.processedWebhookEvent.create({ data: { id: `${provider}:${eventId}`, provider } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
    throw e;
  }
}

/**
 * Step 1 (webhook request path): persist the inbound message and enqueue AI processing.
 * Fast, idempotent, and independent of AI/WhatsApp availability.
 */
export async function receiveInbound(input: { waMessageId: string; from: string; name: string | null; text: string; type: string; timestamp?: Date }) {
  const fresh = await markEventProcessed('wa', input.waMessageId);
  if (!fresh) return { duplicate: true as const };

  const customer = await findOrCreateCustomer(input.from, input.name, { whatsapp: true });
  if (!customer.preferredLanguage && input.text) {
    await prisma.customer.update({ where: { id: customer.id }, data: { preferredLanguage: detectLanguage(input.text) } });
  }
  const convo = await getOrCreateConversation(customer.id);
  const message = await prisma.message.create({
    data: {
      conversationId: convo.id,
      direction: 'INBOUND',
      sender: 'CUSTOMER',
      body: input.text.slice(0, 4096),
      messageType: input.type,
      whatsappMessageId: input.waMessageId,
      status: 'RECEIVED',
      createdAt: input.timestamp,
    },
  });
  await prisma.conversation.update({
    where: { id: convo.id },
    data: { lastInboundAt: new Date(), lastMessageAt: new Date(), lastMessageText: input.text.slice(0, 200), unreadCount: { increment: 1 } },
  });
  const brokerId = (await prisma.lead.findFirst({ where: { customerId: customer.id, brokerId: { not: null } }, orderBy: { updatedAt: 'desc' } }))?.brokerId;
  realtime.publish({ event: 'message:new', payload: { conversationId: convo.id, message }, rooms: roomsFor(brokerId) });

  await enqueue('process-inbound', { messageId: message.id }, { jobId: `inbound-${message.id}` });
  return { duplicate: false as const, messageId: message.id, conversationId: convo.id, customerId: customer.id };
}

function meetsRules(f: LeadFields, rules: { requireLocation: boolean; requireBudget: boolean; requirePropertyType: boolean }) {
  return (!rules.requireLocation || Boolean(f.preferredLocation)) && (!rules.requireBudget || Boolean(f.budgetRange || f.budgetMax)) && (!rules.requirePropertyType || Boolean(f.propertyType));
}

/**
 * Step 2 (worker): AI reply, lead qualification/assignment, optional voice link.
 * Idempotent: if a reply to this message already exists, it does nothing.
 */
export async function processInbound(messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { customer: true } } } });
  if (!msg || msg.direction !== 'INBOUND') return;
  const already = await prisma.message.findFirst({
    where: { conversationId: msg.conversationId, direction: 'OUTBOUND', sender: 'AI', aiMeta: { path: ['inReplyTo'], equals: messageId } },
  });
  if (already) return;
  const convo = msg.conversation;
  const customer = convo.customer;
  if (convo.humanTakeover) {
    logger.info({ conversationId: convo.id }, 'human takeover active; AI skipped');
    return;
  }
  // Only answer the latest inbound message; earlier ones in a burst are included as history.
  const newer = await prisma.message.findFirst({
    where: { conversationId: convo.id, direction: 'INBOUND', createdAt: { gt: msg.createdAt } },
    select: { id: true },
  });
  if (newer) return;

  const recent = await prisma.message.findMany({
    where: { conversationId: convo.id, createdAt: { lt: msg.createdAt }, sender: { in: ['CUSTOMER', 'AI', 'HUMAN'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const history: HistoryItem[] = recent.reverse().map((m) => ({ role: m.direction === 'INBOUND' ? 'customer' : 'assistant', text: m.body }));
  const openLead = await prisma.lead.findFirst({ where: { customerId: customer.id, status: { notIn: ['CONVERTED', 'LOST'] } }, orderBy: { updatedAt: 'desc' } });
  const [business, aiSettings, voiceAvailable] = await Promise.all([settingsService.getBusiness(), settingsService.getAi(), voiceService.isConfigured()]);

  const result = await generateReply({
    ctx: {
      business,
      ai: aiSettings,
      customer: {
        name: customer.fullName,
        phone: customer.phone,
        preferredLocation: customer.preferredLocation,
        budgetRange: customer.budgetRange,
        preferredPropertyType: customer.preferredPropertyType,
      },
      openLead,
      voiceAvailable,
    },
    history,
    latest: msg.body,
  });
  const reply = result.reply;

  await sendConversationMessage({
    conversationId: convo.id,
    toPhone: customer.whatsappNumber ?? customer.phone,
    body: reply.reply_message,
    sender: 'AI',
    brokerId: openLead?.brokerId,
    aiMeta: {
      inReplyTo: messageId,
      provider: result.meta.provider,
      model: result.meta.model,
      fallback: result.meta.fallback,
      toolCalls: result.meta.toolCalls,
      qualified: reply.is_qualified_lead,
      wantsVoiceCall: reply.wants_voice_call,
      missing: reply.missing_information,
      recommended: reply.recommended_property_ids,
    },
  });
  if (result.meta.fallback) return; // never act on unvalidated output

  if (reply.customer_name && !customer.fullName) {
    await prisma.customer.update({ where: { id: customer.id }, data: { fullName: reply.customer_name.slice(0, 120) } });
  }

  const fields = fieldsFromAi(reply);
  let lead = openLead;
  // Common lead pipeline — always runs before (and independent of) voice handling.
  if (reply.is_qualified_lead && meetsRules(fields, aiSettings.qualificationRules)) {
    const r = await upsertQualifiedLead({
      customerId: customer.id,
      conversationId: convo.id,
      originalMessage: history.find((h) => h.role === 'customer')?.text ?? msg.body,
      source: 'WHATSAPP',
      fields,
    });
    lead = r.lead;
  }

  if (reply.wants_voice_call) {
    if (!lead) {
      lead = await createLead({ customerId: customer.id, conversationId: convo.id, originalMessage: msg.body, source: 'WHATSAPP', qualified: false, fields });
    }
    // When voice is unavailable the AI reply has already told the customer a consultant will call.
    if (voiceAvailable) {
      try {
        await voiceService.createCallForLead(lead.id, { sendLink: true });
      } catch (err) {
        logger.error({ err, leadId: lead.id }, 'failed to create voice call');
        await sendConversationMessage({
          conversationId: convo.id,
          toPhone: customer.whatsappNumber ?? customer.phone,
          body: detectLanguage(msg.body) === 'hi' ? 'Maaf kijiye, abhi call link nahi bana paaye. Hamare consultant aapko call karenge.' : 'Sorry, we could not create a call link right now. Our consultant will call you.',
          sender: 'SYSTEM',
          brokerId: lead.brokerId,
        });
      }
    }
  }
  await prisma.conversation.update({ where: { id: convo.id }, data: { unreadCount: 0 } }).catch(() => undefined);
  await enqueue('summarize-conversation', { conversationId: convo.id }, { jobId: `sum-${convo.id}-${Math.floor(Date.now() / 300000)}` });
}

export async function refreshConversationSummary(conversationId: string) {
  const msgs = await prisma.message.findMany({ where: { conversationId, sender: { in: ['CUSTOMER', 'AI', 'HUMAN'] } }, orderBy: { createdAt: 'desc' }, take: 60 });
  const summary = await summarizeConversation(msgs.reverse().map((m) => ({ role: m.direction === 'INBOUND' ? 'customer' : 'assistant', text: m.body })));
  return prisma.conversation.update({ where: { id: conversationId }, data: { summary, summaryUpdatedAt: new Date() } });
}
