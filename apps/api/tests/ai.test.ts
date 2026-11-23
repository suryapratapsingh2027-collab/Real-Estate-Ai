import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { extractJson, generateReply, setChatProviderForTests } from '../src/services/ai/aiService';
import type { ChatMessage, ChatProvider } from '../src/services/ai/groqProvider';
import { searchAvailableProperties } from '../src/services/propertySearch';
import { settingsService } from '../src/services/settingsService';
import { seedBase } from './helpers';

const ctx = async () => ({
  business: await settingsService.getBusiness(),
  ai: await settingsService.getAi(),
  customer: { name: null, phone: '+919800000099' },
  openLead: null,
});

function scripted(responses: Array<(msgs: ChatMessage[]) => { content: string | null; toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }>) {
  const calls: ChatMessage[][] = [];
  const p: ChatProvider = {
    async chat(messages) {
      calls.push(messages);
      const r = responses.shift();
      if (!r) throw new Error('no more scripted responses');
      const out = r(messages);
      return { content: out.content, toolCalls: out.toolCalls ?? [] };
    },
  };
  return { p, calls };
}

const valid = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ reply_message: 'Here you go', is_qualified_lead: false, wants_voice_call: false, missing_information: [], recommended_property_ids: [], ...over });

describe('AI service', () => {
  beforeAll(seedBase);
  afterEach(() => setChatProviderForTests(null));

  it('extractJson handles fences and junk', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} thanks')).toEqual({ a: 2 });
    expect(extractJson('not json')).toBeNull();
  });

  it('property search only returns AVAILABLE properties', async () => {
    const hits = await searchAvailableProperties({ location: 'Arera Colony' });
    expect(hits.map((h) => h.title)).toEqual(['2 BHK in Arera Colony']);
    const ignoredBadArgs = await searchAvailableProperties({ location: 123, limit: 'x' });
    expect(ignoredBadArgs.every((h) => h.id)).toBe(true);
  });

  it('runs the search tool and strips property ids the tool did not return', async () => {
    const realId = (await prisma.property.findFirstOrThrow({ where: { availability: 'AVAILABLE', location: 'Arera Colony' } })).id;
    const { p, calls } = scripted([
      () => ({ content: null, toolCalls: [{ id: 't1', type: 'function', function: { name: 'search_properties', arguments: '{"location":"Arera Colony"}' } }] }),
      () => ({ content: valid({ recommended_property_ids: [realId, '00000000-0000-0000-0000-00000000dead'] }) }),
    ]);
    setChatProviderForTests(p);
    const r = await generateReply({ ctx: await ctx(), history: [], latest: '2bhk in arera colony' });
    expect(r.meta.toolCalls).toBe(1);
    expect(r.reply.recommended_property_ids).toEqual([realId]);
    const toolMsg = calls[1]!.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('2 BHK in Arera Colony');
    expect(toolMsg?.content).not.toContain('Sold flat'); // sold listings never reach the model
  });

  it('repairs invalid output once in JSON mode', async () => {
    const { p } = scripted([() => ({ content: 'Sure, I can help with that!' }), () => ({ content: valid({ reply_message: 'Fixed' }) })]);
    setChatProviderForTests(p);
    const r = await generateReply({ ctx: await ctx(), history: [], latest: 'hello' });
    expect(r.meta.fallback).toBe(false);
    expect(r.meta.attempts).toBe(2);
    expect(r.reply.reply_message).toBe('Fixed');
  });

  it('falls back safely (never sends raw invalid JSON) when output stays invalid', async () => {
    const { p } = scripted([() => ({ content: '{"reply_message": 5}' }), () => ({ content: '{broken' })]);
    setChatProviderForTests(p);
    const r = await generateReply({ ctx: await ctx(), history: [], latest: 'mujhe ghar chahiye' });
    expect(r.meta.fallback).toBe(true);
    expect(r.reply.is_qualified_lead).toBe(false);
    expect(r.reply.reply_message).toMatch(/Maaf kijiye/); // Hinglish fallback for Hinglish input
    expect(r.reply.reply_message).not.toContain('{');
  });

  it('falls back when the provider errors', async () => {
    setChatProviderForTests({ chat: async () => Promise.reject(new Error('timeout')) });
    const r = await generateReply({ ctx: await ctx(), history: [], latest: 'hi' });
    expect(r.meta.fallback).toBe(true);
    expect(r.meta.error).toBe('timeout');
  });

  it('mock provider qualifies only with complete info and recommends real listings', async () => {
    const partial = await generateReply({ ctx: await ctx(), history: [], latest: 'I want a flat in Arera Colony' });
    expect(partial.reply.is_qualified_lead).toBe(false);
    expect(partial.reply.missing_information).toContain('budget');
    const full = await generateReply({ ctx: await ctx(), history: [{ role: 'customer', text: 'I want a flat in Arera Colony' }], latest: 'budget 50-70 lakhs, 2 bhk' });
    expect(full.reply.is_qualified_lead).toBe(true);
    expect(full.reply.preferred_location).toBe('Arera Colony');
    expect(full.reply.reply_message).toContain('2 BHK in Arera Colony');
    expect(full.reply.reply_message).not.toContain('Sold flat');
  });
});
