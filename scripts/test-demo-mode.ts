/**
 * اختبار وضع التجربة (Demo Mode) + أزرار الطباعة — API-level:
 * 1. GET /api/demo قبل التجهيز → غير جاهز
 * 2. POST /api/demo → ينشئ مدرس + مجموعتين + 6 طلاب (99xxx) + حصتين النهاردة
 * 3. idempotent: POST تاني → مفيش تكرار
 * 4. جرب الحضور على طالب تجريبي (scan API) + دفعة (payments) → إيصال
 * 5. DELETE بدون confirm → مرفوض
 * 6. DELETE ?confirm=demo → مسح كامل + الطلاب الحقيقيين سليمين + الأرصدة رجعت
 * 7. الاستقبال ممنوع يعمل تجهيز/مسح
 */
const BASE = "http://localhost:3000";
let cookie = "";
let passed = 0, failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  console.log("=== 1) دخول المدير + الحالة الأولية ===");
  let r = await api("/api/auth", { method: "POST", body: { username: "manager", password: "nokhba123" } });
  check("دخول المدير", r.status === 200 && r.data.user?.role === "MANAGER");

  // تنظيف أي بقايا تجريبية من تشغيل سابق (عشان الاختبار يبدأ من صفحة بيضا)
  await api("/api/demo?confirm=demo", { method: "DELETE" });

  // عدد الطلاب الحقيقيين قبل أي حاجة
  const beforeStudents = await api("/api/students");
  const realBefore = beforeStudents.data.students?.length ?? beforeStudents.data.total ?? -1;
  console.log(`  (طلاب النظام قبل التجربة: ${realBefore})`);

  r = await api("/api/demo");
  check("GET demo قبل التجهيز → غير جاهز", r.status === 200 && r.data.ready === false, JSON.stringify(r.data).slice(0, 120));

  console.log("=== 2) التجهيز ===");
  r = await api("/api/demo", { method: "POST" });
  check("POST demo → 200", r.status === 200, JSON.stringify(r.data).slice(0, 200));
  check("اتعمل 6 طلاب", r.data.created?.students === 6, JSON.stringify(r.data.created));
  check("اتعملت حصتين", r.data.created?.sessions === 2, JSON.stringify(r.data.created));
  check("كل الأكواد 99xxx", (r.data.students as any[]).every((s) => /^99\d{3}$/.test(s.code)));
  check("أرصدة متنوعة (فيه اللي عليه وفيه اللي له)", (r.data.students as any[]).some((s) => s.balance > 0) && (r.data.students as any[]).some((s) => s.balance < 0));
  const firstSession = r.data.sessions?.[0];
  check("الحصة الأولى ليها وقت وقاعة", !!firstSession?.startTime && firstSession?.room !== undefined, JSON.stringify(firstSession));
  const demoStudentWithBalance = (r.data.students as any[]).find((s) => s.balance > 0);
  const demoStudentZero = (r.data.students as any[]).find((s) => s.balance === 0);
  check("فيه طالب رصيده صفر (لتجربة الدفع)", !!demoStudentZero);

  console.log("=== 3) idempotent — POST تاني ===");
  r = await api("/api/demo", { method: "POST" });
  check("مفيش طلاب جداد", r.data.created?.students === 0, JSON.stringify(r.data.created));
  check("مفيش حصص جداد", r.data.created?.sessions === 0, JSON.stringify(r.data.created));
  check("لسه 6 طلاب", r.data.students?.length === 6);

  console.log("=== 4) GET الحالة ===");
  r = await api("/api/demo");
  check("جاهز", r.data.ready === true);
  check("6 طلاب بحالة أرصدتهم", r.data.students?.length === 6);
  check("حصتين النهاردة", r.data.sessions?.length === 2, JSON.stringify(r.data.sessions?.length));

  console.log("=== 5) تجربة زي ما المدير هيجرب: مسح + دفع + قفل ===");
  r = await api("/api/demo", { method: "POST" });
  const demoStudents: any[] = r.data.students;
  const trialSessionId: string = r.data.sessions[0].id;
  const withBalance = demoStudents.find((s) => s.balance > 0);
  const zeroBalance = demoStudents.find((s) => s.balance === 0);

  // 5أ) الفلو الحقيقي: scan (يحلل ويرجع id) ثم mark (يسجل حضور + خصم)
  let scan = await api("/api/attendance/scan", { method: "POST", body: { query: withBalance.code, sessionId: trialSessionId } });
  check("scan طالب تجريبي → حالة خضرا ومسجل", scan.status === 200 && scan.data.registered === true, JSON.stringify(scan.data).slice(0, 120));
  const scanId: string | undefined = scan.data.student?.id;
  check("scan رجع id الطالب", !!scanId);

  let mark = await api("/api/attendance/mark", { method: "POST", body: { studentId: scanId, sessionId: trialSessionId } });
  check("mark → حضور + خصم من الرصيد", mark.status === 200 && mark.data.charged === 5000, JSON.stringify(mark.data).slice(0, 150));

  // 5ب) مسح مكرر → ممنوع يتخصم مرتين
  mark = await api("/api/attendance/mark", { method: "POST", body: { studentId: scanId, sessionId: trialSessionId } });
  check("mark مكرر ممنوع (idempotent)", mark.data.alreadyAttended === true || mark.status === 409, JSON.stringify(mark.data).slice(0, 120));

  // 5ج) طالب حقيقي (10001) يمسح في الحصة التجريبية — عشان نتأكد إن المسح بيرجّع الأثر
  const realScan = await api("/api/attendance/scan", { method: "POST", body: { query: "10001", sessionId: trialSessionId } });
  const realId: string | undefined = realScan.data.student?.id;
  check("scan طالب حقيقي 10001", !!realId);
  const realBalanceBefore: number | undefined = realId ? (await api(`/api/students/${realId}`)).data.balance : undefined;
  // مش مسجل في المجموعة التجريبية → mark بـ registerGroup (زي فلو البرتقالي بالظبط)
  let realMark = await api("/api/attendance/mark", { method: "POST", body: { studentId: realId, sessionId: trialSessionId, registerGroup: true } });
  check("طالب حقيقي حضر في حصة تجريبية (تسجيل تلقائي)", realMark.status === 200, JSON.stringify(realMark.data).slice(0, 150));

  // 5د) دفعة لطالب تجريبي مربوطة بالحصة التجريبية → إيصال (يجي في المسح)
  // نجيب id الطالب التجريبي من scan (زي الواجهة)
  const zeroScan = await api("/api/attendance/scan", { method: "POST", body: { query: zeroBalance.code, sessionId: trialSessionId } });
  const zeroId: string | undefined = zeroScan.data.student?.id;
  const payRes = await api("/api/payments", {
    method: "POST",
    body: { studentId: zeroId, type: "PAYMENT", amount: "100", method: "CASH", sessionId: trialSessionId },
  });
  check("دفعة تجريبية 100ج اتعملت", payRes.status === 200 || payRes.status === 201, JSON.stringify(payRes.data).slice(0, 150));
  check("الإيصال اتعمل", !!payRes.data.receipt?.number, JSON.stringify(payRes.data.receipt));

  // 5هـ) قفل الحصة التجريبية → إيراد + نصيب مدرس في اليومية
  let closeRes = await api(`/api/sessions/${trialSessionId}`, { method: "POST", body: { action: "close" } });
  check("قفل الحصة التجريبية", closeRes.status === 200, JSON.stringify(closeRes.data).slice(0, 150));

  console.log("=== 6) DELETE بدون تأكيد → مرفوض ===");
  r = await api("/api/demo", { method: "DELETE" });
  check("مرفوض بدون confirm", r.status === 400, `status=${r.status}`);

  console.log("=== 7) DELETE بالتأكيد → مسح كامل ===");
  r = await api("/api/demo?confirm=demo", { method: "DELETE" });
  check("DELETE → 200", r.status === 200, JSON.stringify(r.data).slice(0, 200));
  check("اتمسح 6 طلاب", r.data.deleted?.students === 6, JSON.stringify(r.data.deleted));
  check("اتمسحت حصتين على الأقل", (r.data.deleted?.sessions ?? 0) >= 2, JSON.stringify(r.data.deleted));
  check("اتمسحت الإيصالات التجريبية", (r.data.deleted?.receipts ?? 0) >= 1, JSON.stringify(r.data.deleted));
  check("اتمسحت قيود اليومية (إيراد + نصيب مدرس)", (r.data.deleted?.centerTxns ?? 0) >= 2, JSON.stringify(r.data.deleted));
  check("اتمسحت الحركات المالية المرتبطة (حضور/دفع)", (r.data.deleted?.txns ?? 0) >= 2, JSON.stringify(r.data.deleted));
  check("اتمسح الحضور التجريبي", (r.data.deleted?.attendance ?? 0) >= 2, JSON.stringify(r.data.deleted));

  // الطالب الحقيقي: رصيده رجع زي ما كان (الخصم التجريبي اترجّع)
  if (realId && realBalanceBefore !== undefined) {
    const realBalanceAfter = (await api(`/api/students/${realId}`)).data.balance;
    check(`رصيد الطالب الحقيقي رجع أصله (${realBalanceBefore} → ${realBalanceAfter})`, realBalanceBefore === realBalanceAfter);
  }

  r = await api("/api/demo");
  check("رجع غير جاهز", r.data.ready === false);

  const afterStudents = await api("/api/students");
  const realAfter = afterStudents.data.students?.length ?? afterStudents.data.total ?? -1;
  check(`الطلاب الحقيقيين زي ما هما (${realBefore} → ${realAfter})`, realBefore === realAfter, `before=${realBefore} after=${realAfter}`);

  console.log("=== 8) الاستقبال ممنوع ===");
  await api("/api/auth", { method: "POST", body: { username: "reception", password: "nokhba123" } });
  r = await api("/api/demo", { method: "POST" });
  check("الاستقبال ممنوع يجهز", r.status === 403 || r.status === 401, `status=${r.status}`);
  r = await api("/api/demo?confirm=demo", { method: "DELETE" });
  check("الاستقبال ممنوع يمسح", r.status === 403 || r.status === 401, `status=${r.status}`);
  // GET مسموح (عشان الكارت لو ظهر)
  r = await api("/api/demo");
  check("الاستقبال يشوف الحالة بس", r.status === 200, `status=${r.status}`);

  console.log(`\n========= النتيجة: ${passed} نجح / ${failed} فشل =========`);
  if (failures.length) { console.log("فشل:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
}

main().catch((e) => { console.error("خطأ قاتل:", e); process.exit(1); });
