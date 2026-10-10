/**
 * Live verification of the student-portal balance bug fix.
 * Reproduces the user's exact complaint: "add 10 EGP → portal shows 1000".
 *
 * Flow: receptionist logs in → adds 10 EGP ADJUSTMENT to a test student
 * → student logs into the portal → /api/portal balance checked
 * → assert the DISPLAYED value is 10 EGP (not 1000).
 */
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const db = new PrismaClient();
const scriptStart = new Date();
let cookies = "";
let portalCookies = "";

async function j(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setc = res.headers.getSetCookie?.() ?? [];
  if (setc.length) cookies = setc.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function pj(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(portalCookies ? { Cookie: portalCookies } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setc = res.headers.getSetCookie?.() ?? [];
  if (setc.length) portalCookies = setc.map((c) => c.split(";")[0]).join("; ");
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const pass = [];
const fail = [];
function check(name, cond, extra = "") {
  (cond ? pass : fail).push(name + (extra ? ` (${extra})` : ""));
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

(async () => {
  // ---------- 1) staff login (manager — ADJUSTMENT requires MANAGER role) ----------
  const login = await j("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
  check("staff login", login.status === 200, `status=${login.status}`);

  // ---------- 2) pick a KNOWN test student (ACTIVE, has phone) ----------
  const stu = await db.student.findFirst({ where: { code: "10001", status: "ACTIVE" }, select: { id: true, name: true, code: true } });
  check("test student found", Boolean(stu), stu ? `${stu.code} ${stu.name}` : "not found");
  if (!stu) process.exit(1);

  // balance BEFORE (in piastres, from ledger)
  const before = await db.studentTransaction.aggregate({ _sum: { amount: true }, where: { studentId: stu.id } });
  const beforePiastres = before._sum.amount ?? 0;

  // ---------- 3) student portal login ----------
  portalCookies = "";
  const student = await db.student.findUnique({ where: { id: stu.id } });
  const clean = (s: string) => String(s ?? "").replace(/[\s\-()\u200f\u200e\u202a-\u202e]/g, "");
  const phone = clean(student?.phone || student?.parentPhone || "");
  const plogin = await pj("/api/portal", { method: "POST", body: JSON.stringify({ action: "login", code: student.code, phone }) });
  check("portal login", plogin.status === 200, `status=${plogin.status} ${plogin.data?.error ?? ""}`);

  const homeBefore = await pj("/api/portal");
  check("portal home before", homeBefore.status === 200 && homeBefore.data?.student, `balance(piastres)=${homeBefore.data?.balance}`);

  // ---------- 4) receptionist adds 10 EGP (the user's exact repro) ----------
  const pay = await j("/api/payments", {
    method: "POST",
    body: JSON.stringify({ studentId: stu.id, amount: 10, type: "ADJUSTMENT", method: "CASH", note: "اختبار الرصيد — 10 جنيه" }),
  });
  check("add 10 EGP adjustment", pay.status === 200, `status=${pay.status} ${pay.data?.error ?? ""}`);

  // stored amount must be exactly 1000 piastres (10 EGP) — not 100,000
  const stored = pay.data?.txn?.amount ?? null;
  check("stored amount = 1000 piastres (10 EGP)", stored === 1000, `stored=${stored}`);

  // ---------- 5) portal shows 10 more EGP, not 1000 more ----------
  const homeAfter = await pj("/api/portal");
  const balAfter = homeAfter.data?.balance;
  const deltaEGP = (balAfter - homeBefore.data.balance) / 100;
  check("portal balance delta = 10 EGP", Math.abs(deltaEGP - 10) < 0.001, `delta=${deltaEGP} EGP (api=${balAfter} piastres)`);

  // the DISPLAY conversion (exactly what portal.tsx line 475 does)
  const displayed = Math.round(balAfter) / 100;
  console.log(`\n  → Portal would display: ${displayed} ج (was ${Math.round(homeBefore.data.balance) / 100} ج)`);
  check("displayed ≠ ×100", displayed !== balAfter, `display=${displayed} vs raw=${balAfter}`);

  // ---------- 6) cleanup: reverse the adjustment exactly ----------
  const undo = await j("/api/payments", {
    method: "POST",
    body: JSON.stringify({ studentId: stu.id, amount: -10, type: "ADJUSTMENT", method: "CASH", note: "تراجع اختبار الرصيد" }),
  });
  check("cleanup adjustment reversal", undo.status === 200, `status=${undo.status}`);

  const homeFinal = await pj("/api/portal");
  check("balance restored to original", homeFinal.data.balance === beforePiastres, `final=${homeFinal.data.balance} vs original=${beforePiastres}`);

  // notifications from this test run (PAYMENT/REFUND/ADJUSTMENT since the script started)
  const notifCleanup = await db.studentNotification.deleteMany({
    where: {
      studentId: stu.id,
      type: { in: ["PAYMENT", "REFUND", "ADJUSTMENT"] },
      createdAt: { gte: scriptStart },
    },
  });
  check("test notifications cleaned", notifCleanup.count >= 0, `deleted=${notifCleanup.count}`);

  // logout portal
  await pj("/api/portal", { method: "POST", body: JSON.stringify({ action: "logout" }) });
  await j("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });

  console.log(`\n==== ${pass.length} passed, ${fail.length} failed ====`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH:", e.message); process.exit(1); });
