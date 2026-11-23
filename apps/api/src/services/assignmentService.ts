import type { BrokerProfile, Lead, Prisma } from '@prisma/client';
import { ACTIVE_LEAD_STATUSES, type FallbackPolicy } from '@rea/shared';

type Tx = Prisma.TransactionClient;
type BrokerWithUser = BrokerProfile & { user: { fullName: string; isActive: boolean } };

export type Candidate = {
  brokerId: string;
  name: string;
  activeLeads: number;
  maxActiveLeads: number;
  loadRatio: number;
  locationMatch: boolean;
  specializationMatch: boolean;
};

export type AssignmentDecision = {
  broker: BrokerWithUser | null;
  reason: string;
  candidates: Candidate[];
  usedFallback: boolean;
};

export function locationMatches(areas: string[], location: string | null | undefined): boolean {
  if (!location) return false;
  const loc = location.trim().toLowerCase();
  if (!loc) return false;
  return areas.some((a) => {
    const area = a.trim().toLowerCase();
    return area.length > 0 && (area === loc || loc.includes(area) || area.includes(loc));
  });
}

/**
 * Deterministic broker selection (prompt §6):
 *  1. location match → 2. active + AVAILABLE → 3. under capacity →
 *  4. lowest load ratio, then specialization match, then least-recently assigned.
 *  If no location-matched broker qualifies, apply the configured fallback policy.
 */
export async function pickBroker(
  tx: Tx,
  lead: Pick<Lead, 'preferredLocation' | 'propertyType'>,
  fallbackPolicy: FallbackPolicy,
): Promise<AssignmentDecision> {
  const brokers = (await tx.brokerProfile.findMany({
    where: { status: 'ACTIVE', availability: 'AVAILABLE', user: { isActive: true } },
    include: { user: { select: { fullName: true, isActive: true } } },
  })) as BrokerWithUser[];
  if (brokers.length === 0) {
    return { broker: null, reason: 'No active, available brokers.', candidates: [], usedFallback: false };
  }
  const counts = await tx.lead.groupBy({
    by: ['brokerId'],
    where: { brokerId: { in: brokers.map((b) => b.id) }, status: { in: ACTIVE_LEAD_STATUSES } },
    _count: { _all: true },
  });
  const load = new Map(counts.map((c) => [c.brokerId, c._count._all]));

  const candidates: Candidate[] = brokers.map((b) => {
    const active = load.get(b.id) ?? 0;
    return {
      brokerId: b.id,
      name: b.user.fullName,
      activeLeads: active,
      maxActiveLeads: b.maxActiveLeads,
      loadRatio: active / Math.max(1, b.maxActiveLeads),
      locationMatch: locationMatches(b.areas, lead.preferredLocation),
      specializationMatch: lead.propertyType ? b.specialization.includes(lead.propertyType) : false,
    };
  });
  const lastAssigned = new Map(brokers.map((b) => [b.id, b.lastAssignedAt?.getTime() ?? 0]));
  const rank = (a: Candidate, b: Candidate) =>
    a.loadRatio - b.loadRatio ||
    Number(b.specializationMatch) - Number(a.specializationMatch) ||
    (lastAssigned.get(a.brokerId) ?? 0) - (lastAssigned.get(b.brokerId) ?? 0) ||
    a.brokerId.localeCompare(b.brokerId);

  const withCapacity = candidates.filter((c) => c.activeLeads < c.maxActiveLeads);
  const located = withCapacity.filter((c) => c.locationMatch).sort(rank);
  const byId = (id: string) => brokers.find((b) => b.id === id)!;

  if (located.length > 0) {
    const c = located[0]!;
    return {
      broker: byId(c.brokerId),
      reason: `Covers "${lead.preferredLocation}"; lowest workload among ${located.length} matching broker(s) (${c.activeLeads}/${c.maxActiveLeads} active)${c.specializationMatch ? '; specialises in ' + lead.propertyType : ''}.`,
      candidates,
      usedFallback: false,
    };
  }

  const noLocReason = lead.preferredLocation
    ? `No available broker with capacity covers "${lead.preferredLocation}".`
    : 'Lead has no preferred location.';

  if (fallbackPolicy === 'UNASSIGNED_QUEUE') {
    return { broker: null, reason: `${noLocReason} Fallback policy UNASSIGNED_QUEUE: left for manual assignment.`, candidates, usedFallback: true };
  }
  const any = withCapacity.sort(rank);
  if (any.length === 0) {
    return { broker: null, reason: `${noLocReason} All available brokers are at capacity.`, candidates, usedFallback: true };
  }
  const c = any[0]!;
  return {
    broker: byId(c.brokerId),
    reason: `${noLocReason} Fallback LEAST_LOADED_ANY_AREA: ${c.name} has the lowest workload (${c.activeLeads}/${c.maxActiveLeads}).`,
    candidates,
    usedFallback: true,
  };
}
