import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { scanFollowUps } from '../src/workers/handlers';
import { app, seedBase, tokenFor } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082', 'hex');

describe('CRM modules', () => {
  let admin: string;
  let broker: string;
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  beforeAll(async () => {
    ctx = await seedBase();
    admin = await tokenFor('admin@test.local');
    broker = await tokenFor('a@test.local');
  });
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('properties: create, validate, filter, update, images, delete', async () => {
    const bad = await request(app).post('/api/properties').set(auth(admin)).send({ title: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.length).toBeGreaterThan(0);

    const created = await request(app).post('/api/properties').set(auth(admin)).send({
      title: '3 BHK Lake View', propertyType: 'APARTMENT', listingType: 'SALE', location: 'Shyamla Hills', city: 'Bhopal', state: 'MP', bedrooms: 3, price: 9500000, amenities: ['Lift'],
    });
    expect(created.status).toBe(201);
    expect(created.body.price).toBe(9500000);
    const id = created.body.id;

    const filtered = await request(app).get('/api/properties').set(auth(admin)).query({ city: 'Bhopal', bedrooms: 3, minPrice: 9000000, availability: 'AVAILABLE' });
    expect(filtered.body.items.map((p: { id: string }) => p.id)).toEqual([id]);

    const fake = await request(app).post(`/api/properties/${id}/images`).set(auth(admin)).attach('images', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const img = await request(app).post(`/api/properties/${id}/images`).set(auth(admin)).attach('images', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(img.status).toBe(201);
    const served = await request(app).get(img.body[0].url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);

    const upd = await request(app).patch(`/api/properties/${id}`).set(auth(admin)).send({ availability: 'SOLD' });
    expect(upd.body.availability).toBe('SOLD');
    expect((await request(app).delete(`/api/properties/${id}`).set(auth(admin))).status).toBe(204);
  });

  it('brokers: create with temporary password, deactivate', async () => {
    const r = await request(app).post('/api/brokers').set(auth(admin)).send({ fullName: 'New Broker', email: 'nb@test.local', phone: '98765 00000', areas: ['Bhopal'] });
    expect(r.status).toBe(201);
    expect(r.body.temporaryPassword).toMatch(/^Tmp-/);
    expect(r.body.phone).toBe('+919876500000');
    expect(r.body.areas).toEqual(['bhopal']);
    const login = await request(app).post('/api/auth/login').send({ email: 'nb@test.local', password: r.body.temporaryPassword });
    expect(login.status).toBe(200);
    const dup = await request(app).post('/api/brokers').set(auth(admin)).send({ fullName: 'Dup', email: 'nb@test.local', phone: '9876500001' });
    expect(dup.status).toBe(409);
    const del = await request(app).delete(`/api/brokers/${r.body.id}`).set(auth(admin));
    expect(del.body.status).toBe('INACTIVE');
    expect((await request(app).post('/api/auth/login').send({ email: 'nb@test.local', password: r.body.temporaryPassword })).status).toBe(401);
  });

  it('leads: manual create normalises phone, dedupes customers, status/notes/assign', async () => {
    const r1 = await request(app).post('/api/leads').set(auth(admin)).send({ customerPhone: '098111 22222', customerName: 'Dev', preferredLocation: 'Bhopal', propertyType: 'APARTMENT', budgetRange: '40-50 lakh' });
    expect(r1.status).toBe(201);
    expect(r1.body.leadNumber).toMatch(/^LD-\d{6}$/);
    expect(r1.body.brokerId).toBe(ctx.brokerA.id);
    const r2 = await request(app).post('/api/leads').set(auth(admin)).send({ customerPhone: '+91 98111 22222', preferredLocation: 'Indore', propertyType: 'VILLA', budgetRange: '2 Cr' });
    expect(r2.body.customerId).toBe(r1.body.customerId);
    expect(r2.body.id).not.toBe(r1.body.id);

    const lost = await request(app).patch(`/api/leads/${r1.body.id}`).set(auth(broker)).send({ status: 'LOST' });
    expect(lost.status).toBe(400);
    const contacted = await request(app).patch(`/api/leads/${r1.body.id}`).set(auth(broker)).send({ status: 'CONTACTED' });
    expect(contacted.body.status).toBe('CONTACTED');
    const note = await request(app).post(`/api/leads/${r1.body.id}/notes`).set(auth(broker)).send({ note: 'Called, wants site visit Sunday' });
    expect(note.status).toBe(201);

    const reassign = await request(app).post(`/api/leads/${r1.body.id}/assign`).set(auth(admin)).send({ brokerId: ctx.brokerB.id, reason: 'Language' });
    expect(reassign.body.brokerId).toBe(ctx.brokerB.id);
    const detail = await request(app).get(`/api/leads/${r1.body.id}`).set(auth(admin));
    expect(detail.body.activities.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['CREATED', 'ASSIGNED', 'STATUS_CHANGED', 'NOTE', 'REASSIGNED']));
    expect(detail.body.notifications.some((n: { type: string }) => n.type === 'LEAD_REASSIGNED')).toBe(true);
  });

  it('follow-ups: schedule, overdue listing, reminder sent once', async () => {
    const lead = await prisma.lead.findFirstOrThrow({ where: { brokerId: ctx.brokerB.id } });
    const f = await request(app).post('/api/follow-ups').set(auth(admin)).send({ leadId: lead.id, title: 'Call back', dueAt: new Date(Date.now() - 60_000).toISOString() });
    expect(f.status).toBe(201);
    const overdue = await request(app).get('/api/follow-ups').set(auth(admin)).query({ overdue: 'true' });
    expect(overdue.body.items[0].overdue).toBe(true);
    expect(await scanFollowUps()).toBe(1);
    expect(await scanFollowUps()).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'FOLLOW_UP_REMINDER', channel: 'IN_APP' } })).toBe(1);
  });

  it('dashboard numbers come from the database', async () => {
    const o = await request(app).get('/api/dashboard/overview').set(auth(admin));
    expect(o.body.totalLeads).toBe(await prisma.lead.count());
    expect(o.body.activeProperties).toBe(await prisma.property.count({ where: { availability: 'AVAILABLE' } }));
    const a = await request(app).get('/api/dashboard/analytics').set(auth(admin)).query({ days: 7 });
    expect(a.body.leadsOverTime).toHaveLength(7);
    expect(a.body.leadsOverTime.reduce((s: number, d: { count: number }) => s + d.count, 0)).toBe(await prisma.lead.count());
    const scoped = await request(app).get('/api/dashboard/overview').set(auth(broker));
    expect(scoped.body.totalLeads).toBe(await prisma.lead.count({ where: { brokerId: ctx.brokerA.id } }));
  });

  it('settings: business + AI validated; switching to Groq requires the integration', async () => {
    const su = await tokenFor('super@test.local');
    const b = await request(app).put('/api/settings/business').set(auth(admin)).send({ businessName: 'Acme Homes', fallbackPolicy: 'UNASSIGNED_QUEUE' });
    expect(b.status).toBe(200);
    const ai = await request(app).get('/api/settings/ai').set(auth(su));
    const toGroq = await request(app).put('/api/settings/ai').set(auth(su)).send({ ...ai.body, provider: 'groq' });
    expect(toGroq.status).toBe(400);
    expect((await request(app).put('/api/settings/ai').set(auth(admin)).send(ai.body)).status).toBe(403);
  });

  it('returns 404 JSON for unknown routes and hides internals on errors', async () => {
    const r = await request(app).get('/api/nope').set(auth(admin));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    const badJson = await request(app).post('/api/leads').set(auth(admin)).set('content-type', 'application/json').send('{bad');
    expect(badJson.status).toBe(400);
  });
});

describe('dashboard scoping regression', () => {
  it('broker "assigned" count never exceeds their own total', async () => {
    const ctx = await seedBase();
    const c = await prisma.customer.create({ data: { phone: '+919700000001' } });
    await prisma.lead.create({ data: { customerId: c.id, brokerId: ctx.brokerB.id, status: 'ASSIGNED' } });
    await prisma.lead.create({ data: { customerId: c.id, brokerId: ctx.brokerA.id, status: 'CONTACTED' } });
    const t = await tokenFor('a@test.local');
    const o = await request(app).get('/api/dashboard/overview').set({ Authorization: `Bearer ${t}` });
    expect(o.body.totalLeads).toBe(1);
    expect(o.body.assignedLeads).toBe(1);
  });
});
