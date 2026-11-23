import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CALL_STATUS, paginationSchema, voiceEndSchema, voiceRoomCreateSchema, voiceTokenSchema } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { brokerScope, requireAuth, requirePermission } from '../middleware/auth';
import { publicCallLimiter } from '../middleware/rateLimit';
import { audit } from '../services/auditService';
import { storage } from '../services/storage';
import { voiceService } from '../services/voiceService';
import { forbidden, notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';

export const voiceRouter = Router();

// ---------- Public (customer call page; authorised by the opaque join code) ----------
voiceRouter.get('/session/:code', publicCallLimiter, async (req, res) => {
  res.json(await voiceService.sessionInfo(String(req.params.code)));
});

voiceRouter.post('/token', publicCallLimiter, async (req, res) => {
  const { code, recordingConsent } = parse(voiceTokenSchema, req.body);
  res.json(await voiceService.issueToken(code, recordingConsent));
});

voiceRouter.post('/end', publicCallLimiter, async (req, res) => {
  const { code } = parse(voiceEndSchema, req.body);
  const call = await voiceService.endByCode(code);
  res.json({ status: call?.status ?? 'UNKNOWN' });
});

// ---------- Staff ----------
voiceRouter.post('/rooms', requireAuth, requirePermission('call:create'), async (req, res) => {
  const { leadId, sendLink } = parse(voiceRoomCreateSchema, req.body);
  const b = brokerScope(req);
  if (b && !(await prisma.lead.findFirst({ where: { id: leadId, brokerId: b } }))) throw forbidden();
  const r = await voiceService.createCallForLead(leadId, { sendLink, actorId: req.user!.id });
  await audit(req, 'call.create', 'VoiceCall', r.call.id, { leadId, sendLink });
  res.status(201).json({ callId: r.call.id, roomName: r.call.roomName, link: sendLink ? null : r.link });
});

const callScope = (req: Parameters<typeof brokerScope>[0]): Prisma.VoiceCallWhereInput => {
  const b = brokerScope(req);
  return b ? { lead: { brokerId: b } } : {};
};

voiceRouter.get('/calls', requireAuth, requirePermission('call:read'), async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.enum(CALL_STATUS).optional(), leadId: z.string().uuid().optional(), customerId: z.string().uuid().optional() }), req.query);
  const where: Prisma.VoiceCallWhereInput = {
    ...callScope(req),
    ...(q.status ? { status: q.status } : {}),
    ...(q.leadId ? { leadId: q.leadId } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.search ? { OR: [{ customer: { fullName: { contains: q.search, mode: 'insensitive' } } }, { customer: { phone: { contains: q.search } } }, { summary: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.voiceCall.findMany({
      where,
      omit: { joinCodeHash: true },
      include: { customer: { select: { id: true, fullName: true, phone: true } }, lead: { select: { id: true, number: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.voiceCall.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

voiceRouter.get('/calls/:id', requireAuth, requirePermission('call:read'), async (req, res) => {
  const call = await prisma.voiceCall.findFirst({
    where: { id: String(req.params.id), ...callScope(req) },
    omit: { joinCodeHash: true },
    include: { customer: true, lead: { select: { id: true, number: true, status: true, brokerId: true } }, transcript: true },
  });
  if (!call) throw notFound('Call');
  res.json(call);
});

/** Recording access: short-lived signed URL, audited. */
voiceRouter.get('/calls/:id/recording', requireAuth, requirePermission('call:read'), async (req, res) => {
  const call = await prisma.voiceCall.findFirst({ where: { id: String(req.params.id), ...callScope(req) } });
  if (!call) throw notFound('Call');
  if (call.recordingStatus !== 'AVAILABLE' || !call.recordingKey) throw notFound('Recording');
  const url = await storage.signedUrl(call.recordingKey, 300);
  if (!url) throw notFound('Recording');
  await audit(req, 'call.recording_access', 'VoiceCall', call.id);
  res.json({ url, expiresInSeconds: 300 });
});
