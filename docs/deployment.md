# Deployment

## Topology
`web` (nginx: SPA + reverse proxy) → `api` (Express, Socket.IO) → PostgreSQL, Redis; `worker` (BullMQ jobs: inbound AI processing, notifications, follow-up scans, link expiry, recording retention); `voice-agent` (Python, connects to LiveKit). All are in `docker-compose.yml`.

## Steps
1. Provision PostgreSQL 14+ and Redis 6+ (managed services recommended), or use the compose services.
2. Create `.env` from `.env.example` with **production** values:
   - `NODE_ENV=production`, `PUBLIC_APP_URL=https://your-domain`, `CORS_ORIGINS=https://your-domain`
   - fresh random `ENCRYPTION_KEY` (64 hex), `JWT_*`, `AGENT_API_KEY`; keep them in a secret manager
   - `QUEUE_MODE=queue` (inline mode is refused in production)
3. `docker compose up -d --build` — the API applies migrations at start (`RUN_MIGRATIONS=false` to disable and run `docker compose run --rm api migrate` from CI instead).
4. Seed roles/permissions: `docker compose run --rm api seed` (no users are created in production), then create the first Super Admin interactively: `docker compose run --rm -it api create-admin`.
5. Terminate TLS in front of nginx (load balancer / Caddy / certbot). The refresh cookie is `Secure` in production, so HTTPS is required. Browsers also require HTTPS for microphone access on the call page.
6. Configure integrations and webhooks (`docs/whatsapp-setup.md`, `docs/livekit-setup.md`), press **Test** for each.
7. Start the voice agent: `docker compose --profile voice up -d voice-agent`.

Scale `worker` horizontally as needed. Run one API replica, or several behind sticky sessions for Socket.IO (realtime events are fanned out via Redis pub/sub, so multiple replicas each deliver to their own sockets).

## Storage
`STORAGE_DRIVER=local` stores uploads in the `uploads` volume. For multi-host deployments and call recordings use `STORAGE_DRIVER=s3` with `S3_BUCKET`, `S3_REGION`, credentials and (for MinIO/R2/etc.) `S3_ENDPOINT`. The bucket should be private: property images are streamed through `/api/files/properties/*`, recordings are served via short-lived signed URLs.

## Backups and recovery
- **PostgreSQL**: nightly `pg_dump -Fc` (or managed PITR). Example: `docker compose exec postgres pg_dump -U realestate -Fc realestate > backup-$(date +%F).dump`. Restore: `pg_restore -U realestate -d realestate --clean backup.dump`, then `npm run db:deploy`.
- **Uploads**: back up the `uploads` volume or rely on S3 versioning.
- **Redis**: holds only queued jobs (AOF enabled). Losing it loses pending jobs, not data; inbound messages are already persisted, and failed jobs are recorded in `FailedJob`.
- **Secrets**: `ENCRYPTION_KEY` must be backed up — integration secrets stored in the DB cannot be decrypted without it.
- Test restores periodically into a staging environment.

## Operations
- `GET /api/health` for liveness/readiness.
- Structured JSON logs (pino) with sensitive headers redacted.
- Failed background jobs: `FailedJob` table; WhatsApp delivery problems: **Notifications → WhatsApp delivery log**.

## Validation status
`docker compose config` validates. The images were not built in the development sandbox because Docker Hub was unreachable from it; the same build steps (`npm ci`, `prisma generate`, `tsup`, `vite build`) were run and verified outside Docker.
