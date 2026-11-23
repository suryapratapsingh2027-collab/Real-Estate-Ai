# EstateFlow — AI Real Estate Automation & CRM

A full-stack platform that turns the n8n workflow **"WhatsApp Real Estate Chatbot + Lead Assignment + LiveKit Voice Calls"** into a production-oriented application:

- **WhatsApp AI assistant** (Meta Cloud API + Groq Llama) answering in English, Hindi and Hinglish, recommending only real, available listings from PostgreSQL.
- **Lead qualification → intelligent broker assignment → WhatsApp notifications**, with every step logged.
- **Browser-based AI voice calls** (LiveKit + Python agent: Groq Whisper STT, Groq Llama, Cartesia/ElevenLabs TTS) with transcripts and summaries saved against the lead. _Not_ phone-network (PSTN) calling.
- **Admin/broker dashboard**: properties, brokers, customers, leads, WhatsApp inbox with human takeover, calls, follow-ups, analytics, settings, integrations, users, audit logs.

```
apps/api          Express + TypeScript REST API, webhooks, BullMQ worker (Prisma/PostgreSQL, Redis)
apps/web          React + Vite + Tailwind + shadcn-style UI (TanStack Query, RHF + Zod, Recharts)
apps/voice-agent  Python LiveKit Agents service
packages/shared   Shared enums, Zod schemas, permission matrix, phone/budget helpers
prisma/           Schema, migrations, seed
infrastructure/   Dockerfiles, nginx
docs/             Setup, API, database, deployment, security
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md), [`REQUIREMENTS.md`](REQUIREMENTS.md) and [`PROGRESS.md`](PROGRESS.md).

---

## Quick start (local, no external credentials)

Everything works in **demo mode** without WhatsApp, Groq or LiveKit: the AI uses a deterministic rule-based provider (`AI_PROVIDER=mock`), outbound WhatsApp messages are stored as _"Not sent (not configured)"_, and voice calls report that they are unavailable. Use **Conversations → Simulate message** to drive the full pipeline.

Prerequisites: Node.js ≥ 20, PostgreSQL 14+, Redis 6+ (Python 3.11+ only for the voice agent).

```bash
cp .env.example .env
# Generate secrets and paste them into .env:
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, AGENT_API_KEY

npm install
npm run db:generate
npm run db:deploy        # apply migrations
npm run db:seed          # roles + demo data (skipped in production)

npm run dev              # API :4000, worker, web :5173
```

Open http://localhost:5173 and sign in with the **seeded local development accounts** (created only when `NODE_ENV` ≠ `production`; all demo rows are flagged and shown with a "Demo" badge):

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@demo.local` | `Admin@12345` |
| Admin | `manager@demo.local` | `Admin@12345` |
| Broker | `ravi.broker@demo.local` | `Admin@12345` |

The demo password comes from `SEED_ADMIN_PASSWORD`. In production the seed creates **no users**; create the first Super Admin with `npm run create-admin -w @rea/api`.

### With Docker

```bash
cp .env.example .env   # fill in secrets
docker compose up -d --build
docker compose run --rm api seed            # optional demo data (non-production)
docker compose --profile voice up -d voice-agent   # after configuring LiveKit/Groq/TTS
```
App: http://localhost:8080 (nginx serves the SPA and proxies `/api` and `/socket.io`).

---

## Connecting real integrations

| Integration | Guide | Where to configure |
|---|---|---|
| WhatsApp Cloud API | [`docs/whatsapp-setup.md`](docs/whatsapp-setup.md) | `.env` or **Settings → Integrations** |
| Groq | set `GROQ_API_KEY`, test it, then switch **AI Settings → Provider** to Groq | Integrations + AI Settings |
| LiveKit + voice agent | [`docs/livekit-setup.md`](docs/livekit-setup.md) | `.env` (agent reads env) + Integrations |
| S3 storage / recordings | [`docs/deployment.md`](docs/deployment.md#storage) | Integrations |

Each integration has a **Test** button that performs a real read-only call. Status is never shown as working without a successful test.

---

## Testing

```bash
npm test                 # shared (12) + API (51, real Postgres, inline queue) + web (10)
npm run typecheck        # strict TypeScript in all packages
npm run test:voice       # Python agent unit tests (pip install -r apps/voice-agent/requirements-dev.txt)
```
API tests use a separate database (`TEST_DATABASE_URL`, default `postgresql://realestate:realestate@localhost:5432/realestate_test`); create it once with `createdb realestate_test`. External HTTP (WhatsApp, LiveKit) is stubbed — tests never call real services.

Coverage highlights: auth (lockout, refresh rotation + reuse detection, CSRF header), RBAC and broker data scoping, secret non-disclosure, assignment rules/fallbacks/concurrency, AI tool use + output validation + repair + fallback, WhatsApp signature verification, idempotency and delivery status, human takeover, voice token scope/TTL, signed call-summary webhook, CRUD, uploads (magic-byte validation), follow-up reminders, dashboard numbers vs. DB.

---

## Troubleshooting

- **`prisma generate` fails downloading engines in a restricted network.** The app uses Prisma's rust-free client (`queryCompiler` + `@prisma/adapter-pg`) and the JS schema engine, so no native engine is needed at runtime. If the CLI still insists on downloading the library engine, run `PRISMA_QUERY_ENGINE_LIBRARY=/tmp/none npm run db:generate` (create the empty file first).
- **`Invalid environment configuration`** on startup lists exactly which variables are missing or malformed (values are never printed).
- **Webhook returns 401** — the WhatsApp app secret is wrong or the request is not from Meta. See `docs/whatsapp-setup.md`.
- **Brokers don't receive WhatsApp notifications** — messages to numbers that haven't messaged you in 24 h require an approved template; set `brokerTemplateName` on the WhatsApp integration.
