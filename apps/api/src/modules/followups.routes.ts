import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { FOLLOWUP_STATUS, followUpCreateSchema, followUpUpdateSchema, paginationSchema } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { brokerScope, requireAuth, requirePermission } from '../middleware/auth';
import { addActivity } from '../services/leadService';
import { notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';

export const followUpsRouter = Router();
followUpsRouter.use(requireAuth);

const querySchema = paginationSchema.extend({
  status: z.enum(FOLLOWUP_STATUS).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  leadId: z.string().uuid().optional(),
});

followUpsRouter.get('/', requirePermission('followup:read'), async (req, res) => {
  const q = parse(querySchema, req.query);
  const b = brokerScope(req);
  const where: Prisma.FollowUpWhereInput = {
    ...(b ? { lead: { brokerId: b } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.leadId ? { leadId: q.leadId } : {}),
    ...(q.overdue === 'true' ? { status: 'PENDING', dueAt: { lt: new Date() } } : {}),
    ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.followUp.findMany({
      where,
      include: { lead: { select: { id: true, number: true, customer: { select: { fullName: true, phone: true } } } }, assignee: { select: { fullName: true } } },
      orderBy: { dueAt: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.followUp.count({ where }),
  ]);
  const now = Date.now();
  res.json(paged(items.map((f) => ({ ...f, overdue: f.status === 'PENDING' && f.dueAt.getTime() < now })), total, q.page, q.pageSize));
});

followUpsRouter.post('/', requirePermission('followup:write'), async (req, res) => {
  const input = parse(followUpCreateSchema, req.body);
  const b = brokerScope(req);
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, ...(b ? { brokerId: b } : {}) }, include: { broker: true } });
  if (!lead) throw notFound('Lead');
  const f = await prisma.followUp.create({
    data: {
      leadId: lead.id,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt,
      assigneeId: input.assigneeId ?? lead.broker?.userId ?? req.user!.id,
      createdById: req.user!.id,
    },
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { followUpAt: input.dueAt } });
  await addActivity(lead.id, 'FOLLOW_UP', `Follow-up scheduled: ${input.title} (${input.dueAt.toISOString()})`, req.user!.id);
  res.status(201).json(f);
});

followUpsRouter.patch('/:id', requirePermission('followup:write'), async (req, res) => {
  const input = parse(followUpUpdateSchema, req.body);
  const b = brokerScope(req);
  const f = await prisma.followUp.findFirst({ where: { id: String(req.params.id), ...(b ? { lead: { brokerId: b } } : {}) } });
  if (!f) throw notFound('Follow-up');
  const updated = await prisma.followUp.update({
    where: { id: f.id },
    data: {
      ...input,
      completedAt: input.status === 'DONE' ? new Date() : input.status ? null : undefined,
      remindedAt: input.dueAt ? null : undefined,
    },
  });
  if (input.status && input.status !== f.status) await addActivity(f.leadId, 'FOLLOW_UP', `Follow-up "${f.title}" marked ${input.status.toLowerCase()}`, req.user!.id);
  res.json(updated);
});
