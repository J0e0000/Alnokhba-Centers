// فحص قراءة فقط: جداول نظام الطوارئ موجودة على الإنتاج؟
import fs from "node:fs";
import pg from "pg";
const pw = fs.readFileSync("/home/z/my-project/scripts/.dbpass", "utf8").trim();
const c = new pg.Client({
  host: "aws-0-eu-west-2.pooler.supabase.com", port: 6543,
  user: "postgres.ttydfyqwzkwivucgiegy", password: pw, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const names = ["EmergencyPackage", "EmergencyRecoveryImport", "EmergencyImportedTxn", "Receipt", "User", "Student"];
const r = await c.query(
  "select table_name from information_schema.tables where table_schema='public' and table_name = any($1)", [names]
);
console.log("جداول موجودة:", r.rows.map((x) => x.table_name).sort());
const missing = names.filter((n) => !r.rows.some((x) => x.table_name === n));
console.log("ناقصة:", missing.length ? missing : "ولا حاجة ✅");
await c.end();
