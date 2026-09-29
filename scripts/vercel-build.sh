#!/bin/sh
# Vercel build command — auto-detects the database provider.
#
# PostgreSQL (Vercel/Supabase/Neon):
#   1. generates the Prisma client FROM the postgres schema (default output,
#      so `@prisma/client` imports just work)
#   2. `prisma db push` creates/updates tables — additive changes apply
#      silently; destructive changes fail the build loudly (safe default:
#      production data can never be silently dropped)
# SQLite (local/preview without DATABASE_URL): standard generate.
set -e

case "$DATABASE_URL" in
  postgres*)
    echo "── Prisma: PostgreSQL detected"
    npx prisma generate --schema=prisma/schema.postgres.prisma
    echo "── Prisma: db push (creates tables on first deploy; additive-only)"
    npx prisma db push --schema=prisma/schema.postgres.prisma --skip-generate
    ;;
  "")
    echo "── Prisma: no DATABASE_URL — sqlite default generate"
    npx prisma generate
    ;;
  *)
    echo "── Prisma: non-postgres DATABASE_URL — default generate"
    npx prisma generate
    ;;
esac

echo "── Next.js build"
NODE_OPTIONS=--max-old-space-size=3072 npx next build
