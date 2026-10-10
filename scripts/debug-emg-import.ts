/** تشخيص استيراد الاسترداد — أسباب invalid/conflicts بالتفصيل */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";

const BASE = "http://localhost:3000";

async function login(page: any) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator("#username").fill("manager");
  await page.locator("#password").fill("nokhba123");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/app**", { timeout: 15000 });
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await login(page);
const res = await page.request.get(`${BASE}/api/emergency?package=1`);
const html = await res.text();
const packageId = (/"packageId":"(NK-EMG-[A-Z0-9]+)"/.exec(html) || [])[1];

// سيرفر ملفات
const srv = http.createServer((req: any, rres: any) => {
  rres.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  rres.end(html);
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as any).port;

const app = await ctx.newPage();
app.on("pageerror", (e: any) => console.log("[PAGEERR]", e.message));
await app.goto(`http://127.0.0.1:${port}/emg.html`, { waitUntil: "domcontentloaded" });
await app.waitForFunction(() => !!(window as any).__NKDBG, null, { timeout: 20000 });
if (!(await app.evaluate(() => (window as any).__NKDBG.state().actor))) {
  await app.locator(".nk-modal .nk-btn").first().click();
  await app.waitForTimeout(400);
}

// نفس سير الاختبار: جلسة + حضور + دفعات
const st = await app.evaluate(async () => {
  const w = window as any;
  const sess = w.ST.sessions.find((s: any) => s.status === "SCHEDULED");
  if (sess) await w.sessionStart(sess);
  const activeKey = Object.keys(w.ST.sessionsById).find((k: string) => w.ST.sessionsById[k].status === "ACTIVE");
  const ses = w.ST.sessionsById[activeKey];
  const student = w.ST.students.find((s: any) => (s.regs || []).some((r: any) => r.groupId === ses.groupId));
  if (student) {
    await w.setAttendance(ses.id, student.id, "PRESENT");
    await w.recordPayment(student, { amount: 10000, changeReturned: 3500, method: "CASH" });
  }
  const m2 = await w.manualSession(w.ST.groups[w.ST.groups.length - 1].id, w.ST.sessionDate, "22:00", "23:00", null);
  const ended = await w.sessionEnd(w.ST.sessionsById[activeKey]);
  return { txnCount: w.ST.txns.length, activeKey, studentId: student?.id, m2id: m2.id, ended: ended.txn.payload, sessId: ses.id, sesLabel: ses.id };
});
console.log("offline state:", JSON.stringify(st, null, 1).slice(0, 600));

// صدّر الاسترداد
const dlPromise = app.waitForEvent("download", { timeout: 15000 });
await app.evaluate(() => (window as any).go("export"));
await app.waitForTimeout(200);
await app.locator("#ex-json").click();
const dl = await dlPromise;
await dl.saveAs("/tmp/emg-debug-recovery.json");
await app.close();

const recovery = JSON.parse(fs.readFileSync("/tmp/emg-debug-recovery.json", "utf8"));
console.log("recovery txns:", recovery.txns.length);
for (const t of recovery.txns) console.log(`  #${t.seq} ${t.op} ${t.entityType} ${String(t.entityId).slice(0, 26)}`);

// preview على السيرفر
const prev = await page.evaluate(async (body: string) => {
  const rres = await fetch("/api/emergency", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "recovery-preview", recovery: JSON.parse(body) }),
  });
  return await rres.json();
}, fs.readFileSync("/tmp/emg-debug-recovery.json", "utf8"));
console.log("\n=== PREVIEW ===");
console.log("valid:", prev.valid, "dups:", prev.duplicates, "conflicts:", prev.conflicts, "invalid:", prev.invalid);
console.log("--- INVALID reasons ---");
for (const v of prev.preview?.invalid ?? []) console.log(" ", v.txnId?.slice(0, 20), "→", v.reason);
console.log("--- CONFLICTS ---");
for (const c of prev.preview?.conflicts ?? []) console.log(" ", c.seq, c.opAr, c.code, "|", c.field, "|", c.offlineValue, "vs", c.onlineValue);
console.log("message:", prev.message);

// تنضيف
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
await db.emergencyImportedTxn.deleteMany({ where: { packageId } });
await db.emergencyRecoveryImport.deleteMany({ where: { packageId } });
await db.emergencyPackage.deleteMany({ where: { id: packageId } });
await db.auditLog.deleteMany({ where: { action: { in: ["إصدار حزمة طوارئ", "استيراد ملف استرداد الطوارئ"] }, createdAt: { gte: new Date(Date.now() - 1800e3) } } });
// حركات ETX لو في
const emgTxns = await db.studentTransaction.findMany({ where: { idemKey: { startsWith: "ETX-" } }, select: { id: true } });
if (emgTxns.length) {
  await db.receipt.deleteMany({ where: { txnId: { in: emgTxns.map((t: any) => t.id) } } });
  await db.studentTransaction.deleteMany({ where: { id: { in: emgTxns.map((t: any) => t.id) } } });
}
await db.attendance.deleteMany({ where: { idemKey: { startsWith: "ETX-" } } });
await db.teacherSettlement.deleteMany({ where: { note: { contains: "طوارئ ETX-" } } });
await db.centerTransaction.deleteMany({ where: { note: { contains: "طوارئ ETX-" } } });
console.log("\ncleaned package", packageId);
await db.$disconnect();
await browser.close();
srv.close();
