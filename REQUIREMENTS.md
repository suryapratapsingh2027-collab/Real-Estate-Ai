# Requirements

Source: the master development prompt describing the n8n workflow **"WhatsApp Real Estate Chatbot + Lead Assignment + LiveKit Voice Calls"**.

> The n8n workflow JSON itself was not supplied with the prompt. Requirements below are extracted from the prompt's description of that workflow and its explicit corrections. If the JSON becomes available, diff it against the "Workflow behaviour" table and update.

## Workflow behaviour → platform module mapping

| Workflow behaviour (n8n) | Limitation in n8n version | Platform module | Implementation |
|---|---|---|---|
| WhatsApp trigger receives message | No signature check, no idempotency | `webhooks/whatsapp` | GET verify (`hub.verify_token`), POST with `X-Hub-Signature-256` HMAC, `ProcessedWebhookEvent` dedupe by WhatsApp message id |
| AI agent (Groq Llama) answers | Free-text output, could hallucinate listings | `services/ai` | Structured JSON output validated by Zod, retry + fallback, property search tool against PostgreSQL only |
| Property lookup (Google Sheets) | Sheets as DB | `modules/properties` | PostgreSQL + Prisma, availability filter |
| "Is qualified lead?" branch | Lead keyed by phone | `services/leadService` | UUID lead id + human-readable `LD-000123` number; multiple leads per customer |
| Random broker pick | Random assignment | `services/assignmentService` | Location → availability → workload → fallback policy, reason logged |
| Notify broker via WhatsApp | Failure breaks the flow | `queues/notifications` | Notification row + BullMQ job with retries, delivery status via webhook |
| "Wants voice call?" branch skipped lead creation | Voice bypasses assignment | `services/conversationService` | Qualification/assignment always runs first; voice is an additional step |
| Create LiveKit room + token, send link | Token in link, long-lived | `modules/voice` | Room + agent dispatch, opaque join link (hashed one-time-use code) exchanged for a 10-min token |
| Voice agent | Not implemented in workflow | `apps/voice-agent` | Python LiveKit Agents: Groq Whisper STT, Groq Llama, Cartesia/ElevenLabs TTS, Silero VAD |
| Call summary saved | Not tied to lead | `webhooks/voice-summary` | HMAC-authenticated, stored against `VoiceCall.leadId` |

## Functional requirements (by prompt section)

- **§3 RBAC** — roles `SUPER_ADMIN`, `ADMIN`, `BROKER`; customers are not system users (WhatsApp + signed join links). Enforced via `requirePermission()` middleware and per-record broker scoping.
- **§4 Dashboard** — 13 KPIs + 7 charts from live SQL aggregates.
- **§5 Properties** — full CRUD, image upload (local or S3), filters, pagination.
- **§6 Brokers** — CRUD, areas, capacity, workload, performance; intelligent assignment.
- **§7 Customers** — E.164 normalisation, unique phone, timeline.
- **§8 WhatsApp AI** — Hindi/English/Hinglish, same-script reply, no invented data.
- **§9–10 Leads** — 9 statuses, activities, notes, follow-ups, auto/manual assignment, broker + customer notifications.
- **§11–12 Voice** — browser voice only (no PSTN), call page, Python agent, transcript, summary, optional egress recording with consent flag and retention.
- **§13 Conversations** — inbox, delivery status, human takeover (pauses AI).
- **§14 Follow-ups** — BullMQ reminders, overdue detection.
- **§15 Settings** — business, AI, integrations (secrets AES-256-GCM encrypted, never returned).
- **§16–17 DB/API** — Prisma models listed in prompt, REST routes listed in prompt.
- **§18–19 Security/reliability** — see `docs/security-checklist.md`.
- **§21 Tests** — `npm test` runs API (vitest + supertest against real Postgres), web (vitest + RTL), voice agent (pytest).

## Explicit non-goals
- PSTN / phone-network calling (future extension; see `docs/livekit-setup.md`).
- Multi-tenant organisations: the prompt mentions "organizations" for Super Admin; the data model is single-business with `BusinessSetting`. Tenancy is listed as a future extension in `ARCHITECTURE.md`.
