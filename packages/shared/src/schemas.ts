import { z } from 'zod';
import {
  ACCOUNT_STATUS,
  AREA_UNITS,
  AVAILABILITY,
  BROKER_AVAILABILITY,
  FALLBACK_POLICIES,
  FOLLOWUP_STATUS,
  FURNISHING,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LISTING_TYPES,
  PROPERTY_TYPES,
  ROLES,
  URGENCY,
} from './enums';

const optionalString = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v === '' ? null : v));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[0-9]/, 'Needs a number');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  password: passwordSchema,
  role: z.enum(ROLES),
});
export const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});

// ---------- Property ----------
export const propertyBaseSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: optionalString,
  propertyType: z.enum(PROPERTY_TYPES),
  listingType: z.enum(LISTING_TYPES),
  location: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  address: optionalString,
  bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
  bathrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
  area: z.coerce.number().positive().max(10_000_000).optional().nullable(),
  areaUnit: z.enum(AREA_UNITS).default('SQFT'),
  price: z.coerce.number().positive().max(1e12),
  priceRange: optionalString,
  furnishing: z.enum(FURNISHING).optional().nullable(),
  amenities: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  availability: z.enum(AVAILABILITY).default('AVAILABLE'),
  brokerId: z.string().uuid().optional().nullable(),
});
export const propertyCreateSchema = propertyBaseSchema;
export const propertyUpdateSchema = propertyBaseSchema.partial();
export type PropertyInput = z.infer<typeof propertyCreateSchema>;

export const propertyQuerySchema = paginationSchema.extend({
  city: z.string().trim().max(80).optional(),
  location: z.string().trim().max(120).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  availability: z.enum(AVAILABILITY).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  bedrooms: z.coerce.number().int().min(0).optional(),
});

// ---------- Broker ----------
export const brokerCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(8).max(20),
  whatsappNumber: z.string().trim().min(8).max(20).optional().nullable(),
  password: passwordSchema.optional(),
  areas: z.array(z.string().trim().min(2).max(120)).max(50).default([]),
  specialization: z.array(z.enum(PROPERTY_TYPES)).default([]),
  experienceYears: z.coerce.number().int().min(0).max(80).default(0),
  availability: z.enum(BROKER_AVAILABILITY).default('AVAILABLE'),
  maxActiveLeads: z.coerce.number().int().min(1).max(1000).default(20),
  status: z.enum(ACCOUNT_STATUS).default('ACTIVE'),
});
export const brokerUpdateSchema = brokerCreateSchema.omit({ password: true }).partial();
export type BrokerInput = z.infer<typeof brokerCreateSchema>;

// ---------- Customer ----------
export const customerUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional().nullable(),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('').transform(() => null)),
  preferredLanguage: z.string().trim().max(20).optional().nullable(),
  preferredPropertyType: z.enum(PROPERTY_TYPES).optional().nullable(),
  budgetRange: optionalString,
  preferredLocation: optionalString,
  notes: optionalString,
  whatsappConsent: z.boolean().optional(),
});

// ---------- Lead ----------
export const leadCreateSchema = z.object({
  customerPhone: z.string().trim().min(8).max(20),
  customerName: z.string().trim().max(120).optional().nullable(),
  propertyType: z.enum(PROPERTY_TYPES).optional().nullable(),
  budgetRange: optionalString,
  budgetMin: z.coerce.number().nonnegative().optional().nullable(),
  budgetMax: z.coerce.number().nonnegative().optional().nullable(),
  preferredLocation: optionalString,
  bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
  urgency: z.enum(URGENCY).default('UNKNOWN'),
  summary: optionalString,
  source: z.enum(LEAD_SOURCES).default('MANUAL'),
  autoAssign: z.boolean().default(true),
});
export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional().nullable(),
  budgetRange: optionalString,
  preferredLocation: optionalString,
  bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
  urgency: z.enum(URGENCY).optional(),
  summary: optionalString,
  followUpAt: z.coerce.date().optional().nullable(),
  lostReason: optionalString,
});
export const leadAssignSchema = z.object({
  brokerId: z.string().uuid().optional(),
  auto: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});
export const leadNoteSchema = z.object({ note: z.string().trim().min(1).max(5000) });
export const leadQuerySchema = paginationSchema.extend({
  status: z.enum(LEAD_STATUSES).optional(),
  brokerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  location: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// ---------- Follow-ups ----------
export const followUpCreateSchema = z.object({
  leadId: z.string().uuid(),
  dueAt: z.coerce.date(),
  title: z.string().trim().min(2).max(200),
  description: optionalString,
  assigneeId: z.string().uuid().optional().nullable(),
});
export const followUpUpdateSchema = z.object({
  dueAt: z.coerce.date().optional(),
  title: z.string().trim().min(2).max(200).optional(),
  description: optionalString,
  status: z.enum(FOLLOWUP_STATUS).optional(),
});

// ---------- Conversations ----------
export const replySchema = z.object({ text: z.string().trim().min(1).max(4000) });
export const takeoverSchema = z.object({ active: z.boolean() });

// ---------- Voice ----------
export const voiceRoomCreateSchema = z.object({ leadId: z.string().uuid(), sendLink: z.boolean().default(true) });
export const voiceTokenSchema = z.object({ code: z.string().trim().min(20).max(200), recordingConsent: z.boolean().default(false) });
export const voiceEndSchema = z.object({ code: z.string().trim().min(20).max(200) });

export const voiceSummarySchema = z.object({
  roomName: z.string().min(1).max(200),
  transcript: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(10000),
        at: z.string().optional(),
      }),
    )
    .max(2000),
  summary: z.string().max(10000).optional().nullable(),
  propertyType: z.string().max(60).optional().nullable(),
  budget: z.string().max(120).optional().nullable(),
  preferredLocation: z.string().max(120).optional().nullable(),
  urgency: z.string().max(60).optional().nullable(),
  startedAt: z.string().optional().nullable(),
  endedAt: z.string().optional().nullable(),
});
export type VoiceSummaryInput = z.infer<typeof voiceSummarySchema>;

// ---------- Settings ----------
export const businessSettingsSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessPhone: optionalString,
  businessWhatsapp: optionalString,
  businessAddress: optionalString,
  businessEmail: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
  logoUrl: optionalString,
  workingHours: z.string().trim().max(200).optional().nullable(),
  timezone: z.string().trim().max(60).default('Asia/Kolkata'),
  fallbackPolicy: z.enum(FALLBACK_POLICIES).default('LEAST_LOADED_ANY_AREA'),
  recordingEnabled: z.boolean().default(false),
  recordingRetentionDays: z.coerce.number().int().min(1).max(3650).default(30),
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

export const aiSettingsSchema = z.object({
  provider: z.enum(['groq', 'mock']),
  model: z.string().trim().min(2).max(120),
  temperature: z.coerce.number().min(0).max(1.5),
  systemPromptAddendum: z.string().max(8000).default(''),
  languages: z.array(z.string().trim().max(30)).default(['English', 'Hindi', 'Hinglish']),
  qualificationRules: z.object({
    requireLocation: z.boolean().default(true),
    requireBudget: z.boolean().default(true),
    requirePropertyType: z.boolean().default(true),
  }),
  voice: z.object({
    ttsProvider: z.enum(['cartesia', 'elevenlabs']).default('cartesia'),
    voiceId: z.string().trim().max(120).optional().nullable(),
    greeting: z.string().max(500).default('Namaste! I am your property assistant. How can I help you today?'),
    maxCallMinutes: z.coerce.number().int().min(1).max(60).default(15),
  }),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const integrationUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  /** Non-secret config (e.g. phone number id, LiveKit URL). */
  config: z.record(z.string(), z.string().max(500)).optional(),
  /** Secret values; empty string clears a secret. Never returned. */
  secrets: z.record(z.string(), z.string().max(4000)).optional(),
});
