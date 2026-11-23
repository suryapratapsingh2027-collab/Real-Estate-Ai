import { Router } from 'express';
import crypto from 'node:crypto';
import { ACTIVE_LEAD_STATUSES, brokerCreateSchema, brokerUpdateSchema, normalizePhone, paginationSchema } from '@rea/shared';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/auditService';
import { hashPassword, invalidateUserCache, revokeAllForUser } from '../services/authService';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';
import { serializeLead } from './serializers';

export const brokersRouter = Router();
brokersRouter.use(requireAuth);

async function brokerStats(ids: string[]) {
  const rows = await prisma.lead.groupBy({ by: ['brokerId', 'status'], where: { brokerId: { in: ids } }, _count: { _all: true } });
  const stats = new Map<string, { total: number; active: number; converted: number; lost: number; conversionRate: number }>();
  for (const id of ids) stats.set(id, { total: 0, active: 0, converted: 0, lost: 0, conversionRate: 0 });
  for (const r of rows) {
    const s = stats.get(r.brokerId!)!;
    s.total += r._count._all;
    if (ACTIVE_LEAD_STATUSES.includes(r.status)) s.active += r._count._all;
    if (r.status === 'CONVERTED') s.converted += r._count._all;
    if (r.status === 'LOST') s.lost += r._count._all;
  }
  for (const s of stats.values()) {
    const closed = s.converted + s.lost;
    s.conversionRate = closed ? Math.round((s.converted / closed) * 1000) / 10 : 0;
  }
  return stats;
}

function normaliseBrokerPhones(phone?: string, whatsapp?: string | null) {
  const p = phone !== undefined ? normalizePhone(phone) : undefined;
  if (phone !== undefined && !p) throw badRequest('Invalid phone number');
  const w = whatsapp ? normalizePhone(whatsapp) : whatsapp === null ? null : undefined;
  if (whatsapp && !w) throw badRequest('Invalid WhatsApp number');
  return { phone: p ?? undefined, whatsappNumber: w };
}

brokersRouter.get('/', requirePermission('broker:read'), async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional(), area: z.string().max(120).optional() }), req.query);
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.area ? { areas: { has: q.area.toLowerCase() } } : {}),
    ...(q.search
      ? { OR: [{ user: { fullName: { contains: q.search, mode: 'insensitive' as const } } }, { user: { email: { contains: q.search, mode: 'insensitive' as const } } }, { phone: { contains: q.search } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.brokerProfile.findMany({ where, include: { user: { select: { id: true, fullName: true, email: true, isActive: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.brokerProfile.count({ where }),
  ]);
  const stats = await brokerStats(items.map((b) => b.id));
  res.json(paged(items.map((b) => ({ ...b, stats: stats.get(b.id) })), total, q.page, q.pageSize));
});

brokersRouter.get('/options', requirePermission('lead:assign'), async (_req, res) => {
  const items = await prisma.brokerProfile.findMany({ where: { status: 'ACTIVE' }, include: { user: { select: { fullName: true } } }, orderBy: { user: { fullName: 'asc' } } });
  const stats = await brokerStats(items.map((b) => b.id));
  res.json(items.map((b) => ({ id: b.id, fullName: b.user.fullName, areas: b.areas, availability: b.availability, activeLeads: stats.get(b.id)?.active ?? 0, maxActiveLeads: b.maxActiveLeads })));
});

brokersRouter.get('/:id', requirePermission('broker:read'), async (req, res) => {
  const b = await prisma.brokerProfile.findUnique({
    where: { id: String(req.params.id) },
    include: {
      user: { select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true } },
      leads: { orderBy: { updatedAt: 'desc' }, take: 50, include: { customer: { select: { fullName: true, phone: true } } } },
    },
  });
  if (!b) throw notFound('Broker');
  const stats = (await brokerStats([b.id])).get(b.id);
  res.json({ ...b, leads: b.leads.map(serializeLead), stats });
});

brokersRouter.post('/', requirePermission('broker:write'), async (req, res) => {
  const input = parse(brokerCreateSchema, req.body);
  const phones = normaliseBrokerPhones(input.phone, input.whatsappNumber ?? null);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw conflict('A user with this email already exists');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'BROKER' } });
  // If no password is given, generate a one-time temporary password returned only in this response.
  const tempPassword = input.password ? null : `Tmp-${crypto.randomBytes(9).toString('base64url')}9a`;
  const passwordHash = await hashPassword(input.password ?? tempPassword!);
  const broker = await prisma.brokerProfile.create({
    data: {
      phone: phones.phone!,
      whatsappNumber: phones.whatsappNumber ?? phones.phone!,
      areas: input.areas.map((a) => a.toLowerCase()),
      specialization: input.specialization,
      experienceYears: input.experienceYears,
      availability: input.availability,
      maxActiveLeads: input.maxActiveLeads,
      status: input.status,
      user: { create: { email: input.email, fullName: input.fullName, passwordHash, roleId: role.id } },
    },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });
  await audit(req, 'broker.create', 'BrokerProfile', broker.id, { email: input.email });
  res.status(201).json({ ...broker, temporaryPassword: tempPassword });
});

brokersRouter.patch('/:id', requirePermission('broker:write'), async (req, res) => {
  const input = parse(brokerUpdateSchema, req.body);
  const existing = await prisma.brokerProfile.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) throw notFound('Broker');
  const phones = normaliseBrokerPhones(input.phone, input.whatsappNumber);
  const b = await prisma.brokerProfile.update({
    where: { id: existing.id },
    data: {
      phone: phones.phone,
      whatsappNumber: phones.whatsappNumber,
      areas: input.areas?.map((a) => a.toLowerCase()),
      specialization: input.specialization,
      experienceYears: input.experienceYears,
      availability: input.availability,
      maxActiveLeads: input.maxActiveLeads,
      status: input.status,
      user:
        input.fullName || input.email || input.status
          ? { update: { fullName: input.fullName, email: input.email, isActive: input.status ? input.status === 'ACTIVE' : undefined } }
          : undefined,
    },
    include: { user: { select: { id: true, fullName: true, email: true, isActive: true } } },
  });
  invalidateUserCache(b.userId);
  if (input.status === 'INACTIVE') await revokeAllForUser(b.userId);
  await audit(req, 'broker.update', 'BrokerProfile', b.id, { fields: Object.keys(input) });
  res.json(b);
});

/** Default: deactivate (keeps history). ?hard=true permanently deletes a broker with no leads. */
brokersRouter.delete('/:id', requirePermission('broker:write'), async (req, res) => {
  const b = await prisma.brokerProfile.findUnique({ where: { id: String(req.params.id) }, include: { _count: { select: { leads: true } } } });
  if (!b) throw notFound('Broker');
  if (req.query.hard === 'true') {
    if (req.user!.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can permanently delete brokers');
    if (b._count.leads > 0) throw conflict('Broker has leads; deactivate instead or reassign leads first');
    await prisma.user.delete({ where: { id: b.userId } });
    await audit(req, 'broker.delete', 'BrokerProfile', b.id);
    return res.status(204).end();
  }
  await prisma.brokerProfile.update({ where: { id: b.id }, data: { status: 'INACTIVE', user: { update: { isActive: false } } } });
  invalidateUserCache(b.userId);
  await revokeAllForUser(b.userId);
  await audit(req, 'broker.deactivate', 'BrokerProfile', b.id);
  res.json({ ok: true, status: 'INACTIVE' });
});
