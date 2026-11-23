import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { parseWebhook } from '../src/services/whatsapp';
import { integrationService } from '../src/services/integrationService';
import { app, postWhatsApp, seedBase, sentWhatsApp, tokenFor, waTextPayload } from './helpers';

describe('WhatsApp webhook', () => {
  beforeEach(async () => {
    await seedBase();
  });

  it('verifies the Meta subscription handshake', async () => {
    const ok = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wa-verify-token', 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    const bad = await request(app).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' });
    expect(bad.status).toBe(403);
  });

  it('rejects payloads with a missing or invalid signature', async () => {
    const body = JSON.stringify(waTextPayload('919811111111', 'wamid.X', 'hi'));
    const none = await request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').send(body);
    expect(none.status).toBe(401);
    const bad = await request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=deadbeef').send(body);
    expect(bad.status).toBe(401);
    expect(await prisma.message.count()).toBe(0);
  });

  it('processes a message end-to-end: customer, AI reply, qualified lead, assignment, notifications', async () => {
    const res = await postWhatsApp(waTextPayload('919811111111', 'wamid.A1', 'Hi I need a 2 BHK flat in Arera Colony, budget 50-70 lakhs, urgent', 'Rahul'));
    expect(res.status).toBe(200);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { phone: '+919811111111' } });
    expect(customer.fullName).toBe('Rahul');
    expect(customer.whatsappConsent).toBe(true);

    const msgs = await prisma.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(msgs[0]).toMatchObject({ direction: 'INBOUND', status: 'RECEIVED', whatsappMessageId: 'wamid.A1' });
    const ai = msgs.find((m) => m.sender === 'AI')!;
    expect(ai.status).toBe('SENT');
    expect(ai.body).toContain('2 BHK in Arera Colony');

    const lead = await prisma.lead.findFirstOrThrow({ where: { customerId: customer.id }, include: { broker: { include: { user: true } } } });
    expect(lead).toMatchObject({ isQualified: true, status: 'ASSIGNED', preferredLocation: 'Arera Colony', propertyType: 'APARTMENT', bedrooms: 2, urgency: 'IMMEDIATE' });
    expect(lead.broker?.user.fullName).toBe('Broker A');

    // AI reply + broker notification + customer confirmation all went out through WhatsApp.
    expect(sentWhatsApp.map((s) => s.to).sort()).toEqual(['919000000001', '919811111111', '919811111111'].sort());
    expect(sentWhatsApp.find((s) => s.to === '919000000001')!.body).toContain('Customer: Rahul');
  });

  it('is idempotent for duplicate deliveries of the same message id', async () => {
    const payload = waTextPayload('919811111112', 'wamid.DUP', 'hello');
    await postWhatsApp(payload);
    await postWhatsApp(payload);
    await Promise.all([postWhatsApp(payload), postWhatsApp(payload)]);
    expect(await prisma.message.count({ where: { direction: 'INBOUND' } })).toBe(1);
    expect(await prisma.message.count({ where: { sender: 'AI' } })).toBe(1);
  });

  it('applies delivery status updates without regressing', async () => {
    await postWhatsApp(waTextPayload('919811111113', 'wamid.S1', 'hello'));
    const ai = await prisma.message.findFirstOrThrow({ where: { sender: 'AI' } });
    const status = (s: string) => ({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: ai.whatsappMessageId, status: s }] } }] }],
    });
    await postWhatsApp(status('read'));
    await postWhatsApp(status('delivered'));
    expect((await prisma.message.findUniqueOrThrow({ where: { id: ai.id } })).status).toBe('READ');
  });

  it('does not run the AI while a human has taken over', async () => {
    await postWhatsApp(waTextPayload('919811111114', 'wamid.H1', 'hello'));
    const convo = await prisma.conversation.findFirstOrThrow();
    const t = await tokenFor('admin@test.local');
    await request(app).post(`/api/conversations/${convo.id}/takeover`).set('Authorization', `Bearer ${t}`).send({ active: true });
    await postWhatsApp(waTextPayload('919811111114', 'wamid.H2', 'are you there?'));
    expect(await prisma.message.count({ where: { sender: 'AI' } })).toBe(1);
    const reply = await request(app).post(`/api/conversations/${convo.id}/reply`).set('Authorization', `Bearer ${t}`).send({ text: 'Hi, this is Asha from the team.' });
    expect(reply.status).toBe(201);
    expect(reply.body.sender).toBe('HUMAN');
  });

  it('voice-call intent never bypasses lead creation; without LiveKit the customer is told calls are unavailable', async () => {
    await integrationService.update('livekit', { enabled: false });
    await postWhatsApp(waTextPayload('919811111115', 'wamid.V1', 'Need 2 bhk apartment in Indore under 80 lakh'));
    await postWhatsApp(waTextPayload('919811111115', 'wamid.V2', 'Can we talk on a call?'));
    const lead = await prisma.lead.findFirstOrThrow({ where: { customer: { phone: '+919811111115' } } });
    expect(lead.isQualified).toBe(true);
    expect(lead.brokerId).not.toBeNull();
    const ai = await prisma.message.findFirst({ where: { sender: 'AI' }, orderBy: { createdAt: 'desc' } });
    expect(ai?.body).toMatch(/not available/);
    expect(ai?.body).not.toMatch(/secure link/);
    expect(await prisma.voiceCall.count()).toBe(0);
  });

  it('marks outbound messages SKIPPED_NOT_CONFIGURED when WhatsApp credentials are absent', async () => {
    await integrationService.update('whatsapp', { enabled: false });
    const t = await tokenFor('super@test.local');
    await request(app).post('/api/conversations/simulate').set('Authorization', `Bearer ${t}`).send({ phone: '9811111116', text: 'hello' });
    const ai = await prisma.message.findFirstOrThrow({ where: { sender: 'AI' } });
    expect(ai.status).toBe('SKIPPED_NOT_CONFIGURED');
    expect(sentWhatsApp).toHaveLength(0);
  });

  it('parses interactive, location and unknown message types', () => {
    const r = parseWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [
        { id: '1', from: '91', type: 'interactive', interactive: { button_reply: { title: 'Yes' } } },
        { id: '2', from: '91', type: 'location', location: { name: 'Home', address: 'Bhopal' } },
        { id: '3', from: '91', type: 'sticker' },
      ] } }] }],
    });
    expect(r.messages.map((m) => m.text)).toEqual(['Yes', '[location] Home, Bhopal', '[sticker]']);
  });
});
