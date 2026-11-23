import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Permission, RoleName } from '@rea/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AppError, unauthorized } from '../utils/errors';
import { randomToken, sha256 } from './crypto';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
// Precomputed hash used to keep login timing constant for unknown emails.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  permissions: Set<Permission>;
  brokerId: string | null;
};

export const hashPassword = (p: string) => bcrypt.hash(p, 12);

export function signAccessToken(userId: string, role: RoleName): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    audience: 'rea-api',
    issuer: 'rea',
  });
}

export function verifyAccessToken(token: string): { sub: string; role: RoleName } {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, { audience: 'rea-api', issuer: 'rea' }) as jwt.JwtPayload;
    if (!p.sub) throw new Error('no sub');
    return { sub: p.sub, role: p.role as RoleName };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

async function issueRefresh(userId: string, familyId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const raw = randomToken(48);
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: sha256(raw + env.JWT_REFRESH_SECRET),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return { raw, id: row.id, expiresAt: row.expiresAt };
}

export async function login(email: string, password: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Invalid email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    throw unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw unauthorized('Account is disabled');
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const refresh = await issueRefresh(user.id, crypto.randomUUID(), meta);
  return { user, accessToken: signAccessToken(user.id, user.role.name), refresh };
}

/**
 * Refresh-token rotation with reuse detection: presenting an already-rotated token
 * revokes the whole token family (likely theft).
 */
export async function rotateRefresh(raw: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw + env.JWT_REFRESH_SECRET) }, include: { user: { include: { role: true } } } });
  if (!row) throw unauthorized('Invalid refresh token');
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized('Refresh token reuse detected; please sign in again');
  }
  if (row.expiresAt < new Date() || !row.user.isActive) throw unauthorized('Session expired');
  const next = await issueRefresh(row.userId, row.familyId, meta);
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: next.id } });
  return { user: row.user, accessToken: signAccessToken(row.userId, row.user.role.name), refresh: next };
}

export async function revokeRefresh(raw: string) {
  await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw + env.JWT_REFRESH_SECRET), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllForUser(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// ---- Per-request user loading with a short cache ----
const userCache = new Map<string, { user: AuthUser; at: number }>();
const USER_TTL = 10_000;

export async function loadAuthUser(userId: string): Promise<AuthUser> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_TTL) return hit.user;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } }, brokerProfile: { select: { id: true } } },
  });
  if (!u || !u.isActive) throw unauthorized('Account is disabled');
  const user: AuthUser = {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role.name,
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.key as Permission)),
    brokerId: u.brokerProfile?.id ?? null,
  };
  userCache.set(userId, { user, at: Date.now() });
  return user;
}

export function invalidateUserCache(userId?: string) {
  if (userId) userCache.delete(userId);
  else userCache.clear();
}
