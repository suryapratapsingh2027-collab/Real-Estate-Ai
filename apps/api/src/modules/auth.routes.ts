import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { changePasswordSchema, loginSchema } from '@rea/shared';
import { isProd, env } from '../config/env';
import { prisma } from '../lib/prisma';
import { requireAuth, requireXhrHeader } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { audit } from '../services/auditService';
import { hashPassword, invalidateUserCache, login, revokeAllForUser, revokeRefresh, rotateRefresh } from '../services/authService';
import { badRequest, unauthorized } from '../utils/errors';
import { clientInfo, parse } from '../utils/http';

const COOKIE = 'rea_rt';
const cookieOpts = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
});

function sendSession(res: Response, data: { accessToken: string; refresh: { raw: string }; user: { id: string; email: string; fullName: string; role: { name: string } } }) {
  res.cookie(COOKIE, data.refresh.raw, cookieOpts());
  res.json({ accessToken: data.accessToken, user: { id: data.user.id, email: data.user.email, fullName: data.user.fullName, role: data.user.role.name } });
}

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  try {
    const r = await login(email, password, clientInfo(req));
    await audit(req, 'auth.login', 'User', r.user.id, undefined, r.user.id);
    sendSession(res, r);
  } catch (e) {
    await audit(req, 'auth.login_failed', 'User', null, { email });
    throw e;
  }
});

authRouter.post('/refresh', requireXhrHeader, async (req, res) => {
  const raw = req.cookies?.[COOKIE] as string | undefined;
  if (!raw) throw unauthorized('No session');
  try {
    sendSession(res, await rotateRefresh(raw, clientInfo(req)));
  } catch (e) {
    res.clearCookie(COOKIE, { path: '/api/auth' });
    throw e;
  }
});

authRouter.post('/logout', requireXhrHeader, async (req, res) => {
  const raw = req.cookies?.[COOKIE] as string | undefined;
  if (raw) await revokeRefresh(raw);
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const u = req.user!;
  res.json({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, brokerId: u.brokerId, permissions: [...u.permissions] });
});

// ---------- Profile ----------
export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.patch('/', async (req, res) => {
  const { fullName } = parse(z.object({ fullName: z.string().trim().min(2).max(120) }), req.body);
  await prisma.user.update({ where: { id: req.user!.id }, data: { fullName } });
  invalidateUserCache(req.user!.id);
  await audit(req, 'profile.update', 'User', req.user!.id);
  res.json({ ok: true });
});

profileRouter.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  await revokeAllForUser(user.id);
  await audit(req, 'profile.password_change', 'User', user.id);
  res.json({ ok: true });
});
