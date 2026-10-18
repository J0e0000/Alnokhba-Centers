// إيقاف QR الحصة المتغير (dynamic_qr) على كل المراكز — المالك طلب العادي يكون مطفي
// والتشغيل من الإعدادات (إعدادات الحضور) وقت ما يحب. قراءة قبل/بعد للتوثيق.
import fs from "node:fs";
import pg from "pg";
const pw = fs.readFileSync("/home/z/my-project/scripts/.dbpass", "utf8").trim();
const c = new pg.Client({
  host: "aws-0-eu-west-2.pooler.supabase.com", port: 6543,
  user: "postgres.ttydfyqwzkwivucgiegy", password: pw, database: "postgres",
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});
await c.connect();

const before = await c.query(
  `SELECT cc."centerId", ce.name, cc.enabled
     FROM "CenterCapability" cc JOIN "Center" ce ON ce.id = cc."centerId"
    WHERE cc.key = 'dynamic_qr' ORDER BY ce.name`
);
console.log("قبل:", before.rows.map(r => `${r.name}=${r.enabled}`).join(" · ") || "(مفيش صفوف)");

const upd = await c.query(`UPDATE "CenterCapability" SET enabled = false, "updatedAt" = NOW() WHERE key = 'dynamic_qr' AND enabled = true`);
console.log(`اتحدث: ${upd.rowCount} صف`);

// مراكز مالهاش صف أصلاً — سيبها (الافتراضي في الكود بقى false فأول قراءة هتزرعها مطفية)
const after = await c.query(
  `SELECT cc."centerId", ce.name, cc.enabled
     FROM "CenterCapability" cc JOIN "Center" ce ON ce.id = cc."centerId"
    WHERE cc.key = 'dynamic_qr' ORDER BY ce.name`
);
console.log("بعد:", after.rows.map(r => `${r.name}=${r.enabled}`).join(" · ") || "(مفيش صفوف)");

const centers = await c.query(`SELECT name FROM "Center" ORDER BY name`);
console.log("مراكز الإنتاج:", centers.rows.map(r => r.name).join(" · "));
await c.end();
