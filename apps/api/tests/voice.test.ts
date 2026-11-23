import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { hmacSha256Hex } from '../src/services/crypto';
import { app, postWhatsApp, seedBase, sentWhatsApp, tokenFor, waTextPayload } from './helpers';

const lk = vi.hoisted(() => ({ createRoom: vi.fn(), listRooms: vi.fn(async () => [] as unknown[]), deleteRoom: vi.fn(), createDispatch: vi.fn() }));
vi.mock('livekit-server-sdk', async (orig) => {
  const real = await orig<typeof import('livekit-server-sdk')>();
  return {
    ...real,
    RoomServiceClient: class {
      createRoom = lk.createRoom;
      listRooms = lk.listRooms;
      deleteRoom = lk.deleteRoom;
    },
    AgentDispatchClient: class {
      createDispatch = lk.createDispatch;
    },
  };
});

function codeFromLink(text: string) {
  const m = text.match(/\/call\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('no link in ' + text);
  return m[1]!;
}

function signSummary(body: string, ts = Math.floor(Date.now() / 1000)) {
  return { ts: String(ts), sig: hmacSha256Hex('test-agent-key-test-agent-key-0123456789', `${ts}.${body}`) };
}

describe('LiveKit voice calling', () => {
  beforeEach(async () => {
    await seedBase();
    Object.values(lk).forEach((f) => f.mockClear());
  });

  it('WhatsApp voice request: lead is qualified + assigned first, then a secure link is sent', async () => {
    await postWhatsApp(waTextPayload('919833300001', 'wamid.C1', 'Looking for 2bhk apartment in Arera Colony, budget 60 lakh'));
    await postWhatsApp(waTextPayload('919833300001', 'wamid.C2', 'please call me, I want to talk'));
    const lead = await prisma.lead.findFirstOrThrow({ include: { voiceCalls: true } });
    expect(lead.status).toBe('ASSIGNED');
    expect(lead.voiceCalls).toHaveLength(1);
    expect(lead.voiceCalls[0]!.status).toBe('LINK_SENT');
    const linkMsg = sentWhatsApp.find((m) => m.body?.includes('/call/'))!;
    expect(linkMsg.body).toContain('http://app.test/call/');
    // Only the hash of the code is stored.
    const code = codeFromLink(linkMsg.body!);
    expect(lead.voiceCalls[0]!.joinCodeHash).not.toBe(code);
  });

  it('issues a short-lived, room-scoped token and dispatches the agent once', async () => {
    const t = await tokenFor('admin@test.local');
    const c = await prisma.customer.create({ data: { phone: '+919833300002', fullName: 'Meera K' } });
    const lead = await prisma.lead.create({ data: { customerId: c.id, preferredLocation: 'Bhopal' } });
    const created = await request(app).post('/api/voice/rooms').set('Authorization', `Bearer ${t}`).send({ leadId: lead.id, sendLink: false });
    expect(created.status).toBe(201);
    const code = codeFromLink(created.body.link);

    const info = await request(app).get(`/api/voice/session/${code}`);
    expect(info.body).toMatchObject({ customerFirstName: 'Meera', status: 'CREATED' });

    const tok = await request(app).post('/api/voice/token').send({ code });
    expect(tok.status).toBe(200);
    const claims = jwt.verify(tok.body.token, 'lk-secret-lk-secret-lk-secret-lk-secret-123') as jwt.JwtPayload & { video: Record<string, unknown> };
    expect(claims.video).toMatchObject({ room: created.body.roomName, roomJoin: true, canPublish: true, canSubscribe: true });
    expect(claims.video.roomAdmin).toBeUndefined();
    expect(claims.exp! - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    expect(lk.createRoom).toHaveBeenCalledOnce();
    expect(lk.createDispatch).toHaveBeenCalledWith(created.body.roomName, 'realestate-agent', expect.any(Object));

    // Reconnect: new token, no second dispatch.
    const again = await request(app).post('/api/voice/token').send({ code });
    expect(again.status).toBe(200);
    expect(lk.createDispatch).toHaveBeenCalledOnce();
  });

  it('rejects unknown and expired codes', async () => {
    expect((await request(app).post('/api/voice/token').send({ code: 'x'.repeat(43) })).status).toBe(404);
    const t = await tokenFor('admin@test.local');
    const c = await prisma.customer.create({ data: { phone: '+919833300003' } });
    const lead = await prisma.lead.create({ data: { customerId: c.id } });
    const created = await request(app).post('/api/voice/rooms').set('Authorization', `Bearer ${t}`).send({ leadId: lead.id, sendLink: false });
    await prisma.voiceCall.update({ where: { id: created.body.callId }, data: { joinExpiresAt: new Date(Date.now() - 1000) } });
    const r = await request(app).post('/api/voice/token').send({ code: codeFromLink(created.body.link) });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/expired/);
  });

  it('saves transcript + summary against the correct lead (signed webhook only)', async () => {
    const c = await prisma.customer.create({ data: { phone: '+919833300004' } });
    const lead = await prisma.lead.create({ data: { customerId: c.id } });
    const call = await prisma.voiceCall.create({ data: { leadId: lead.id, customerId: c.id, roomName: 'call-test-1', joinCodeHash: 'h1', joinExpiresAt: new Date(Date.now() + 60000), status: 'IN_PROGRESS', startedAt: new Date(Date.now() - 90_000) } });
    const body = JSON.stringify({
      roomName: 'call-test-1',
      transcript: [
        { role: 'assistant', text: 'Hello!' },
        { role: 'user', text: 'I need a villa in Bhopal under 2 crore' },
      ],
      summary: 'Customer wants a villa in Bhopal under 2 Cr.',
      budget: 'under 2 Cr',
      preferredLocation: 'Bhopal',
      endedAt: new Date().toISOString(),
    });
    const unsigned = await request(app).post('/api/webhooks/voice-summary').set('content-type', 'application/json').send(body);
    expect(unsigned.status).toBe(401);
    const stale = signSummary(body, Math.floor(Date.now() / 1000) - 3600);
    expect((await request(app).post('/api/webhooks/voice-summary').set('content-type', 'application/json').set('x-agent-timestamp', stale.ts).set('x-agent-signature', stale.sig).send(body)).status).toBe(401);

    const { ts, sig } = signSummary(body);
    const ok = await request(app).post('/api/webhooks/voice-summary').set('content-type', 'application/json').set('x-agent-timestamp', ts).set('x-agent-signature', sig).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.leadId).toBe(lead.id);
    const saved = await prisma.voiceCall.findUniqueOrThrow({ where: { id: call.id }, include: { transcript: true } });
    expect(saved.summary).toMatch(/villa/);
    expect(saved.status).toBe('COMPLETED');
    expect(saved.durationSeconds).toBeGreaterThanOrEqual(89);
    expect(saved.transcript?.fullText).toContain('Customer: I need a villa');
    const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updatedLead.preferredLocation).toBe('Bhopal');
    expect(await prisma.leadActivity.count({ where: { leadId: lead.id, type: 'CALL_SUMMARY' } })).toBe(1);
  });

  it('agent API requires the agent key and returns read-only context', async () => {
    const c = await prisma.customer.create({ data: { phone: '+919833300005', fullName: 'Kiran Rao' } });
    await prisma.voiceCall.create({ data: { customerId: c.id, roomName: 'call-test-2', joinCodeHash: 'h2', joinExpiresAt: new Date(Date.now() + 60000) } });
    expect((await request(app).get('/api/agent/calls/call-test-2/context')).status).toBe(401);
    const ctx = await request(app).get('/api/agent/calls/call-test-2/context').set('x-agent-key', 'test-agent-key-test-agent-key-0123456789');
    expect(ctx.status).toBe(200);
    expect(ctx.body.customer.firstName).toBe('Kiran');
    expect(JSON.stringify(ctx.body)).not.toContain('+919833300005'); // agent does not need the phone number
    const search = await request(app).post('/api/agent/properties/search').set('x-agent-key', 'test-agent-key-test-agent-key-0123456789').send({ location: 'Arera Colony' });
    expect(search.body.properties).toHaveLength(1);
  });

  it('call list never exposes the join code hash', async () => {
    const t = await tokenFor('admin@test.local');
    const c = await prisma.customer.create({ data: { phone: '+919833300006' } });
    await prisma.voiceCall.create({ data: { customerId: c.id, roomName: 'call-test-3', joinCodeHash: 'secret-hash', joinExpiresAt: new Date() } });
    const r = await request(app).get('/api/voice/calls').set('Authorization', `Bearer ${t}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('secret-hash');
  });
});
