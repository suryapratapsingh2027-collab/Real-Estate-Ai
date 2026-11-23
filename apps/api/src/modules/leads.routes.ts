import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { leadAssignSchema, leadCreateSchema, leadNoteSchema, leadQuerySchema, leadUpdateSchema, parseBudget } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { brokerScope, requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/auditService';
import { findOrCreateCustomer } from '../services/customerService';
import { addActivity, assignLead, createLead, upsertQualifiedLead } from '../services/leadService';
import { realtime, roomsFor } from '../services/realtime';
import { voiceService } from '../services/voiceService';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';
import { serializeLead } from './serializers';

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

export function leadScope(req: Request): Prisma.LeadWhereInput {
  const b = brokerScope(req);
  return b ? { brokerId: b } : {};
}

async function loadScopedLead(req: Request, id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, ...leadScope(req) } });
  if (!lead) throw notFound('Lead');
  return lead;
}

leadsRouter.get('/', requirePermission('lead:read'), async (req, res) => {
  const q = parse(leadQuerySchema, req.query);
  const and: Prisma.LeadWhereInput[] = [leadScope(req)];
  if (q.status) and.push({ status: q.status });
  if (q.brokerId) and.push({ brokerId: q.brokerId });
  if (q.customerId) and.push({ customerId: q.customerId });
  if (q.source) and.push({ source: q.source });
  if (q.location) and.push({ preferredLocation: { contains: q.location, mode: 'insensitive' } });
  if (q.from || q.to) and.push({ createdAt: { gte: q.from, lte: q.to } });
  if (q.search) {
    const n = Number(q.search.replace(/^LD-?/i, ''));
    and.push({
      OR: [
        { customer: { fullName: { contains: q.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: q.search } } },
        { summary: { contains: q.search, mode: 'insensitive' } },
        { preferredLocation: { contains: q.search, mode: 'insensitive' } },
        ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { customer: { select: { id: true, fullName: true, phone: true } }, broker: { include: { user: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.lead.count({ where }),
  ]);
  res.json(paged(items.map(serializeLead), total, q.page, q.pageSize));
});

leadsRouter.get('/:id', requirePermission('lead:read'), async (req, res) => {
  const lead = await prisma.lead.findFirst({
    where: { id: String(req.params.id), ...leadScope(req) },
    include: {
      customer: true,
      broker: { include: { user: { select: { fullName: true, email: true } } } },
      activities: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { fullName: true } } } },
      followUps: { orderBy: { dueAt: 'asc' }, include: { assignee: { select: { fullName: true } } } },
      voiceCalls: { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, createdAt: true, durationSeconds: true, summary: true, recordingStatus: true } },
      notifications: { where: { channel: 'WHATSAPP' }, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, status: true, createdAt: true, lastError: true, title: true } },
    },
  });
  if (!lead) throw notFound('Lead');
  res.json(serializeLead(lead));
});

leadsRouter.post('/', requirePermission('lead:write'), async (req, res) => {
  const input = parse(leadCreateSchema, req.body);
  if (req.user!.role === 'BROKER' && input.autoAssign) input.autoAssign = false;
  const customer = await findOrCreateCustomer(input.customerPhone, input.customerName);
  const parsed = parseBudget(input.budgetRange);
  const fields = {
    propertyType: input.propertyType ?? null,
    budgetRange: input.budgetRange ?? null,
    budgetMin: input.budgetMin ?? parsed.min,
    budgetMax: input.budgetMax ?? parsed.max,
    preferredLocation: input.preferredLocation ?? null,
    bedrooms: input.bedrooms ?? null,
    urgency: input.urgency,
    summary: input.summary ?? null,
  };
  let lead;
  const qualified = Boolean(fields.preferredLocation && (fields.propertyType || fields.budgetRange));
  if (qualified && input.autoAssign) {
    lead = (await upsertQualifiedLead({ customerId: customer.id, source: input.source, fields, actorId: req.user!.id })).lead;
  } else {
    lead = await createLead({ customerId: customer.id, source: input.source, qualified, fields, actorId: req.user!.id });
    if (req.user!.role === 'BROKER' && req.user!.brokerId) await assignLead(lead.id, { brokerId: req.user!.brokerId, actorId: req.user!.id, reason: 'Created by broker' });
  }
  await audit(req, 'lead.create', 'Lead', lead.id);
  res.status(201).json(serializeLead(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })));
});

leadsRouter.patch('/:id', requirePermission('lead:write'), async (req, res) => {
  const input = parse(leadUpdateSchema, req.body);
  const lead = await loadScopedLead(req, String(req.params.id));
  if (input.status === 'LOST' && !input.lostReason && !lead.lostReason) throw badRequest('Please provide a reason when marking a lead as lost');
  const data: Prisma.LeadUpdateInput = { ...input };
  if (input.budgetRange !== undefined) {
    const b = parseBudget(input.budgetRange);
    data.budgetMin = b.min;
    data.budgetMax = b.max;
  }
  if (input.status === 'CONVERTED' && lead.status !== 'CONVERTED') data.convertedAt = new Date();
  if (input.status && ['QUALIFIED', 'ASSIGNED', 'CONTACTED', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'CONVERTED'].includes(input.status)) data.isQualified = true;
  const updated = await prisma.lead.update({ where: { id: lead.id }, data });
  if (input.status && input.status !== lead.status) {
    await addActivity(lead.id, 'STATUS_CHANGED', `Status changed from ${lead.status} to ${input.status}${input.lostReason ? ` (${input.lostReason})` : ''}`, req.user!.id, { from: lead.status, to: input.status });
  }
  const other = Object.keys(input).filter((k) => k !== 'status' && k !== 'lostReason');
  if (other.length) await addActivity(lead.id, 'UPDATED', `Updated ${other.join(', ')}`, req.user!.id);
  await audit(req, 'lead.update', 'Lead', lead.id, { fields: Object.keys(input) });
  realtime.publish({ event: 'lead:updated', payload: { leadId: lead.id }, rooms: roomsFor(updated.brokerId) });
  res.json(serializeLead(updated));
});

leadsRouter.post('/:id/assign', requirePermission('lead:assign'), async (req, res) => {
  const input = parse(leadAssignSchema, req.body);
  await loadScopedLead(req, String(req.params.id));
  if (!input.brokerId && !input.auto) throw badRequest('Provide brokerId or auto=true');
  const r = await assignLead(String(req.params.id), { brokerId: input.brokerId, auto: input.auto, actorId: req.user!.id, reason: input.reason });
  await audit(req, 'lead.assign', 'Lead', String(req.params.id), { brokerId: r.brokerId, reason: r.reason });
  res.json({ brokerId: r.brokerId, reason: r.reason, lead: serializeLead(await prisma.lead.findUniqueOrThrow({ where: { id: String(req.params.id) } })) });
});

leadsRouter.post('/:id/notes', requirePermission('lead:write'), async (req, res) => {
  const { note } = parse(leadNoteSchema, req.body);
  const lead = await loadScopedLead(req, String(req.params.id));
  const a = await addActivity(lead.id, 'NOTE', note, req.user!.id);
  res.status(201).json(a);
});

leadsRouter.post('/:id/call', requirePermission('call:create'), async (req, res) => {
  const lead = await loadScopedLead(req, String(req.params.id));
  const sendLink = req.body?.sendLink !== false;
  if (req.user!.role === 'BROKER' && !lead.brokerId) throw forbidden();
  const r = await voiceService.createCallForLead(lead.id, { sendLink, actorId: req.user!.id });
  await audit(req, 'call.create', 'VoiceCall', r.call.id, { leadId: lead.id, sendLink });
  res.status(201).json({ callId: r.call.id, link: sendLink ? null : r.link, status: sendLink ? 'LINK_SENT' : 'CREATED' });
});
