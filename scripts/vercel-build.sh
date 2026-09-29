#!/bin/sh
# Vercel build command — auto-detects the database provider.
#
# PostgreSQL (Vercel/Supabase/Neon): generate the Prisma client FROM the
# postgres schema (default output, so `@prisma/client` imports just work).
# NOTE: no `db push` here — DDL over a transaction-pooler (pgBouncer) hangs.
# Tables are created/updated explicitly via the SESSION pooler (port 5432):
#   DATABASE_URL="<session-pooler-url>" npx prisma db push \
#     --schema=prisma/schema.postgres.prisma --skip-generate
# SQLite (local): standard generate.
set -e

case "$DATABASE_URL" in
  postgres*)
    echo "── Prisma: PostgreSQL detected — generating client from schema.postgres.prisma"
    npx prisma generate --schema=prisma/schema.postgres.prisma
    ;;
  *)
    echo "── Prisma: default (sqlite) generate"
    npx prisma generate
    ;;
esac

echo "── Next.js build"
NODE_OPTIONS=--max-old-space-size=3072 npx next build
