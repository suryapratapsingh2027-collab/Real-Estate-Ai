import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { registerHandler } from '../queues/queue';
import { processInbound, refreshConversationSummary } from '../services/conversationService';
import { leadNo } from '../services/leadService';
import { createInAppNotification, deliverNotification, queueWhatsAppNotification } from '../services/notificationService';
import { storage } from '../services/storage';

/** Registers every job handler. Imported by both the API (inline mode) and the worker. */
export function registerAllHandlers() {
  registerHandler('process-inbound', async ({ messageId }) => processInbound(messageId));
  registerHandler('send-notification', async ({ notificationId }, meta) => deliverNotification(notificationId, meta));
  registerHandler('summarize-conversation', async ({ conversationId }) => {
    await refreshConversationSummary(conversationId);
  });
  registerHandler('followup-scan', async () => {
    await scanFollowUps();
  });
  registerHandler('expire-call-links', async () => {
    await expireCallLinks();
  });
  registerHandler('recording-retention', async () => {
    await enforceRecordingRetention();
  });
}

/** Send reminders for follow-ups that are due (once each). */
export async function scanFollowUps(now = new Date()) {
  const due = await prisma.followUp.findMany({
    where: { status: 'PENDING', remindedAt: null, dueAt: { lte: now } },
    include: { lead: { include: { customer: true, broker: true } }, assignee: true },
    take: 200,
  });
  for (const f of due) {
    // Claim first so concurrent scans do not double-send.
    const claimed = await prisma.followUp.updateMany({ where: { id: f.id, remindedAt: null }, data: { remindedAt: now } });
    if (claimed.count === 0) continue;
    const userId = f.assigneeId ?? f.lead.broker?.userId;
    const text = `Follow-up due: ${f.title} — ${leadNo(f.lead.number)} (${f.lead.customer.fullName ?? f.lead.customer.phone})`;
    if (userId) {
      await createInAppNotification({ userId, type: 'FOLLOW_UP_REMINDER', title: 'Follow-up due', body: text, leadId: f.leadId, brokerId: f.lead.brokerId });
    }
    if (f.lead.broker) {
      await queueWhatsAppNotification({
        type: 'FOLLOW_UP_REMINDER',
        toAddress: f.lead.broker.whatsappNumber ?? f.lead.broker.phone,
        title: 'Follow-up reminder',
        body: `${text}\nCustomer phone: ${f.lead.customer.phone}`,
        leadId: f.leadId,
        brokerId: f.lead.brokerId,
      });
    }
  }
  return due.length;
}

export async function expireCallLinks(now = new Date()) {
  const r = await prisma.voiceCall.updateMany({
    where: { status: { in: ['CREATED', 'LINK_SENT'] }, joinExpiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  // Calls stuck "in progress" for > 2h without an end event are marked failed.
  await prisma.voiceCall.updateMany({
    where: { status: 'IN_PROGRESS', endedAt: null, createdAt: { lt: new Date(now.getTime() - 2 * 3600_000) } },
    data: { status: 'FAILED', failureReason: 'No end event received' },
  });
  return r.count;
}

export async function enforceRecordingRetention(now = new Date()) {
  const calls = await prisma.voiceCall.findMany({
    where: { recordingKey: { not: null }, recordingDeleteAt: { lte: now }, recordingStatus: { in: ['AVAILABLE', 'RECORDING', 'FAILED'] } },
    take: 100,
  });
  for (const c of calls) {
    try {
      await storage.remove(c.recordingKey!);
      await prisma.voiceCall.update({ where: { id: c.id }, data: { recordingStatus: 'DELETED', recordingKey: null } });
    } catch (err) {
      logger.error({ err, callId: c.id }, 'recording deletion failed');
    }
  }
  return calls.length;
}
