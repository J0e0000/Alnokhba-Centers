import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   ⚠️ TEMPORARY (نفس حل درس Task O — بيتشال بعد التشغيل الناجح):
   POST /api/admin/schema-sync — مزامنة سكيما الإنتاج (PostgreSQL)
   السبب: vercel-build.sh بيعمل db push محمي، ولو فشل فوق الـ pooler
   البناء بيكمل والسكيما بتفضل قديمة → كل endpoint بيلمس الأعمدة الجديدة 500.
   endpoint ده بينفذ الـ DDL الإضافي (من prisma migrate diff) كسطور
   مفردة autocommit (pgbouncer-safe) — وidempotent (بيتجاهل duplicate).
============================================================ */

// DDL من: prisma migrate diff (old schema.postgres → current) — إضافي بس
const STATEMENTS: string[] = [
  `ALTER TABLE "SessionInstance" DROP CONSTRAINT IF EXISTS "SessionInstance_groupId_fkey"`,
  `ALTER TABLE "SessionInstance" ADD COLUMN IF NOT EXISTS "allowUnregistered" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "SessionInstance" ADD COLUMN IF NOT EXISTS "name" TEXT`,
  `ALTER TABLE "SessionInstance" ADD COLUMN IF NOT EXISTS "studentCodeLength" INTEGER`,
  `ALTER TABLE "SessionInstance" ADD COLUMN IF NOT EXISTS "studentSource" TEXT NOT NULL DEFAULT 'ROSTER'`,
  `ALTER TABLE "SessionInstance" ALTER COLUMN "groupId" DROP NOT NULL`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "studentCode" TEXT`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "studentName" TEXT`,
  `ALTER TABLE "Attendance" ALTER COLUMN "studentId" DROP NOT NULL`,
  `ALTER TABLE "CheckInAttempt" ADD COLUMN IF NOT EXISTS "studentName" TEXT`,
  `ALTER TABLE "SessionInstance" ADD CONSTRAINT "SessionInstance_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<{ confirm?: string }>(req);
  if (body.confirm !== "SYNC-SCHEMA") {
    throw new Error("تأكيد ناقص — العملية بتعدل سكيما الإنتاج.");
  }

  const results: { sql: string; ok: boolean; error?: string }[] = [];
  for (const sql of STATEMENTS) {
    try {
      // $executeRawUnsafe = statement واحد autocommit — شغال على transaction pooler
      await db.$executeRawUnsafe(sql);
      results.push({ sql: sql.slice(0, 60), ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 42701 duplicate_column · 42710 duplicate_object · already exists — idempotent
      if (/42701|42710|already exists|duplicate/i.test(msg)) {
        results.push({ sql: sql.slice(0, 60), ok: true, error: "already-applied" });
      } else {
        results.push({ sql: sql.slice(0, 60), ok: false, error: msg.slice(0, 200) });
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  await logAudit({
    user,
    action: AUDIT.BACKUP_EXPORTED,
    entity: "SCHEMA_SYNC",
    entityId: "one-time",
    reason: `مزامنة سكيما إنتاج يدوية — ${results.length - failed.length}/${results.length} نجح`,
    after: { failed },
  }).catch(() => {});

  return ok({ synced: failed.length === 0, results });
});
