import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   ⚠️ TEMPORARY ADMIN ENDPOINT — RUN ONCE THEN REMOVE ⚠️
   Production Postgres schema sync (the additive DDL that
   `prisma migrate diff` old→new produces — 6 new tables from
   capabilities/unified-attendance + Attendance device-lock
   columns + unique(sessionId, deviceId) + all indexes/FKs).

   Why an endpoint: the Vercel DATABASE_URL is a transaction
   pooler (pgBouncer) — interactive transactions/DDL batches
   hang there, so the build-time db push guard failed. Here we
   run EACH statement as a single autocommit statement, which
   pgbouncer handles fine.

   Safety:
   - Manager-only (requireManager) — same gate as financial ops.
   - Additive only, fully idempotent (IF NOT EXISTS / DO-block
     constraint guards) — safe to run any number of times.
   - No arbitrary SQL — the statement list below is fixed code.
   - Every run is appended to the audit trail.
============================================================ */

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "CenterCapability" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CenterCapability_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "studentId" TEXT,
    "userId" TEXT,
    "teacherId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "sessionId" TEXT,
    "deviceId" TEXT,
    "metadata" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'QR_SCREEN',
    "keyHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "StaffQrToken" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffQrToken_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "FingerprintEnrollment" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "personType" TEXT NOT NULL,
    "userId" TEXT,
    "teacherId" TEXT,
    "studentId" TEXT,
    "displayName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "templateHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FingerprintEnrollment_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CheckInAttempt" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "studentId" TEXT,
    "studentCode" TEXT,
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskFlags" TEXT,
    "tokenTail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckInAttempt_pkey" PRIMARY KEY ("id")
  )`,
];

const ALTER_COLUMNS: string[] = [
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "deviceId" TEXT`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "riskFlags" TEXT`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "riskScore" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "userAgent" TEXT`,
];

const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS "CenterCapability_centerId_idx" ON "CenterCapability"("centerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CenterCapability_centerId_key_key" ON "CenterCapability"("centerId", "key")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceEvent_centerId_occurredAt_idx" ON "AttendanceEvent"("centerId", "occurredAt")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceEvent_centerId_method_idx" ON "AttendanceEvent"("centerId", "method")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceEvent_sessionId_idx" ON "AttendanceEvent"("sessionId")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceEvent_studentId_idx" ON "AttendanceEvent"("studentId")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceEvent_userId_idx" ON "AttendanceEvent"("userId")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceDevice_centerId_idx" ON "AttendanceDevice"("centerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StaffQrToken_token_key" ON "StaffQrToken"("token")`,
  `CREATE INDEX IF NOT EXISTS "StaffQrToken_centerId_isActive_idx" ON "StaffQrToken"("centerId", "isActive")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "FingerprintEnrollment_templateHash_key" ON "FingerprintEnrollment"("templateHash")`,
  `CREATE INDEX IF NOT EXISTS "FingerprintEnrollment_centerId_active_idx" ON "FingerprintEnrollment"("centerId", "active")`,
  `CREATE INDEX IF NOT EXISTS "CheckInAttempt_sessionId_createdAt_idx" ON "CheckInAttempt"("sessionId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "CheckInAttempt_deviceId_idx" ON "CheckInAttempt"("deviceId")`,
  `CREATE INDEX IF NOT EXISTS "CheckInAttempt_ipAddress_createdAt_idx" ON "CheckInAttempt"("ipAddress", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "CheckInAttempt_centerId_createdAt_idx" ON "CheckInAttempt"("centerId", "createdAt")`,
  // القاعدة الأساسية لقفل الجهاز: جهاز واحد = حضور واحد ناجح لكل حصة
  `CREATE INDEX IF NOT EXISTS "Attendance_deviceId_idx" ON "Attendance"("deviceId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_sessionId_deviceId_key" ON "Attendance"("sessionId", "deviceId")`,
];

/** PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS → DO-block guard by conname */
function fkGuard(conName: string, ddl: string): string {
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${conName}') THEN
    ${ddl};
  END IF;
END $$`;
}

const FOREIGN_KEYS: string[] = [
  fkGuard(
    "CenterCapability_centerId_fkey",
    `ALTER TABLE "CenterCapability" ADD CONSTRAINT "CenterCapability_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ),
  fkGuard(
    "AttendanceEvent_centerId_fkey",
    `ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ),
  fkGuard(
    "AttendanceDevice_centerId_fkey",
    `ALTER TABLE "AttendanceDevice" ADD CONSTRAINT "AttendanceDevice_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ),
  fkGuard(
    "StaffQrToken_centerId_fkey",
    `ALTER TABLE "StaffQrToken" ADD CONSTRAINT "StaffQrToken_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ),
  fkGuard(
    "FingerprintEnrollment_centerId_fkey",
    `ALTER TABLE "FingerprintEnrollment" ADD CONSTRAINT "FingerprintEnrollment_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ),
  fkGuard(
    "CheckInAttempt_centerId_fkey",
    `ALTER TABLE "CheckInAttempt" ADD CONSTRAINT "CheckInAttempt_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  ),
];

const ALL: { name: string; sql: string }[] = [
  ...CREATE_TABLES.map((s, i) => ({ name: `table#${i + 1}`, sql: s })),
  ...ALTER_COLUMNS.map((s, i) => ({ name: `attendance-col#${i + 1}`, sql: s })),
  ...INDEXES.map((s, i) => ({ name: `index#${i + 1}`, sql: s })),
  ...FOREIGN_KEYS.map((s, i) => ({ name: `fk#${i + 1}`, sql: s })),
];

export const POST = handler(async () => {
  // مدير بس — نفس بوابة العمليات المالية
  const user = await requireManager();

  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const stmt of ALL) {
    try {
      // كل عبارة لوحدها (autocommit) — مفيش interactive transaction عشان pgbouncer
      await db.$executeRawUnsafe(stmt.sql);
      results.push({ name: stmt.name, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 300) : String(e);
      results.push({ name: stmt.name, ok: false, error: msg });
    }
  }

  const failed = results.filter((r) => !r.ok);
  await logAudit({
    user,
    action: AUDIT.SCHEMA_SYNC,
    entity: "SCHEMA_SYNC",
    reason: failed.length
      ? `فشل ${failed.length} من ${ALL.length} عبارة`
      : `${ALL.length} عبارة كلها سليمة (DDL إضافي فقط — idempotent)`,
    after: { failed: failed.map((f) => ({ name: f.name, error: f.error })) },
  });

  return ok({ total: ALL.length, failedCount: failed.length, results });
});
