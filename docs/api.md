# REST API

Base path `/api`. JSON in/out. Errors: `{ "error": { "code", "message", "details?" } }`. List endpoints accept `page`, `pageSize` (≤100), `search` and return `{ items, total, page, pageSize, totalPages }`.

**Auth:** `Authorization: Bearer <accessToken>` (15 min). Refresh via httpOnly cookie `rea_rt` (path `/api/auth`, SameSite=Strict) and header `X-Requested-With: XMLHttpRequest`.

| Method & path | Permission | Notes |
|---|---|---|
| `POST /auth/login` | public (rate-limited) | 5 failures → 15 min lock |
| `POST /auth/refresh` · `POST /auth/logout` | cookie + XHR header | rotation with reuse detection |
| `GET /auth/me` | any | role, permissions, brokerId |
| `PATCH /profile` · `POST /profile/password` | any | password change revokes sessions |
| `GET /dashboard/overview` · `GET /dashboard/analytics?days=` | `dashboard:read` | broker-scoped for brokers |
| `GET/POST /properties`, `GET/PATCH/DELETE /properties/:id` | `property:read` / `property:write` | filters: `city, location, propertyType, listingType, availability, minPrice, maxPrice, bedrooms` |
| `POST /properties/:id/images` (multipart `images`) · `DELETE /properties/:id/images/:imageId` | `property:write` | JPEG/PNG/WebP ≤ 5 MB, ≤ 10/request, ≤ 20/property, magic-byte checked |
| `GET/POST /brokers`, `GET/PATCH /brokers/:id` | `broker:read` / `broker:write` | create returns one-time `temporaryPassword` if none given |
| `DELETE /brokers/:id[?hard=true]` | `broker:write` (hard: Super Admin) | default deactivates |
| `GET /brokers/options` | `lead:assign` | active brokers with workload |
| `GET /customers`, `GET/PATCH /customers/:id` | `customer:read` / `customer:write` | brokers: only customers with their leads |
| `GET/POST /leads`, `GET/PATCH /leads/:id` | `lead:read` / `lead:write` | brokers: own leads only; LOST requires `lostReason` |
| `POST /leads/:id/assign` `{ auto } \| { brokerId, reason }` | `lead:assign` | returns the logged reason |
| `POST /leads/:id/notes` | `lead:write` | |
| `POST /leads/:id/call` `{ sendLink }` | `call:create` | |
| `GET/POST /follow-ups`, `PATCH /follow-ups/:id` | `followup:read` / `followup:write` | `overdue=true` filter |
| `GET /conversations`, `GET /conversations/:id`, `GET /conversations/:id/messages` | `conversation:read` | filters: `customerId, brokerId, from, to, takeover` |
| `POST /conversations/:id/reply` · `POST /conversations/:id/takeover` | `conversation:reply` | reply only inside 24 h window |
| `POST /conversations/:id/summary` | `conversation:read` | |
| `POST /conversations/simulate` | `settings:business` | demo/testing; disabled in prod when WhatsApp configured |
| `POST /voice/rooms` `{ leadId, sendLink }` | `call:create` | |
| `GET /voice/session/:code` · `POST /voice/token` · `POST /voice/end` | public, join code | rate-limited |
| `GET /voice/calls`, `GET /voice/calls/:id`, `GET /voice/calls/:id/recording` | `call:read` | recording = 5 min signed URL |
| `GET /notifications?scope=mine\|all`, `POST /notifications/:id/read`, `POST /notifications/read-all` | `notification:read` | |
| `GET /integrations` | `settings:business` | secrets → `{ hasValue, last4 }` only |
| `PATCH /integrations/:key` · `POST /integrations/:key/test` | `settings:integrations` | keys: `whatsapp, groq, livekit, tts, storage` |
| `GET/PUT /settings/business` | `settings:business` | |
| `GET /settings/ai` · `PUT /settings/ai` | `settings:business` / `settings:ai` | |
| `GET/POST /users`, `PATCH /users/:id` | `user:manage` | |
| `GET /audit-logs` | `audit:read` | |
| `GET /health` | public | DB status |
| `GET /files/properties/*` | public | property images only |

**Webhooks** (no JWT; each verified):
- `GET/POST /webhooks/whatsapp` — verify token / `X-Hub-Signature-256`
- `POST /webhooks/livekit` — LiveKit signed JWT
- `POST /webhooks/voice-summary` — `X-Agent-Timestamp` + `X-Agent-Signature`

**Agent API** (`X-Agent-Key`): `GET /agent/calls/:room/context`, `POST /agent/properties/search`, `POST /agent/calls/:room/started`.

Default role matrix: `packages/shared/src/permissions.ts` (seeded into the DB).
