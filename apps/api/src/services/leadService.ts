import type { Lead, LeadSource, Prisma, PropertyType, Urgency } from '@prisma/client';
import {
  maskPhone,
  normalizeListingType,
  normalizePropertyType,
  normalizeUrgency,
  parseBudget,
  humanize,
  type AiReply,
} from '@rea/shared';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, notFound } from '../utils/errors';
import { pickBroker } from './assignmentService';
import { createInAppNotification, queueWhatsAppNotification } from './notificationService';
import { realtime, roomsFor } from './realtime';
import { settingsService } from './settingsService';

export const leadNo = (n: number) => `LD-${String(n).padStart(6, '0')}`;
const ASSIGN_LOCK_KEY = 4_242_001; // pg advisory lock id serialising assignments

export type LeadFields = {
  propertyType?: PropertyType | null;
  listingType?: 'SALE' | 'RENT' | null;
  budgetRange?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  preferredLocation?: string | null;
  bedrooms?: number | null;
  urgency?: Urgency;
  summary?: string | null;
};

export function fieldsFromAi(r: AiReply): LeadFields {
  const parsedBudget = parseBudget(r.budget_range);
  return {
    propertyType: normalizePropertyType(r.property_type),
    listingType: normalizeListingType(r.listing_type),
    budgetRange: r.budget_range ?? null,
    budgetMin: r.budget_min ?? parsedBudget.min,
    budgetMax: r.budget_max ?? parsedBudget.max,
    preferredLocation: r.preferred_location?.trim() || null,
    bedrooms: r.bedrooms ?? null,
    urgency: normalizeUrgency(r.urgency),
    summary: r.lead_summary ?? null,
  };
}

function sameText(a?: string | null, b?: string | null) {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/** Find an open lead for the same requirement (so repeated chats don't create duplicates). */
async function findOpenMatchingLead(customerId: string, f: LeadFields): Promise<Lead | null> {
  const open = await prisma.lead.findMany({
    where: { customerId, status: { notIn: ['CONVERTED', 'LOST'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return (
    open.find(
      (l) =>
        (!l.propertyType || !f.propertyType || l.propertyType === f.propertyType) &&
        (!l.preferredLocation || !f.preferredLocation || sameText(l.preferredLocation, f.preferredLocation)),
    ) ?? null
  );
}

function leadData(f: LeadFields) {
  return {
    propertyType: f.propertyType ?? undefined,
    listingType: f.listingType ?? undefined,
    budgetRange: f.budgetRange ?? undefined,
    budgetMin: f.budgetMin ?? undefined,
    budgetMax: f.budgetMax ?? undefined,
    preferredLocation: f.preferredLocation ?? undefined,
    bedrooms: f.bedrooms ?? undefined,
    urgency: f.urgency && f.urgency !== 'UNKNOWN' ? f.urgency : undefined,
    summary: f.summary ?? undefined,
  };
}

export async function createLead(input: {
  customerId: string;
  conversationId?: string | null;
  originalMessage?: string | null;
  source: LeadSource;
  qualified: boolean;
  fields: LeadFields;
  actorId?: string | null;
}): Promise<Lead> {
  const lead = await prisma.lead.create({
    data: {
      customerId: input.customerId,
      conversationId: input.conversationId ?? null,
      originalMessage: input.originalMessage ?? null,
      source: input.source,
      isQualified: input.qualified,
      status: input.qualified ? 'QUALIFIED' : 'NEW',
      ...leadData(input.fields),
      activities: {
        create: {
          actorId: input.actorId ?? null,
          type: 'CREATED',
          message: `Lead created from ${input.source.toLowerCase()}${input.qualified ? ' (qualified)' : ''}`,
        },
      },
    },
  });
  realtime.publish({ event: 'dashboard:refresh', payload: {}, rooms: ['staff'] });
  return lead;
}

/**
 * The single entry point for qualified leads (prompt §10). Creates or updates the lead,
 * then runs assignment and queues notifications. Independent of voice-call intent.
 */
export async function upsertQualifiedLead(input: {
  customerId: string;
  conversationId?: string | null;
  originalMessage?: string | null;
  source: LeadSource;
  fields: LeadFields;
  actorId?: string | null;
}): Promise<{ lead: Lead; created: boolean; newlyQualified: boolean }> {
  const existing = await findOpenMatchingLead(input.customerId, input.fields);
  let lead: Lead;
  let created = false;
  let newlyQualified = false;
  if (existing) {
    newlyQualified = !existing.isQualified;
    lead = await prisma.lead.update({
      where: { id: existing.id },
      data: {
        ...leadData(input.fields),
        isQualified: true,
        status: existing.status === 'NEW' ? 'QUALIFIED' : existing.status,
        conversationId: existing.conversationId ?? input.conversationId ?? null,
        activities: {
          create: {
            actorId: input.actorId ?? null,
            type: newlyQualified ? 'QUALIFIED' : 'UPDATED',
            message: newlyQualified ? 'Lead qualified by AI' : 'Requirement details updated',
            data: leadData(input.fields) as object,
          },
        },
      },
    });
  } else {
    lead = await createLead({ ...input, qualified: true });
    created = true;
    newlyQualified = true;
  }

  // Update customer profile with latest preferences (non-destructive).
  await prisma.customer.update({
    where: { id: input.customerId },
    data: {
      preferredLocation: input.fields.preferredLocation ?? undefined,
      budgetRange: input.fields.budgetRange ?? undefined,
      preferredPropertyType: input.fields.propertyType ?? undefined,
    },
  });

  if (newlyQualified && !lead.brokerId) {
    try {
      await assignLead(lead.id, { auto: true, actorId: input.actorId ?? null });
    } catch (err) {
      // Assignment failure must not lose the lead.
      logger.error({ err, leadId: lead.id }, 'auto-assignment failed');
    }
    await notifyCustomerLeadRegistered(lead.id);
    lead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  }
  return { lead, created, newlyQualified };
}

/** Auto or manual assignment, serialised with a Postgres advisory lock to keep workload counts accurate. */
export async function assignLead(
  leadId: string,
  opts: { auto?: boolean; brokerId?: string; actorId?: string | null; reason?: string },
) {
  const business = await settingsService.getBusiness();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ASSIGN_LOCK_KEY})`;
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound('Lead');
    if (lead.status === 'CONVERTED' || lead.status === 'LOST') throw badRequest('Closed leads cannot be reassigned');
    const previousBrokerId = lead.brokerId;

    let brokerId: string | null = null;
    let reason: string;
    let candidates: unknown = undefined;
    if (opts.brokerId) {
      const b = await tx.brokerProfile.findUnique({ where: { id: opts.brokerId }, include: { user: true } });
      if (!b || b.status !== 'ACTIVE' || !b.user.isActive) throw badRequest('Broker is not active');
      brokerId = b.id;
      reason = `Manually assigned to ${b.user.fullName}${opts.reason ? `: ${opts.reason}` : ''}`;
    } else {
      const d = await pickBroker(tx, lead, business.fallbackPolicy);
      brokerId = d.broker?.id ?? null;
      reason = d.reason;
      candidates = d.candidates;
    }

    if (!brokerId) {
      await tx.leadActivity.create({
        data: { leadId, actorId: opts.actorId ?? null, type: 'ASSIGNMENT_FAILED', message: reason, data: { candidates } as object },
      });
      await tx.lead.update({ where: { id: leadId }, data: { assignmentReason: reason } });
      return { lead, brokerId: null, previousBrokerId, reason };
    }

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        brokerId,
        assignedAt: new Date(),
        assignmentReason: reason,
        status: ['NEW', 'QUALIFIED'].includes(lead.status) ? 'ASSIGNED' : lead.status,
        activities: {
          create: {
            actorId: opts.actorId ?? null,
            type: previousBrokerId ? 'REASSIGNED' : 'ASSIGNED',
            message: reason,
            data: { brokerId, previousBrokerId, candidates } as object,
          },
        },
      },
    });
    await tx.brokerProfile.update({ where: { id: brokerId }, data: { lastAssignedAt: new Date() } });
    return { lead: updated, brokerId, previousBrokerId, reason };
  });

  if (result.brokerId && result.brokerId !== result.previousBrokerId) {
    await notifyBrokerOfLead(result.lead.id, result.previousBrokerId ? 'LEAD_REASSIGNED' : 'BROKER_NEW_LEAD');
  }
  realtime.publish({ event: 'lead:updated', payload: { leadId }, rooms: roomsFor(result.brokerId) });
  return result;
}

export async function notifyBrokerOfLead(leadId: string, type: 'BROKER_NEW_LEAD' | 'LEAD_REASSIGNED') {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { customer: true, broker: { include: { user: true } } } });
  if (!lead?.broker) return;
  const budget = lead.budgetRange ? `₹${lead.budgetRange.replace(/^₹/, '')}` : 'Not specified';
  const body = [
    type === 'BROKER_NEW_LEAD' ? 'New Qualified Lead' : 'Lead Reassigned to You',
    '',
    `Lead: ${leadNo(lead.number)}`,
    `Customer: ${lead.customer.fullName ?? 'Unknown'}`,
    `Phone: ${lead.customer.phone}`,
    `Property Type: ${lead.propertyType ? humanize(lead.propertyType) : 'Not specified'}${lead.bedrooms != null ? ` (${lead.bedrooms} BHK)` : ''}`,
    `Budget: ${budget}`,
    `Location: ${lead.preferredLocation ?? 'Not specified'}`,
    `Urgency: ${humanize(lead.urgency)}`,
    lead.summary ? `Summary: ${lead.summary}` : null,
    '',
    'Please contact the customer.',
  ]
    .filter((l) => l !== null)
    .join('\n');
  await queueWhatsAppNotification({
    type,
    toAddress: lead.broker.whatsappNumber ?? lead.broker.phone,
    title: `${type === 'BROKER_NEW_LEAD' ? 'New lead' : 'Reassigned lead'} ${leadNo(lead.number)}`,
    body,
    leadId: lead.id,
    brokerId: lead.broker.id,
  });
  await createInAppNotification({
    userId: lead.broker.userId,
    type,
    title: `${type === 'BROKER_NEW_LEAD' ? 'New lead assigned' : 'Lead reassigned to you'}: ${leadNo(lead.number)}`,
    body: `${lead.customer.fullName ?? maskPhone(lead.customer.phone)} — ${lead.summary ?? lead.preferredLocation ?? ''}`.slice(0, 300),
    leadId: lead.id,
    brokerId: lead.broker.id,
  });
}

export async function notifyCustomerLeadRegistered(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { customer: true } });
  if (!lead) return;
  const already = await prisma.notification.findFirst({ where: { leadId, type: 'CUSTOMER_LEAD_CONFIRMATION' } });
  if (already) return;
  const hi = lead.customer.preferredLanguage === 'hi';
  const body = hi
    ? `Dhanyavaad! Aapki property requirement (${leadNo(lead.number)}) register ho gayi hai. Hamare real estate consultant jaldi aapse sampark karenge.`
    : `Thank you for sharing your property requirements (ref ${leadNo(lead.number)}). Our real estate consultant will contact you shortly.`;
  await queueWhatsAppNotification({
    type: 'CUSTOMER_LEAD_CONFIRMATION',
    toAddress: lead.customer.whatsappNumber ?? lead.customer.phone,
    title: 'Requirement registered',
    body,
    leadId: lead.id,
    customerId: lead.customerId,
  });
}

export async function addActivity(leadId: string, type: string, message: string, actorId?: string | null, data?: Prisma.InputJsonValue) {
  return prisma.leadActivity.create({ data: { leadId, type, message, actorId: actorId ?? null, data } });
}
