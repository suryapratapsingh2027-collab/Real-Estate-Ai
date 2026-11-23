import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { locationMatches, pickBroker } from '../src/services/assignmentService';
import { assignLead, upsertQualifiedLead } from '../src/services/leadService';
import { settingsService } from '../src/services/settingsService';
import { seedBase } from './helpers';

async function customer(phone: string) {
  return prisma.customer.create({ data: { phone } });
}

describe('locationMatches', () => {
  it('matches areas case-insensitively and by containment', () => {
    expect(locationMatches(['bhopal'], 'Bhopal')).toBe(true);
    expect(locationMatches(['arera colony'], 'Arera Colony, Bhopal')).toBe(true);
    expect(locationMatches(['indore'], 'Bhopal')).toBe(false);
    expect(locationMatches(['bhopal'], null)).toBe(false);
  });
});

describe('broker assignment service', () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeEach(async () => {
    ctx = await seedBase();
  });

  it('assigns the location-matched broker and logs the reason', async () => {
    const c = await customer('+919811100001');
    const { lead } = await upsertQualifiedLead({ customerId: c.id, source: 'WHATSAPP', fields: { preferredLocation: 'Indore', propertyType: 'APARTMENT', budgetRange: '50 lakh' } });
    expect(lead.brokerId).toBe(ctx.brokerB.id);
    expect(lead.status).toBe('ASSIGNED');
    expect(lead.assignmentReason).toMatch(/Covers "Indore"/);
    const act = await prisma.leadActivity.findFirst({ where: { leadId: lead.id, type: 'ASSIGNED' } });
    expect(act?.message).toMatch(/lowest workload/);
  });

  it('prefers the matching broker with lower workload', async () => {
    const third = await prisma.user.create({ data: { email: 'c@test.local', fullName: 'Broker C', passwordHash: 'x', roleId: (await prisma.role.findUniqueOrThrow({ where: { name: 'BROKER' } })).id } });
    const brokerC = await prisma.brokerProfile.create({ data: { userId: third.id, phone: '+919000000003', areas: ['bhopal'], maxActiveLeads: 5 } });
    // Give broker A two active leads.
    for (const p of ['+919811100002', '+919811100003']) {
      const c = await customer(p);
      await prisma.lead.create({ data: { customerId: c.id, brokerId: ctx.brokerA.id, status: 'CONTACTED' } });
    }
    const c = await customer('+919811100004');
    const d = await prisma.$transaction((tx) => pickBroker(tx, { preferredLocation: 'Bhopal', propertyType: null }, 'LEAST_LOADED_ANY_AREA'));
    expect(d.broker?.id).toBe(brokerC.id);
    expect(d.usedFallback).toBe(false);
    void c;
  });

  it('skips unavailable, inactive and at-capacity brokers', async () => {
    await prisma.brokerProfile.update({ where: { id: ctx.brokerA.id }, data: { availability: 'ON_LEAVE' } });
    const d1 = await prisma.$transaction((tx) => pickBroker(tx, { preferredLocation: 'Bhopal', propertyType: null }, 'UNASSIGNED_QUEUE'));
    expect(d1.broker).toBeNull();
    expect(d1.reason).toMatch(/UNASSIGNED_QUEUE/);

    await prisma.brokerProfile.update({ where: { id: ctx.brokerA.id }, data: { availability: 'AVAILABLE', maxActiveLeads: 1 } });
    const c = await customer('+919811100005');
    await prisma.lead.create({ data: { customerId: c.id, brokerId: ctx.brokerA.id, status: 'NEGOTIATION' } });
    const d2 = await prisma.$transaction((tx) => pickBroker(tx, { preferredLocation: 'Bhopal', propertyType: null }, 'LEAST_LOADED_ANY_AREA'));
    expect(d2.broker?.id).toBe(ctx.brokerB.id); // fallback to any area
    expect(d2.usedFallback).toBe(true);
    expect(d2.reason).toMatch(/Fallback LEAST_LOADED_ANY_AREA/);
  });

  it('honours the UNASSIGNED_QUEUE fallback policy from business settings', async () => {
    await settingsService.save('business', { ...(await settingsService.getBusiness()), fallbackPolicy: 'UNASSIGNED_QUEUE' });
    const c = await customer('+919811100006');
    const { lead } = await upsertQualifiedLead({ customerId: c.id, source: 'WHATSAPP', fields: { preferredLocation: 'Pune', propertyType: 'APARTMENT', budgetRange: '1 Cr' } });
    expect(lead.brokerId).toBeNull();
    expect(lead.status).toBe('QUALIFIED');
    expect(await prisma.leadActivity.count({ where: { leadId: lead.id, type: 'ASSIGNMENT_FAILED' } })).toBe(1);
  });

  it('does not create duplicate leads for the same requirement, but allows a second requirement', async () => {
    const c = await customer('+919811100007');
    const f = { preferredLocation: 'Bhopal', propertyType: 'APARTMENT' as const, budgetRange: '50 lakh' };
    const r1 = await upsertQualifiedLead({ customerId: c.id, source: 'WHATSAPP', fields: f });
    const r2 = await upsertQualifiedLead({ customerId: c.id, source: 'WHATSAPP', fields: { ...f, budgetRange: '60 lakh' } });
    expect(r2.lead.id).toBe(r1.lead.id);
    expect(r2.created).toBe(false);
    const r3 = await upsertQualifiedLead({ customerId: c.id, source: 'WHATSAPP', fields: { preferredLocation: 'Indore', propertyType: 'VILLA', budgetRange: '2 Cr' } });
    expect(r3.lead.id).not.toBe(r1.lead.id);
    expect(await prisma.lead.count({ where: { customerId: c.id } })).toBe(2);
  });

  it('serialises concurrent assignments so capacity is respected', async () => {
    await prisma.brokerProfile.update({ where: { id: ctx.brokerB.id }, data: { maxActiveLeads: 2 } });
    const leads = [];
    for (let i = 0; i < 4; i++) {
      const c = await customer(`+91982220000${i}`);
      leads.push(await prisma.lead.create({ data: { customerId: c.id, preferredLocation: 'Indore', status: 'QUALIFIED', isQualified: true } }));
    }
    await settingsService.save('business', { ...(await settingsService.getBusiness()), fallbackPolicy: 'UNASSIGNED_QUEUE' });
    await Promise.all(leads.map((l) => assignLead(l.id, { auto: true })));
    expect(await prisma.lead.count({ where: { brokerId: ctx.brokerB.id } })).toBe(2);
  });

  it('notifies the broker via WhatsApp and in-app, and the customer once', async () => {
    const c = await customer('+919811100008');
    const { lead } = await upsertQualifiedLead({ customerId: c.id, source: 'WHATSAPP', fields: { preferredLocation: 'Indore', propertyType: 'APARTMENT', budgetRange: '50-70 Lakhs', urgency: 'IMMEDIATE' } });
    const notes = await prisma.notification.findMany({ where: { leadId: lead.id } });
    const broker = notes.find((n) => n.type === 'BROKER_NEW_LEAD' && n.channel === 'WHATSAPP');
    expect(broker?.status).toBe('SENT');
    expect(broker?.body).toContain('New Qualified Lead');
    expect(broker?.body).toContain('Budget: ₹50-70 Lakhs');
    expect(notes.some((n) => n.channel === 'IN_APP')).toBe(true);
    expect(notes.filter((n) => n.type === 'CUSTOMER_LEAD_CONFIRMATION')).toHaveLength(1);
  });
});
