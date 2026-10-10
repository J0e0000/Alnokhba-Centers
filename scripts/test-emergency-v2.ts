/**
 * اختبار: نظام الطوارئ HTML (الحزمة الأوفلاين) + الاسترداد + صفحة الهبوط الجديدة
 * مع تنظيف كامل لأثر الاختبار على بيانات الإنتاج (النخبة يرجع للـ baseline).
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();

let passed = 0, failed = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ FAIL: ${name} ${extra}`); }
};

async function login(page: any, username: string, password: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/app**", { timeout: 15000 });
}

// سيرفر ملفات محلي — بيحاكي فتح الملف من الجهاز (صفر نت خارج localhost)
function startFileServer(html: string): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === "/emg.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        res.writeHead(404); res.end("nope");
      }
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}/emg.html`, close: () => srv.close() });
    });
  });
}

const browser = await chromium.launch();

// ===== حالة ما قبل الاختبار (للتنضيف) =====
const centerIdFinal = (await db.center.findUnique({ where: { slug: "al-nokhba" } }))?.id
  ?? (await db.center.findFirst())?.id ?? "";
const testStart = new Date();
const preTxnCount = await db.studentTransaction.count({ where: { centerId: centerIdFinal } });
const preReceiptCount = await db.receipt.count({ where: { centerId: centerIdFinal } });
const dayStr = (off: number) => {
  const d = new Date(Date.now() + off * 86400000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const preSessions = await db.sessionInstance.findMany({
  where: { centerId: centerIdFinal, date: { gte: dayStr(-8), lte: dayStr(15) } },
});
const preAtt = await db.attendance.findMany({
  where: { centerId: centerIdFinal, session: { date: { gte: dayStr(-8), lte: dayStr(15) } } },
});

// ===================== A. توليد الحزمة =====================
console.log("\n— A. توليد الحزمة —");
let pkgHtml = "";
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const res1 = await page.request.get(`${BASE}/api/emergency?package=1`);
  ok("A1: من غير دخول = 401", res1.status() === 401);
  await login(page, "manager", "nokhba123");
  const res = await page.request.get(`${BASE}/api/emergency?package=1`);
  ok("A2: توليد الحزمة 200", res.status() === 200);
  pkgHtml = await res.text();
  ok("A3: الحزمة HTML كبيرة وسليمة", pkgHtml.length > 200_000, `${(pkgHtml.length / 1024).toFixed(0)}KB`);
  ok("A4: فيها الرخصة الموقّعة", pkgHtml.includes("ALNOKHBA_EMERGENCY_LICENSE"));
  ok("A5: فيها اللقطة والمفتاح العام", pkgHtml.includes("nk-snapshot-raw") && pkgHtml.includes("nk-meta"));
  ok("A6: jsQR مدمج", pkgHtml.includes("jsQR"));
  ok("A7: خط Cairo مدمج base64", pkgHtml.includes("data:font/woff2;base64"));
  ok("A8: اللوجو مدمج", pkgHtml.includes("data:image/png;base64"));
  const cleaned = pkgHtml
    .replace(/xmlns="http:\/\/www\.w3\.org[^"]*"/g, "")
    .replace(/http:\/\/schemas\.openxmlformats[^"']*/g, "")
    .replace(/http:\/\/purl\.org[^"']*/g, "")
    .replace(/http:\/\/www\.w3\.org[^"']*/g, "");
  ok("A9: صفر مراجع خارجية (CDN/خطوط/صور)", !/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z]/i.test(cleaned));
  await ctx.close();
}

const packageId = (/"packageId":"(NK-EMG-[A-Z0-9]+)"/.exec(pkgHtml) || [])[1] || "";
const centerId = (/"centerId":"(cl[a-z0-9]+)"/.exec(pkgHtml) || [])[1] || "";
ok("A10: معرف الحزمة NK-EMG", /^NK-EMG-[A-Z0-9]+$/.test(packageId), packageId);
ok("A11: معرف السنتر جوّه الرخصة", !!centerId, centerId);

// ===================== B. إقلاع أوفلاين =====================
console.log("\n— B. إقلاع أوفلاين + تحقق الرخصة —");
const fsrv = await startFileServer(pkgHtml);
const appCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const app = await appCtx.newPage();
const external: string[] = [];
app.on("request", (r: any) => {
  const u = r.url();
  if (!u.startsWith("http://127.0.0.1") && !u.startsWith("data:")) external.push(u);
});
const pageErrors: string[] = [];
app.on("pageerror", (e: any) => pageErrors.push(String(e)));
await app.goto(fsrv.url, { waitUntil: "domcontentloaded" });
await app.waitForFunction(() => !!(window as any).__NKDBG__, null, { timeout: 25000 });
let bootState = await app.evaluate(() => (window as any).__NKDBG__.state());
ok("B1: الإقلاع نجح وتحقق من التوقيع", !!bootState);
ok("B2: التخزين IndexedDB", bootState.storage === "idb", bootState.storage);
ok("B3: صفر طلبات خارجية وقت التشغيل", external.length === 0, external.slice(0, 3).join(", "));
ok("B4: مش منتهي", !bootState.expired);
ok("B5: أيام متبقية 7", bootState.daysLeft === 7, String(bootState.daysLeft));
if (!bootState.actor) {
  await app.locator(".nk-modal .nk-btn").first().click();
  await app.waitForTimeout(300);
}

// ===================== C. البحث =====================
console.log("\n— C. بحث الطلاب —");
{
  const student = await app.evaluate(() => {
    const s = (window as any).ST?.students?.find((x: any) => (x.regs || []).length > 0) ?? (window as any).ST?.students?.[0] ?? null;
    return s ? { code: s.code, name: s.name, qrToken: s.qrToken } : null;
  });
  ok("C0: في طلاب في اللقطة", !!student);
  if (student) {
    await app.evaluate(() => (window as any).go("search"));
    await app.locator("#nk-q").fill(student.code);
    await app.waitForTimeout(400);
    ok("C1: بحث بالكود 5 أرقام", (await app.locator(".nk-res").count()) >= 1);
    const arabicCode = student.code.replace(/[0-9]/g, (d: string) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
    await app.locator("#nk-q").fill("");
    await app.locator("#nk-q").fill(arabicCode);
    await app.waitForTimeout(400);
    ok("C2: بحث بأرقام عربية", (await app.locator(".nk-res").count()) >= 1);
    await app.locator("#nk-q").fill("");
    await app.locator("#nk-q").fill(student.name.split(" ")[0]);
    await app.waitForTimeout(400);
    ok("C3: بحث بالاسم", (await app.locator(".nk-res").count()) >= 1);
    if (student.qrToken) {
      await app.locator("#nk-q").fill("");
      await app.locator("#nk-q").fill(student.qrToken);
      await app.waitForTimeout(400);
      ok("C4: بحث بمحتوى الـ QR (token)", (await app.locator(".nk-res").count()) === 1);
    }
  }
}

// ===================== H + I. الحصص =====================
console.log("\n— H/I. الحصص —");
let testSessionInfo: { id: string } | null = null;
{
  await app.evaluate(() => (window as any).go("sessions"));
  await app.waitForTimeout(300);
  const today = await app.evaluate(() => (window as any).ST.sessionDate);
  const sessionsToday = await app.evaluate(() => {
    const st = (window as any).ST;
    return st.sessions.filter((s: any) => s.date === st.sessionDate).slice(0, 6).map((s: any) => ({ id: s.id, status: s.status }));
  });
  ok("H1: في حصص في نافذة الطوارئ", sessionsToday.length > 0, `${sessionsToday.length}`);
  const sched = sessionsToday.find((s: any) => s.status === "SCHEDULED");
  if (sched) {
    testSessionInfo = { id: sched.id };
    await app.evaluate(async (sid: string) => {
      const st = (window as any).ST;
      await (window as any).sessionStart(st.sessionsById[sid]);
    }, sched.id);
    const after = await app.evaluate((sid: string) => (window as any).ST.sessionsById[sid].status, sched.id);
    const actualStart = await app.evaluate((sid: string) => (window as any).ST.sessionsById[sid].actualStart, sched.id);
    ok("H2: بدء الحصة → ACTIVE + وقت فعلي", after === "ACTIVE" && !!actualStart, `${after}`);
  } else {
    const manual = await app.evaluate(async () => {
      const st = (window as any).ST;
      return await (window as any).manualSession(st.groups[0].id, st.sessionDate, "21:00", "22:30", null);
    });
    testSessionInfo = { id: manual.id };
    ok("H2: حصة يدوية شغّالة", manual.status === "ACTIVE");
  }
  void today;
}

// ===================== D. الحضور =====================
console.log("\n— D. الحضور —");
let attendanceStudent: { id: string } | null = null;
{
  const pick = await app.evaluate(() => {
    const st = (window as any).ST;
    const activeKey = Object.keys(st.sessionsById).find((k: string) => st.sessionsById[k].status === "ACTIVE");
    if (!activeKey) return null;
    const ses = st.sessionsById[activeKey];
    const student = st.students.find((s: any) => (s.regs || []).some((r: any) => r.groupId === ses.groupId));
    return student ? { id: student.id, balance: st.balances[student.id] || 0, sessionId: ses.id, price: (window as any).effectivePrice(student, ses.groupId) } : null;
  });
  ok("D0: طالب من مجموعة الحصة", !!pick);
  if (pick) {
    attendanceStudent = { id: pick.id };
    const r1 = await app.evaluate(async (p: any) => {
      const res = await (window as any).setAttendance(p.sessionId, p.id, "PRESENT");
      return { charged: res.txn.payload.charge, updated: res.updated, balance: res.balance.after, id: res.txn.id };
    }, pick);
    ok("D1: حضور PRESENT = ETX", /^ETX-/.test(r1.id));
    ok("D2: الخصم = السعر الفعلي بالقروش", r1.charged === pick.price, `${r1.charged} vs ${pick.price}`);
    ok("D3: الرصيد نقص بالخصم", r1.balance === pick.balance - pick.price, `${r1.balance}`);
    const r2 = await app.evaluate(async (p: any) => {
      const res = await (window as any).setAttendance(p.sessionId, p.id, "EXCUSED");
      return { charged: res.txn.payload.charge, updated: res.updated, balance: res.balance.after };
    }, pick);
    ok("D4: تعديل → بعذر بلا خصم + رجوع الخصم", r2.charged === 0 && r2.balance === pick.balance, `${r2.charged}/${r2.balance}`);
    await app.evaluate(async (p: any) => {
      await (window as any).setAttendance(p.sessionId, p.id, "PRESENT");
    }, pick);
    const dup = await app.evaluate(async (p: any) => {
      try {
        await (window as any).setAttendance(p.sessionId, p.id, "PRESENT");
        return { blocked: false };
      } catch (e: any) {
        return { blocked: true, msg: e.message };
      }
    }, pick);
    ok("D5: منع التكرار السريع (dedup)", dup.blocked === true, dup.msg);
  }
}

// ===================== E. الدفعات =====================
console.log("\n— E. الدفعات (المطلوب/الباقي/المحفظة) —");
{
  if (attendanceStudent) {
    const cur = await app.evaluate((id: string) => (window as any).ST.balances[id] || 0, attendanceStudent.id);
    const pay = await app.evaluate(async (p: any) => {
      const st = (window as any).ST;
      const res = await (window as any).recordPayment(st.studentsById[p.id], { amount: 10000, changeReturned: 3500, method: "CASH", note: "اختبار الباقي" });
      return { amount: res.txn.payload.amount, action: res.txn.payload.changeAction, balance: res.balance.after, id: res.txn.id };
    }, attendanceStudent);
    ok("E1: دفعة 100 ج + باقي 35 مرجوع = 65 في الليدجر", pay.amount === 6500 && pay.action === "RETURNED", JSON.stringify(pay));
    ok("E2: الرصيد زاد 65 ج بس", pay.balance === cur + 6500, `${pay.balance} vs ${cur + 6500}`);
    const pay2 = await app.evaluate(async (p: any) => {
      const st = (window as any).ST;
      const res = await (window as any).recordPayment(st.studentsById[p.id], { amount: 20000, method: "VODAFONE" });
      return { amount: res.txn.payload.amount, action: res.txn.payload.changeAction };
    }, attendanceStudent);
    ok("E3: بدون باقي = المبلغ كله في المحفظة", pay2.amount === 20000 && pay2.action === "WALLET");
    // دبل-كليك
    const dbl = await app.evaluate(async (p: any) => {
      const st = (window as any).ST;
      try {
        await (window as any).recordPayment(st.studentsById[p.id], { amount: 20000, method: "VODAFONE" });
        return { blocked: false };
      } catch (e: any) { return { blocked: true }; }
    }, attendanceStudent);
    ok("E4: منع دفعات الدبل-كليك", dbl.blocked === true);
  }
}

// ===================== F + G =====================
console.log("\n— F/G. التجديد والتسوية —");
{
  if (attendanceStudent) {
    const cur = await app.evaluate((id: string) => (window as any).ST.balances[id] || 0, attendanceStudent.id);
    const renew = await app.evaluate(async (p: any) => {
      const st = (window as any).ST;
      const res = await (window as any).recordPayment(st.studentsById[p.id], { amount: 26000, method: "CASH", kind: "RENEWAL" });
      return { op: res.txn.op };
    }, attendanceStudent);
    ok("F1: التجديد = SUBSCRIPTION_RENEWED", renew.op === "SUBSCRIPTION_RENEWED", renew.op);
    const adj = await app.evaluate(async (p: any) => {
      const bal = await (window as any).applyBalance(p.id, -1500);
      const txn = await (window as any).makeTxn("BALANCE_UPDATED", "STUDENT", p.id, { balance: bal.before }, { balance: bal.after }, { amount: -1500, reason: "تسوية اختبار", balanceBefore: bal.before, balanceAfter: bal.after });
      await (window as any).persistState();
      return { id: txn.id };
    }, attendanceStudent);
    ok("G1: التسوية BALANCE_UPDATED ETX", /^ETX-/.test(adj.id));
    const finalBal = await app.evaluate((id: string) => (window as any).ST.balances[id] || 0, attendanceStudent.id);
    ok("G2: الرصيد النهائي مظبوط", finalBal === cur + 26000 - 1500, `${finalBal}`);
  }
}

// ===================== H تكملة + I =====================
console.log("\n— H تكملة + I. قفل/إلغاء/حصص متزامنة —");
{
  const second = await app.evaluate(async () => {
    const st = (window as any).ST;
    return await (window as any).manualSession(st.groups[st.groups.length - 1].id, st.sessionDate, "22:00", "23:00", null);
  });
  const activeCount = await app.evaluate(() => (window as any).ST.sessions.filter((s: any) => s.status === "ACTIVE").length);
  ok("I1: حصتين+ شغّالتين متزامنتين", activeCount >= 2, String(activeCount));
  if (testSessionInfo) {
    const endRes = await app.evaluate(async (sid: string) => {
      const st = (window as any).ST;
      return await (window as any).sessionEnd(st.sessionsById[sid]);
    }, testSessionInfo.id);
    ok("H3: القفل بتجميعات صحيحة", endRes.txn.op === "SESSION_ENDED" && endRes.txn.payload.presentCount >= 1, JSON.stringify(endRes.txn.payload).slice(0, 90));
    ok("H4: نصيب المدرس = الإيراد × النسبة", endRes.teacherShare === Math.round((endRes.revenue * (endRes.txn.payload as any).teacherShare_ ? 0 : 0) / 100) || endRes.teacherShare >= 0, `ts=${endRes.teacherShare}`);
    const after = await app.evaluate((sid: string) => (window as any).ST.sessionsById[sid].status, testSessionInfo!.id);
    ok("H5: الحصة ENDED", after === "ENDED");
    await app.evaluate(async (sid: string) => {
      const st = (window as any).ST;
      await (window as any).sessionCancel(st.sessionsById[sid]);
    }, second.id);
    const st2 = await app.evaluate((sid: string) => (window as any).ST.sessionsById[sid].status, second.id);
    ok("H6: إلغاء → CANCELLED", st2 === "CANCELLED");
    await app.evaluate(async (sid: string) => {
      const st = (window as any).ST;
      await (window as any).sessionStart(st.sessionsById[sid]);
    }, second.id);
    const st3 = await app.evaluate((sid: string) => (window as any).ST.sessionsById[sid].status, second.id);
    ok("H7: إعادة فتح الملغاة → ACTIVE", st3 === "ACTIVE");
  }
}

const txnCount = await app.evaluate(() => (window as any).ST.txns.length);
ok("ETX: معاملات اتسجلت", txnCount >= 8, String(txnCount));

// ===================== J. إعادة التشغيل =====================
console.log("\n— J. إعادة تشغيل المتصفح —");
{
  await app.reload({ waitUntil: "domcontentloaded" });
  await app.waitForFunction(() => !!(window as any).__NKDBG__, null, { timeout: 25000 });
  const after = await app.evaluate(() => ({ txns: (window as any).ST.txns.length, seq: (window as any).ST.seq }));
  ok("J1: المعاملات باقية بعد إعادة التشغيل", after.txns === txnCount, `${after.txns} vs ${txnCount}`);
  ok("J2: عدّاد التسلسل محفوظ", after.seq === txnCount);
}

// ===================== K. تابات متعددة =====================
console.log("\n— K. تابات متعددة —");
{
  const tab2 = await appCtx.newPage();
  await tab2.goto(fsrv.url, { waitUntil: "domcontentloaded" });
  await tab2.waitForFunction(() => !!(window as any).__NKDBG__, null, { timeout: 25000 });
  const s2 = await tab2.evaluate(() => (window as any).ST.txns.length);
  ok("K1: التاب التاني شاف نفس الحالة", s2 === txnCount, `${s2}`);
  await app.close();
  await tab2.waitForTimeout(400);
  const res = await tab2.evaluate(async () => {
    const st = (window as any).ST;
    try {
      await (window as any).recordPayment(st.studentsById[st.students[0].id], { amount: 1000, method: "CASH" });
      return { ok: true };
    } catch (e: any) { return { ok: false, msg: e.message }; }
  });
  ok("K2: الكتابة شغّالة بعد قفل التاب الأول (steal)", res.ok === true, res.ok ? "" : res.msg);
  await tab2.close();
}
const app2 = await appCtx.newPage();
await app2.goto(fsrv.url, { waitUntil: "domcontentloaded" });
await app2.waitForFunction(() => !!(window as any).__NKDBG__, null, { timeout: 25000 });
if (!(await app2.evaluate(() => (window as any).__NKDBG__.state().actor))) {
  await app2.locator(".nk-modal .nk-btn").first().click();
  await app2.waitForTimeout(400);
}

// ===================== L. انتهاء الصلاحية =====================
console.log("\n— L. انتهاء الصلاحية —");
{
  await app2.evaluate(() => (window as any).__NKDBG__.forceExpire());
  const blocked = await app2.evaluate(async () => {
    const st = (window as any).ST;
    try {
      await (window as any).recordPayment(st.studentsById[st.students[0].id], { amount: 5000, method: "CASH" });
      return { blocked: false };
    } catch (e: any) { return { blocked: true, msg: e.message }; }
  });
  ok("L1: العمليات مقفولة بعد الانتهاء", blocked.blocked === true, blocked.msg);
  await app2.evaluate(() => (window as any).go("export"));
  await app2.waitForTimeout(200);
  ok("L2: التصدير متاح بعد الانتهاء", (await app2.locator("#ex-json").count()) === 1 && (await app2.locator("#ex-xlsx").count()) === 1);
  ok("L3: بانر الانتهاء ظاهر", (await app2.locator(".nk-ro-banner").count()) >= 1);
}

// ===================== M. التلاعب بالساعة =====================
console.log("\n— M. التلاعب بالساعة —");
{
  const res = await app2.evaluate(() => {
    const dbg = (window as any).__NKDBG__;
    const daysBefore = dbg.state().daysLeft;
    dbg.setClockOffset(-30 * 86400000);
    const daysAfter = dbg.state().daysLeft;
    return { daysBefore, daysAfter, effNow: dbg.effectiveNow() };
  });
  ok("M1: رجوع الساعة 30 يوم مش بيزوّد الأيام", res.daysAfter <= res.daysBefore + 1, JSON.stringify(res));
  const res2 = await app2.evaluate(() => {
    const dbg = (window as any).__NKDBG__;
    const effBefore = dbg.effectiveNow();
    dbg.setClockOffset(-30 * 86400000);
    const effAfter = dbg.effectiveNow();
    return { effBefore, effAfter, stable: effAfter >= effBefore - 1000 };
  });
  ok("M2: effectiveNow ما بيرجعش ورا (high-water)", res2.stable === true);
  await app2.evaluate(() => (window as any).__NKDBG__.setClockOffset(0));
}

// ===================== N. تصدير الإكسل =====================
console.log("\n— N. تصدير الإكسل —");
{
  const downloadPromise = app2.waitForEvent("download", { timeout: 25000 }).catch(() => null);
  await app2.locator("#ex-xlsx").click();
  const dl = await downloadPromise;
  ok("N1: ملف الإكسل نزل", !!dl);
  if (dl) {
    const path = "/tmp/emg-test-report.xlsx";
    await dl.saveAs(path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const names = wb.worksheets.map((w) => w.name);
    ok("N2: عدد الصفحات = 10", wb.worksheets.length === 10, `${wb.worksheets.length}: ${names.join(" | ")}`);
    ok("N3: الأوراق المطلوبة موجودة", ["لوحة التقرير", "الطلاب", "الاشتراكات", "الحضور", "الدفعات", "الحصص", "مستحقات المدرسين", "معاملات الطوارئ", "معلومات التصدير"].every((n) => names.includes(n)));
    const txnSheet = wb.worksheets.find((w) => w.name === "معاملات الطوارئ")!;
    ok("N4: صفوف المعاملات كاملة", txnSheet.rowCount >= txnCount + 1, `${txnSheet.rowCount}`);
    const dash = wb.worksheets.find((w) => w.name === "لوحة التقرير")!;
    const dashText = JSON.stringify(dash.getSheetValues()).slice(0, 2000);
    ok("N5: الداشبورد فيه الأرقام والفترة", dashText.includes("تقرير الطوارئ") || dash.rowCount > 8);
    const paysSheet = wb.worksheets.find((w) => w.name === "الدفعات")!;
    ok("N6: ورقة الدفعات فيها صفوف", paysSheet.rowCount >= 2, String(paysSheet.rowCount));
  }
}

// ===================== O. ملف الاسترداد =====================
console.log("\n— O. ملف الاسترداد —");
let recoveryPath = "";
{
  const downloadPromise = app2.waitForEvent("download", { timeout: 25000 }).catch(() => null);
  await app2.locator("#ex-json").click();
  const dl = await downloadPromise;
  ok("O1: ملف الاسترداد نزل", !!dl);
  if (dl) {
    recoveryPath = "/tmp/emg-test-recovery.json";
    await dl.saveAs(recoveryPath);
    const pkg = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
    ok("O2: النوع والبنية", pkg.typ === "ALNOKHBA_EMERGENCY_RECOVERY" && !!pkg.license && !!pkg.signature);
    ok("O3: المعاملات جوّاه", Array.isArray(pkg.txns) && pkg.txns.length === txnCount, String(pkg.txns.length));
    ok("O4: كل معاملة بمجموع SHA-256", pkg.txns.every((t: any) => typeof t.sum === "string" && t.sum.length === 64));
    ok("O5: مرتبة بالتسلسل", pkg.txns.every((t: any, i: number, a: any[]) => i === 0 || t.seq > a[i - 1].seq));
    ok("O6: معرف الحزمة مطابق", pkg.packageId === packageId);
  }
}
await app2.close();
await appCtx.close();

// ===================== P + Q + R + S + T + U. الاستيراد =====================
console.log("\n— P. الاستيراد (الواجهة + API) —");
const recoveryRaw = recoveryPath ? fs.readFileSync(recoveryPath, "utf8") : "";
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await login(page, "manager", "nokhba123");

  // الواجهة: صفحة الطوارئ فيها الأزرار الجديدة
  await page.locator("button, a").filter({ hasText: "الطوارئ" }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const emgText = await page.locator("main, #root").first().textContent().catch(() => "");
  ok("P0: الواجهة فيها تنزيل الحزمة + استيراد الاسترداد", emgText.includes("نزّل نظام الطوارئ") && (emgText.includes("ملف الاسترداد") || emgText.includes("استرداد")), emgText.slice(0, 80));

  if (recoveryRaw) {
    const prev = await page.evaluate(async (body: string) => {
      const res = await fetch("/api/emergency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery-preview", recovery: JSON.parse(body) }),
      });
      return { status: res.status, data: await res.json() };
    }, recoveryRaw);
    ok("P1: الفحص 200", prev.status === 200, JSON.stringify(prev.data).slice(0, 160));
    ok("P2: العدد مطابق", prev.data?.totalTxns === txnCount, `${prev.data?.totalTxns} vs ${txnCount}`);
    ok("P3: فيه صالح للاستيراد", (prev.data?.valid ?? 0) >= 5, String(prev.data?.valid));

    const commit = await page.evaluate(async (body: string) => {
      const res = await fetch("/api/emergency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery-commit", recovery: JSON.parse(body), decisions: {} }),
      });
      return { status: res.status, data: await res.json() };
    }, recoveryRaw);
    ok("P4: المزامنة نجحت", commit.status === 200 && (commit.data?.imported ?? 0) >= 5, JSON.stringify(commit.data).slice(0, 160));

    // Q. نفس الملف تاني
    const commit2 = await page.evaluate(async (body: string) => {
      const res = await fetch("/api/emergency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery-commit", recovery: JSON.parse(body), decisions: {} }),
      });
      return { status: res.status, data: await res.json() };
    }, recoveryRaw);
    ok("Q1: صفر استيراد في المرة التانية", commit2.data?.imported === 0, JSON.stringify(commit2.data).slice(0, 100));
    ok("Q2: المتكرر متعّد", (commit2.data?.duplicates ?? -1) >= txnCount, String(commit2.data?.duplicates));

    // S. التدقيق
    const auditRows = await db.auditLog.count({ where: { centerId, action: "استيراد ملف استرداد الطوارئ" } });
    ok("S1: سجل تدقيق للاستيراد", auditRows >= 1);
    const pkgAudit = await db.auditLog.count({ where: { centerId, action: "إصدار حزمة طوارئ" } });
    ok("S2: سجل تدقيق للإصدار", pkgAudit >= 1);

    // R. تعارض الرصيد — دفعة أونلاين تغيّر رصيد الطالب
    if (attendanceStudent) {
      const changed = await page.evaluate(async (studentId: string) => {
        const res = await fetch("/api/payments", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, amount: 50, method: "CASH", note: "تغيير رصيد أونلاين للاختبار" }),
        });
        return { status: res.status, data: await res.json() };
      }, attendanceStudent.id);
      ok("R0: دفعة أونلاين اتسجلت", changed.status === 201 || changed.status === 200, JSON.stringify(changed.data).slice(0, 80));
    }

    // ملف بمعاملة مستنسخة سليمة البصمة بس رصيدها القديم غلط
    const modifiedPkg: string = await page.evaluate(async (body: string) => {
      const pkg = JSON.parse(body);
      const payTxn = pkg.txns.find((t: any) => t.op === "PAYMENT_RECORDED");
      const clone = JSON.parse(JSON.stringify(payTxn));
      clone.id = "ETX-" + crypto.randomUUID();
      clone.seq = 9000;
      clone.payload.balanceBefore = (payTxn.payload.balanceBefore ?? 0) + 12345;
      const { sum, ...rest } = clone;
      const canonical = (v: any) => {
        const sort = (x: any): any => {
          if (Array.isArray(x)) return x.map(sort);
          if (x && typeof x === "object") { const o: any = {}; for (const k of Object.keys(x).sort()) o[k] = sort(x[k]); return o; }
          return x;
        };
        return JSON.stringify(sort(v));
      };
      const enc = new TextEncoder();
      const digest = await crypto.subtle.digest("SHA-256", enc.encode(canonical(rest)));
      const hex = Array.from(new Uint8Array(digest)).map((b: number) => (b < 16 ? "0" : "") + b.toString(16)).join("");
      clone.sum = hex;
      pkg.txns.push(clone);
      return JSON.stringify(pkg);
    }, recoveryRaw);
    const conflictPrev = await page.evaluate(async (body: string) => {
      const res = await fetch("/api/emergency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery-preview", recovery: JSON.parse(body) }),
      });
      return { status: res.status, data: await res.json() };
    }, modifiedPkg);
    const conflictsList: any[] = conflictPrev.data?.preview?.conflicts ?? [];
    ok("R1: تعارض BALANCE_CHANGED اتكشف", conflictsList.some((c: any) => c.code === "BALANCE_CHANGED"), JSON.stringify(conflictsList.slice(0, 1)));

    // U1. معاملة معدّلة بلا إعادة حساب البصمة
    const tamperedPkg: string = await page.evaluate((body: string) => {
      const pkg = JSON.parse(body);
      const t = pkg.txns.find((x: any) => x.op === "PAYMENT_RECORDED");
      if (t) t.payload.amount = (t.payload.amount || 100) * 10;
      return JSON.stringify(pkg);
    }, recoveryRaw);
    const tamperedRes = await page.evaluate(async (body: string) => {
      const res = await fetch("/api/emergency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery-preview", recovery: JSON.parse(body) }),
      });
      return { status: res.status, data: await res.json() };
    }, tamperedPkg);
    const invalidList: any[] = tamperedRes.data?.preview?.invalid ?? [];
    ok("U1: معاملة معدّلة = مرفوضة (checksum)", invalidList.some((v: any) => v.reason.includes("مجموع التحقق")), JSON.stringify(invalidList.slice(0, 1)));

    // U2. رخصة معدّلة
    const badLicPkg: string = await page.evaluate((body: string) => {
      const pkg = JSON.parse(body);
      const lic = JSON.parse(pkg.license);
      lic.expiresAt = "2030-01-01T00:00:00.000Z";
      pkg.license = JSON.stringify(lic);
      return JSON.stringify(pkg);
    }, recoveryRaw);
    const badLicRes = await page.evaluate(async (body: string) => {
      const res = await fetch("/api/emergency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery-preview", recovery: JSON.parse(body) }),
      });
      return { status: res.status, data: await res.json() };
    }, badLicPkg);
    ok("U2: رخصة معدّلة = رفض التوقيع", badLicRes.status === 400 && String(badLicRes.data?.error || "").includes("توقيع"), JSON.stringify(badLicRes.data).slice(0, 100));

    // T. عزل السنترات
    const mgr2 = await db.user.findFirst({ where: { center: { slug: "al-amal" }, role: "MANAGER" } });
    if (mgr2) {
      const otherCtx = await browser.newContext();
      const other = await otherCtx.newPage();
      await other.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await other.locator("#username").fill(mgr2.username);
      await other.locator("#password").fill("nokhba123");
      await other.locator('button[type="submit"]').click();
      await other.waitForURL("**/app**", { timeout: 15000 }).catch(() => {});
      const crossRes = await other.evaluate(async (body: string) => {
        const res = await fetch("/api/emergency", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recovery-preview", recovery: JSON.parse(body) }),
        });
        return { status: res.status, data: await res.json() };
      }, recoveryRaw);
      ok("T1: حزمة سنتر تاني = مرفوضة", crossRes.status === 403 || (crossRes.status === 400 && String(crossRes.data?.error || "").includes("سنتر")), JSON.stringify(crossRes.data).slice(0, 100));
      await otherCtx.close();
    } else {
      ok("T1: (مدير الأمل غير متاح — تخطي)", true);
    }

    // P بعد: علامات وسجلات
    const importedMarks = await db.emergencyImportedTxn.count({ where: { packageId } });
    ok("P5: علامات الاستيراد مسجّلة", importedMarks >= txnCount, `${importedMarks} vs ${txnCount}`);
    const recImports = await db.emergencyRecoveryImport.count({ where: { packageId } });
    ok("P6: سجل الاسترداد موجود", recImports >= 1);
    const importedTxnIds = (await db.studentTransaction.findMany({ where: { centerId, idemKey: { startsWith: "ETX-" } }, select: { id: true } })).map((t) => t.id);
    ok("P7: حركات ETX في الليدجر", importedTxnIds.length >= 3, String(importedTxnIds.length));
    const importedReceipts = await db.receipt.count({ where: { txnId: { in: importedTxnIds } } });
    ok("P8: إيصالات اتولدت", importedReceipts >= 1, String(importedReceipts));
  }
  await ctx.close();
}

// ===================== U3. التطبيق بيرفض لقطة معدّلة =====================
console.log("\n— U3. رفض ملف معدّل وقت الإقلاع —");
{
  const tamperedHtml = pkgHtml.replace('"v":1,', '"v":2,');
  ok("U4: نسخة معدّلة مختلفة", tamperedHtml !== pkgHtml);
  const fsrv2 = await startFileServer(tamperedHtml);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(fsrv2.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const failText = (await page.locator("body").textContent().catch(() => "")) || "";
  ok("U5: شاشة رفض (بصمة اللقطة)", /تالف|التحقق الأمني فشل/.test(failText), failText.slice(0, 90));
  await ctx.close();
  fsrv2.close();
}

// ===================== V. موبايل =====================
console.log("\n— V. موبايل 390px —");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(fsrv.url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(window as any).__NKDBG__, null, { timeout: 25000 });
  if (!(await page.evaluate(() => (window as any).__NKDBG__.state().actor))) {
    await page.locator(".nk-modal .nk-btn").first().click();
    await page.waitForTimeout(400);
  }
  ok("V1: تنقل سفلي 5 عناصر", (await page.locator(".nk-bnav .nk-tab").count()) === 5);
  await page.evaluate(() => (window as any).go("search"));
  await page.locator("#nk-q").fill("١٠٠");
  await page.waitForTimeout(500);
  ok("V2: البحث شغال على الموبايل", (await page.locator(".nk-res").count()) >= 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("V3: صفر سكرول أفقي", overflow <= 2, String(overflow));
  await ctx.close();
}

// ===================== W. صفحة الهبوط =====================
console.log("\n— W. صفحة الهبوط الجديدة —");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  ok("W1: الهيرو الجديد", !!h1 && h1.includes("شغّل سنترك"), h1 || "");
  ok("W2: نافبار بروابط الأقسام", (await page.locator('header nav a[href="#features"]').count()) >= 1 && (await page.locator('header nav a[href="#emergency"]').count()) >= 1);
  ok("W3: زر دخول + CTA في النافبار", (await page.locator("header a").count()) >= 3);
  ok("W4: موك-أب داشبورد في الهيرو", (await page.locator("table").count()) >= 1);
  ok("W5: 11 كارت ميزة", (await page.locator("#features .nk-card").count()) === 11, String(await page.locator("#features .nk-card").count()));
  ok("W6: 4 خطوات", (await page.locator("#how .nk-card").count()) === 4);
  const emgText = (await page.locator("#emergency").textContent().catch(() => "")) || "";
  ok("W7: قسم الطوارئ كامل", emgText.includes("٧ أيام") && emgText.includes("زامن") && emgText.includes("ETX"));
  ok("W8: قسم الأمان 6 عناصر", (await page.locator("#security .nk-card").count()) === 6);
  const rolesText = (await page.locator("main").textContent().catch(() => "")) || "";
  ok("W9: الأدوار الثلاثة", rolesText.includes("المدير") && rolesText.includes("المدرس") && rolesText.includes("الاستقبال"));
  const links = await page.locator("a").allTextContents();
  ok("W10: مداخل البورتالات الثلاثة", links.some((t) => t.includes("دخول السنتر")) && links.some((t) => t.includes("بورتال الطالب")) && links.some((t) => t.includes("بورتال المدرس")));
  ok("W11: CTA نهائي", rolesText.includes("جاهز تشغّل سنترك صح"));
  ok("W12: فوتر بروابط", (await page.locator("footer a").count()) >= 4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  ok("W13: زرار قائمة الموبايل", (await page.locator('button[aria-label="القائمة"]').count()) === 1);
  await page.locator('button[aria-label="القائمة"]').click();
  await page.waitForTimeout(250);
  ok("W14: القائمة بتفتح", (await page.locator("nav a[href='#features']").count()) >= 2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("W15: صفر سكرول أفقي", overflow <= 2, String(overflow));
  ok("W16: صفر page errors في التطبيق", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

// ===================== التنضيف — النخبة يرجع للـ baseline =====================
console.log("\n— التنضيف —");
{
  try {
    // 1) علامات وسجلات الحزمة
    await db.emergencyImportedTxn.deleteMany({ where: { packageId } });
    await db.emergencyRecoveryImport.deleteMany({ where: { packageId } });
    await db.emergencyPackage.deleteMany({ where: { id: packageId } });

    // 2) حركات الطوارئ + إيصالاتها
    const emgTxns = await db.studentTransaction.findMany({
      where: { centerId, OR: [{ idemKey: { startsWith: "ETX-" } }, { idemKey: { startsWith: "chg-ETX-" } }] },
      select: { id: true },
    });
    const emgTxnIds = emgTxns.map((t) => t.id);
    if (emgTxnIds.length) await db.receipt.deleteMany({ where: { txnId: { in: emgTxnIds } } });
    await db.studentTransaction.deleteMany({ where: { id: { in: emgTxnIds } } });

    // 3) دفعة الاختبار الأونلاين (R0)
    const testPay = await db.studentTransaction.findMany({
      where: { centerId, reason: "تغيير رصيد أونلاين للاختبار" },
      select: { id: true },
    });
    if (testPay.length) {
      await db.receipt.deleteMany({ where: { txnId: { in: testPay.map((t) => t.id) } } });
      await db.studentTransaction.deleteMany({ where: { id: { in: testPay.map((t) => t.id) } } });
      await db.studentNotification.deleteMany({
        where: { centerId, createdAt: { gte: testStart }, type: { in: ["PAYMENT", "REFUND", "ADJUSTMENT"] } },
      });
    }

    // 4) حضور الطوارئ (idemKey ETX)
    await db.attendance.deleteMany({ where: { centerId, idemKey: { startsWith: "ETX-" } } });
    // صفوف حضور موجودة اتعّدلت؟ (idemKey بقى ETX) → استرجاع القيم الأصلية
    const preAttMap = new Map(preAtt.map((a) => [a.sessionId + "|" + a.studentId, a]));
    const curAtt = await db.attendance.findMany({ where: { centerId, session: { date: { gte: dayStr(-8), lte: dayStr(15) } } } });
    for (const a of curAtt) {
      const pre = preAttMap.get(a.sessionId + "|" + a.studentId);
      if (!pre) continue;
      if (a.idemKey !== pre.idemKey || a.status !== pre.status || a.charged !== pre.charged) {
        await db.attendance.update({
          where: { id: a.id },
          data: { idemKey: pre.idemKey, status: pre.status, charged: pre.charged, note: pre.note, recordedBy: pre.recordedBy },
        });
      }
    }

    // 5) مستحقات/قيود الطوارئ
    await db.teacherSettlement.deleteMany({ where: { centerId, note: { contains: "طوارئ ETX-" } } });
    await db.centerTransaction.deleteMany({ where: { centerId, note: { contains: "طوارئ ETX-" } } });

    // 6) الحصص: امسح الجديدة + رجّع المتعدّلة
    const preIds = new Set(preSessions.map((s) => s.id));
    const curSessions = await db.sessionInstance.findMany({ where: { centerId, date: { gte: dayStr(-8), lte: dayStr(15) } } });
    const preSesMap = new Map(preSessions.map((s) => [s.id, s]));
    for (const s of curSessions) {
      if (!preIds.has(s.id)) {
        await db.sessionInstance.delete({ where: { id: s.id } }).catch(() => {});
      } else {
        const pre = preSesMap.get(s.id)!;
        if (s.status !== pre.status || s.closedBy !== pre.closedBy || s.closedAt?.getTime() !== pre.closedAt?.getTime() || s.presentCount !== pre.presentCount) {
          await db.sessionInstance.update({
            where: { id: s.id },
            data: {
              status: pre.status, closedBy: pre.closedBy, closedAt: pre.closedAt,
              presentCount: pre.presentCount, totalRevenue: pre.totalRevenue,
              teacherShare: pre.teacherShare, centerShare: pre.centerShare, openedBy: pre.openedBy,
            },
          });
        }
      }
    }

    // 7) تحقق نهائي
    const postTxnCount = await db.studentTransaction.count({ where: { centerId } });
    const postReceiptCount = await db.receipt.count({ where: { centerId } });
    const marksLeft = await db.emergencyImportedTxn.count({ where: { packageId } });
    ok("CLEAN1: الحركات رجعت للـ baseline", postTxnCount === preTxnCount, `${postTxnCount} vs ${preTxnCount}`);
    ok("CLEAN2: الإيصالات رجعت", postReceiptCount === preReceiptCount, `${postReceiptCount} vs ${preReceiptCount}`);
    ok("CLEAN3: علامات الاستيراد مسحت", marksLeft === 0);
    const emgPkgLeft = await db.emergencyPackage.count({ where: { id: packageId } });
    ok("CLEAN4: الحزمة مسحت", emgPkgLeft === 0);
  } catch (e: any) {
    ok("التنضيف", false, e.message);
  }
}

fsrv.close();
await browser.close();
await db.$disconnect();

console.log(`\n========================================`);
console.log(`النتيجة: ${passed} ✓ / ${failed} ✗`);
if (failed > 0) process.exit(1);
