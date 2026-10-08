import { handler } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   TEMP: POST /api/admin/schema-sync — مزامنة الجداول الناقصة (manager)
   جداول الوكيل الذكي (AgentTask/Messages/Executions/Confirmations/Memory)
   + أعمدة العقل الذكي على Center — DDL إضافي فقط، متشفر هنا بالكامل
   (مفيش أي SQL من جسم الطلب). كل statement لوحده autocommit (pgbouncer-safe).
   بيتشال بعد تشغيل ناجح واحد (نفس نمط Task O/P).
============================================================ */

const STATEMENTS: { name: string; sql: string }[] = [
  {
    name: "create AgentTask",
    sql: `CREATE TABLE IF NOT EXISTS "AgentTask" (
  "id" TEXT NOT NULL,
  "centerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "plan" JSONB,
  "result" JSONB,
  "error" TEXT,
  "provider" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
)`,
  },
  {
    name: "create AgentMessage",
    sql: `CREATE TABLE IF NOT EXISTS "AgentMessage" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'text',
  "content" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
)`,
  },
  {
    name: "create AgentToolExecution",
    sql: `CREATE TABLE IF NOT EXISTS "AgentToolExecution" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "stepIndex" INTEGER NOT NULL DEFAULT 0,
  "input" JSONB NOT NULL,
  "output" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "risk" TEXT NOT NULL DEFAULT 'LOW',
  "confirmedBy" TEXT,
  "error" TEXT,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentToolExecution_pkey" PRIMARY KEY ("id")
)`,
  },
  {
    name: "create AgentConfirmation",
    sql: `CREATE TABLE IF NOT EXISTS "AgentConfirmation" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "executionId" TEXT,
  "toolName" TEXT NOT NULL,
  "args" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "details" JSONB,
  "risk" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "AgentConfirmation_pkey" PRIMARY KEY ("id")
)`,
  },
  {
    name: "create AgentMemory",
    sql: `CREATE TABLE IF NOT EXISTS "AgentMemory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'USER_PREF',
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
)`,
  },
  { name: "Center.agentLlmBaseUrl", sql: `ALTER TABLE "Center" ADD COLUMN IF NOT EXISTS "agentLlmBaseUrl" TEXT` },
  { name: "Center.agentLlmModel", sql: `ALTER TABLE "Center" ADD COLUMN IF NOT EXISTS "agentLlmModel" TEXT` },
  { name: "Center.agentLlmApiKey", sql: `ALTER TABLE "Center" ADD COLUMN IF NOT EXISTS "agentLlmApiKey" TEXT` },
  { name: "idx AgentTask center", sql: `CREATE INDEX IF NOT EXISTS "AgentTask_centerId_createdAt_idx" ON "AgentTask"("centerId")` },
  { name: "idx AgentTask user", sql: `CREATE INDEX IF NOT EXISTS "AgentTask_userId_createdAt_idx" ON "AgentTask"("userId")` },
  { name: "idx AgentTask status", sql: `CREATE INDEX IF NOT EXISTS "AgentTask_status_idx" ON "AgentTask"("status")` },
  { name: "idx AgentMessage task", sql: `CREATE INDEX IF NOT EXISTS "AgentMessage_taskId_createdAt_idx" ON "AgentMessage"("taskId")` },
  { name: "idx AgentToolExecution task", sql: `CREATE INDEX IF NOT EXISTS "AgentToolExecution_taskId_idx" ON "AgentToolExecution"("taskId")` },
  { name: "idx AgentToolExecution tool", sql: `CREATE INDEX IF NOT EXISTS "AgentToolExecution_toolName_createdAt_idx" ON "AgentToolExecution"("toolName")` },
  { name: "idx AgentConfirmation task", sql: `CREATE INDEX IF NOT EXISTS "AgentConfirmation_taskId_idx" ON "AgentConfirmation"("taskId")` },
  { name: "idx AgentConfirmation status", sql: `CREATE INDEX IF NOT EXISTS "AgentConfirmation_status_idx" ON "AgentConfirmation"("status")` },
  { name: "uniq AgentMemory", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "AgentMemory_userId_scope_key_key" ON "AgentMemory"("userId", "scope", "key")` },
  { name: "fk AgentTask center", sql: `DO $$ BEGIN ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$` },
  { name: "fk AgentTask user", sql: `DO $$ BEGIN ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$` },
  { name: "fk AgentMessage task", sql: `DO $$ BEGIN ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$` },
  { name: "fk AgentToolExecution task", sql: `DO $$ BEGIN ALTER TABLE "AgentToolExecution" ADD CONSTRAINT "AgentToolExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$` },
  { name: "fk AgentConfirmation task", sql: `DO $$ BEGIN ALTER TABLE "AgentConfirmation" ADD CONSTRAINT "AgentConfirmation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$` },
  { name: "fk AgentMemory user", sql: `DO $$ BEGIN ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$` },
];

export const POST = handler(async () => {
  const user = await requireManager();
  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const s of STATEMENTS) {
    try {
      await db.$executeRawUnsafe(s.sql);
      results.push({ name: s.name, ok: true });
    } catch (e) {
      results.push({ name: s.name, ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) });
    }
  }
  const failed = results.filter((r) => !r.ok);
  await logAudit({
    user, action: AUDIT.BRANDING_UPDATED, entity: "CENTER", entityId: user.centerId,
    after: { schemaSync: { total: results.length, failed: failed.length } },
    reason: "مزامنة جداول الوكيل الذكي (schema-sync المؤقت)",
  });
  return Response.json({ ok: failed.length === 0, total: results.length, failed: failed.length, results });
});
