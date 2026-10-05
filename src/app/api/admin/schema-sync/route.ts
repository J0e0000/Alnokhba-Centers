import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   TEMP endpoint — مزامنة سكيمة الإنتاج (مثل Task O/P/Q):
   الـ build-time db push بيفشل فوق الـ pooler، فالـ DDL الإضافي
   بيتنفذ هنا statement-by-statement (autocommit واحد لكل statement).
   كل الـ statements idempotent (IF NOT EXISTS) — آمنة لإعادة الاستدعاء.
   هيتشال بعد أول تشغيل ناجح (نفس درس Task O/P/Q).
   ============================================================ */

const STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS "CheckInAttempt_sessionId_deviceId_idx" ON "CheckInAttempt"("sessionId", "deviceId")`,
  `CREATE INDEX IF NOT EXISTS "CheckInAttempt_sessionId_ipAddress_idx" ON "CheckInAttempt"("sessionId", "ipAddress")`,
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
    entityId: "risk-engine-indexes",
    reason: `مزامنة سكيمة الإنتاج — ${results.length - failed.length}/${results.length} نجحت`,
  }).catch(() => {});
  return ok({ ok: failed.length === 0, applied: results.length - failed.length, failed: failed.length, results });
});
