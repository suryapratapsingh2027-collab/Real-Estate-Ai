import { afterAll, beforeEach, vi } from 'vitest';

// Environment must be set before any app module is imported (env is validated at import).
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://realestate:realestate@localhost:5432/realestate_test',
  QUEUE_MODE: 'inline',
  REDIS_URL: '',
  ENCRYPTION_KEY: 'a'.repeat(64),
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123',
  JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-01',
  AGENT_API_KEY: 'test-agent-key-test-agent-key-0123456789',
  AI_PROVIDER: 'mock',
  PUBLIC_APP_URL: 'http://app.test',
  WHATSAPP_API_BASE: 'http://wa.test',
  WHATSAPP_ACCESS_TOKEN: 'wa-token',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_APP_SECRET: 'wa-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'wa-verify-token',
  LIVEKIT_URL: 'wss://lk.test',
  LIVEKIT_API_KEY: 'lk-key',
  LIVEKIT_API_SECRET: 'lk-secret-lk-secret-lk-secret-lk-secret-123',
  UPLOAD_DIR: '/tmp/rea-test-uploads',
});

export type SentWhatsApp = { to: string; type: string; body?: string; template?: string };
export const sentWhatsApp: SentWhatsApp[] = [];
let waCounter = 0;

/** Stub only the WhatsApp Graph API; any other outbound HTTP fails loudly. */
const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('http://wa.test/')) {
    if ((init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { to: string; type: string; text?: { body: string }; template?: { name: string } };
      sentWhatsApp.push({ to: body.to, type: body.type, body: body.text?.body, template: body.template?.name });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.test${++waCounter}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ display_phone_number: '+91 00000', verified_name: 'Test' }), { status: 200 });
  }
  throw new Error(`Unexpected network call in tests: ${url}`);
});
vi.stubGlobal('fetch', fetchStub);

beforeEach(() => {
  sentWhatsApp.length = 0;
});

afterAll(async () => {
  const { prisma } = await import('../src/lib/prisma');
  await prisma.$disconnect();
});
