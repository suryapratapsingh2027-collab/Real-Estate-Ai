import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, seedBase, tokenFor } from './helpers';

describe('role-based access control (enforced by the backend)', () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  let superT: string, adminT: string, brokerAT: string, brokerBT: string;
  let leadForB: string;

  beforeAll(async () => {
    ctx = await seedBase();
    [superT, adminT, brokerAT, brokerBT] = (await Promise.all(['super@test.local', 'admin@test.local', 'a@test.local', 'b@test.local'].map(tokenFor))) as [string, string, string, string];
    const c = await prisma.customer.create({ data: { phone: '+919999900001', fullName: 'Cust' } });
    leadForB = (await prisma.lead.create({ data: { customerId: c.id, brokerId: ctx.brokerB.id, status: 'ASSIGNED', preferredLocation: 'Indore' } })).id;
  });

  it('brokers cannot manage users, audit logs or integrations', async () => {
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${brokerAT}`)).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${brokerAT}`)).status).toBe(403);
    expect((await request(app).get('/api/integrations').set('Authorization', `Bearer ${brokerAT}`)).status).toBe(403);
    expect((await request(app).post('/api/properties').set('Authorization', `Bearer ${brokerAT}`).send({})).status).toBe(403);
  });

  it('admins cannot change integration secrets; super admins can', async () => {
    const body = { secrets: { apiKey: 'gsk_secret_value_123456' } };
    expect((await request(app).patch('/api/integrations/groq').set('Authorization', `Bearer ${adminT}`).send(body)).status).toBe(403);
    const ok = await request(app).patch('/api/integrations/groq').set('Authorization', `Bearer ${superT}`).send(body);
    expect(ok.status).toBe(200);
    // Secret values are never returned — only presence and last 4 chars.
    expect(JSON.stringify(ok.body)).not.toContain('gsk_secret_value_123456');
    expect(ok.body.secretFields.apiKey).toEqual({ hasValue: true, last4: '3456' });
    const row = await prisma.integration.findUnique({ where: { key: 'groq' } });
    expect(row?.secretsCipher).toBeTruthy();
    expect(row?.secretsCipher).not.toContain('gsk_secret');
    const list = await request(app).get('/api/integrations').set('Authorization', `Bearer ${adminT}`);
    expect(JSON.stringify(list.body)).not.toContain('gsk_secret_value_123456');
    expect(JSON.stringify(list.body)).not.toContain('wa-token');
  });

  it('brokers only see their own leads', async () => {
    const a = await request(app).get(`/api/leads/${leadForB}`).set('Authorization', `Bearer ${brokerAT}`);
    expect(a.status).toBe(404);
    const b = await request(app).get(`/api/leads/${leadForB}`).set('Authorization', `Bearer ${brokerBT}`);
    expect(b.status).toBe(200);
    const listA = await request(app).get('/api/leads').set('Authorization', `Bearer ${brokerAT}`);
    expect(listA.body.total).toBe(0);
    const upd = await request(app).patch(`/api/leads/${leadForB}`).set('Authorization', `Bearer ${brokerAT}`).send({ status: 'CONTACTED' });
    expect(upd.status).toBe(404);
  });

  it('brokers cannot assign leads', async () => {
    const r = await request(app).post(`/api/leads/${leadForB}/assign`).set('Authorization', `Bearer ${brokerBT}`).send({ auto: true });
    expect(r.status).toBe(403);
  });

  it('brokers only see customers linked to their leads', async () => {
    const other = await prisma.customer.create({ data: { phone: '+919999900002' } });
    expect((await request(app).get(`/api/customers/${other.id}`).set('Authorization', `Bearer ${brokerBT}`)).status).toBe(404);
    const list = await request(app).get('/api/customers').set('Authorization', `Bearer ${brokerBT}`);
    expect(list.body.items.map((c: { phone: string }) => c.phone)).toEqual(['+919999900001']);
  });

  it('cannot deactivate the last super admin or yourself', async () => {
    const self = await request(app).patch(`/api/users/${ctx.superAdmin.id}`).set('Authorization', `Bearer ${superT}`).send({ isActive: false });
    expect(self.status).toBe(400);
  });

  it('records audit logs for privileged actions', async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: 'integration.update' } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs[0]!.data)).not.toContain('gsk_secret');
  });
});
