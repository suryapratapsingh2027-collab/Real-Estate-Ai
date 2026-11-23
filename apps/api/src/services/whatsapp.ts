import { toWhatsAppRecipient } from '@rea/shared';
import { env } from '../config/env';
import { IntegrationError } from '../utils/errors';
import { fetchWithRetry } from '../utils/http';
import { hmacSha256Hex, safeEqual } from './crypto';
import { integrationService } from './integrationService';

export type SendResult = { status: 'SENT'; whatsappMessageId: string } | { status: 'SKIPPED_NOT_CONFIGURED' };

async function cfg() {
  const r = await integrationService.resolve('whatsapp');
  const configured = await integrationService.isConfigured('whatsapp');
  return { configured, ...r };
}

async function post(payload: Record<string, unknown>): Promise<SendResult> {
  const c = await cfg();
  if (!c.configured) return { status: 'SKIPPED_NOT_CONFIGURED' };
  const url = `${env.WHATSAPP_API_BASE}/${c.config.graphVersion ?? env.WHATSAPP_GRAPH_VERSION}/${c.config.phoneNumberId}/messages`;
  const res = await fetchWithRetry(
    'whatsapp',
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.secrets.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    },
    { retries: 2, timeoutMs: 15000 },
  );
  const json = (await res.json()) as { messages?: Array<{ id: string }> };
  const id = json.messages?.[0]?.id;
  if (!id) throw new IntegrationError('whatsapp', 'No message id in WhatsApp response', false);
  return { status: 'SENT', whatsappMessageId: id };
}

export const whatsapp = {
  isConfigured: async () => (await cfg()).configured,

  sendText(toE164: string, body: string): Promise<SendResult> {
    return post({ to: toWhatsAppRecipient(toE164), type: 'text', text: { preview_url: true, body: body.slice(0, 4096) } });
  },

  /** Template message (required to message a user outside the 24-hour customer service window). */
  sendTemplate(toE164: string, name: string, languageCode: string, bodyParams: string[]): Promise<SendResult> {
    return post({
      to: toWhatsAppRecipient(toE164),
      type: 'template',
      template: {
        name,
        language: { code: languageCode },
        components: bodyParams.length
          ? [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: t.slice(0, 1000) })) }]
          : [],
      },
    });
  },

  async getVerifyToken(): Promise<string | undefined> {
    return (await cfg()).secrets.verifyToken;
  },

  /** Validates Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
  async verifySignature(rawBody: Buffer, header: string | undefined): Promise<boolean> {
    const secret = (await cfg()).secrets.appSecret;
    if (!secret || !header?.startsWith('sha256=')) return false;
    const expected = 'sha256=' + hmacSha256Hex(secret, rawBody);
    return safeEqual(expected, header);
  },
};

// ---------- Webhook payload parsing ----------
export type InboundMessage = {
  id: string;
  from: string;
  name: string | null;
  timestamp: Date;
  type: string;
  text: string;
};
export type StatusUpdate = { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; error?: string };

type WaPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id: string;
          from: string;
          timestamp?: string;
          type: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          audio?: { id?: string };
          image?: { caption?: string };
          location?: { name?: string; address?: string; latitude?: number; longitude?: number };
        }>;
        statuses?: Array<{ id: string; status: string; errors?: Array<{ title?: string; message?: string }> }>;
      };
    }>;
  }>;
};

export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const p = body as WaPayload;
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  if (p?.object !== 'whatsapp_business_account') return { messages, statuses };
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      for (const m of v.messages ?? []) {
        const contact = v.contacts?.find((c) => c.wa_id === m.from) ?? v.contacts?.[0];
        let text = '';
        switch (m.type) {
          case 'text':
            text = m.text?.body ?? '';
            break;
          case 'button':
            text = m.button?.text ?? '';
            break;
          case 'interactive':
            text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
            break;
          case 'image':
            text = m.image?.caption ?? '[image]';
            break;
          case 'location':
            text = `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(', ')}`.trim();
            break;
          case 'audio':
            text = '[voice note]';
            break;
          default:
            text = `[${m.type}]`;
        }
        messages.push({
          id: m.id,
          from: m.from,
          name: contact?.profile?.name ?? null,
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          type: m.type,
          text,
        });
      }
      for (const s of v.statuses ?? []) {
        if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        statuses.push({
          id: s.id,
          status: s.status as StatusUpdate['status'],
          error: s.errors?.map((e) => e.message ?? e.title).filter(Boolean).join('; ') || undefined,
        });
      }
    }
  }
  return { messages, statuses };
}
