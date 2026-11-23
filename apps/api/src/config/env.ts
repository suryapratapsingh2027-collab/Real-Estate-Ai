import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: opt,
  QUEUE_MODE: z.enum(['queue', 'inline']).default('queue'),

  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  AGENT_API_KEY: z.string().min(24),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  S3_ENDPOINT: opt,
  S3_REGION: opt,
  S3_BUCKET: opt,
  S3_ACCESS_KEY_ID: opt,
  S3_SECRET_ACCESS_KEY: opt,

  AI_PROVIDER: z.enum(['groq', 'mock']).default('mock'),
  GROQ_API_KEY: opt,
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  AI_MODEL: z.string().default('llama-3.3-70b-versatile'),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1.5).default(0.3),
  AI_TIMEOUT_MS: z.coerce.number().int().default(20000),

  WHATSAPP_ACCESS_TOKEN: opt,
  WHATSAPP_PHONE_NUMBER_ID: opt,
  WHATSAPP_APP_SECRET: opt,
  WHATSAPP_VERIFY_TOKEN: opt,
  WHATSAPP_GRAPH_VERSION: z.string().default('v22.0'),
  WHATSAPP_API_BASE: z.string().url().default('https://graph.facebook.com'),

  LIVEKIT_URL: opt,
  LIVEKIT_API_KEY: opt,
  LIVEKIT_API_SECRET: opt,
  LIVEKIT_AGENT_NAME: z.string().default('realestate-agent'),
  RECORDING_ENABLED: bool,
  RECORDING_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  CALL_LINK_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  CALL_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),

  TTS_PROVIDER: z.enum(['cartesia', 'elevenlabs']).default('cartesia'),
  CARTESIA_API_KEY: opt,
  ELEVENLABS_API_KEY: opt,

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Do not print values — only which keys are wrong.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.QUEUE_MODE === 'inline') {
    throw new Error('QUEUE_MODE=inline is not allowed in production');
  }
  if (env.QUEUE_MODE === 'queue' && !env.REDIS_URL) {
    throw new Error('REDIS_URL is required when QUEUE_MODE=queue');
  }
  return env;
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
