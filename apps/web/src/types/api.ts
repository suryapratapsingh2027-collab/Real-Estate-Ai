import type { Availability, CallStatus, LeadSource, LeadStatus, MessageStatus, PropertyType, Urgency } from '@rea/shared';

export type Property = {
  id: string;
  propertyCode: string;
  title: string;
  description: string | null;
  propertyType: PropertyType;
  listingType: 'SALE' | 'RENT';
  location: string;
  city: string;
  state: string;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area: number | null;
  areaUnit: string;
  price: number;
  priceRange: string | null;
  furnishing: string | null;
  amenities: string[];
  availability: Availability;
  brokerId: string | null;
  broker?: { id: string; user: { fullName: string } } | null;
  images?: Array<{ id: string; url: string }>;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BrokerStats = { total: number; active: number; converted: number; lost: number; conversionRate: number };
export type Broker = {
  id: string;
  userId: string;
  phone: string;
  whatsappNumber: string | null;
  areas: string[];
  specialization: PropertyType[];
  experienceYears: number;
  availability: 'AVAILABLE' | 'BUSY' | 'ON_LEAVE';
  maxActiveLeads: number;
  status: 'ACTIVE' | 'INACTIVE';
  user: { id: string; fullName: string; email: string; isActive: boolean; lastLoginAt?: string | null };
  stats?: BrokerStats;
  leads?: Lead[];
  createdAt: string;
};

export type Customer = {
  id: string;
  fullName: string | null;
  phone: string;
  whatsappNumber: string | null;
  email: string | null;
  preferredLanguage: string | null;
  preferredPropertyType: PropertyType | null;
  budgetRange: string | null;
  preferredLocation: string | null;
  notes: string | null;
  whatsappConsent: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { leads: number; voiceCalls: number };
};

export type LeadActivity = { id: string; type: string; message: string; createdAt: string; actor: { fullName: string } | null };
export type FollowUp = {
  id: string;
  leadId: string;
  title: string;
  description: string | null;
  dueAt: string;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  overdue?: boolean;
  assignee?: { fullName: string } | null;
  lead?: { id: string; number: number; customer: { fullName: string | null; phone: string } };
};

export type Lead = {
  id: string;
  number: number;
  leadNumber: string;
  customerId: string;
  customer?: { id: string; fullName: string | null; phone: string } & Partial<Customer>;
  originalMessage: string | null;
  propertyType: PropertyType | null;
  listingType: 'SALE' | 'RENT' | null;
  budgetRange: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  preferredLocation: string | null;
  bedrooms: number | null;
  urgency: Urgency;
  summary: string | null;
  source: LeadSource;
  isQualified: boolean;
  status: LeadStatus;
  brokerId: string | null;
  broker?: { id: string; user: { fullName: string; email?: string } } | null;
  assignedAt: string | null;
  assignmentReason: string | null;
  followUpAt: string | null;
  lostReason: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  activities?: LeadActivity[];
  followUps?: FollowUp[];
  voiceCalls?: Array<{ id: string; status: CallStatus; createdAt: string; durationSeconds: number | null; summary: string | null; recordingStatus: string }>;
  notifications?: Array<{ id: string; type: string; status: MessageStatus; createdAt: string; lastError: string | null; title: string }>;
};

export type Conversation = {
  id: string;
  customerId: string;
  customer: { id: string; fullName: string | null; phone: string; whatsappNumber?: string | null; leads?: Array<{ id: string; number: number; status: LeadStatus; brokerId: string | null; summary: string | null }> };
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastMessageText: string | null;
  humanTakeover: boolean;
  summary: string | null;
  summaryUpdatedAt: string | null;
  unreadCount: number;
  windowOpen?: boolean;
};

export type Message = {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender: 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM';
  body: string;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  senderUser?: { fullName: string } | null;
  aiMeta?: { qualified?: boolean; wantsVoiceCall?: boolean; fallback?: boolean; provider?: string } | null;
};

export type VoiceCall = {
  id: string;
  leadId: string | null;
  customerId: string;
  roomName: string;
  status: CallStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  summary: string | null;
  propertyType: string | null;
  budget: string | null;
  preferredLocation: string | null;
  urgency: string | null;
  recordingConsent: boolean;
  recordingStatus: string;
  failureReason: string | null;
  createdAt: string;
  customer: { id: string; fullName: string | null; phone: string };
  lead: { id: string; number: number; status?: LeadStatus } | null;
  transcript?: { segments: Array<{ role: 'user' | 'assistant'; text: string; at?: string }>; fullText: string } | null;
};

export type Notification = {
  id: string;
  type: string;
  channel: 'WHATSAPP' | 'IN_APP';
  title: string;
  body: string;
  status: MessageStatus;
  toAddress: string | null;
  readAt: string | null;
  lastError: string | null;
  attempts: number;
  leadId: string | null;
  createdAt: string;
};

export type Integration = {
  key: 'whatsapp' | 'groq' | 'livekit' | 'tts' | 'storage';
  name: string;
  enabled: boolean;
  status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'OK' | 'ERROR';
  config: Record<string, string>;
  configFields: string[];
  secretFields: Record<string, { hasValue: boolean; last4: string | null }>;
  requiredFields: string[];
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type UserRow = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { name: string };
  brokerProfile: { id: string } | null;
};

export type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  data: unknown;
  createdAt: string;
  actor: { fullName: string; email: string } | null;
};
