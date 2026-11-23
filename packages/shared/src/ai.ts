import { z } from 'zod';
import { PROPERTY_TYPES, URGENCY, LISTING_TYPES } from './enums';

/**
 * Structured output the WhatsApp AI must return (prompt §8).
 * Values are loosely typed strings from the model and normalised by `normalizeAiOutput`.
 */
export const aiReplySchema = z.object({
  reply_message: z.string().trim().min(1).max(3500),
  is_qualified_lead: z.boolean(),
  wants_voice_call: z.boolean(),
  property_type: z.string().max(60).nullable().optional(),
  listing_type: z.string().max(20).nullable().optional(),
  budget_range: z.string().max(120).nullable().optional(),
  budget_min: z.number().nonnegative().nullable().optional(),
  budget_max: z.number().nonnegative().nullable().optional(),
  preferred_location: z.string().max(120).nullable().optional(),
  bedrooms: z.number().int().min(0).max(50).nullable().optional(),
  urgency: z.string().max(60).nullable().optional(),
  lead_summary: z.string().max(1000).nullable().optional(),
  customer_name: z.string().max(120).nullable().optional(),
  missing_information: z.array(z.string().max(60)).max(10).default([]),
  recommended_property_ids: z.array(z.string()).max(10).default([]),
});
export type AiReply = z.infer<typeof aiReplySchema>;

/** Arguments the model may pass to the read-only `search_properties` tool. */
export const propertySearchArgsSchema = z.object({
  location: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  property_type: z.string().trim().max(60).optional().nullable(),
  listing_type: z.string().trim().max(20).optional().nullable(),
  min_price: z.number().nonnegative().optional().nullable(),
  max_price: z.number().nonnegative().optional().nullable(),
  bedrooms: z.number().int().min(0).max(50).optional().nullable(),
  limit: z.number().int().min(1).max(5).optional().nullable(),
});
export type PropertySearchArgs = z.infer<typeof propertySearchArgsSchema>;

const TYPE_ALIASES: Record<string, (typeof PROPERTY_TYPES)[number]> = {
  apartment: 'APARTMENT',
  flat: 'APARTMENT',
  bhk: 'APARTMENT',
  villa: 'VILLA',
  house: 'INDEPENDENT_HOUSE',
  'independent house': 'INDEPENDENT_HOUSE',
  independent_house: 'INDEPENDENT_HOUSE',
  bungalow: 'INDEPENDENT_HOUSE',
  plot: 'PLOT',
  land: 'PLOT',
  commercial: 'COMMERCIAL',
  office: 'OFFICE',
  shop: 'SHOP',
};

export function normalizePropertyType(v: string | null | undefined): (typeof PROPERTY_TYPES)[number] | null {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  const upper = k.toUpperCase().replace(/\s+/g, '_');
  if ((PROPERTY_TYPES as readonly string[]).includes(upper)) return upper as (typeof PROPERTY_TYPES)[number];
  for (const [alias, t] of Object.entries(TYPE_ALIASES)) if (k.includes(alias)) return t;
  return null;
}

export function normalizeListingType(v: string | null | undefined): (typeof LISTING_TYPES)[number] | null {
  if (!v) return null;
  const k = v.toLowerCase();
  if (/(rent|lease|kiraya|kiraye)/.test(k)) return 'RENT';
  if (/(sale|buy|purchase|kharid)/.test(k)) return 'SALE';
  return null;
}

export function normalizeUrgency(v: string | null | undefined): (typeof URGENCY)[number] {
  if (!v) return 'UNKNOWN';
  const k = v.toLowerCase();
  if (/(immediate|urgent|asap|turant|abhi|this week)/.test(k)) return 'IMMEDIATE';
  if (/(1 month|one month|this month|30 day|within a month)/.test(k)) return 'WITHIN_1_MONTH';
  if (/(3 month|three month|quarter|2 month|few month)/.test(k)) return 'WITHIN_3_MONTHS';
  if (/(explor|just looking|later|no hurry|not sure)/.test(k)) return 'EXPLORING';
  const upper = v.toUpperCase();
  if ((URGENCY as readonly string[]).includes(upper)) return upper as (typeof URGENCY)[number];
  return 'UNKNOWN';
}

/**
 * Parse Indian-style budget text into rupee amounts.
 * "50-70 Lakhs" → {min: 5_000_000, max: 7_000_000}; "1.2 Cr" → {max: 12_000_000}; "25k/month" → {max: 25_000}.
 */
export function parseBudget(text: string | null | undefined): { min: number | null; max: number | null } {
  if (!text) return { min: null, max: null };
  const t = text.toLowerCase().replace(/,/g, '');
  const unitOf = (s: string): number => {
    if (/(\d\s*cr\b|crore)/.test(s)) return 10_000_000;
    if (/(\d\s*l\b|lac|lakh)/.test(s)) return 100_000;
    if (/(\d\s*k\b|thousand)/.test(s)) return 1_000;
    return 1;
  };
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (nums.length === 0) return { min: null, max: null };
  const unit = unitOf(t);
  const scaled = nums.slice(0, 2).map((n) => Math.round(n * unit));
  if (scaled.length === 1) {
    const v = scaled[0]!;
    if (/(under|below|upto|up to|max|less than|tak)/.test(t)) return { min: null, max: v };
    if (/(above|over|min|more than|at least)/.test(t)) return { min: v, max: null };
    return { min: Math.round(v * 0.85), max: Math.round(v * 1.15) };
  }
  const [a, b] = scaled as [number, number];
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Fallback reply when the model output cannot be validated. Never contains raw model output. */
export function fallbackReply(language: 'hi' | 'en' = 'en'): AiReply {
  return {
    reply_message:
      language === 'hi'
        ? 'Maaf kijiye, abhi aapka sandesh samajhne mein dikkat aa rahi hai. Kripya apni zarurat (location, budget, property type) dobara batayein.'
        : 'Sorry, I had trouble processing that. Could you share your requirement again — location, budget and property type?',
    is_qualified_lead: false,
    wants_voice_call: false,
    missing_information: [],
    recommended_property_ids: [],
  };
}

/** Rough script/language detection used for fallback replies and mock provider. */
export function detectLanguage(text: string): 'hi' | 'en' {
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  if (/\b(hai|chahiye|mujhe|kya|ghar|kiraye|karna|nahi|haan|bhai|lakh)\b/i.test(text)) return 'hi';
  return 'en';
}
