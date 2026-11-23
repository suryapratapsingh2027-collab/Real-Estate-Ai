import type { IntegrationKey, IntegrationStatus } from '@rea/shared';
import { RoomServiceClient } from 'livekit-server-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decrypt, encrypt } from './crypto';
import { fetchWithRetry } from '../utils/http';

/**
 * Integration definitions. Values come from the DB (set via the Integrations page,
 * secrets AES-256-GCM encrypted) and fall back to environment variables.
 */
const DEFS: Record<IntegrationKey, { name: string; config: Record<string, keyof typeof env>; secrets: Record<string, keyof typeof env>; required: string[] }> = {
  whatsapp: {
    name: 'WhatsApp Cloud API',
    config: { phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID', graphVersion: 'WHATSAPP_GRAPH_VERSION' },
    secrets: { accessToken: 'WHATSAPP_ACCESS_TOKEN', appSecret: 'WHATSAPP_APP_SECRET', verifyToken: 'WHATSAPP_VERIFY_TOKEN' },
    required: ['phoneNumberId', 'accessToken', 'appSecret', 'verifyToken'],
  },
  groq: {
    name: 'Groq (LLM + Whisper)',
    config: { baseUrl: 'GROQ_BASE_URL', model: 'AI_MODEL' },
    secrets: { apiKey: 'GROQ_API_KEY' },
    required: ['apiKey'],
  },
  livekit: {
    name: 'LiveKit',
    config: { url: 'LIVEKIT_URL', agentName: 'LIVEKIT_AGENT_NAME' },
    secrets: { apiKey: 'LIVEKIT_API_KEY', apiSecret: 'LIVEKIT_API_SECRET' },
    required: ['url', 'apiKey', 'apiSecret'],
  },
  tts: {
    name: 'Text-to-Speech (Cartesia / ElevenLabs)',
    config: { provider: 'TTS_PROVIDER' },
    secrets: { cartesiaApiKey: 'CARTESIA_API_KEY', elevenlabsApiKey: 'ELEVENLABS_API_KEY' },
    required: [],
  },
  storage: {
    name: 'Object Storage',
    config: { driver: 'STORAGE_DRIVER', endpoint: 'S3_ENDPOINT', region: 'S3_REGION', bucket: 'S3_BUCKET' },
    secrets: { accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY' },
    required: [],
  },
};

/** Extra non-secret config keys allowed per integration (not mirrored from env). */
const EXTRA_CONFIG: Partial<Record<IntegrationKey, string[]>> = {
  whatsapp: ['brokerTemplateName', 'brokerTemplateLanguage', 'reminderTemplateName'],
};

export type Resolved = { enabled: boolean; config: Record<string, string>; secrets: Record<string, string> };

const cache = new Map<IntegrationKey, { value: Resolved; at: number }>();
const TTL = 30_000;

export function isIntegrationKey(k: string): k is IntegrationKey {
  return k in DEFS;
}

export const integrationService = {
  defs: DEFS,

  async resolve(key: IntegrationKey): Promise<Resolved> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const def = DEFS[key];
    const row = await prisma.integration.findUnique({ where: { key } });
    const dbConfig = (row?.config ?? {}) as Record<string, string>;
    let dbSecrets: Record<string, string> = {};
    if (row?.secretsCipher) {
      try {
        dbSecrets = JSON.parse(decrypt(row.secretsCipher)) as Record<string, string>;
      } catch {
        logger.error({ key }, 'Failed to decrypt integration secrets (ENCRYPTION_KEY changed?)');
      }
    }
    const config: Record<string, string> = {};
    for (const [k, envKey] of Object.entries(def.config)) {
      const v = dbConfig[k] || (env[envKey] as string | undefined);
      if (v !== undefined && v !== '') config[k] = String(v);
    }
    for (const k of EXTRA_CONFIG[key] ?? []) if (dbConfig[k]) config[k] = dbConfig[k];
    const secrets: Record<string, string> = {};
    for (const [k, envKey] of Object.entries(def.secrets)) {
      const v = dbSecrets[k] || (env[envKey] as string | undefined);
      if (v) secrets[k] = String(v);
    }
    const value = { enabled: row?.enabled ?? true, config, secrets };
    cache.set(key, { value, at: Date.now() });
    return value;
  },

  async isConfigured(key: IntegrationKey): Promise<boolean> {
    const r = await this.resolve(key);
    if (!r.enabled) return false;
    if (key === 'tts') return Boolean(r.secrets.cartesiaApiKey || r.secrets.elevenlabsApiKey);
    if (key === 'storage') return r.config.driver !== 's3' || Boolean(r.config.bucket && r.secrets.accessKeyId);
    return DEFS[key].required.every((f) => r.config[f] || r.secrets[f]);
  },

  async list() {
    const rows = await prisma.integration.findMany();
    const out = [];
    for (const key of Object.keys(DEFS) as IntegrationKey[]) {
      const row = rows.find((r) => r.key === key);
      const resolved = await this.resolve(key);
      const configured = await this.isConfigured(key);
      const secretFields: Record<string, { hasValue: boolean; last4: string | null }> = {};
      for (const k of Object.keys(DEFS[key].secrets)) {
        const v = resolved.secrets[k];
        secretFields[k] = { hasValue: Boolean(v), last4: v && v.length > 8 ? v.slice(-4) : null };
      }
      let status: IntegrationStatus = configured ? 'CONFIGURED' : 'NOT_CONFIGURED';
      if (configured && row?.status && (row.status === 'OK' || row.status === 'ERROR')) status = row.status;
      out.push({
        key,
        name: DEFS[key].name,
        enabled: resolved.enabled,
        status,
        config: resolved.config,
        configFields: [...Object.keys(DEFS[key].config), ...(EXTRA_CONFIG[key] ?? [])],
        secretFields,
        requiredFields: DEFS[key].required,
        lastCheckedAt: row?.lastCheckedAt ?? null,
        lastError: configured ? (row?.lastError ?? null) : null,
      });
    }
    return out;
  },

  async update(key: IntegrationKey, input: { enabled?: boolean; config?: Record<string, string>; secrets?: Record<string, string> }) {
    const def = DEFS[key];
    const row = await prisma.integration.findUnique({ where: { key } });
    const allowedConfig = new Set([...Object.keys(def.config), ...(EXTRA_CONFIG[key] ?? [])]);
    const config = { ...((row?.config ?? {}) as Record<string, string>) };
    for (const [k, v] of Object.entries(input.config ?? {})) {
      if (!allowedConfig.has(k)) continue;
      if (v === '') delete config[k];
      else config[k] = v;
    }
    let secrets: Record<string, string> = {};
    if (row?.secretsCipher) {
      try {
        secrets = JSON.parse(decrypt(row.secretsCipher)) as Record<string, string>;
      } catch {
        secrets = {};
      }
    }
    for (const [k, v] of Object.entries(input.secrets ?? {})) {
      if (!(k in def.secrets)) continue;
      if (v === '') delete secrets[k];
      else secrets[k] = v;
    }
    const secretsCipher = Object.keys(secrets).length ? encrypt(JSON.stringify(secrets)) : null;
    await prisma.integration.upsert({
      where: { key },
      update: { enabled: input.enabled ?? row?.enabled ?? true, config, secretsCipher, status: 'CONFIGURED', lastError: null },
      create: { key, name: def.name, enabled: input.enabled ?? true, config, secretsCipher },
    });
    cache.delete(key);
  },

  /** Performs a real, read-only call against the provider. */
  async test(key: IntegrationKey): Promise<{ ok: boolean; message: string }> {
    const configured = await this.isConfigured(key);
    if (!configured) return { ok: false, message: 'Not configured — required fields are missing.' };
    const r = await this.resolve(key);
    let result: { ok: boolean; message: string };
    try {
      result = await runTest(key, r);
    } catch (e) {
      result = { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : 'Test failed' };
    }
    await prisma.integration.upsert({
      where: { key },
      update: { status: result.ok ? 'OK' : 'ERROR', lastCheckedAt: new Date(), lastError: result.ok ? null : result.message },
      create: { key, name: DEFS[key].name, status: result.ok ? 'OK' : 'ERROR', lastCheckedAt: new Date(), lastError: result.ok ? null : result.message },
    });
    return result;
  },

  clearCache: () => cache.clear(),
};

async function runTest(key: IntegrationKey, r: Resolved): Promise<{ ok: boolean; message: string }> {
  switch (key) {
    case 'whatsapp': {
      const url = `${env.WHATSAPP_API_BASE}/${r.config.graphVersion ?? env.WHATSAPP_GRAPH_VERSION}/${r.config.phoneNumberId}?fields=display_phone_number,verified_name`;
      const res = await fetchWithRetry('whatsapp', url, { headers: { Authorization: `Bearer ${r.secrets.accessToken}` } }, { retries: 0, timeoutMs: 10000 });
      const j = (await res.json()) as { display_phone_number?: string; verified_name?: string };
      return { ok: true, message: `Connected: ${j.verified_name ?? ''} ${j.display_phone_number ?? ''}`.trim() };
    }
    case 'groq': {
      const res = await fetchWithRetry('groq', `${r.config.baseUrl}/models`, { headers: { Authorization: `Bearer ${r.secrets.apiKey}` } }, { retries: 0, timeoutMs: 10000 });
      const j = (await res.json()) as { data?: Array<{ id: string }> };
      const has = j.data?.some((m) => m.id === r.config.model);
      return { ok: true, message: has ? `Connected; model ${r.config.model} available` : `Connected; model ${r.config.model} NOT listed — update AI settings` };
    }
    case 'livekit': {
      const host = r.config.url!.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      const client = new RoomServiceClient(host, r.secrets.apiKey, r.secrets.apiSecret);
      const rooms = await client.listRooms();
      return { ok: true, message: `Connected; ${rooms.length} active room(s)` };
    }
    case 'tts': {
      const provider = r.config.provider ?? 'cartesia';
      if (provider === 'cartesia') {
        if (!r.secrets.cartesiaApiKey) return { ok: false, message: 'Cartesia selected but CARTESIA_API_KEY missing' };
        await fetchWithRetry('tts', 'https://api.cartesia.ai/voices', { headers: { 'X-API-Key': r.secrets.cartesiaApiKey, 'Cartesia-Version': '2024-06-10' } }, { retries: 0, timeoutMs: 10000 });
        return { ok: true, message: 'Cartesia key accepted' };
      }
      if (!r.secrets.elevenlabsApiKey) return { ok: false, message: 'ElevenLabs selected but ELEVENLABS_API_KEY missing' };
      await fetchWithRetry('tts', 'https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': r.secrets.elevenlabsApiKey } }, { retries: 0, timeoutMs: 10000 });
      return { ok: true, message: 'ElevenLabs key accepted' };
    }
    case 'storage': {
      if (r.config.driver !== 's3') {
        const dir = path.resolve(env.UPLOAD_DIR);
        await fs.mkdir(dir, { recursive: true });
        const probe = path.join(dir, '.write-test');
        await fs.writeFile(probe, 'ok');
        await fs.unlink(probe);
        return { ok: true, message: `Local storage writable at ${dir}` };
      }
      const { storage } = await import('./storage');
      await storage.healthCheck();
      return { ok: true, message: `S3 bucket ${r.config.bucket} reachable` };
    }
  }
}
