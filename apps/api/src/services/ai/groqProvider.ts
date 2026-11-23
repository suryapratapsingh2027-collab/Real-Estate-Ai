import { env } from '../../config/env';
import { IntegrationError } from '../../utils/errors';
import { fetchWithRetry } from '../../utils/http';
import { integrationService } from '../integrationService';

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatResult = { content: string | null; toolCalls: ToolCall[] };

export interface ChatProvider {
  chat(messages: ChatMessage[], opts: { model: string; temperature: number; tools?: readonly unknown[]; json?: boolean; maxTokens?: number }): Promise<ChatResult>;
}

/** Groq exposes an OpenAI-compatible Chat Completions API. */
export const groqProvider: ChatProvider = {
  async chat(messages, opts) {
    const r = await integrationService.resolve('groq');
    if (!r.secrets.apiKey) throw new IntegrationError('groq', 'Groq API key is not configured', false);
    const body: Record<string, unknown> = {
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens ?? 1024,
      messages,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }
    if (opts.json) body.response_format = { type: 'json_object' };
    const res = await fetchWithRetry(
      'groq',
      `${r.config.baseUrl ?? env.GROQ_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${r.secrets.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { timeoutMs: env.AI_TIMEOUT_MS, retries: 2 },
    );
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
    };
    const msg = json.choices?.[0]?.message;
    return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
  },
};
