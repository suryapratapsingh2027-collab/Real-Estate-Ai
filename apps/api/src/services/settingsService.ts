import { aiSettingsSchema, businessSettingsSchema, type AiSettings, type BusinessSettings } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';

const DEFAULT_BUSINESS: BusinessSettings = {
  businessName: 'My Real Estate',
  businessPhone: null,
  businessWhatsapp: null,
  businessAddress: null,
  businessEmail: null,
  logoUrl: null,
  workingHours: 'Mon–Sat 10:00–19:00',
  timezone: 'Asia/Kolkata',
  fallbackPolicy: 'LEAST_LOADED_ANY_AREA',
  recordingEnabled: false,
  recordingRetentionDays: 30,
};

function defaultAi(): AiSettings {
  return {
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL,
    temperature: env.AI_TEMPERATURE,
    systemPromptAddendum: '',
    languages: ['English', 'Hindi', 'Hinglish'],
    qualificationRules: { requireLocation: true, requireBudget: true, requirePropertyType: true },
    voice: {
      ttsProvider: env.TTS_PROVIDER,
      voiceId: null,
      greeting: 'Namaste! I am your property assistant. How can I help you today?',
      maxCallMinutes: 15,
    },
  };
}

const cache = new Map<string, { value: unknown; at: number }>();
const TTL = 15_000;

async function read<T>(key: string, schema: { safeParse(v: unknown): { success: boolean; data?: T } }, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const row = await prisma.businessSetting.findUnique({ where: { key } });
  let value = fallback;
  if (row) {
    const merged = { ...(fallback as object), ...(row.value as object) };
    const r = schema.safeParse(merged);
    if (r.success && r.data) value = r.data;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

export const settingsService = {
  getBusiness: () => read<BusinessSettings>('business', businessSettingsSchema, DEFAULT_BUSINESS),
  getAi: () => read<AiSettings>('ai', aiSettingsSchema, defaultAi()),
  async save(key: 'business' | 'ai', value: BusinessSettings | AiSettings, userId?: string) {
    await prisma.businessSetting.upsert({
      where: { key },
      update: { value: value as object, updatedBy: userId ?? null },
      create: { key, value: value as object, updatedBy: userId ?? null },
    });
    cache.delete(key);
  },
  clearCache: () => cache.clear(),
};
