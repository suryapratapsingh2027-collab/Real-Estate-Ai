export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'BROKER'] as const;
export type RoleName = (typeof ROLES)[number];

export const LEAD_STATUSES = [
  'NEW',
  'QUALIFIED',
  'ASSIGNED',
  'CONTACTED',
  'INTERESTED',
  'SITE_VISIT_SCHEDULED',
  'NEGOTIATION',
  'CONVERTED',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** Statuses that count against a broker's active workload. */
export const ACTIVE_LEAD_STATUSES: LeadStatus[] = [
  'ASSIGNED',
  'CONTACTED',
  'INTERESTED',
  'SITE_VISIT_SCHEDULED',
  'NEGOTIATION',
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  QUALIFIED: 'Qualified',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  SITE_VISIT_SCHEDULED: 'Site Visit Scheduled',
  NEGOTIATION: 'Negotiation',
  CONVERTED: 'Converted',
  LOST: 'Lost',
};

export const LEAD_SOURCES = ['WHATSAPP', 'VOICE', 'MANUAL', 'WEBSITE'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const PROPERTY_TYPES = ['APARTMENT', 'VILLA', 'INDEPENDENT_HOUSE', 'PLOT', 'COMMERCIAL', 'OFFICE', 'SHOP', 'OTHER'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const LISTING_TYPES = ['SALE', 'RENT'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const FURNISHING = ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'] as const;
export const AVAILABILITY = ['AVAILABLE', 'UNDER_OFFER', 'SOLD', 'RENTED', 'INACTIVE'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const AREA_UNITS = ['SQFT', 'SQM', 'SQYD', 'ACRE'] as const;

export const BROKER_AVAILABILITY = ['AVAILABLE', 'BUSY', 'ON_LEAVE'] as const;
export const ACCOUNT_STATUS = ['ACTIVE', 'INACTIVE'] as const;

export const URGENCY = ['IMMEDIATE', 'WITHIN_1_MONTH', 'WITHIN_3_MONTHS', 'EXPLORING', 'UNKNOWN'] as const;
export type Urgency = (typeof URGENCY)[number];

export const MESSAGE_STATUS = [
  'RECEIVED',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED_NOT_CONFIGURED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[number];

export const CALL_STATUS = ['CREATED', 'LINK_SENT', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'FAILED', 'EXPIRED'] as const;
export type CallStatus = (typeof CALL_STATUS)[number];

export const FOLLOWUP_STATUS = ['PENDING', 'DONE', 'CANCELLED'] as const;

export const INTEGRATION_KEYS = ['whatsapp', 'groq', 'livekit', 'tts', 'storage'] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];
export const INTEGRATION_STATUS = ['NOT_CONFIGURED', 'CONFIGURED', 'OK', 'ERROR'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUS)[number];

export const FALLBACK_POLICIES = ['LEAST_LOADED_ANY_AREA', 'UNASSIGNED_QUEUE'] as const;
export type FallbackPolicy = (typeof FALLBACK_POLICIES)[number];

export function humanize(v: string): string {
  return v
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
