import type { NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { enqueue } from '../queues/queue';
import { IntegrationError } from '../utils/errors';
import { integrationService } from './integrationService';
import { realtime } from './realtime';
import { whatsapp } from './whatsapp';

type Template = { name: string; language: string; params: string[] };

/**
 * Create a WhatsApp notification row and queue its delivery.
 * Creation never fails because WhatsApp is down — delivery happens in the worker with retries.
 */
export async function queueWhatsAppNotification(input: {
  type: NotificationType;
  toAddress: string | null | undefined;
  title: string;
  body: string;
  leadId?: string | null;
  brokerId?: string | null;
  customerId?: string | null;
}) {
  const n = await prisma.notification.create({
    data: {
      type: input.type,
      channel: 'WHATSAPP',
      toAddress: input.toAddress ?? null,
      title: input.title,
      body: input.body,
      leadId: input.leadId ?? null,
      brokerId: input.brokerId ?? null,
      customerId: input.customerId ?? null,
      status: input.toAddress ? 'QUEUED' : 'FAILED',
      lastError: input.toAddress ? null : 'No WhatsApp number on file',
    },
  });
  if (input.toAddress) await enqueue('send-notification', { notificationId: n.id }, { jobId: `notif-${n.id}` });
  return n;
}

/** In-app (bell) notification for a staff user. */
export async function createInAppNotification(input: { userId: string; type: NotificationType; title: string; body: string; leadId?: string | null; brokerId?: string | null }) {
  const n = await prisma.notification.create({
    data: {
      type: input.type,
      channel: 'IN_APP',
      recipientUserId: input.userId,
      brokerId: input.brokerId ?? null,
      leadId: input.leadId ?? null,
      title: input.title,
      body: input.body,
      status: 'DELIVERED',
      sentAt: new Date(),
    },
  });
  realtime.publish({ event: 'notification:new', payload: { id: n.id, title: n.title }, rooms: [`user:${input.userId}`] });
  return n;
}

/**
 * Business-initiated messages to brokers may fall outside WhatsApp's 24-hour window, which
 * requires an approved template. If a template name is configured on the WhatsApp integration,
 * the notification body is sent as its single {{1}} body parameter; otherwise plain text is used.
 */
async function resolveTemplate(type: NotificationType, body: string): Promise<Template | null> {
  const r = await integrationService.resolve('whatsapp');
  const lang = r.config.brokerTemplateLanguage || 'en';
  if ((type === 'BROKER_NEW_LEAD' || type === 'LEAD_REASSIGNED') && r.config.brokerTemplateName) {
    return { name: r.config.brokerTemplateName, language: lang, params: [body.replace(/\n+/g, ' | ').slice(0, 1000)] };
  }
  if (type === 'FOLLOW_UP_REMINDER' && r.config.reminderTemplateName) {
    return { name: r.config.reminderTemplateName, language: lang, params: [body.replace(/\n+/g, ' | ').slice(0, 1000)] };
  }
  return null;
}

/** Worker handler: deliver one notification. Throws on retryable errors so BullMQ retries. */
export async function deliverNotification(notificationId: string, meta: { attempt: number; finalAttempt: boolean }) {
  const n = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!n || n.channel !== 'WHATSAPP' || !n.toAddress) return;
  if (['SENT', 'DELIVERED', 'READ', 'SKIPPED_NOT_CONFIGURED'].includes(n.status)) return; // idempotent
  try {
    const tpl = await resolveTemplate(n.type, n.body);
    const res = tpl ? await whatsapp.sendTemplate(n.toAddress, tpl.name, tpl.language, tpl.params) : await whatsapp.sendText(n.toAddress, n.body);
    await prisma.notification.update({
      where: { id: n.id },
      data:
        res.status === 'SENT'
          ? { status: 'SENT', whatsappMessageId: res.whatsappMessageId, sentAt: new Date(), attempts: { increment: 1 }, lastError: null }
          : { status: 'SKIPPED_NOT_CONFIGURED', attempts: { increment: 1 }, lastError: 'WhatsApp is not configured' },
    });
  } catch (err) {
    const retryable = err instanceof IntegrationError ? err.retryable : true;
    const message = err instanceof Error ? err.message.slice(0, 500) : 'Unknown error';
    const final = !retryable || meta.finalAttempt;
    await prisma.notification.update({
      where: { id: n.id },
      data: { attempts: { increment: 1 }, lastError: message, status: final ? 'FAILED' : 'QUEUED' },
    });
    logger.warn({ notificationId, attempt: meta.attempt, retryable, final }, 'notification delivery failed');
    if (!final) throw err;
  }
}
