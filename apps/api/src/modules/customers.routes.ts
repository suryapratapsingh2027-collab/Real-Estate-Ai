import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { customerUpdateSchema, paginationSchema } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { brokerScope, requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/auditService';
import { notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';
import { serializeLead } from './serializers';

export const customersRouter = Router();
customersRouter.use(requireAuth);

/** Brokers may only access customers who have a lead assigned to them. */
export function customerScope(req: Request): Prisma.CustomerWhereInput {
  const b = brokerScope(req);
  return b ? { leads: { some: { brokerId: b } } } : {};
}

customersRouter.get('/', requirePermission('customer:read'), async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const where: Prisma.CustomerWhereInput = {
    ...customerScope(req),
    ...(q.search
      ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search.replace(/[^\d+]/g, '') || q.search } }, { email: { contains: q.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, include: { _count: { select: { leads: true, voiceCalls: true } } }, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.customer.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

customersRouter.get('/:id', requirePermission('customer:read'), async (req, res) => {
  const c = await prisma.customer.findFirst({
    where: { id: String(req.params.id), ...customerScope(req) },
    include: {
      leads: { orderBy: { createdAt: 'desc' }, include: { broker: { include: { user: { select: { fullName: true } } } } } },
      conversations: { select: { id: true, lastMessageAt: true, humanTakeover: true, summary: true, _count: { select: { messages: true } } } },
      voiceCalls: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, createdAt: true, durationSeconds: true, summary: true, leadId: true } },
    },
  });
  if (!c) throw notFound('Customer');
  const leadIds = c.leads.map((l) => l.id);
  const [activities, recentMessages] = await Promise.all([
    prisma.leadActivity.findMany({ where: { leadId: { in: leadIds } }, orderBy: { createdAt: 'desc' }, take: 50, include: { actor: { select: { fullName: true } } } }),
    prisma.message.findMany({ where: { conversation: { customerId: c.id } }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, direction: true, body: true, createdAt: true, sender: true } }),
  ]);
  const timeline = [
    ...activities.map((a) => ({ at: a.createdAt, kind: 'lead', text: a.message, by: a.actor?.fullName ?? null, leadId: a.leadId })),
    ...recentMessages.map((m) => ({ at: m.createdAt, kind: 'message', text: `${m.direction === 'INBOUND' ? 'Customer' : m.sender === 'AI' ? 'AI' : 'Team'}: ${m.body.slice(0, 140)}`, by: null, leadId: null })),
    ...c.voiceCalls.map((v) => ({ at: v.createdAt, kind: 'call', text: `Voice call ${v.status.toLowerCase()}${v.durationSeconds ? ` (${v.durationSeconds}s)` : ''}`, by: null, leadId: v.leadId })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  res.json({ ...c, leads: c.leads.map(serializeLead), conversation: c.conversations[0] ?? null, timeline });
});

customersRouter.patch('/:id', requirePermission('customer:write'), async (req, res) => {
  const data = parse(customerUpdateSchema, req.body);
  const existing = await prisma.customer.findFirst({ where: { id: String(req.params.id), ...customerScope(req) } });
  if (!existing) throw notFound('Customer');
  const c = await prisma.customer.update({
    where: { id: existing.id },
    data: {
      ...data,
      whatsappConsentAt: data.whatsappConsent !== undefined && data.whatsappConsent !== existing.whatsappConsent ? new Date() : undefined,
    },
  });
  await audit(req, 'customer.update', 'Customer', c.id, { fields: Object.keys(data) });
  res.json(c);
});
