import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export async function audit(
  req: Request | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  data?: Record<string, unknown>,
  actorId?: string | null,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? req?.user?.id ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        ip: req?.ip ?? null,
        userAgent: req?.get('user-agent')?.slice(0, 300) ?? null,
        data: (data ?? undefined) as object | undefined,
      },
    });
  } catch (e) {
    // Auditing must never break the request.
    logger.error({ err: e, action }, 'audit log write failed');
  }
}
