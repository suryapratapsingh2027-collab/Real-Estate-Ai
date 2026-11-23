import { describe, expect, it } from 'vitest';
import {
  aiReplySchema,
  detectLanguage,
  normalizePhone,
  normalizePropertyType,
  normalizeUrgency,
  parseBudget,
  ROLE_PERMISSIONS,
} from './index';

describe('normalizePhone', () => {
  it('handles WhatsApp format, local 10-digit, leading zero and +', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizePhone('0044 20 7946 0958')).toBe('+442079460958');
  });
  it('rejects garbage', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('parseBudget', () => {
  it('parses lakh ranges', () => expect(parseBudget('50-70 Lakhs')).toEqual({ min: 5_000_000, max: 7_000_000 }));
  it('parses crore upper bound', () => expect(parseBudget('under 1.2 Cr')).toEqual({ min: null, max: 12_000_000 }));
  it('parses rent in k', () => expect(parseBudget('upto 25k')).toEqual({ min: null, max: 25_000 }));
  it('returns nulls for no numbers', () => expect(parseBudget('flexible')).toEqual({ min: null, max: null }));
});

describe('normalizers', () => {
  it('maps property types', () => {
    expect(normalizePropertyType('2 BHK flat')).toBe('APARTMENT');
    expect(normalizePropertyType('Villa')).toBe('VILLA');
    expect(normalizePropertyType('spaceship')).toBeNull();
  });
  it('maps urgency', () => {
    expect(normalizeUrgency('Immediate')).toBe('IMMEDIATE');
    expect(normalizeUrgency('within 3 months')).toBe('WITHIN_3_MONTHS');
    expect(normalizeUrgency(null)).toBe('UNKNOWN');
  });
  it('detects Hindi / Hinglish', () => {
    expect(detectLanguage('मुझे घर चाहिए')).toBe('hi');
    expect(detectLanguage('mujhe 2bhk chahiye')).toBe('hi');
    expect(detectLanguage('I need a flat')).toBe('en');
  });
});

describe('aiReplySchema', () => {
  it('accepts the documented example', () => {
    const r = aiReplySchema.safeParse({
      reply_message: 'Customer-facing reply',
      is_qualified_lead: true,
      wants_voice_call: false,
      property_type: 'Apartment',
      budget_range: '50-70 Lakhs',
      preferred_location: 'Bhopal',
      urgency: 'Immediate',
      lead_summary: 'Customer wants a 2 BHK apartment in Bhopal',
      missing_information: [],
    });
    expect(r.success).toBe(true);
  });
  it('rejects missing reply', () => {
    expect(aiReplySchema.safeParse({ is_qualified_lead: true, wants_voice_call: false }).success).toBe(false);
  });
});

describe('permissions', () => {
  it('brokers cannot manage users or integrations', () => {
    expect(ROLE_PERMISSIONS.BROKER).not.toContain('user:manage');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('settings:integrations');
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toContain('audit:read');
  });
});
