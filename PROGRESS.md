# Progress

_Last updated: 2026-11-21_

## Status: all phases implemented

| Phase | Status | Notes |
|---|---|---|
| 1 Foundation | ✅ | npm workspaces, Prisma schema + migration, env validation, JWT + refresh rotation, DB-backed RBAC, seed |
| 2 Core CRM | ✅ | properties (+images), brokers, customers, leads, assignment service, activities, dashboard |
| 3 AI WhatsApp | ✅ | verified webhook, idempotency, BullMQ processing, Groq tool-calling + Zod validation/repair/fallback, mock provider, notifications, human takeover, simulator |
| 4 Voice AI | ✅ | LiveKit rooms/tokens/dispatch/egress, public call page, Python agent (Groq STT/LLM, Cartesia/ElevenLabs TTS), signed summary webhook |
| 5 Automation | ✅ | queues (inbound, notifications, scheduler, calls), retries with backoff, failed-job table, follow-up reminders, link expiry, recording retention |
| 6 Analytics & settings | ✅ | analytics page, business/AI/integration settings (encrypted secrets, live tests), users, audit logs |
| 7 Testing & production | ✅ | 79 automated tests, Dockerfiles, compose, nginx, docs, security checklist |

## Verification performed
- `npm run typecheck` — clean (strict) for shared, api, web.
- `npm test` — shared 12, API 51 (real PostgreSQL), web 10; `npm run test:voice` — 6.
- Manual end-to-end in queue mode (API + worker + Redis): simulated Hinglish WhatsApp message → AI reply with real listing → qualified lead → assigned with logged reason → notifications.
- All 25 pages rendered in headless Chrome against the running API (desktop + mobile spot check); two UI defects found and fixed (chart axes, nested `<p>`), one data bug found and fixed (broker dashboard scope) with a regression test.
- Production bundle (`tsup`) started and served `/api/health`; worker started.

## Not verified here (need external access/credentials)
- Real Meta WhatsApp delivery, Groq responses, LiveKit rooms/agent audio, TTS, S3 egress. Integration code follows current SDKs/APIs; each has a **Test** button and unit/integration tests with stubs.
- `docker compose build`: Docker Hub was unreachable from the build sandbox; `docker compose config` validates.

## Known limitations / follow-ups
- Single-business data model (no multi-tenant organisations).
- PSTN calling is out of scope (LiveKit SIP is the extension path).
- Voice notes (WhatsApp audio) are stored as `[voice note]`; transcription via Groq Whisper could be added in `processInbound`.
- `prisma generate` may need `PRISMA_QUERY_ENGINE_LIBRARY` set in networks that block binaries.prisma.sh (see README).

## Commands to continue
```bash
service postgresql start && redis-server --daemonize yes   # or docker compose up -d postgres redis
npm install
npm run db:generate && npm run db:deploy && npm run db:seed
npm run dev
npm test
```
