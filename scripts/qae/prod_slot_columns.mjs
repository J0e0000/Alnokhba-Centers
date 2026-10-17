// إضافة عمودين لجدول ScheduleSlot على إنتاج Supabase — إضافة آمنة (مفيش مسح ولا تعديل بيانات)
// updatedAt + lastOverrideAt — قفل التزامن + سجل تجاوز التعارض (جدول v2)
import { readFileSync } from "fs";
import pg from "pg";

const pass = readFileSync("/home/z/my-project/scripts/.dbpass", "utf8").trim();
const client = new pg.Client({
  host: "aws-0-eu-west-2.pooler.supabase.com",
  port: 6543,
  user: "postgres.ttydfyqwzkwivucgiegy",
  password: pass,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// 1) حالة الأعمدة قبل التغيير
const before = await client.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'ScheduleSlot' ORDER BY ordinal_position
`);
console.log("ScheduleSlot columns BEFORE:", before.rows.map((r) => r.column_name).join(", "));

// 2) إضافة الأعمدة لو مش موجودة (IF NOT EXISTS = idempotent)
await client.query(`ALTER TABLE "ScheduleSlot" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
await client.query(`ALTER TABLE "ScheduleSlot" ADD COLUMN IF NOT EXISTS "lastOverrideAt" TIMESTAMP(3)`);

// 3) التحقق بعد
const after = await client.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'ScheduleSlot' ORDER BY ordinal_position
`);
console.log("ScheduleSlot columns AFTER:", after.rows.map((r) => r.column_name).join(", "));

// 4) سلامة البيانات: عدد الصفوف قبل/بعد نفس الشيء + sample
const count = await client.query(`SELECT COUNT(*)::int AS n FROM "ScheduleSlot"`);
const sample = await client.query(`SELECT id, "startTime", "updatedAt" FROM "ScheduleSlot" LIMIT 3`);
console.log("rows:", count.rows[0].n, "sample:", JSON.stringify(sample.rows));

await client.end();
console.log("✅ PROD schema safe-apply done");
