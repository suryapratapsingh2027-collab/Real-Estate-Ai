import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ACTIVE_LEAD_STATUSES } from '@rea/shared';
import { prisma } from '../lib/prisma';
import { brokerScope, requireAuth, requirePermission } from '../middleware/auth';
import { parse } from '../utils/http';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

function scopes(req: Request) {
  const b = brokerScope(req);
  return {
    b,
    lead: b ? { brokerId: b } : {},
    customer: b ? { leads: { some: { brokerId: b } } } : {},
    convo: b ? { customer: { leads: { some: { brokerId: b } } } } : {},
    call: b ? { lead: { brokerId: b } } : {},
    sqlLead: b ? Prisma.sql`AND "brokerId" = ${b}::uuid` : Prisma.empty,
  };
}

dashboardRouter.get('/overview', requirePermission('dashboard:read'), async (req, res) => {
  const s = scopes(req);
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const [
    totalProperties, activeProperties, totalLeads, newLeads, qualifiedLeads, assignedLeads, convertedLeads, lostLeads,
    totalBrokers, totalCustomers, conversations, calls, failedCalls, leadsThisWeek, overdueFollowUps,
  ] = await Promise.all([
    prisma.property.count(),
    prisma.property.count({ where: { availability: 'AVAILABLE' } }),
    prisma.lead.count({ where: s.lead }),
    prisma.lead.count({ where: { ...s.lead, status: 'NEW' } }),
    prisma.lead.count({ where: { ...s.lead, isQualified: true } }),
    prisma.lead.count({ where: { AND: [s.lead, { brokerId: { not: null } }], status: { in: ACTIVE_LEAD_STATUSES } } }),
    prisma.lead.count({ where: { ...s.lead, status: 'CONVERTED' } }),
    prisma.lead.count({ where: { ...s.lead, status: 'LOST' } }),
    prisma.brokerProfile.count({ where: { status: 'ACTIVE' } }),
    prisma.customer.count({ where: s.customer }),
    prisma.conversation.count({ where: s.convo }),
    prisma.voiceCall.count({ where: s.call }),
    prisma.voiceCall.count({ where: { ...s.call, status: { in: ['MISSED', 'FAILED'] } } }),
    prisma.lead.count({ where: { ...s.lead, createdAt: { gte: since7 } } }),
    prisma.followUp.count({ where: { status: 'PENDING', dueAt: { lt: new Date() }, ...(s.b ? { lead: { brokerId: s.b } } : {}) } }),
  ]);
  const closed = convertedLeads + lostLeads;
  res.json({
    totalProperties, activeProperties, totalLeads, newLeads, qualifiedLeads, assignedLeads, convertedLeads,
    totalBrokers, totalCustomers, whatsappConversations: conversations, voiceCalls: calls, missedOrFailedCalls: failedCalls,
    conversionRate: closed ? Math.round((convertedLeads / closed) * 1000) / 10 : 0,
    conversionRateOfAll: totalLeads ? Math.round((convertedLeads / totalLeads) * 1000) / 10 : 0,
    leadsThisWeek, overdueFollowUps,
  });
});

dashboardRouter.get('/analytics', requirePermission('dashboard:read'), async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), req.query);
  const s = scopes(req);
  const since = new Date(Date.now() - days * 86_400_000);

  const [leadsOverTime, byType, byLocation, byStatus, brokerRows, messagesOverTime, callsByStatus, bySource] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Lead" WHERE "createdAt" >= ${since} ${s.sqlLead}
      GROUP BY 1 ORDER BY 1`,
    prisma.lead.groupBy({ by: ['propertyType'], where: { ...s.lead, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ location: string; count: bigint }>>`
      SELECT initcap(lower(trim("preferredLocation"))) AS location, COUNT(*)::bigint AS count
      FROM "Lead" WHERE "preferredLocation" IS NOT NULL AND "createdAt" >= ${since} ${s.sqlLead}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.lead.groupBy({ by: ['status'], where: s.lead, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ brokerId: string; name: string; total: bigint; converted: bigint; active: bigint; lost: bigint }>>`
      SELECT b.id AS "brokerId", u."fullName" AS name,
        COUNT(l.id)::bigint AS total,
        COUNT(l.id) FILTER (WHERE l.status = 'CONVERTED')::bigint AS converted,
        COUNT(l.id) FILTER (WHERE l.status = 'LOST')::bigint AS lost,
        COUNT(l.id) FILTER (WHERE l.status IN ('ASSIGNED','CONTACTED','INTERESTED','SITE_VISIT_SCHEDULED','NEGOTIATION'))::bigint AS active
      FROM "BrokerProfile" b JOIN "User" u ON u.id = b."userId"
      LEFT JOIN "Lead" l ON l."brokerId" = b.id AND l."createdAt" >= ${since}
      WHERE b.status = 'ACTIVE' ${s.b ? Prisma.sql`AND b.id = ${s.b}::uuid` : Prisma.empty}
      GROUP BY b.id, u."fullName" ORDER BY converted DESC, total DESC LIMIT 15`,
    prisma.$queryRaw<Array<{ day: Date; inbound: bigint; outbound: bigint }>>`
      SELECT date_trunc('day', m."createdAt") AS day,
        COUNT(*) FILTER (WHERE m.direction = 'INBOUND')::bigint AS inbound,
        COUNT(*) FILTER (WHERE m.direction = 'OUTBOUND')::bigint AS outbound
      FROM "Message" m
      ${s.b ? Prisma.sql`JOIN "Conversation" c ON c.id = m."conversationId" WHERE EXISTS (SELECT 1 FROM "Lead" l WHERE l."customerId" = c."customerId" AND l."brokerId" = ${s.b}::uuid) AND` : Prisma.sql`WHERE`}
      m."createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.voiceCall.groupBy({ by: ['status'], where: { ...s.call, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationSeconds: true } }),
    prisma.lead.groupBy({ by: ['source'], where: { ...s.lead, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);

  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const fill = <T extends Record<string, number>>(rows: Map<string, T>, empty: T) => {
    const out: Array<{ date: string } & T> = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(new Date(Date.now() - i * 86_400_000));
      out.push({ date: k, ...(rows.get(k) ?? empty) });
    }
    return out;
  };

  res.json({
    days,
    leadsOverTime: fill(new Map(leadsOverTime.map((r) => [dayKey(r.day), { count: Number(r.count) }])), { count: 0 }),
    leadsByPropertyType: byType.map((r) => ({ type: r.propertyType ?? 'UNSPECIFIED', count: r._count._all })),
    leadsByLocation: byLocation.map((r) => ({ location: r.location, count: Number(r.count) })),
    leadStatusDistribution: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
    leadsBySource: bySource.map((r) => ({ source: r.source, count: r._count._all })),
    brokerPerformance: brokerRows.map((r) => {
      const closed = Number(r.converted) + Number(r.lost);
      return { brokerId: r.brokerId, name: r.name, total: Number(r.total), converted: Number(r.converted), active: Number(r.active), conversionRate: closed ? Math.round((Number(r.converted) / closed) * 1000) / 10 : 0 };
    }),
    whatsappMessages: fill(new Map(messagesOverTime.map((r) => [dayKey(r.day), { inbound: Number(r.inbound), outbound: Number(r.outbound) }])), { inbound: 0, outbound: 0 }),
    voiceCallStats: callsByStatus.map((r) => ({ status: r.status, count: r._count._all, avgDurationSeconds: r._avg.durationSeconds ? Math.round(r._avg.durationSeconds) : null })),
  });
});
