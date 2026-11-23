import { aiReplySchema, detectLanguage, fallbackReply, type AiReply } from '@rea/shared';
import { logger } from '../../lib/logger';
import { settingsService } from '../settingsService';
import { searchAvailableProperties, type PropertyHit } from '../propertySearch';
import { groqProvider, type ChatMessage, type ChatProvider } from './groqProvider';
import { mockReply } from './mockProvider';
import { buildSystemPrompt, SEARCH_TOOL, type PromptContext } from './prompt';

export type HistoryItem = { role: 'customer' | 'assistant'; text: string };
export type AiMeta = {
  provider: string;
  model: string;
  toolCalls: number;
  attempts: number;
  fallback: boolean;
  error?: string;
};
export type AiResult = { reply: AiReply; hits: PropertyHit[]; meta: AiMeta };

let providerOverride: ChatProvider | null = null;
/** Test hook: inject a fake Groq provider. */
export function setChatProviderForTests(p: ChatProvider | null) {
  providerOverride = p;
}

/** Extract the first JSON object from a model response (tolerates ```json fences). */
export function extractJson(text: string | null): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Only allow property ids that the tool actually returned in this turn. */
function sanitize(reply: AiReply, hits: PropertyHit[]): AiReply {
  const allowed = new Set(hits.map((h) => h.id));
  return { ...reply, recommended_property_ids: reply.recommended_property_ids.filter((id) => allowed.has(id)) };
}

export async function generateReply(input: {
  ctx: PromptContext;
  history: HistoryItem[];
  latest: string;
}): Promise<AiResult> {
  const ai = await settingsService.getAi();
  const lang = detectLanguage(input.latest);

  if (ai.provider === 'mock' && !providerOverride) {
    const { reply, hits } = await mockReply({
      customerTexts: [...input.history.filter((h) => h.role === 'customer').map((h) => h.text), input.latest],
      latest: input.latest,
      known: {
        location: input.ctx.openLead?.preferredLocation ?? input.ctx.customer.preferredLocation,
        budget: input.ctx.openLead?.budgetRange ?? input.ctx.customer.budgetRange,
        type: input.ctx.openLead?.propertyType ?? input.ctx.customer.preferredPropertyType,
        bedrooms: input.ctx.openLead?.bedrooms,
        name: input.ctx.customer.name,
      },
      rules: ai.qualificationRules,
      voiceAvailable: input.ctx.voiceAvailable,
    });
    return { reply, hits, meta: { provider: 'mock', model: 'rule-based', toolCalls: hits.length ? 1 : 0, attempts: 1, fallback: false } };
  }

  const provider = providerOverride ?? groqProvider;
  const meta: AiMeta = { provider: 'groq', model: ai.model, toolCalls: 0, attempts: 0, fallback: false };
  const hits: PropertyHit[] = [];
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(input.ctx) },
    ...input.history.map<ChatMessage>((h) =>
      h.role === 'customer' ? { role: 'user', content: h.text } : { role: 'assistant', content: h.text },
    ),
    { role: 'user', content: input.latest },
  ];

  try {
    let content: string | null = null;
    // Up to 3 tool rounds; the only tool is a read-only, validated property search.
    for (let round = 0; round < 4; round++) {
      meta.attempts++;
      const res = await provider.chat(messages, { model: ai.model, temperature: ai.temperature, tools: round < 3 ? [SEARCH_TOOL] : undefined });
      if (res.toolCalls.length && round < 3) {
        messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
        for (const call of res.toolCalls) {
          meta.toolCalls++;
          let result: unknown;
          if (call.function.name === 'search_properties') {
            let args: unknown = {};
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              args = {};
            }
            const found = await searchAvailableProperties(args);
            for (const f of found) if (!hits.some((h) => h.id === f.id)) hits.push(f);
            result = { count: found.length, properties: found };
          } else {
            result = { error: `Unknown tool ${call.function.name}` };
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }
      content = res.content;
      break;
    }

    let parsed = aiReplySchema.safeParse(extractJson(content));
    if (!parsed.success) {
      // One safe repair attempt in strict JSON mode.
      meta.attempts++;
      logger.warn({ issues: parsed.error.issues.slice(0, 3) }, 'AI output invalid; requesting JSON repair');
      const repair = await provider.chat(
        [
          ...messages,
          { role: 'assistant', content: content ?? '' },
          { role: 'user', content: 'Your previous answer was not valid. Return ONLY the JSON object in the required OUTPUT FORMAT.' },
        ],
        { model: ai.model, temperature: 0, json: true },
      );
      parsed = aiReplySchema.safeParse(extractJson(repair.content));
    }
    if (!parsed.success) {
      meta.fallback = true;
      meta.error = 'invalid_output';
      logger.error({ issues: parsed.error.issues.slice(0, 5) }, 'AI output invalid after repair; using fallback');
      return { reply: fallbackReply(lang), hits, meta };
    }
    return { reply: sanitize(parsed.data, hits), hits, meta };
  } catch (err) {
    meta.fallback = true;
    meta.error = err instanceof Error ? err.message.slice(0, 300) : 'provider_error';
    logger.error({ err }, 'AI provider failed; using fallback');
    return { reply: fallbackReply(lang), hits, meta };
  }
}

/** Short English summary of a conversation for the inbox. */
export async function summarizeConversation(lines: HistoryItem[]): Promise<string> {
  const ai = await settingsService.getAi();
  if (lines.length === 0) return 'No messages yet.';
  if (ai.provider === 'mock' && !providerOverride) {
    const customer = lines.filter((l) => l.role === 'customer').map((l) => l.text);
    return `Customer sent ${customer.length} message(s). Latest: "${(customer.at(-1) ?? '').slice(0, 160)}"`;
  }
  const provider = providerOverride ?? groqProvider;
  try {
    const res = await provider.chat(
      [
        { role: 'system', content: 'Summarise this real-estate WhatsApp conversation for a broker in 2-3 English sentences: requirement, budget, location, urgency, and next step. No invented facts.' },
        { role: 'user', content: lines.map((l) => `${l.role === 'customer' ? 'Customer' : 'Assistant'}: ${l.text}`).join('\n').slice(-12000) },
      ],
      { model: ai.model, temperature: 0.2, maxTokens: 300 },
    );
    return (res.content ?? '').trim().slice(0, 2000) || 'Summary unavailable.';
  } catch (err) {
    logger.error({ err }, 'summary failed');
    return 'Summary unavailable (AI provider error).';
  }
}
