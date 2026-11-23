import type { NextFunction, Request, Response } from 'express';
import type { Permission } from '@rea/shared';
import { env } from '../config/env';
import { loadAuthUser, verifyAccessToken, type AuthUser } from '../services/authService';
import { safeEqual } from '../services/crypto';
import { forbidden, unauthorized } from '../utils/errors';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    rawBody?: Buffer;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  const { sub } = verifyAccessToken(header.slice(7));
  req.user = await loadAuthUser(sub);
  next();
}

/** Require ALL listed permissions. Enforced server-side regardless of UI. */
export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const missing = perms.filter((p) => !req.user!.permissions.has(p));
    if (missing.length) return next(forbidden());
    next();
  };
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Service-to-service auth for the Python voice agent. */
export function requireAgentKey(req: Request, _res: Response, next: NextFunction) {
  const key = req.get('x-agent-key');
  if (!key || !safeEqual(key, env.AGENT_API_KEY)) return next(unauthorized('Invalid agent key'));
  next();
}

/**
 * Defence-in-depth CSRF check for cookie-authenticated endpoints (refresh/logout):
 * browsers cannot send this custom header cross-site without a CORS preflight we reject.
 */
export function requireXhrHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-requested-with') !== 'XMLHttpRequest') return next(forbidden('Missing X-Requested-With header'));
  next();
}

/** Brokers only see their own leads unless they hold lead:read_all. */
export function brokerScope(req: Request): string | null {
  const u = req.user!;
  if (u.permissions.has('lead:read_all')) return null;
  return u.brokerId ?? '00000000-0000-0000-0000-000000000000';
}
