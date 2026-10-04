import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   TEMP endpoint — مزامنة سكيمة الإنتاج (مثل Task O/P):
   الـ build-time db push بيفشل فوق الـ pooler، فالـ DDL الإضافي
   بيتنفذ هنا statement-by-statement (autocommit واحد لكل statement).
   كل الـ statements idempotent (IF NOT EXISTS) — آمنة لإعادة الاستدعاء.
   هيتشال بعد أول تشغيل ناجح (نفس درس Task O/P).
   ============================================================ */

const STATEMENTS = [
  `ALTER TABLE "SessionInstance" ADD COLUMN IF NOT EXISTS "requireRoomPin" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "SessionInstance" ADD COLUMN IF NOT EXISTS "anchorIp" TEXT`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "deviceFingerprint" TEXT`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "attendanceCode" TEXT`,
  `ALTER TABLE "CheckInAttempt" ADD COLUMN IF NOT EXISTS "deviceFingerprint" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_sessionId_deviceFingerprint_key" ON "Attendance"("sessionId", "deviceFingerprint")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_sessionId_attendanceCode_key" ON "Attendance"("sessionId", "attendanceCode")`,
  `CREATE INDEX IF NOT EXISTS "Attendance_deviceFingerprint_idx" ON "Attendance"("deviceFingerprint")`,
];

export const POST = handler(async (req: Request) => {
  const user = await requireManager(); // مدير فقط — endpoint مؤقت
  const results: { sql: string; ok: boolean; error?: string }[] = [];
  for (const sql of STATEMENTS) {
    try {
      await db.$executeRawUnsafe(sql);
      results.push({ sql: sql.slice(0, 60), ok: true });
    } catch (e) {
      results.push({ sql: sql.slice(0, 60), ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) });
    }
  }
  const failed = results.filter((r) => !r.ok);
  await logAudit({
    user,
    action: "مزامنة سكيمة الإنتاج (SCHEMA_SYNC)",
    entity: "SCHEMA_SYNC",
    entityId: "anti-cheat-columns",
    reason: `مزامنة سكيمة الإنتاج — ${results.length - failed.length}/${results.length} نجحت`,
  }).catch(() => {});
  return ok({ ok: failed.length === 0, applied: results.length - failed.length, failed: failed.length, results });
});
