#!/bin/sh
# Vercel build command — auto-detects the database provider.
#
# PostgreSQL (Vercel/Supabase/Neon):
#   1) generate the Prisma client FROM the postgres schema (default output,
#      so `@prisma/client` imports just work).
#   2) schema sync (db push) — additive-only, timeout-guarded:
#        • NO --accept-data-loss → any destructive change fails instead of
#          touching production data.
#        • `timeout` kills a hang (DDL over a transaction-pooler may stall on
#          pgbouncer) — the build then continues, and the next deploy retries.
#        • idempotent: already-in-sync databases are untouched (no-op).
#   Manual alternative via the SESSION pooler (port 5432) — see docs/PRODUCTION-DB.md:
#   DATABASE_URL="<session-pooler-url>" npx prisma db push \
#     --schema=prisma/schema.postgres.prisma --skip-generate
# SQLite (local): standard generate.
set -e

case "$DATABASE_URL" in
  postgres*)
    echo "── Prisma: PostgreSQL detected — generating client from schema.postgres.prisma"
    npx prisma generate --schema=prisma/schema.postgres.prisma

    echo "── Prisma: schema sync (db push — additive only, 120s guard)"
    if timeout 120 npx prisma db push --schema=prisma/schema.postgres.prisma --skip-generate; then
      echo "── db push: schema in sync ✓"
    else
      echo "── db push: skipped/failed (build continues)."
      echo "   The deployed client still matches the repo schema; sync the tables"
      echo "   manually via the session pooler — see docs/PRODUCTION-DB.md."
    fi
    ;;
  *)
    echo "── Prisma: default (sqlite) generate"
    npx prisma generate
    ;;
esac

echo "── Next.js build"
NODE_OPTIONS=--max-old-space-size=3072 npx next build
