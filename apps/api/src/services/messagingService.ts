import type { MessageSender } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { IntegrationError } from '../utils/errors';
import { realtime, roomsFor } from './realtime';
import { whatsapp } from './whatsapp';

/**
 * Persist an outbound WhatsApp message and send it.
 * The DB row is written first so the message is never lost, then updated with the send result.
 * Failures are recorded on the message and do not throw (callers continue their flow).
 */
export async function sendConversationMessage(input: {
  conversationId: string;
  toPhone: string;
  body: string;
  sender: MessageSender;
  senderUserId?: string | null;
  aiMeta?: Record<string, unknown>;
  brokerId?: string | null;
}) {
  const msg = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: 'OUTBOUND',
      sender: input.sender,
      senderUserId: input.senderUserId ?? null,
      body: input.body,
      status: 'QUEUED',
      aiMeta: (input.aiMeta ?? undefined) as object | undefined,
    },
  });
  let updated = msg;
  try {
    const res = await whatsapp.sendText(input.toPhone, input.body);
    updated = await prisma.message.update({
      where: { id: msg.id },
      data: res.status === 'SENT' ? { status: 'SENT', whatsappMessageId: res.whatsappMessageId } : { status: 'SKIPPED_NOT_CONFIGURED' },
    });
  } catch (err) {
    const error = err instanceof IntegrationError ? err.message : 'Send failed';
    logger.error({ err, messageId: msg.id }, 'WhatsApp send failed');
    updated = await prisma.message.update({ where: { id: msg.id }, data: { status: 'FAILED', error: error.slice(0, 500) } });
  }
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date(), lastMessageText: input.body.slice(0, 200) },
  });
  realtime.publish({ event: 'message:new', payload: { conversationId: input.conversationId, message: updated }, rooms: roomsFor(input.brokerId) });
  return updated;
}

const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/** Apply a WhatsApp delivery status to the matching message or notification without regressing state. */
export async function applyDeliveryStatus(waId: string, status: 'sent' | 'delivered' | 'read' | 'failed', error?: string) {
  const next = status.toUpperCase() as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  const msg = await prisma.message.findUnique({ where: { whatsappMessageId: waId } });
  if (msg && (STATUS_RANK[next] ?? 0) > (STATUS_RANK[msg.status] ?? 0)) {
    const m = await prisma.message.update({ where: { id: msg.id }, data: { status: next, error: error ?? msg.error } });
    realtime.publish({ event: 'message:status', payload: { conversationId: m.conversationId, messageId: m.id, status: m.status }, rooms: ['staff'] });
  }
  const notif = await prisma.notification.findUnique({ where: { whatsappMessageId: waId } });
  if (notif && (STATUS_RANK[next] ?? 0) > (STATUS_RANK[notif.status] ?? 0)) {
    await prisma.notification.update({ where: { id: notif.id }, data: { status: next, lastError: error ?? notif.lastError } });
  }
}
