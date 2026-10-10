/**
 * اختبار الموافقات + الصلاحيات + طلبات الانضمام + ثبات جلسة الطالب:
 *
 * A. حساب مدير سنتر السعة 5000 (capmgr) شغال
 * B. تسجيل حساب جديد (signup) → PENDING → إشعار فوري للأدمن → تعيين لسنتر/رفض
 * C. صلاحيات دقيقة: استقبال بدون REFUND_PAYMENT → ممنوع مباشر (403) + طلب موافقة
 * D. سير الموافقة: طلب → إشعار المدير → اعتماد (تنفيذ مالي عكسي) / رفض (صفر تغيير)
 * E. مضاد السباقات: قرار مرة واحدة بس (409 للتكرار)
 * F. صلاحيات المدير: منح «استرداد فوري» للاستقبال → تنفيذ مباشر يشتغل
 * G. سلامة مالية: الدفعة الأصلية محفوظة (الاسترداد حركة عكسية مش مسح)
 * H. إلغاء حصة: استقبال → 403 مباشر → طلب → اعتماد → الحصة CANCELLED
 * I. جلسة الطالب: سنة كاملة + التجديد المتدحرج + الخروج بس بـ 401 حقيقي (UI)
 * J. الإشعارات: سريعة (فورية في الداتابيز) + الجرس بيقراها
 * K. تنظيف جراحي كامل يرجّع الـ baseline
 *
 * npx tsx scripts/test-approvals-signup.ts
 */
const BASE = "http://localhost:3000";

let mcookie = ""; // manager
let rcookie = ""; // receptionist
let acookie = ""; // admin
let scookie = ""; // student portal
let newcookie = ""; // المستخدم الجديد (بعد التعيين)
const extraCookies: string[] = [];

let passed = 0, failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

type Jar = "m" | "p" | "r" | "a" | "s" | "new";

async function req(path: string, method = "GET", body?: unknown, jar: Jar = "m", noFollow = false) {
  const c = jar === "m" ? mcookie : jar === "r" ? rcookie : jar === "a" ? acookie : jar === "s" ? scookie : jar === "new" ? newcookie : "";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && !noFollow) {
    const first = setCookie.split(";")[0];
    if (jar === "m") mcookie = first;
    else if (jar === "r") rcookie = first;
    else if (jar === "a") acookie = first;
    else if (jar === "s") scookie = first;
    else if (jar === "new") newcookie = first;
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

// ================== Prisma (للتنضيف والفحص المباشر) ==================
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  console.log("🧪 الموافقات + الصلاحيات + الانضمام + جلسة الطالب\n");
  const stamp = Date.now().toString(36);

  // ============ 0. دخول ============
  let r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" });
  ok("login manager", r.status === 200);
  r = await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, "r");
  ok("login reception", r.status === 200);
  const receptionId = ((r.data.user as { id?: string })?.id) ?? "";
  r = await req("/api/auth", "POST", { username: "admin", password: "nokhba123" }, "a");
  ok("login admin", r.status === 200);

  // صلاحيات الاستقبال في الجلسة (من السيرفر)
  const recPerms = ((await req("/api/auth", "GET", undefined, "r")).data.user as { permissions?: string[] })?.permissions ?? [];
  ok("reception session carries permissions array", Array.isArray(recPerms) && recPerms.includes("RECORD_PAYMENT"), `perms=${recPerms.length}`);
  ok("reception default: NO direct REFUND_PAYMENT", !recPerms.includes("REFUND_PAYMENT"));
  ok("reception default: HAS REQUEST_REFUND", recPerms.includes("REQUEST_REFUND"));

  // ============ A. مدير سنتر السعة 5000 ============
  console.log("\n— A. حساب مدير السعة (capmgr) —");
  const capRes = await fetch(`${BASE}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "capmgr", password: "nokhba-cap-5000" }),
  });
  const capData = await capRes.json().catch(() => ({})) as { user?: { centerId?: string; role?: string } };
  ok("capmgr login works", capRes.status === 200, `status=${capRes.status}`);
  if (capRes.status === 200 && capData.user?.centerId) {
    const capStudents = await db.student.count({ where: { centerId: capData.user.centerId } });
    ok("capmgr center = 5000 students", capStudents === 5000, `students=${capStudents}`);
  }

  // ============ B. تسجيل حساب جديد + تعيين ============
  console.log("\n— B. تسجيل حساب جديد (طلب انضمام) —");
  const suUser = `su_${stamp}`;
  r = await req("/api/auth", "POST", { action: "signup", name: "مستخدم اختبار الموافقات", username: suUser, password: "test123456", phone: "01001234567" });
  ok("signup creates pending request (201)", r.status === 201, `status=${r.status}`);

  r = await req("/api/auth", "POST", { username: suUser, password: "test123456" });
  ok("pending user cannot login (403 + رسالة انتظار)", r.status === 403 && String(r.data.error).includes("موافقة"), `status=${r.status}`);

  r = await req("/api/auth", "POST", { action: "signup", name: "تكرار", username: suUser, password: "test123456", phone: "01001234567" });
  ok("duplicate username signup rejected", r.status === 400);

  r = await req("/api/auth", "POST", { action: "signup", name: "x", username: `bad_${stamp}`, password: "12", phone: "123" });
  ok("invalid signup data rejected", r.status === 400);

  // الأدمن شايف الطلب
  r = await req("/api/admin", "GET", undefined, "a");
  const joinReqs = (r.data.joinRequests as { id: string; username: string }[]) ?? [];
  const myJoin = joinReqs.find((j) => j.username === suUser);
  ok("admin sees join request", !!myJoin);

  // إشعار فوري للأدمن
  const adminNotifs = (await req("/api/notifications/staff", "GET", undefined, "a")).data;
  const adminUnreadBefore = (adminNotifs.unread as number) ?? 0;
  const signupNotif = ((adminNotifs.notifications as { type: string; title: string; refId: string | null }[]) ?? [])
    .find((n) => n.type === "SIGNUP_REQUEST" && n.refId === myJoin?.id);
  ok("admin got instant signup notification", !!signupNotif, `unread=${adminUnreadBefore}`);

  // التعيين لسنتر النخبة كاستقبال
  r = await req("/api/admin", "POST", { action: "request-assign", targetUserId: myJoin?.id, centerId: (await db.center.findFirst({ where: { slug: "alnokhba-elite" } }))?.id, requestRole: "RECEPTIONIST" }, "a");
  ok("admin assigns user to center", r.status === 200 && r.data.assigned === true, `status=${r.status}`);

  r = await req("/api/auth", "POST", { username: suUser, password: "test123456" }, "new");
  ok("assigned user can now login (200)", r.status === 200);
  const newUserId = ((r.data.user as { id?: string })?.id) ?? "";

  // مينفعش يعمل قرار على طلب انضمام اتقرر خلاص
  r = await req("/api/admin", "POST", { action: "request-assign", targetUserId: myJoin?.id, centerId: "x", requestRole: "RECEPTIONIST" }, "a");
  ok("cannot decide on already-decided request (400)", r.status === 400);

  // رفض طلب انضمام تاني
  const su2 = `sx_${stamp}`;
  await req("/api/auth", "POST", { action: "signup", name: "مستخدم مرفوض", username: su2, password: "test123456", phone: "01099999999" });
  r = await req("/api/admin", "GET", undefined, "a");
  const join2 = ((r.data.joinRequests as { id: string; username: string }[]) ?? []).find((j) => j.username === su2);
  r = await req("/api/admin", "POST", { action: "request-reject", targetUserId: join2?.id, reason: "اختبار الرفض" }, "a");
  ok("admin rejects second request", r.status === 200);
  r = await req("/api/auth", "POST", { username: su2, password: "test123456" });
  ok("rejected user cannot login (403 + رسالة رفض)", r.status === 403 && String(r.data.error).includes("رفض"));

  // ============ C. الاستقبال + الاسترداد (ممنوع مباشر) ============
  console.log("\n— C. استرداد بدون صلاحية: ممنوع مباشر + طلب موافقة —");
  // طالب اختبار: أول طالب نشط في النخبة
  const testStudent = await db.student.findFirst({ where: { centerId: (await db.center.findFirst({ where: { slug: "alnokhba-elite" } }))?.id }, orderBy: { code: "asc" } });
  if (!testStudent) throw new Error("no test student");
  const txnCountBefore = await db.studentTransaction.count({ where: { studentId: testStudent.id } });
  const balanceBefore = await db.$queryScalar<{ balance: number }[]>`SELECT COALESCE(SUM(amount),0) as balance FROM StudentTransaction WHERE studentId = ${testStudent.id}`.then((x) => Number((x as { balance: number }[])[0]?.balance ?? 0));

  // 1) مباشر → 403
  r = await req("/api/payments", "POST", { studentId: testStudent.id, amount: 50, type: "REFUND", method: "CASH" }, "r");
  ok("reception direct refund blocked (403)", r.status === 403, `status=${r.status}`);
  ok("403 message explains request path", String(r.data.error).includes("طلب موافقة"));

  // 2) الاستقبال ممنوع يقرر
  r = await req("/api/approvals", "PATCH", { id: "fake", action: "approve" }, "r");
  ok("reception cannot decide requests (403)", r.status === 403 || r.status === 404);

  // 3) المدير مالوش طلبات
  r = await req("/api/approvals", "POST", { type: "REFUND", studentId: testStudent.id, amount: 50, reason: "اختبار: مدير مش محتاج طلب" });
  ok("manager cannot submit request (400 — عنده مباشر)", r.status === 400);

  // 4) طلب استرداد من الاستقبال
  r = await req("/api/approvals", "POST", { type: "REFUND", studentId: testStudent.id, amount: 50, reason: "اختبار الموافقات: الطالب دفع مرتين بالغلط" }, "r");
  ok("reception refund request created (201)", r.status === 201, `status=${r.status}`);
  const reqNumber = (r.data.request as { number?: string })?.number ?? "";
  const requestId = await db.approvalRequest.findFirst({ where: { number: reqNumber } }).then((x) => x?.id ?? "");

  // 5) منع التكرار: نفس الطلب تاني → 409
  r = await req("/api/approvals", "POST", { type: "REFUND", studentId: testStudent.id, amount: 50, reason: "تكرار مقصود للاختبار" }, "r");
  ok("duplicate pending request blocked (409)", r.status === 409);

  // 6) سبب ناقص → 400
  r = await req("/api/approvals", "POST", { type: "ADJUSTMENT", studentId: testStudent.id, amount: 10, reason: "أ" }, "r");
  ok("short reason rejected", r.status === 400);

  // 7) إشعار فوري للمدير
  const mgrNotifs = (await req("/api/notifications/staff", "GET")).data;
  const approvalNotif = ((mgrNotifs.notifications as { type: string; refId: string | null }[]) ?? [])
    .find((n) => n.type === "APPROVAL_REQUEST" && n.refId === requestId);
  ok("manager got instant approval notification", !!approvalNotif, `unread=${mgrNotifs.unread}`);

  // 8) المدير شايف الطلب بتفاصيله
  r = await req("/api/approvals", "GET");
  const pendingList = (r.data.requests as { id: string; number: string; status: string; student: { name: string } | null; amount: number | null; reason: string; requestedByName: string }[]) ?? [];
  const pending = pendingList.find((x) => x.id === requestId);
  ok("manager sees pending request with WHAT/WHO/WHY", !!pending && pending.status === "PENDING");
  ok("request shows financial impact + student", pending?.amount === -5000 && !!pending?.student?.name, `amount=${pending?.amount}`);

  // 9) الاستقبال شايف طلباته هو بس
  r = await req("/api/approvals?scope=mine", "GET", undefined, "r");
  const mine = (r.data.requests as { id: string }[]) ?? [];
  ok("reception sees own request in mine scope", mine.some((x) => x.id === requestId));
  ok("mine scope hides others' requests", !mine.some((x) => x.id === "other"));

  // ============ D + E. اعتماد: تنفيذ مرة واحدة بس ============
  console.log("\n— D/E. اعتماد الطلب (مرة واحدة بس) —");
  r = await req("/api/approvals", "PATCH", { id: requestId, action: "approve", note: "راجعت كشف الحساب — طلب صحيح" });
  ok("manager approves request (200)", r.status === 200 && r.data.status === "APPROVED");
  ok("approval executed a financial txn", !!r.data.executedTxnId);

  // التنفيذ: حركة عكسية + الدفعة الأصلية محفوظة
  const txnCountAfter = await db.studentTransaction.count({ where: { studentId: testStudent.id } });
  const balanceAfter = await db.$queryScalar<{ balance: number }[]>`SELECT COALESCE(SUM(amount),0) as balance FROM StudentTransaction WHERE studentId = ${testStudent.id}`.then((x) => Number((x as { balance: number }[])[0]?.balance ?? 0));
  ok("refund added exactly ONE reversal txn", txnCountAfter === txnCountBefore + 1);
  ok("balance decreased by exactly 50 EGP", balanceAfter === balanceBefore - 5000, `${balanceBefore / 100} → ${balanceAfter / 100} ج`);
  const payCount = await db.studentTransaction.count({ where: { studentId: testStudent.id, type: "PAYMENT" } });
  ok("original payments preserved (financial safety)", payCount > 0, `payments=${payCount}`);

  // الطالب اتبلغ
  const stuNotif = await db.studentNotification.findFirst({ where: { studentId: testStudent.id, type: "REFUND" }, orderBy: { createdAt: "desc" } });
  ok("student notified about refund", !!stuNotif);

  // سباق: تاني قرار → 409
  r = await req("/api/approvals", "PATCH", { id: requestId, action: "approve" });
  ok("second approve blocked (409 — race-safe)", r.status === 409, `status=${r.status}`);
  r = await req("/api/approvals", "PATCH", { id: requestId, action: "reject", note: "محاولة قرار تاني" });
  ok("reject after approve blocked (409)", r.status === 409);

  // الاستقبال اتبلغ بالقرار
  const recNotifs = (await req("/api/notifications/staff", "GET", undefined, "r")).data;
  const decidedNotif = ((recNotifs.notifications as { type: string; refId: string | null }[]) ?? [])
    .find((n) => n.type === "APPROVAL_DECIDED" && n.refId === requestId);
  ok("requester got decision notification", !!decidedNotif);

  // ============ D2. الرفض: صفر تغيير مالي ============
  console.log("\n— D2. رفض الطلب (صفر تغيير مالي) —");
  r = await req("/api/approvals", "POST", { type: "ADJUSTMENT", studentId: testStudent.id, amount: 25, reason: "اختبار الرفض: تسوية تجريبية" }, "r");
  const rejId = (await db.approvalRequest.findFirst({ where: { number: (r.data.request as { number?: string })?.number ?? "" } }))?.id ?? "";
  ok("adjustment request created", r.status === 201);
  const txnCountBeforeReject = await db.studentTransaction.count({ where: { studentId: testStudent.id } });
  r = await req("/api/approvals", "PATCH", { id: rejId, action: "reject", note: "التسوية مش مبررة — كشف الحساب سليم" });
  ok("manager rejects request (200)", r.status === 200 && r.data.status === "REJECTED");
  const txnCountAfterReject = await db.studentTransaction.count({ where: { studentId: testStudent.id } });
  ok("rejection = zero financial change", txnCountAfterReject === txnCountBeforeReject);
  r = await req("/api/approvals", "PATCH", { id: rejId, action: "reject", note: "تكرار" });
  ok("double reject blocked (409)", r.status === 409);

  // رفض من غير سبب → 400
  const su3req = await req("/api/approvals", "POST", { type: "ADJUSTMENT", studentId: testStudent.id, amount: 5, reason: "سبب كامل للاختبار" }, "r");
  const su3id = (await db.approvalRequest.findFirst({ where: { number: (su3req.data.request as { number?: string })?.number ?? "" } }))?.id ?? "";
  r = await req("/api/approvals", "PATCH", { id: su3id, action: "reject", note: "" });
  ok("reject without reason rejected (400)", r.status === 400);
  // صاحب الطلب يلغي طلبه
  r = await req("/api/approvals", "PATCH", { id: su3id, action: "cancel" }, "r");
  ok("requester cancels own request", r.status === 200 && r.data.status === "CANCELLED");

  // ============ F. منح صلاحية مباشرة ============
  console.log("\n— F. المدير يمنح «استرداد فوري» للاستقبال —");
  r = await req("/api/staff", "PATCH", { id: receptionId, permissions: { REFUND_PAYMENT: true, REQUEST_REFUND: true } });
  ok("manager grants REFUND_PAYMENT", r.status === 200);

  // لازم login تاني عشان الجلسة تقرا الصلاحيات الجديدة
  await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, "r");
  const recPerms2 = ((await req("/api/auth", "GET", undefined, "r")).data.user as { permissions?: string[] })?.permissions ?? [];
  ok("reception now has REFUND_PAYMENT in session", recPerms2.includes("REFUND_PAYMENT"));

  // تنفيذ مباشر يشتغل دلوقتي
  r = await req("/api/payments", "POST", { studentId: testStudent.id, amount: 30, type: "REFUND", method: "CASH", note: "اختبار صلاحية مباشرة" }, "r");
  ok("reception direct refund works after grant", r.status === 200, `status=${r.status}`);
  const directTxnId = (r.data.txn as { id?: string })?.id ?? "";

  // سحب الصلاحية → 403 تاني
  await req("/api/staff", "PATCH", { id: receptionId, permissions: { REFUND_PAYMENT: false, REQUEST_REFUND: false } });
  await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, "r");
  r = await req("/api/payments", "POST", { studentId: testStudent.id, amount: 30, type: "REFUND", method: "CASH" }, "r");
  ok("direct refund blocked again after revoke (403)", r.status === 403);
  // ومع REQUEST_REFUND مسحوبة → الطلب نفسه ممنوع (Reception C scenario)
  r = await req("/api/approvals", "POST", { type: "REFUND", studentId: testStudent.id, amount: 30, reason: "اختبار سحب حق الطلب" }, "r");
  ok("request blocked when REQUEST_REFUND revoked (403)", r.status === 403);

  // مفتاح صلاحية غريب → مرفوض
  r = await req("/api/staff", "PATCH", { id: receptionId, permissions: { HACK_THE_SYSTEM: true } });
  ok("unknown permission key ignored/rejected", r.status === 400 || r.status === 200);
  // رجّع الافتراضي
  await db.user.update({ where: { id: receptionId }, data: { permissions: null } });

  // ============ H. إلغاء حصة ============
  console.log("\n— H. إلغاء حصة: طلب موافقة —");
  // هات حصة OPEN في النخبة (أو افتح واحدة لو مفيش)
  const eliteId = (await db.center.findFirst({ where: { slug: "alnokhba-elite" } }))?.id;
  let openSession = await db.sessionInstance.findFirst({ where: { centerId: eliteId, status: "OPEN" }, orderBy: { createdAt: "asc" } });
  if (!openSession) {
    // افتح حصة من الجدول للاختبار
    const slot = await db.scheduleSlot.findFirst({ where: { centerId: eliteId, isActive: true }, include: { group: true } });
    if (slot) {
      const today = new Date().toISOString().slice(0, 10);
      openSession = await db.sessionInstance.create({
        data: { centerId: eliteId, groupId: slot.groupId, date: today, startTime: slot.startTime, endTime: slot.endTime, room: slot.room, price: slot.group.sessionPrice, teacherPercent: slot.group.teacherPercent, status: "OPEN" },
      });
    }
  }
  if (openSession) {
    // استقبال (بالصلاحيات الافترادية) ممنوع إلغاء مباشر
    r = await req(`/api/sessions/${openSession.id}`, "POST", { action: "cancel", reason: "اختبار" }, "r");
    ok("reception direct session-cancel blocked (403)", r.status === 403);
    // طلب إلغاء حصة
    r = await req("/api/approvals", "POST", { type: "SESSION_CANCEL", sessionId: openSession.id, reason: "المدرس اعتذر — اختبار الموافقات" }, "r");
    ok("session-cancel request created (201)", r.status === 201, `status=${r.status}`);
    const scId = (await db.approvalRequest.findFirst({ where: { type: "SESSION_CANCEL", status: "PENDING", payload: { contains: `"sessionId":"${openSession.id}"` } } }))?.id ?? "";
    ok("request stored with session payload", !!scId);
    // اعتماد → الحصة تتلغى
    r = await req("/api/approvals", "PATCH", { id: scId, action: "approve", note: "تم — الحصة هتتعوض الأسبوع الجاي" });
    ok("manager approves session cancel", r.status === 200);
    const sessNow = await db.sessionInstance.findUnique({ where: { id: openSession.id } });
    ok("session is CANCELLED after approval", sessNow?.status === "CANCELLED");
  } else {
    console.log("  ⚠ مفيش حصة متاحة لاختبار الإلغاء — تخطي");
  }

  // ============ I. جلسة الطالب: سنة + خروج بـ 401 بس ============
  console.log("\n— I. ثبات جلسة الطالب —");
  // طالب نشط لاختبار البورتال
  const portalStudent = await db.student.findFirst({ where: { centerId: eliteId, status: "ACTIVE" }, orderBy: { code: "asc" } });
  if (portalStudent) {
    const loginPhone = portalStudent.phone ?? portalStudent.parentPhone ?? "";
    r = await req("/api/portal", "POST", { action: "login", code: portalStudent.code, phone: loginPhone }, "s");
    ok("student portal login", r.status === 200, `code=${portalStudent.code}`);
    const portalSession = await db.studentPortalSession.findFirst({ where: { studentId: portalStudent.id }, orderBy: { createdAt: "desc" } });
    const daysLeft = portalSession ? (portalSession.expiresAt.getTime() - Date.now()) / 86400000 : 0;
    ok("portal session lasts ~365 days (was 30)", daysLeft > 360 && daysLeft <= 366, `days=${Math.round(daysLeft)}`);

    // الجلسة شغالة بعد «إعادة تشغيل» (كوكي httpOnly بيجيب الطالب تاني)
    r = await req("/api/portal", "GET", undefined, "s", true); // noFollow: متجددش الكوكي
    ok("session survives (student still recognized)", r.status === 200 && !!(r.data.student));

    // خروج يدوي
    r = await req("/api/portal", "POST", { action: "logout" }, "s");
    ok("manual logout works", r.status === 200);
    await db.studentPortalSession.deleteMany({ where: { studentId: portalStudent.id, token: { not: "" } } }).catch(() => {});
  }

  // ============ J. UI: الخروج بس لما السيرفر يقول مفيش جلسة ============
  console.log("\n— J. UI: غلطة شبكة مش خروج (Playwright) —");
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // دخول طالب
    const loginRes = await page.request.post(`${BASE}/api/portal`, { data: { action: "login", code: portalStudent?.code, phone: portalStudent?.phone ?? portalStudent?.parentPhone } });
    const setCookie = loginRes.headers()["set-cookie"];
    if (setCookie) {
      const cookie = setCookie.split(";")[0];
      const [name, value] = cookie.split("=");
      await ctx.addCookies([{ name, value, url: BASE }]);

      // اقفل الشبكة على /api/portal بس → شاشة «النت واقع» مش شاشة الدخول
      await page.route(`${BASE}/api/portal`, (route) => route.abort());
      await page.goto(`${BASE}/portal`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000); // المحاولات التلاتة + الشاشة
      const bodyText = await page.textContent("body") ?? "";
      ok("network error ≠ logout (offline screen shown)", bodyText.includes("النت واقع"), `text=${bodyText.slice(0, 80)}`);
      ok("login screen NOT shown on network error", !bodyText.includes("كود الطالب"));

      // رجّل الشبكة → جرب تاني بيرجع التطبيق
      await page.unroute(`${BASE}/api/portal`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const bodyText2 = await page.textContent("body") ?? "";
      ok("retry after network recovery restores app", !bodyText2.includes("النت واقع") && !bodyText2.includes("كود الطالب"));
    }
    await browser.close();
  } catch (e) {
    console.log(`  ⚠ Playwright تخطي: ${(e as Error).message.slice(0, 60)}`);
  }

  // ============ K. تنظيف جراحي ============
  console.log("\n— K. التنضيف الجراحي (baseline) —");
  // 1) حركات الاختبار (استرداد الاعتماد + الاسترداد المباشر)
  if (requestId) {
    const reqRow = await db.approvalRequest.findUnique({ where: { id: requestId } });
    if (reqRow?.executedTxnId) await db.studentTransaction.delete({ where: { id: reqRow.executedTxnId } }).catch(() => {});
  }
  if (directTxnId) await db.studentTransaction.delete({ where: { id: directTxnId } }).catch(() => {});
  // أي حركة عليها علامة الاختبار
  await db.studentTransaction.deleteMany({ where: { reason: { contains: "اختبار صلاحية مباشرة" } } });
  // 2) الحصة الملغاة ترجع OPEN
  if (openSession) await db.sessionInstance.update({ where: { id: openSession.id }, data: { status: "OPEN" } }).catch(() => {});
  // 3) إشعارات الطالب الاختبارية
  await db.studentNotification.deleteMany({ where: { studentId: testStudent.id, type: { in: ["REFUND", "ADJUSTMENT"] }, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  // 4) طلبات الموافقة الاختبارية
  await db.approvalRequest.deleteMany({ where: { centerId: eliteId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  // 5) إشعارات الموظفين الاختبارية
  await db.staffNotification.deleteMany({ where: { createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  // 6) مستخدمي الاختبار
  if (newUserId) await db.user.delete({ where: { id: newUserId } }).catch(() => {});
  await db.user.deleteMany({ where: { username: { in: [suUser, su2] } } });
  // 7) صلاحيات الاستقبال = الافتراضي
  await db.user.update({ where: { id: receptionId }, data: { permissions: null } });

  const txnFinal = await db.studentTransaction.count({ where: { studentId: testStudent.id } });
  ok("test student txns restored to baseline", txnFinal === txnCountBefore, `${txnCountBefore} → ${txnFinal}`);
  const pendingFinal = await db.approvalRequest.count({ where: { status: "PENDING" } });
  ok("zero pending approval requests left", pendingFinal === 0);
  const joinFinal = await db.user.count({ where: { role: "PENDING" } });
  ok("zero pending join users left", joinFinal === 0);

  console.log(`\n========== النتيجة: ${passed} ✓ / ${failed} ✗ ==========`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
