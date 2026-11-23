/**
 * API client. The access token lives only in memory; the refresh token is an httpOnly cookie
 * scoped to /api/auth. On 401 the client refreshes once (single-flight) and retries.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onAuthLost: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
  onLost: (fn: () => void) => {
    onAuthLost = fn;
  },
};

export async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return accessToken;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Options = { method?: string; body?: unknown; query?: Record<string, unknown>; form?: FormData; auth?: boolean };

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(path.startsWith('/api') ? path : `/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

export async function api<T = unknown>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? 'GET', headers, body, credentials: 'include' });
  if (res.status === 401 && opts.auth !== false && !retried) {
    const t = await refreshAccessToken();
    if (t) return api<T>(path, opts, true);
    onAuthLost?.();
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: Array<{ path: string; message: string }> } };
  if (!res.ok) {
    throw new ApiError(res.status, data.error?.code ?? 'ERROR', data.error?.message ?? `Request failed (${res.status})`, data.error?.details);
  }
  return data as T;
}

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };
