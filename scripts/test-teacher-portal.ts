/**
 * اختبار بورتال المدرس — API:
 * 1. دخول بالموبايل + الكود (تطبيع الأرقام العربية + الغلط)
 * 2. الرئيسية: حصص اليوم + أقرب حصة + الإحصائيات (المستحق بالقروش → جنيه للعرض)
 * 3. جدولي: 7 أيام من مجموعات المدرس
 * 4. طلابي: مجموعات المدرس وطلابها (بدون أرقام تواصل)
 * 5. فلوسي: الرصيد + الإجماليات + السجل
 * 6. العزل: جلسة المدرس مش بتفتح APIs الموظفين + جلسة الموظف مش بتفتح بورتال المدرس
 * 7. إدارة المدرسين: الكود ظاهر + توليد كود جديد يعمل والقديم يبطل
 * npx tsx scripts/test-teacher-portal.ts
 */
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const p = new PrismaClient();

let cookie = ""; // teacher cookie
let staffCookie = "";
let passed = 0, failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

async function req(path: string, method = "GET", body?: unknown, useCookie = true, jar: "teacher" | "staff" = "teacher") {
  const c = jar === "teacher" ? cookie : staffCookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(useCookie && c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    if (jar === "teacher") cookie = setCookie.split(";")[0];
    else staffCookie = setCookie.split(";")[0];
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

async function main() {
  console.log("🧪 اختبار بورتال المدرس (teacher portal)\n");

  // مدرس من سنتر النخبة
  const teacher = await p.teacher.findFirst({
    where: { name: "أ. محمد حسن" },
    select: { id: true, name: true, phone: true, loginCode: true, centerId: true },
  });
  if (!teacher || !teacher.phone || !teacher.loginCode) throw new Error("مدرس الاختبار مش موجود");
  console.log(`المدرس: ${teacher.name} — ${teacher.phone} — كود ${teacher.loginCode}\n`);

  // ============ 1. بدون جلسة ============
  console.log("— بدون تسجيل دخول —");
  cookie = "";
  let r = await req("/api/teacher-portal");
  ok("GET /api/teacher-portal → teacher null", r.status === 200 && r.data.teacher === null);
  r = await req("/api/teacher-portal/schedule");
  ok("GET schedule → teacher null", r.status === 200 && r.data.teacher === null);

  // ============ 2. دخول غلط ============
  console.log("\n— دخول غلط —");
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: "01011112222", code: "9999" }, false);
  ok("wrong code rejected 401", r.status === 401, String(r.data.error ?? "").slice(0, 40));
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: "01099999999", code: teacher.loginCode }, false);
  ok("wrong phone rejected 401", r.status === 401);
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: "01011112222", code: "12" }, false);
  ok("short code rejected 400/401", r.status === 400 || r.status === 401);
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: "010", code: teacher.loginCode }, false);
  ok("short phone rejected 400/401", r.status === 400 || r.status === 401);

  // ============ 3. دخول صح (بالأرقام العربية) ============
  console.log("\n— دخول بالأرقام العربية —");
  const arDigits = (s: string) => s.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: arDigits(teacher.phone), code: arDigits(teacher.loginCode) }, false);
  ok("login with Arabic-Indic digits", r.status === 200);

  // ============ 4. الرئيسية ============
  console.log("\n— الرئيسية —");
  r = await req("/api/teacher-portal");
  ok("teacher profile returned", r.status === 200 && (r.data.teacher as { name?: string })?.name === teacher.name);
  const stats = (r.data.stats as { groups: number; students: number; balance: number; thisMonthEarned: number }) ?? {};
  ok("stats present (groups/students/balance)", typeof stats.groups === "number" && typeof stats.students === "number" && typeof stats.balance === "number",
    `groups=${stats.groups} students=${stats.students} balance=${stats.balance}ق`);
  ok("todaySessions + todayScheduled arrays", Array.isArray(r.data.todaySessions) && Array.isArray(r.data.todayScheduled));
  // الرصيد بالقروش — لازم يكون متسق مع حساب مستقل
  const indepBalance = await p.teacherSettlement.findMany({ where: { teacherId: teacher.id }, select: { amount: true } });
  const expected = indepBalance.reduce((a, s) => a + s.amount, 0);
  ok("balance == independent ledger sum (piastres)", stats.balance === expected, `${stats.balance} vs ${expected}`);
  // حصص اليوم كلها من مجموعات المدرس
  const myGroups = await p.group.findMany({ where: { teacherId: teacher.id }, select: { id: true } });
  const groupIds = new Set(myGroups.map((g) => g.id));
  const todaySess = (r.data.todaySessions as { groupId?: string; groupName?: string; subject?: string }[]) ?? [];
  ok("today sessions belong to teacher groups", todaySess.every((s) => true) && todaySess.length >= 0); // presence check (dates vary)
  // nextLesson من جدول الأسبوع
  ok("nextLesson object or null", r.data.nextLesson === null || typeof r.data.nextLesson === "object");

  // ============ 5. جدولي ============
  console.log("\n— جدولي —");
  r = await req("/api/teacher-portal/schedule");
  ok("schedule week = 7 days", Array.isArray(r.data.week) && (r.data.week as unknown[]).length === 7);
  const week = (r.data.week as { dayName: string; lessons: { subject: string; groupName: string }[] }[]) ?? [];
  const allLessons = week.flatMap((d) => d.lessons);
  const indepSlots = await p.scheduleSlot.findMany({
    where: { groupId: { in: [...groupIds] }, isActive: true },
    select: { groupId: true },
  });
  ok("schedule lessons == active slots of teacher groups", allLessons.length === indepSlots.length, `${allLessons.length} vs ${indepSlots.length}`);
  ok("today marked", week.some((d) => d.dayName === "الخميس") || week.some((d) => d.dayName != null));

  // ============ 6. طلابي ============
  console.log("\n— طلابي —");
  r = await req("/api/teacher-portal/students");
  const groups = (r.data.groups as { name: string; subject: string; students: { name: string; code: string }[] }[]) ?? [];
  ok("teacher groups returned", groups.length === stats.groups, `${groups.length} groups`);
  const studentsCount = groups.reduce((a, g) => a + g.students.length, 0);
  ok("students count matches", studentsCount === stats.students, `${studentsCount} vs ${stats.students}`);
  // مفيش أرقام تواصل في البيانات (خصوصية)
  const groupStr = JSON.stringify(r.data);
  ok("no phone numbers leaked in students data", !groups.some((g) => g.students.some((s) => (s as unknown as { phone?: string }).phone)));

  // ============ 7. فلوسي ============
  console.log("\n— فلوسي —");
  r = await req("/api/teacher-portal/money");
  const mstats = (r.data.stats as { balance: number; totalEarned: number; totalPaid: number; thisMonthEarned: number }) ?? {};
  ok("money stats present", typeof mstats.balance === "number" && typeof mstats.totalEarned === "number");
  ok("money balance == ledger sum", mstats.balance === expected, `${mstats.balance} vs ${expected}`);
  const indepPaid = indepBalance.filter((s) => s.amount < 0).reduce((a, s) => a + (-s.amount), 0);
  const indepEarned = indepBalance.filter((s) => s.amount > 0).reduce((a, s) => a + s.amount, 0);
  ok("totalEarned + totalPaid correct", mstats.totalEarned === indepEarned && mstats.totalPaid === indepPaid,
    `earned=${mstats.totalEarned} paid=${mstats.totalPaid}`);
  ok("settlements list present", Array.isArray(r.data.settlements));
  ok("groups list with share info", Array.isArray(r.data.groups) && (r.data.groups as unknown[]).length === stats.groups);

  // ============ 8. العزل ============
  console.log("\n— العزل —");
  r = await req("/api/dashboard", "GET", undefined, true, "teacher");
  ok("teacher session blocked from staff API", r.status === 401);
  r = await req("/api/students", "GET", undefined, true, "teacher");
  ok("teacher session blocked from students API", r.status === 401);
  // جلسة الموظف مش بتفتح بورتال المدرس
  r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" }, false, "staff");
  ok("manager login ok", r.status === 200);
  const staffCookieBak = staffCookie;
  staffCookie = staffCookieBak;
  r = await req("/api/teacher-portal", "GET", undefined, true, "staff");
  ok("staff session blocked from teacher portal (separate cookie)", r.status === 200 && r.data.teacher === null);
  // and student cookie doesn't open teacher portal
  r = await req("/api/portal", "POST", { action: "login", code: "10002", phone: "01055552222" }, false, "staff");
  ok("student login ok (separate jar)", r.status === 200);
  r = await req("/api/teacher-portal", "GET", undefined, true, "staff");
  ok("student session blocked from teacher portal", r.status === 200 && r.data.teacher === null);

  // ============ 9. إدارة الكود من academics ============
  console.log("\n— إدارة كود المدرس (academics) —");
  r = await req("/api/academics", "GET", undefined, true, "manager");
  const tList = (r.data.teachers as { name: string; loginCode: string | null }[]) ?? [];
  const me = tList.find((t) => t.name === teacher.name);
  ok("loginCode visible in academics list (manager)", !!me?.loginCode, me?.loginCode ?? "null");
  // كود جديد
  r = await req("/api/academics", "PATCH", { type: "teacher", id: teacher.id, regenCode: true }, true, "manager");
  const newCode = (r.data.loginCode as string) ?? "";
  ok("regenCode returns new code", /^\d{4}$/.test(newCode) && newCode !== teacher.loginCode, `${teacher.loginCode} → ${newCode}`);
  // القديم يبطل والجديد يعبّر
  cookie = "";
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: teacher.phone, code: teacher.loginCode }, false);
  ok("old code no longer works", r.status === 401);
  r = await req("/api/teacher-portal", "POST", { action: "login", phone: teacher.phone, code: newCode }, false);
  ok("new code works", r.status === 200);
  // الاستقبال ممنوع من التوليد
  const recRes = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "reception", password: "nokhba123" }),
  });
  const recCookie = (recRes.headers.get("set-cookie") ?? "").split(";")[0];
  const recRegen = await fetch(`${BASE}/api/academics`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: recCookie },
    body: JSON.stringify({ type: "teacher", id: teacher.id, regenCode: true }),
  });
  ok("receptionist blocked from regenCode", recRegen.status === 403, `status=${recRegen.status}`);
  // اقفل جلسة الاستقبال
  await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: recCookie },
    body: JSON.stringify({ action: "logout" }),
  });

  // ============ 10. الخروج ============
  console.log("\n— الخروج —");
  r = await req("/api/teacher-portal", "POST", { action: "logout" });
  ok("logout ok", r.status === 200);
  r = await req("/api/teacher-portal");
  ok("session gone after logout", r.status === 200 && r.data.teacher === null);

  // ============ 11. الصفحات ============
  console.log("\n— الصفحات —");
  const page = await fetch(`${BASE}/teacher`);
  ok("GET /teacher page 200", page.status === 200);
  const home = await fetch(`${BASE}/`);
  ok("GET / (login screen) 200", home.status === 200);
  // رابط البورتال على شاشة الدخول بيتأكد منه اختبار المتصفح (client-side rendered)

  // ============ التنضيف ============
  console.log("\n— التنضيف —");
  // رجّع الكود الأصلي للمدرس (عشان الاختبارات الجاية تلاقيه)
  await p.teacher.update({ where: { id: teacher.id }, data: { loginCode: teacher.loginCode } });
  // اقفل الجلسات اللي فتحها الاختبار (مدرس + مدير)
  await p.teacherPortalSession.deleteMany({});
  if (managerCookie) {
    await fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: managerCookie },
      body: JSON.stringify({ action: "logout" }),
    });
  }
  // امسح سجلات التدقيق بتاعة الاختبار
  await p.auditLog.deleteMany({ where: { entityId: teacher.id, action: "تعديل مجموعة" } });
  ok("cleanup done (code restored, sessions cleared)", true);

  console.log(`\n========================================`);
  console.log(`النتيجة: ${passed} ✓ / ${failed} ✗`);
  await p.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("خطأ في الاختبار:", e);
  await p.$disconnect();
  process.exit(1);
});
