import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { paginationSchema, replySchema, takeoverSchema } from '@rea/shared';
import { isProd } from '../config/env';
import { prisma } from '../lib/prisma';
import { brokerScope, requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/auditService';
import { receiveInbound, refreshConversationSummary } from '../services/conversationService';
import { randomToken } from '../services/crypto';
import { sendConversationMessage } from '../services/messagingService';
import { whatsapp } from '../services/whatsapp';
import { AppError, forbidden, notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

function convoScope(req: Request): Prisma.ConversationWhereInput {
  const b = brokerScope(req);
  return b ? { customer: { leads: { some: { brokerId: b } } } } : {};
}

const listSchema = paginationSchema.extend({
  customerId: z.string().uuid().optional(),
  brokerId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  takeover: z.enum(['true', 'false']).optional(),
});

conversationsRouter.get('/', requirePermission('conversation:read'), async (req, res) => {
  const q = parse(listSchema, req.query);
  const and: Prisma.ConversationWhereInput[] = [convoScope(req)];
  if (q.customerId) and.push({ customerId: q.customerId });
  if (q.brokerId) and.push({ customer: { leads: { some: { brokerId: q.brokerId } } } });
  if (q.from || q.to) and.push({ lastMessageAt: { gte: q.from, lte: q.to } });
  if (q.takeover) and.push({ humanTakeover: q.takeover === 'true' });
  if (q.search) {
    and.push({
      OR: [
        { customer: { fullName: { contains: q.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: q.search } } },
        { messages: { some: { body: { contains: q.search, mode: 'insensitive' } } } },
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: { customer: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.conversation.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

async function loadConvo(req: Request) {
  const c = await prisma.conversation.findFirst({
    where: { id: String(req.params.id), ...convoScope(req) },
    include: { customer: { include: { leads: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, number: true, status: true, brokerId: true, summary: true } } } } },
  });
  if (!c) throw notFound('Conversation');
  return c;
}

conversationsRouter.get('/:id', requirePermission('conversation:read'), async (req, res) => {
  const c = await loadConvo(req);
  const windowOpen = Boolean(c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < 24 * 3600_000);
  res.json({ ...c, windowOpen });
});

conversationsRouter.get('/:id/messages', requirePermission('conversation:read'), async (req, res) => {
  const c = await loadConvo(req);
  const q = parse(paginationSchema.extend({ pageSize: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
  const where = { conversationId: c.id };
  const [items, total] = await Promise.all([
    prisma.message.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { senderUser: { select: { fullName: true } } } }),
    prisma.message.count({ where }),
  ]);
  await prisma.conversation.update({ where: { id: c.id }, data: { unreadCount: 0 } });
  res.json(paged(items.reverse(), total, q.page, q.pageSize));
});

/** Human reply (admin/broker). Only allowed within WhatsApp's 24h customer-service window. */
conversationsRouter.post('/:id/reply', requirePermission('conversation:reply'), async (req, res) => {
  const { text } = parse(replySchema, req.body);
  const c = await loadConvo(req);
  if (!c.lastInboundAt || Date.now() - c.lastInboundAt.getTime() > 24 * 3600_000) {
    throw new AppError(422, 'WINDOW_CLOSED', 'The 24-hour WhatsApp window is closed. The customer must message first, or use an approved template.');
  }
  const msg = await sendConversationMessage({
    conversationId: c.id,
    toPhone: c.customer.whatsappNumber ?? c.customer.phone,
    body: text,
    sender: 'HUMAN',
    senderUserId: req.user!.id,
    brokerId: c.customer.leads[0]?.brokerId,
  });
  await audit(req, 'conversation.reply', 'Conversation', c.id);
  res.status(201).json(msg);
});

conversationsRouter.post('/:id/takeover', requirePermission('conversation:reply'), async (req, res) => {
  const { active } = parse(takeoverSchema, req.body);
  const c = await loadConvo(req);
  const updated = await prisma.conversation.update({
    where: { id: c.id },
    data: { humanTakeover: active, takeoverById: active ? req.user!.id : null, takeoverAt: active ? new Date() : null },
  });
  await audit(req, active ? 'conversation.takeover' : 'conversation.release', 'Conversation', c.id);
  res.json(updated);
});

conversationsRouter.post('/:id/summary', requirePermission('conversation:read'), async (req, res) => {
  const c = await loadConvo(req);
  res.json(await refreshConversationSummary(c.id));
});

/**
 * Demo/testing: inject a customer message through the same pipeline the WhatsApp webhook uses.
 * Disabled in production when WhatsApp is configured (real traffic must come from Meta).
 */
conversationsRouter.post('/simulate', requirePermission('settings:business'), async (req, res) => {
  if (isProd && (await whatsapp.isConfigured())) throw forbidden('Simulator is disabled in production when WhatsApp is configured');
  const input = parse(z.object({ phone: z.string().min(8).max(20), name: z.string().max(120).optional(), text: z.string().min(1).max(2000) }), req.body);
  const r = await receiveInbound({ waMessageId: `sim-${randomToken(12)}`, from: input.phone, name: input.name ?? null, text: input.text, type: 'text' });
  await audit(req, 'conversation.simulate', 'Conversation', 'conversationId' in r ? r.conversationId : null);
  res.status(202).json(r);
});
