import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  S3Upload,
  WebhookReceiver,
} from 'livekit-server-sdk';
import type { VoiceSummaryInput } from '@rea/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { badRequest, notFound, unavailable } from '../utils/errors';
import { randomToken, sha256 } from './crypto';
import { integrationService } from './integrationService';
import { addActivity, leadNo } from './leadService';
import { getOrCreateConversation } from './customerService';
import { sendConversationMessage } from './messagingService';
import { realtime, roomsFor } from './realtime';
import { settingsService } from './settingsService';

async function lk() {
  const r = await integrationService.resolve('livekit');
  if (!(await integrationService.isConfigured('livekit'))) return null;
  const host = r.config.url!.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return {
    url: r.config.url!,
    host,
    apiKey: r.secrets.apiKey!,
    apiSecret: r.secrets.apiSecret!,
    agentName: r.config.agentName ?? env.LIVEKIT_AGENT_NAME,
  };
}

export const voiceService = {
  isConfigured: async () => (await lk()) !== null,

  /**
   * Create a call record + opaque join link for a lead. The LiveKit room itself is created
   * lazily when the customer opens the link (rooms with no participants are closed by LiveKit).
   */
  async createCallForLead(leadId: string, opts: { sendLink: boolean; actorId?: string | null }) {
    if (!(await lk())) throw unavailable('LiveKit is not configured. Configure it under Settings → Integrations.');
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { customer: true } });
    if (!lead) throw notFound('Lead');
    const code = randomToken(32);
    const roomName = `call-${leadNo(lead.number)}-${randomToken(6)}`.toLowerCase();
    const call = await prisma.voiceCall.create({
      data: {
        leadId: lead.id,
        customerId: lead.customerId,
        roomName,
        joinCodeHash: sha256(code),
        joinExpiresAt: new Date(Date.now() + env.CALL_LINK_TTL_MINUTES * 60_000),
        propertyType: lead.propertyType,
        budget: lead.budgetRange,
        preferredLocation: lead.preferredLocation,
        urgency: lead.urgency,
      },
    });
    const link = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/call/${code}`;
    await addActivity(lead.id, 'CALL', 'AI voice call link created', opts.actorId ?? null, { callId: call.id });

    if (opts.sendLink) {
      const convo = await getOrCreateConversation(lead.customerId);
      const hi = lead.customer.preferredLanguage === 'hi';
      const body = hi
        ? `Hamare AI property assistant se baat karne ke liye is secure link par tap karein (${env.CALL_LINK_TTL_MINUTES} minute tak valid):\n${link}\nAapko browser mein microphone ki permission deni hogi.`
        : `Tap this secure link to talk to our AI property assistant (valid for ${env.CALL_LINK_TTL_MINUTES} minutes):\n${link}\nYour browser will ask for microphone permission.`;
      const msg = await sendConversationMessage({ conversationId: convo.id, toPhone: lead.customer.whatsappNumber ?? lead.customer.phone, body, sender: 'SYSTEM', brokerId: lead.brokerId });
      await prisma.voiceCall.update({ where: { id: call.id }, data: { status: 'LINK_SENT' } });
      await prisma.notification.create({
        data: {
          type: 'CUSTOMER_CALL_LINK',
          channel: 'WHATSAPP',
          customerId: lead.customerId,
          leadId: lead.id,
          toAddress: lead.customer.phone,
          title: 'Voice call link',
          body: body.replace(link, `${env.PUBLIC_APP_URL}/call/…`),
          status: msg.status,
          whatsappMessageId: null,
          sentAt: msg.status === 'SENT' ? new Date() : null,
          lastError: msg.error,
        },
      });
    }
    return { call, link };
  },

  async findByCode(code: string) {
    const call = await prisma.voiceCall.findUnique({ where: { joinCodeHash: sha256(code) }, include: { customer: true, lead: true } });
    if (!call) throw notFound('Call link');
    return call;
  },

  /** Public: minimal info for the call page (no token). */
  async sessionInfo(code: string) {
    const call = await this.findByCode(code);
    const business = await settingsService.getBusiness();
    const expired = call.joinExpiresAt < new Date() || ['COMPLETED', 'EXPIRED', 'FAILED', 'MISSED'].includes(call.status);
    return {
      status: expired ? 'EXPIRED' : call.status,
      customerFirstName: call.customer.fullName?.split(' ')[0] ?? null,
      businessName: business.businessName,
      recordingEnabled: business.recordingEnabled && (await storageIsS3()),
      expiresAt: call.joinExpiresAt,
    };
  },

  /** Exchange a join code for a short-lived LiveKit token. Creates the room and dispatches the agent. */
  async issueToken(code: string, recordingConsent: boolean) {
    const conf = await lk();
    if (!conf) throw unavailable('Voice calling is not available right now.');
    const call = await this.findByCode(code);
    if (call.joinExpiresAt < new Date()) {
      if (call.status !== 'EXPIRED' && call.status !== 'COMPLETED') await prisma.voiceCall.update({ where: { id: call.id }, data: { status: 'EXPIRED' } });
      throw badRequest('This call link has expired. Please request a new one on WhatsApp.');
    }
    if (['COMPLETED', 'EXPIRED', 'FAILED', 'MISSED'].includes(call.status)) throw badRequest('This call has already ended.');

    const rooms = new RoomServiceClient(conf.host, conf.apiKey, conf.apiSecret);
    const metadata = JSON.stringify({ callId: call.id, leadId: call.leadId, customerId: call.customerId });
    const ai = await settingsService.getAi();
    const existing = await rooms.listRooms([call.roomName]);
    if (existing.length === 0) {
      await rooms.createRoom({
        name: call.roomName,
        emptyTimeout: 120,
        departureTimeout: 20,
        maxParticipants: 3,
        metadata,
      });
    }
    // Dispatch the agent once per call (re-joins after a network drop reuse the same agent).
    if (call.status === 'CREATED' || call.status === 'LINK_SENT') {
      const dispatch = new AgentDispatchClient(conf.host, conf.apiKey, conf.apiSecret);
      await dispatch.createDispatch(call.roomName, conf.agentName, { metadata });
      await prisma.voiceCall.update({
        where: { id: call.id },
        data: { status: 'IN_PROGRESS', recordingConsent },
      });
      await this.maybeStartRecording(call.id, call.roomName, recordingConsent);
    }

    const ttl = env.CALL_TOKEN_TTL_SECONDS;
    const at = new AccessToken(conf.apiKey, conf.apiSecret, {
      identity: `customer-${call.customerId}`,
      name: call.customer.fullName ?? 'Customer',
      ttl,
      metadata: JSON.stringify({ role: 'customer', callId: call.id }),
    });
    at.addGrant({ roomJoin: true, room: call.roomName, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
    const token = await at.toJwt();
    realtime.publish({ event: 'call:updated', payload: { callId: call.id }, rooms: roomsFor(call.lead?.brokerId) });
    return {
      token,
      url: conf.url,
      roomName: call.roomName,
      expiresAt: new Date(Date.now() + ttl * 1000),
      maxCallMinutes: ai.voice.maxCallMinutes,
    };
  },

  async maybeStartRecording(callId: string, roomName: string, consent: boolean) {
    const business = await settingsService.getBusiness();
    if (!business.recordingEnabled) return;
    if (!consent) {
      await prisma.voiceCall.update({ where: { id: callId }, data: { recordingStatus: 'NO_CONSENT' } });
      return;
    }
    const conf = await lk();
    const st = await integrationService.resolve('storage');
    if (!conf || st.config.driver !== 's3' || !st.config.bucket || !st.secrets.accessKeyId) {
      await prisma.voiceCall.update({ where: { id: callId }, data: { recordingStatus: 'UNAVAILABLE', failureReason: 'Recording needs S3 storage configured' } });
      return;
    }
    try {
      const key = `recordings/${roomName}.ogg`;
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: key,
        output: {
          case: 's3',
          value: new S3Upload({
            accessKey: st.secrets.accessKeyId,
            secret: st.secrets.secretAccessKey ?? '',
            bucket: st.config.bucket,
            region: st.config.region ?? '',
            endpoint: st.config.endpoint ?? '',
            forcePathStyle: Boolean(st.config.endpoint),
          }),
        },
      });
      const egress = new EgressClient(conf.host, conf.apiKey, conf.apiSecret);
      const info = await egress.startRoomCompositeEgress(roomName, output, { audioOnly: true });
      await prisma.voiceCall.update({
        where: { id: callId },
        data: {
          recordingStatus: 'RECORDING',
          egressId: info.egressId,
          recordingKey: key,
          recordingDeleteAt: new Date(Date.now() + business.recordingRetentionDays * 86_400_000),
        },
      });
    } catch (err) {
      logger.error({ err, callId }, 'failed to start egress');
      await prisma.voiceCall.update({ where: { id: callId }, data: { recordingStatus: 'FAILED', failureReason: 'Egress start failed' } });
    }
  },

  /** Customer pressed "End call". */
  async endByCode(code: string) {
    const call = await this.findByCode(code);
    await this.closeRoom(call.roomName);
    return this.markEnded(call.id);
  },

  async closeRoom(roomName: string) {
    const conf = await lk();
    if (!conf) return;
    try {
      await new RoomServiceClient(conf.host, conf.apiKey, conf.apiSecret).deleteRoom(roomName);
    } catch {
      /* room may already be gone */
    }
  },

  async markStarted(callId: string, at = new Date()) {
    const call = await prisma.voiceCall.findUnique({ where: { id: callId } });
    if (!call || call.startedAt) return;
    await prisma.voiceCall.update({ where: { id: callId }, data: { startedAt: at, status: 'IN_PROGRESS' } });
  },

  async markEnded(callId: string, at = new Date()) {
    const call = await prisma.voiceCall.findUnique({ where: { id: callId } });
    if (!call) return null;
    if (call.endedAt) return call;
    const duration = call.startedAt ? Math.max(0, Math.round((at.getTime() - call.startedAt.getTime()) / 1000)) : null;
    const updated = await prisma.voiceCall.update({
      where: { id: callId },
      data: { endedAt: at, durationSeconds: duration, status: call.startedAt ? 'COMPLETED' : 'MISSED' },
    });
    if (call.leadId) await addActivity(call.leadId, 'CALL', `AI voice call ${updated.status.toLowerCase()}${duration != null ? ` (${duration}s)` : ''}`, null, { callId });
    realtime.publish({ event: 'call:updated', payload: { callId }, rooms: ['staff'] });
    return updated;
  },

  /** LiveKit webhook (signed JWT in Authorization header). */
  async handleWebhook(rawBody: string, authHeader: string | undefined) {
    const conf = await lk();
    if (!conf) throw unavailable('LiveKit not configured');
    const receiver = new WebhookReceiver(conf.apiKey, conf.apiSecret);
    const event = await receiver.receive(rawBody, authHeader);
    return event;
  },

  /** Save transcript + summary posted by the Python agent (prompt §12). */
  async saveSummary(input: VoiceSummaryInput) {
    const call = await prisma.voiceCall.findUnique({ where: { roomName: input.roomName }, include: { lead: true } });
    if (!call) throw notFound('Call');
    const fullText = input.transcript.map((s) => `${s.role === 'user' ? 'Customer' : 'Assistant'}: ${s.text}`).join('\n');
    await prisma.$transaction(async (tx) => {
      await tx.callTranscript.upsert({
        where: { callId: call.id },
        update: { segments: input.transcript as object, fullText },
        create: { callId: call.id, segments: input.transcript as object, fullText },
      });
      await tx.voiceCall.update({
        where: { id: call.id },
        data: {
          summary: input.summary ?? call.summary,
          propertyType: input.propertyType ?? call.propertyType,
          budget: input.budget ?? call.budget,
          preferredLocation: input.preferredLocation ?? call.preferredLocation,
          urgency: input.urgency ?? call.urgency,
          startedAt: call.startedAt ?? (input.startedAt ? new Date(input.startedAt) : undefined),
        },
      });
      if (call.leadId) {
        await tx.leadActivity.create({
          data: { leadId: call.leadId, type: 'CALL_SUMMARY', message: input.summary?.slice(0, 1000) ?? 'Call transcript saved', data: { callId: call.id } },
        });
        // Fill gaps in the lead from what the customer said on the call (never overwrite existing values).
        if (call.lead) {
          await tx.lead.update({
            where: { id: call.leadId },
            data: {
              budgetRange: call.lead.budgetRange ?? input.budget ?? undefined,
              preferredLocation: call.lead.preferredLocation ?? input.preferredLocation ?? undefined,
              summary: call.lead.summary ?? input.summary?.slice(0, 1000) ?? undefined,
            },
          });
        }
      }
    });
    if (input.endedAt) await this.markEnded(call.id, new Date(input.endedAt));
    return { callId: call.id, leadId: call.leadId };
  },
};

async function storageIsS3() {
  return (await integrationService.resolve('storage')).config.driver === 's3';
}
