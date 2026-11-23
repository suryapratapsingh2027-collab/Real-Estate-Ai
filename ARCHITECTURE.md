# Architecture

```
                 ┌───────────────┐        ┌────────────────────┐
WhatsApp user ──▶│ Meta Cloud API│──POST─▶│  nginx (/api/...)  │
                 └───────────────┘        └─────────┬──────────┘
                                                    ▼
 Browser (admin / broker) ──HTTPS──▶ nginx ──▶ apps/api (Express, TS)
 Browser (customer call page) ─────────────────────▶│   ├─ REST modules (auth, crm, voice, settings)
                                                    │   ├─ webhooks (whatsapp, livekit, voice-summary)
                                                    │   ├─ services (ai, assignment, lead, whatsapp, livekit, crypto)
                                                    │   └─ Socket.IO (live inbox / dashboard refresh)
                                                    │
                       PostgreSQL ◀── Prisma ───────┤
                       Redis ◀── BullMQ queues ─────┤──▶ apps/api worker process (same image, `npm run worker`)
                                                    │      inbound-message · notifications · follow-ups · call-summary
                                                    ▼
                                        LiveKit server/Cloud ◀──▶ apps/voice-agent (Python, LiveKit Agents)
                                                                  Groq Whisper STT · Groq Llama · Cartesia/ElevenLabs TTS
                                                                  calls /api/agent/* with AGENT_API_KEY
```

## Key decisions

1. **Webhook → queue → worker.** The WhatsApp webhook verifies the signature, records the message id for idempotency, persists the inbound message, enqueues `inbound-message`, and returns 200 within Meta's timeout. The AI runs in the worker. When Redis is unavailable (tests, `QUEUE_MODE=inline`), jobs run inline.
2. **AI never writes to the DB.** The LLM may call one read-only tool (`search_properties`), whose arguments are Zod-validated and translated to a parameterised Prisma query that always includes `availability = AVAILABLE`. Its final answer is a Zod-validated JSON object; the application decides what to persist.
3. **Single lead pipeline.** `leadService.upsertQualifiedLead()` is the only path that creates a qualified lead and triggers assignment + notifications. Voice intent is processed *after* this call, never instead of it.
4. **Assignment is deterministic and explained.** `assignmentService.pickBroker()` returns `{ broker, reason, candidates }`; the reason is stored in `LeadActivity`.
5. **Join links are opaque.** WhatsApp receives `/call/<code>`; the code is random 32 bytes, stored only as a SHA-256 hash, expires (default 30 min). The call page exchanges it for a LiveKit token with a 10-minute TTL scoped to one room with publish/subscribe grants only.
6. **Integrations degrade explicitly.** Each integration reports `NOT_CONFIGURED | CONFIGURED | OK | ERROR`. Without WhatsApp credentials, outbound messages are stored with status `SKIPPED_NOT_CONFIGURED`; with `AI_PROVIDER=mock`, a deterministic rule-based responder is used. Nothing pretends to have succeeded.
7. **Secrets.** Env vars are the primary source. Secrets entered via the Integrations page are AES-256-GCM encrypted with `ENCRYPTION_KEY` and only `hasValue`/last-4 are returned.
8. **Shared package.** `packages/shared` merges the prompt's `shared` and `validation` packages: enums, Zod schemas (incl. AI output), permission matrix, phone normalisation. It is consumed as TypeScript source (bundled by tsup for the API and by Vite for the web).

## Future extensions
- PSTN via LiveKit SIP trunks (outbound/inbound telephony).
- Multi-tenant organisations (add `organizationId` to tenant-scoped tables).
- Vector search over property descriptions.
