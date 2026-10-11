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

    echo "── Prisma: schema sync (db push — additive only, 3 attempts × 180s)"
    # الانفصام ده حصل فعلًا: بوش واحد فشل والكود انشر بيه → كل راوتس الاستحقاق 500.
    # سبب الفشل المزمن: DDL عبر transaction-pooler (6543/pgbouncer) بيميل يعلق —
    # الحل: مشتقة رابط الجلسة (5432) من رابط الـ pooler (نفس المستخدم/الباسورد
    # على Supabase — البورت بس بيتغير) وندفع السكيما عن طريقه (زي الـ manual sync
    # اللي نجح قبل كده). لو الرابط مش pooler على 6543، السطر ده بيبقى no-op.
    PUSH_URL="$DATABASE_URL"
    case "$PUSH_URL" in
      *:6543/*)
        PUSH_URL=$(printf '%s' "$DATABASE_URL" | sed 's/:6543\//:5432\//')
        echo "── db push: using SESSION pooler (5432) for DDL instead of transaction pooler"
        ;;
    esac
    push_ok=0
    for attempt in 1 2 3; do
      if DATABASE_URL="$PUSH_URL" timeout 180 npx prisma db push --schema=prisma/schema.postgres.prisma --skip-generate; then
        push_ok=1
        break
      fi
      echo "── db push: attempt $attempt failed — retrying in 15s"
      sleep 15
    done
    if [ "$push_ok" = "1" ]; then
      echo "── db push: schema in sync ✓"
    else
      echo "── db push: FAILED after 3 attempts (build continues)."
      echo "   Sync manually via the SESSION pooler — see docs/PRODUCTION-DB.md."
      echo "   NOTE: entitlement reads fail-safe to full-plan mode until synced."
    fi
    ;;
  *)
    echo "── Prisma: default (sqlite) generate"
    npx prisma generate
    ;;
esac

echo "── Next.js build"
NODE_OPTIONS=--max-old-space-size=3072 npx next build
