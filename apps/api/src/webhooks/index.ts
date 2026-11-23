import express, { Router } from 'express';
import { voiceSummarySchema } from '@rea/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { webhookLimiter } from '../middleware/rateLimit';
import { markEventProcessed, receiveInbound } from '../services/conversationService';
import { hmacSha256Hex, safeEqual } from '../services/crypto';
import { applyDeliveryStatus } from '../services/messagingService';
import { voiceService } from '../services/voiceService';
import { parseWebhook, whatsapp } from '../services/whatsapp';
import { badRequest, unauthorized } from '../utils/errors';
import { parse } from '../utils/http';

export const webhooksRouter = Router();
webhooksRouter.use(webhookLimiter);
// Raw body is required for signature verification; JSON is parsed after verifying.
const raw = express.raw({ type: '*/*', limit: '2mb' });

function jsonFrom(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw badRequest('Malformed JSON');
  }
}

// ---------- WhatsApp ----------
/** Meta webhook verification handshake. */
webhooksRouter.get('/whatsapp', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = await whatsapp.getVerifyToken();
  if (mode === 'subscribe' && typeof token === 'string' && expected && safeEqual(token, expected) && typeof challenge === 'string') {
    return res.status(200).type('text/plain').send(challenge);
  }
  res.sendStatus(403);
});

webhooksRouter.post('/whatsapp', raw, async (req, res) => {
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !(await whatsapp.verifySignature(body, req.get('x-hub-signature-256')))) {
    logger.warn('WhatsApp webhook signature verification failed');
    return res.sendStatus(401);
  }
  const { messages, statuses } = parseWebhook(jsonFrom(body));
  for (const s of statuses) {
    try {
      await applyDeliveryStatus(s.id, s.status, s.error);
    } catch (err) {
      logger.error({ err }, 'status update failed');
    }
  }
  for (const m of messages) {
    // Errors for one message must not cause Meta to redeliver the whole batch forever:
    // the message id is recorded first, so a retry is a no-op and failures are logged.
    try {
      await receiveInbound({ waMessageId: m.id, from: m.from, name: m.name, text: m.text, type: m.type, timestamp: m.timestamp });
    } catch (err) {
      logger.error({ err, waMessageId: m.id }, 'inbound processing failed');
    }
  }
  res.sendStatus(200);
});

// ---------- LiveKit ----------
webhooksRouter.post('/livekit', raw, async (req, res) => {
  let event;
  try {
    event = await voiceService.handleWebhook((req.body as Buffer).toString('utf8'), req.get('authorization'));
  } catch (err) {
    logger.warn({ err }, 'LiveKit webhook rejected');
    return res.sendStatus(401);
  }
  if (event.id && !(await markEventProcessed('lk', event.id))) return res.sendStatus(200);
  const roomName = event.room?.name ?? event.egressInfo?.roomName;
  const call = roomName ? await prisma.voiceCall.findUnique({ where: { roomName } }) : null;
  if (call) {
    const at = event.createdAt ? new Date(Number(event.createdAt) * 1000) : new Date();
    switch (event.event) {
      case 'participant_joined':
        if (event.participant?.identity?.startsWith('customer-')) await voiceService.markStarted(call.id, at);
        break;
      case 'room_finished':
        await voiceService.markEnded(call.id, at);
        break;
      case 'egress_ended': {
        const ok = event.egressInfo?.status === 3; // EGRESS_COMPLETE
        await prisma.voiceCall.update({ where: { id: call.id }, data: { recordingStatus: ok ? 'AVAILABLE' : 'FAILED', failureReason: ok ? call.failureReason : (event.egressInfo?.error ?? 'Egress failed') } });
        break;
      }
    }
  }
  res.sendStatus(200);
});

// ---------- Voice agent: transcript + summary ----------
/** Signed by the agent: X-Agent-Timestamp + X-Agent-Signature = HMAC-SHA256(AGENT_API_KEY, `${ts}.${body}`). */
webhooksRouter.post('/voice-summary', raw, async (req, res) => {
  const body = req.body as Buffer;
  const ts = req.get('x-agent-timestamp');
  const sig = req.get('x-agent-signature');
  if (!ts || !sig || !Buffer.isBuffer(body)) throw unauthorized('Missing signature');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw unauthorized('Stale request');
  const expected = hmacSha256Hex(env.AGENT_API_KEY, Buffer.concat([Buffer.from(`${ts}.`), body]));
  if (!safeEqual(expected, sig)) throw unauthorized('Bad signature');
  const input = parse(voiceSummarySchema, jsonFrom(body));
  res.json(await voiceService.saveSummary(input));
});
