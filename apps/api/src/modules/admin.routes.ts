import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  aiSettingsSchema,
  businessSettingsSchema,
  integrationUpdateSchema,
  paginationSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@rea/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/auditService';
import { hashPassword, invalidateUserCache, revokeAllForUser } from '../services/authService';
import { integrationService, isIntegrationKey } from '../services/integrationService';
import { settingsService } from '../services/settingsService';
import { badRequest, conflict, notFound } from '../utils/errors';
import { paged, parse } from '../utils/http';

// ---------- Integrations ----------
export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get('/', requirePermission('settings:business'), async (_req, res) => {
  // Admins can see status; secret values are never returned (only hasValue / last4).
  res.json(await integrationService.list());
});

integrationsRouter.patch('/:id', requirePermission('settings:integrations'), async (req, res) => {
  const key = String(req.params.id);
  if (!isIntegrationKey(key)) throw notFound('Integration');
  const input = parse(integrationUpdateSchema, req.body);
  await integrationService.update(key, input);
  await audit(req, 'integration.update', 'Integration', key, {
    enabled: input.enabled,
    configKeys: Object.keys(input.config ?? {}),
    secretKeysChanged: Object.keys(input.secrets ?? {}),
  });
  res.json((await integrationService.list()).find((i) => i.key === key));
});

integrationsRouter.post('/:id/test', requirePermission('settings:integrations'), async (req, res) => {
  const key = String(req.params.id);
  if (!isIntegrationKey(key)) throw notFound('Integration');
  const r = await integrationService.test(key);
  await audit(req, 'integration.test', 'Integration', key, { ok: r.ok });
  res.json(r);
});

// ---------- Settings ----------
export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/business', requirePermission('settings:business'), async (_req, res) => res.json(await settingsService.getBusiness()));
settingsRouter.put('/business', requirePermission('settings:business'), async (req, res) => {
  const v = parse(businessSettingsSchema, req.body);
  await settingsService.save('business', v, req.user!.id);
  await audit(req, 'settings.business_update', 'BusinessSetting', 'business');
  res.json(v);
});
settingsRouter.get('/ai', requirePermission('settings:business'), async (_req, res) => res.json(await settingsService.getAi()));
settingsRouter.put('/ai', requirePermission('settings:ai'), async (req, res) => {
  const v = parse(aiSettingsSchema, req.body);
  if (v.provider === 'groq' && !(await integrationService.isConfigured('groq'))) {
    throw badRequest('Configure the Groq integration before switching the AI provider to Groq');
  }
  await settingsService.save('ai', v, req.user!.id);
  await audit(req, 'settings.ai_update', 'BusinessSetting', 'ai', { provider: v.provider, model: v.model });
  res.json(v);
});

// ---------- Users ----------
export const usersRouter = Router();
usersRouter.use(requireAuth, requirePermission('user:manage'));

usersRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const where: Prisma.UserWhereInput = q.search ? { OR: [{ fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {};
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, email: true, fullName: true, isActive: true, isDemo: true, lastLoginAt: true, createdAt: true, role: { select: { name: true } }, brokerProfile: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

usersRouter.post('/', async (req, res) => {
  const input = parse(userCreateSchema, req.body);
  if (input.role === 'BROKER') throw badRequest('Create brokers from the Brokers page so a broker profile is created');
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw conflict('Email already in use');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: input.role } });
  const u = await prisma.user.create({
    data: { email: input.email, fullName: input.fullName, passwordHash: await hashPassword(input.password), roleId: role.id },
    select: { id: true, email: true, fullName: true },
  });
  await audit(req, 'user.create', 'User', u.id, { role: input.role });
  res.status(201).json(u);
});

usersRouter.patch('/:id', async (req, res) => {
  const input = parse(userUpdateSchema, req.body);
  const id = String(req.params.id);
  if (id === req.user!.id && (input.isActive === false || (input.role && input.role !== req.user!.role))) {
    throw badRequest('You cannot deactivate or change the role of your own account');
  }
  const target = await prisma.user.findUnique({ where: { id }, include: { role: true, brokerProfile: true } });
  if (!target) throw notFound('User');
  if (input.role && (input.role === 'BROKER') !== Boolean(target.brokerProfile)) throw badRequest('Broker role is tied to a broker profile');
  if ((input.isActive === false || (input.role && input.role !== 'SUPER_ADMIN')) && target.role.name === 'SUPER_ADMIN') {
    const others = await prisma.user.count({ where: { role: { name: 'SUPER_ADMIN' }, isActive: true, id: { not: id } } });
    if (others === 0) throw badRequest('At least one active Super Admin is required');
  }
  const roleId = input.role ? (await prisma.role.findUniqueOrThrow({ where: { name: input.role } })).id : undefined;
  await prisma.user.update({ where: { id }, data: { fullName: input.fullName, isActive: input.isActive, roleId } });
  invalidateUserCache(id);
  if (input.isActive === false) await revokeAllForUser(id);
  await audit(req, 'user.update', 'User', id, input);
  res.json({ ok: true });
});

// ---------- Audit logs ----------
export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission('audit:read'));
auditRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ entityType: z.string().max(60).optional(), action: z.string().max(80).optional(), actorId: z.string().uuid().optional() }), req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.action ? { action: { contains: q.action } } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.search ? { OR: [{ action: { contains: q.search, mode: 'insensitive' } }, { entityId: { contains: q.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

// ---------- Notifications ----------
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requirePermission('notification:read'));

notificationsRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ scope: z.enum(['mine', 'all']).default('mine'), status: z.string().max(40).optional() }), req.query);
  const isAdmin = req.user!.permissions.has('lead:read_all');
  const where: Prisma.NotificationWhereInput =
    q.scope === 'all' && isAdmin
      ? { channel: 'WHATSAPP', ...(q.status ? { status: q.status as never } : {}) }
      : { recipientUserId: req.user!.id, channel: 'IN_APP' };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientUserId: req.user!.id, channel: 'IN_APP', readAt: null } }),
  ]);
  res.json({ ...paged(items, total, q.page, q.pageSize), unread });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: String(req.params.id), recipientUserId: req.user!.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { recipientUserId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
