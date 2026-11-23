# Architecture (detailed)

The system overview and key decisions are in [`../ARCHITECTURE.md`](../ARCHITECTURE.md). This page maps modules to code.

## API (`apps/api/src`)
| Concern | Files |
|---|---|
| Config & env validation | `config/env.ts` |
| HTTP app, security middleware, routing | `app.ts`, `middleware/*` |
| REST modules | `modules/*.routes.ts` |
| Webhooks | `webhooks/index.ts` |
| Auth & tokens | `services/authService.ts` |
| AI (prompt, Groq, mock, validation) | `services/ai/*` |
| Property search tool | `services/propertySearch.ts` |
| Inbound pipeline | `services/conversationService.ts` |
| Lead pipeline & notifications text | `services/leadService.ts` |
| Broker assignment | `services/assignmentService.ts` |
| WhatsApp client & parser | `services/whatsapp.ts`, `services/messagingService.ts` |
| Notifications (queue + delivery) | `services/notificationService.ts` |
| Voice (LiveKit rooms, tokens, egress, summaries) | `services/voiceService.ts` |
| Integrations & encrypted secrets | `services/integrationService.ts`, `services/crypto.ts` |
| Storage (local/S3) | `services/storage.ts` |
| Queues & jobs | `queues/queue.ts`, `workers/handlers.ts`, `worker.ts` |
| Realtime | `services/realtime.ts`, `server.ts` |

## Inbound WhatsApp sequence
```
Meta ─POST→ /webhooks/whatsapp ─verify HMAC→ ledger(wa:<id>) ─dup?→ 200
                                   └→ customer upsert → message(RECEIVED) → enqueue process-inbound → 200
worker: process-inbound
  skip if human takeover / already answered / newer message exists
  → history(20) + open lead + settings → AI (tool: search_properties) → Zod validate (repair → fallback)
  → send reply (Message QUEUED→SENT|FAILED|SKIPPED_NOT_CONFIGURED)
  → if fallback: stop
  → if qualified & rules met: upsertQualifiedLead → assignLead (advisory lock) → notify broker (WA + in-app) + customer
  → if wants voice: ensure lead → createCallForLead → send link   (or AI already said voice unavailable)
  → enqueue summarize-conversation
```

## Frontend (`apps/web/src`)
`services/api.ts` (fetch client, in-memory token, single-flight refresh), `contexts/AuthContext.tsx`, `hooks/useRealtime.ts` (Socket.IO → query invalidation), `routes/index.tsx` (route guards mirror permissions), `components/ui/*` (shadcn-style primitives), `pages/*`.

## Voice agent (`apps/voice-agent`)
`agent/main.py` (LiveKit worker, AgentSession, tools `search_properties` and `end_call`, silence + max-duration handling, shutdown summary), `services/backend.py` (authenticated client, retries, HMAC signing), `services/prompt.py`, `services/transcript.py`, `services/config.py`.
