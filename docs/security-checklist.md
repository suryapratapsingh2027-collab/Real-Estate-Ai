# Security checklist

| Control | Implementation | Verified by |
|---|---|---|
| Password hashing | bcrypt (cost 12); constant-time path for unknown emails | `auth.test.ts` |
| Brute force | 5 failures → 15 min lock; login rate limit 20/15 min/IP | `auth.test.ts` |
| Tokens | 15 min JWT (aud/iss checked) in memory; refresh token httpOnly, Secure (prod), SameSite=Strict, path-scoped, stored hashed, rotated with family reuse detection | `auth.test.ts` |
| CSRF | Bearer auth for APIs; cookie endpoints require `X-Requested-With` (custom header + strict CORS) | `auth.test.ts` |
| RBAC | DB-backed permissions, `requirePermission` on every route, broker record scoping | `rbac.test.ts` |
| Input validation | Zod on every body/query; Prisma parameterised queries (no raw string SQL with user input) | `crud.test.ts` |
| AI safety | Model output Zod-validated; one read-only tool; recommended ids filtered to tool results; fallback never echoes model output; AI cannot write to DB | `ai.test.ts` |
| Webhooks | WhatsApp HMAC on raw body; LiveKit signed JWT; agent summary HMAC + 5 min freshness; idempotency ledger | `whatsapp.test.ts`, `voice.test.ts` |
| Secrets | Env validated at start; DB secrets AES-256-GCM; API returns only `hasValue`/last 4; never logged or audited | `rbac.test.ts` |
| LiveKit | Secret server-side only; 10 min single-room token without admin grants; opaque hashed join codes with expiry | `voice.test.ts` |
| Uploads | Type allow-list + magic-byte sniffing, 5 MB/file, count limits, random keys, path traversal guard, `nosniff` | `crud.test.ts` |
| Headers | helmet on API; CSP, frame-deny, Permissions-Policy (mic self only) in nginx | config |
| CORS | explicit origin allow-list with credentials | config |
| Rate limits | API 300/min, webhooks 1200/min, public call endpoints 30/min | config |
| Errors | central handler; no stack traces or internals in responses | `crud.test.ts` |
| Audit | logins, failures, CRUD on sensitive entities, assignments, integrations, recording access | `rbac.test.ts` |
| Privacy | agent context excludes phone numbers; recording only with consent + retention job | `voice.test.ts` |
| Repo hygiene | `.env*` git-ignored; `.env.example` placeholders only; no production admin is hard-coded | — |

Recommended before go-live: run `npm audit` and dependency updates; restrict nginx `connect-src` to your LiveKit host; put the API behind TLS; rotate `JWT_*` and `AGENT_API_KEY` periodically; enable DB encryption at rest; review WhatsApp opt-out handling for your jurisdiction.
