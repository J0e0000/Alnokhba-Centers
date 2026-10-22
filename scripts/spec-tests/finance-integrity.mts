/**
 * اختبارات سلامة المعاملات المالية — spec المرحلة 3.
 * ------------------------------------------------------------
 * idempotency (نفس المفتاح = تسجيل واحد) + السباق المتزامن + حساب القرش الصحيح
 * + العكس المرتبط (الأصل محفوظ) + منع العكس المزدوج + عزل السنترات + المطابقة.
 * سيرفر معزول بقاعدة SQLite مؤقتة — صفر لمس لأي بيانات حقيقية.
 * التشغيل: npm run build ثم npx tsx scripts/spec-tests/finance-integrity.mts
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { startTestServer, type TestServer } from "./harness.mts";

let db: PrismaClient;
let srv: TestServer;
let passed = 0, failed = 0;
const failures: string[] = [];
let baseUrl = "";
const tokens: Record<string, string> = {};

function check(name: string, cond: boolean, extra = ""): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(`${name}${extra ? " — " + extra : ""}`); console.log(`  ❌ ${name} ${extra}`); }
}

async function call(path: string, opts: { as?: string | null; method?: string; body?: unknown; idemKey?: string } = {}): Promise<Response> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const t = opts.as === undefined ? tokens.mgrA : opts.as ? tokens[opts.as] : null;
  if (t) h["cookie"] = `nokhba_session=${t}`;
  if (opts.idemKey) h["idempotency-key"] = opts.idemKey;
  return fetch(`${baseUrl}${path}`, { method: opts.method ?? "GET", headers: h, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

async function main(): Promise<void> {
  console.log("\n━━━ تشغيل السيرفر الاختباري المعزول ━━━");
  srv = await startTestServer();
  baseUrl = srv.baseUrl;
  db = new PrismaClient({ datasources: { db: { url: `file:${srv.dbFile}` } } });
  console.log(`✓ ${baseUrl}`);

  /* ─── بذر ─── */
  const centerA = await db.center.create({ data: { name: "سنتر مالية أ", slug: `fin-a-${Date.now()}` } });
  const centerB = await db.center.create({ data: { name: "سنتر مالية ب", slug: `fin-b-${Date.now()}` } });
  const stamp = Date.now();
  const admin = await db.user.create({ data: { username: `f-admin-${stamp}`, passwordHash: "x", name: "أدمن", role: "ADMIN", isActive: true } });
  const mgrA = await db.user.create({ data: { username: `f-mgr-a-${stamp}`, passwordHash: "x", name: "مدير أ", role: "MANAGER", centerId: centerA.id, isActive: true } });
  const tchA = await db.user.create({ data: { username: `f-tch-a-${stamp}`, passwordHash: "x", name: "مدرس أ", role: "TEACHER", centerId: centerA.id, isActive: true } });
  const mgrB = await db.user.create({ data: { username: `f-mgr-b-${stamp}`, passwordHash: "x", name: "مدير ب", role: "MANAGER", centerId: centerB.id, isActive: true } });
  for (const [u, k] of [[admin, "admin"], [mgrA, "mgrA"], [tchA, "tchA"], [mgrB, "mgrB"]] as const) {
    const token = randomBytes(32).toString("hex");
    await db.authSession.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    tokens[k] = token;
  }
  const student = await db.student.create({ data: { centerId: centerA.id, code: "80001", name: "طالب مالية", qrToken: randomBytes(24).toString("hex"), status: "ACTIVE" } });

  /* ─── 1) حساب القرش الصحيح — 123.45 ج = 12345 بياستر بالظبط ─── */
  console.log("\n━━━ 1) الحساب الصحيح (بياسترات) ━━━");
  const p1 = await call("/api/payments", { method: "POST", body: { studentId: student.id, amount: "123.45", method: "CASH" } });
  const j1 = await p1.json() as { txn: { amount: number }; after: number; receipt: { number: string } | null };
  check("دفع 123.45 → 12345 بياستر (مش فلو트)", p1.status === 200 && j1.txn.amount === 12345, `amount=${j1?.txn?.amount}`);
  check("الرصيد بعدها = 12345", j1.after === 12345);
  check("إيصال اتولد برقم متسلسل", Boolean(j1.receipt?.number?.startsWith("RC-")));

  /* ─── 2) idempotency — نفس المفتاح مرتين = تسجيل واحد ─── */
  console.log("\n━━━ 2) idempotency ━━━");
  const key = `test-pay-${randomBytes(8).toString("hex")}`;
  const a = await call("/api/payments", { method: "POST", body: { studentId: student.id, amount: 50, method: "VODAFONE" }, idemKey: key });
  const b = await call("/api/payments", { method: "POST", body: { studentId: student.id, amount: 50, method: "VODAFONE" }, idemKey: key });
  const ja = await a.json(), jb = await b.json();
  check("الطلبين نجحوا", a.status === 200 && b.status === 200);
  check("نفس المعاملة في الاتنين", ja.txn.id === jb.txn.id);
  check("التاني عليه علامة replay", jb.idempotentReplay === true);
  const rows = await db.studentTransaction.count({ where: { idemKey: key } });
  check("صف واحد بس في الداتابيز", rows === 1, `rows=${rows}`);
  const receiptsForKey = await db.receipt.count({ where: { txnId: ja.txn.id } });
  check("إيصال واحد بس", receiptsForKey === 1);

  /* ─── 3) سباق متزامن — 5 طلبات بنفس المفتاح في نفس اللحظة ─── */
  console.log("\n━━━ 3) سباق متزامن ━━━");
  const key2 = `race-${randomBytes(8).toString("hex")}`;
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    call("/api/payments", { method: "POST", body: { studentId: student.id, amount: 10, method: "CASH" }, idemKey: key2 })));
  const bodies = await Promise.all(results.map((r) => r.json()));
  const allOk = results.every((r) => r.status === 200);
  const uniqueTxns = new Set(bodies.map((x: { txn: { id: string } }) => x.txn.id));
  check("الكل 200 (السباق بيرجّع الأصل مش خطأ)", allOk, `statuses=${results.map((r) => r.status).join(",")}`);
  check("معاملة واحدة بس للكل", uniqueTxns.size === 1, `unique=${uniqueTxns.size}`);
  const raceRows = await db.studentTransaction.count({ where: { idemKey: key2 } });
  check("صف واحد في الداتابيز", raceRows === 1, `rows=${raceRows}`);

  /* ─── 4) من غير مفتاح — شغالة زي ما هي (توافق خلفي) ─── */
  const noKey = await call("/api/payments", { method: "POST", body: { studentId: student.id, amount: 7, method: "CASH" } });
  check("دفع من غير مفتاح → 200", noKey.status === 200);

  /* ─── 5) العكس المرتبط ─── */
  console.log("\n━━━ 5) العكس المرتبط (reversal) ━━━");
  const payTxnId = j1.txn.id; // دفعة 12345
  const noReason = await call("/api/payments/reverse", { method: "POST", body: { txnId: payTxnId, reason: "" } });
  check("من غير سبب → 400", noReason.status === 400);
  const rev = await call("/api/payments/reverse", { method: "POST", body: { txnId: payTxnId, reason: "الطالب دفع مرتين بالغلط" } });
  const jr = await rev.json() as { reversal: { amount: number; refTxnId: string }; original: { preserved: boolean }; after: number };
  check("العكس نجح", rev.status === 200, `status=${rev.status}`);
  check("المبلغ معكوس بالظبط (-12345)", jr.reversal?.amount === -12345);
  check("مرتبط بالأصل refTxnId", jr.reversal?.refTxnId === payTxnId);
  const originalStillThere = await db.studentTransaction.findUnique({ where: { id: payTxnId } });
  check("الأصل محفوظ (مش اتمسح ولا اتعدل)", Boolean(originalStillThere && originalStillThere.amount === 12345));
  check("الرصيد = باقي الدفعات غير المعكوسة (5000+1000+700=6700)", jr.after === 6700, `after=${jr.after}`);
  const rev2 = await call("/api/payments/reverse", { method: "POST", body: { txnId: payTxnId, reason: "محاولة تانية" } });
  check("عكس تاني → 409", rev2.status === 409, `status=${rev2.status}`);
  const state = await call(`/api/payments/reverse?txnId=${payTxnId}`, { as: "mgrA" });
  const jst = await state.json();
  check("حالة العكس: reversible=false", jst.reversible === false && jst.corrections.length === 1);

  /* ─── 6) عزل السنترات + الصلاحيات ─── */
  console.log("\n━━━ 6) عزل السنترات والصلاحيات ━━━");
  check("مدير سنتر ب يعكس معاملة سنتر أ → 404", (await call("/api/payments/reverse", { as: "mgrB", method: "POST", body: { txnId: payTxnId, reason: "محاولة عابرة للسنترات" } })).status === 404);
  check("مدرس يعكس → 403 (مفيش صلاحية)", (await call("/api/payments/reverse", { as: "tchA", method: "POST", body: { txnId: payTxnId, reason: "مدرس" } })).status === 403);
  check("مدرس مطابقة → 403", (await call("/api/reconciliation", { as: "tchA" })).status === 403);

  /* ─── 7) المطابقة — بتكتشف العبث ─── */
  console.log("\n━━━ 7) المطابقة (reconciliation) ━━━");
  const rec1 = await call("/api/reconciliation", { as: "mgrA" });
  const jrec1 = await rec1.json() as { counts: { orphanReceipts: number; amountMismatch: number; missingReceipt: number } };
  check("مطابقة لمدير أ → 200", rec1.status === 200);
  check("صفر تناقضات بعد العمليات النضيفة", (jrec1.counts.orphanReceipts + jrec1.counts.amountMismatch + jrec1.counts.missingReceipt) === 0, JSON.stringify(jrec1.counts));
  // نزرع تناقض مباشرة في الداتابيز (محاكاة عبث خارجي) — نأكد إن المطابقة بتكشفه
  const someReceipt = await db.receipt.findFirst({ where: { centerId: centerA.id } });
  if (someReceipt) {
    await db.receipt.update({ where: { id: someReceipt.id }, data: { amount: someReceipt.amount + 100 } });
    const rec2 = await call("/api/reconciliation", { as: "mgrA" });
    const jrec2 = await rec2.json() as { counts: { amountMismatch: number } };
    check("تعديل إيصال خفية بيتكشف (MISMATCH)", jrec2.counts.amountMismatch >= 1, `mismatches=${jrec2.counts.amountMismatch}`);
    await db.receipt.update({ where: { id: someReceipt.id }, data: { amount: someReceipt.amount } }); // ترجيع
  }
  check("أدمن مطابقة بـ centerId → 200", (await call(`/api/reconciliation?centerId=${centerA.id}`, { as: "admin" })).status === 200);

  console.log(`\n━━━ النتيجة: ${passed} ناجح / ${failed} فاشل ━━━`);
  if (failures.length) { console.log("الفاشلة:"); failures.forEach((f) => console.log("  - " + f)); }
  await db.$disconnect();
  await srv.stop();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("💥 فشل تشغيل الاختبار:", e);
  try { await db?.$disconnect(); } catch {}
  try { await srv?.stop(); } catch {}
  process.exit(1);
});
