# Database

PostgreSQL via Prisma (`prisma/schema.prisma`, migrations in `prisma/migrations`). All primary keys are UUIDs; leads (`LD-000123`) and properties (`P-0001`) also have human-readable sequence numbers.

## Models
| Area | Models |
|---|---|
| Access | `User`, `Role`, `Permission`, `RolePermission`, `RefreshToken` |
| CRM | `Customer` (unique E.164 phone), `Property`, `PropertyImage`, `BrokerProfile`, `Lead`, `LeadActivity`, `FollowUp` |
| Messaging | `Conversation` (one per customer), `Message` (unique WhatsApp id), `Notification` |
| Voice | `VoiceCall` (unique room, hashed join code), `CallTranscript` |
| Platform | `Integration` (encrypted secrets), `BusinessSetting` (`business`, `ai`), `AuditLog`, `ProcessedWebhookEvent` (idempotency), `FailedJob` |

## Key relations and deletion policies
- `Lead → Customer` **Restrict** (customers with leads can't be deleted); `Lead → BrokerProfile` **SetNull**.
- A customer can have many leads; leads are never keyed by phone.
- `LeadActivity`, `FollowUp` cascade with their lead; `Message` cascades with its conversation.
- `VoiceCall → Lead` SetNull; `CallTranscript` cascades with the call.
- Deactivating a broker keeps history; hard delete is blocked while leads reference them.

## Indexes
Availability+city/location on properties; `(brokerId, status)`, `(status, createdAt)` on leads; `(conversationId, createdAt)` on messages; `(status, dueAt)` on follow-ups; audit by entity and actor.

## Commands
```bash
npm run db:migrate    # create a new migration in development (prisma migrate dev)
npm run db:deploy     # apply migrations (CI / production)
npm run db:seed       # roles, permissions; demo data outside production
```
Migrations run through `apps/api/prisma.config.ts`, which uses the JavaScript schema engine with the `pg` adapter.
