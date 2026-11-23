import type { Request } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';
import { IntegrationError } from './errors';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest(
      'Validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function clientInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 300) ?? null };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with timeout + retry with exponential backoff for retryable failures
 * (network errors, 408, 429, 5xx). Non-retryable 4xx are thrown immediately.
 */
export async function fetchWithRetry(
  integration: string,
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15000, retries = 2, baseDelayMs = 500 } = opts;
  let lastErr: IntegrationError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      const text = (await res.text().catch(() => '')).slice(0, 500);
      lastErr = new IntegrationError(integration, `HTTP ${res.status}: ${text}`, retryable, res.status);
      if (!retryable) throw lastErr;
    } catch (e) {
      if (e instanceof IntegrationError && !e.retryable) throw e;
      if (!(e instanceof IntegrationError)) {
        const msg = e instanceof Error ? e.message : String(e);
        lastErr = new IntegrationError(integration, `Network error: ${msg}`, true);
      }
    }
    if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100));
  }
  throw lastErr ?? new IntegrationError(integration, 'Unknown error', true);
}
