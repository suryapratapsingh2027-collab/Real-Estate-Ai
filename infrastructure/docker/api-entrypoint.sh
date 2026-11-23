#!/bin/sh
set -e
case "$1" in
  api)
    # Apply pending migrations before serving (idempotent; safe with one API replica).
    if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
      npx prisma migrate deploy
    fi
    exec node dist/server.js
    ;;
  worker)
    exec node dist/worker.js
    ;;
  migrate)
    exec npx prisma migrate deploy
    ;;
  seed)
    exec npx tsx ../../prisma/seed.ts
    ;;
  create-admin)
    exec node dist/scripts/createAdmin.js
    ;;
  *)
    exec "$@"
    ;;
esac
