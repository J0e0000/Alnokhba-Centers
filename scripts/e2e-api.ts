/**
 * Nokhba Centers — end-to-end API workflow test.
 * Exercises the full receptionist + manager + admin journeys against the running dev server.
 * Run: bun /home/z/my-project/scripts/e2e-api.ts
 */
const BASE = "http://localhost:3000";
let cookie = "";
let passed = 0, failed = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra)?.slice(0, 300) : ""); }
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data: any = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) data = await res.json().catch(() => null);
  else data = await res.text().catch(() => null);
  return { status: res.status, data };
}

// ================= 1. AUTH =================
console.log("\n[1] المصادقة");
let r = await req("POST", "/api/auth", { username: "manager", password: "nokhba123" });
check("مدير يسجل دخول", r.status === 200 && r.data?.user?.role === "MANAGER");
r = await req("POST", "/api/auth", { username: "manager", password: "wrong" });
check("باسورد غلط يترفض برسالة عربية", r.status === 401 && /غلط/.test(r.data?.error ?? ""));

// ================= 2. DASHBOARD =================
console.log("\n[2] الداشبورد");
r = await req("GET", "/api/dashboard");
check("داشبورد المدير يرجع بيانات", r.status === 200 && Array.isArray(r.data?.sessions));
check("إحصائيات مالية موجودة", r.data?.stats && typeof r.data.stats.collectedToday === "number");
check("صندوق اليوم متوقع", typeof r.data?.cash?.expected === "number");

// ================= 3. ARABIC DIGITS NORMALIZATION =================
console.log("\n[3] تطبيع الأرقام العربية");
r = await req("GET", "/api/lookup?q=" + encodeURIComponent("١٠٠٠١"));
check("٥ أرقام عربية → طالب يتلاقى", r.status === 200 && r.data?.students?.length >= 1, r.data);
r = await req("GET", "/api/lookup?q=" + encodeURIComponent("يوسف"));
check("البحث بالاسم شغال", r.data?.students?.length >= 1);

// ================= 4. STUDENT REGISTRATION + VALIDATION =================
console.log("\n[4] تسجيل طالب جديد");
r = await req("POST", "/api/students", { name: "تست", phone: "123", parentName: "", parentPhone: "" });
check("بيانات ناقصة تترفض برسالة عربية", r.status === 400 && /اسم الطالب/.test(r.data?.error ?? ""), r.data?.error);
r = await req("POST", "/api/students", { name: "محمود سيد إبراهيم", phone: "٠١٢٣٤٥٦٧٨٩٠", parentName: "سيد إبراهيم", parentPhone: "01098765432", gradeId: "wrong", groupIds: [] });
check("موبايل بأرقام عربية يتقبل بعد التطبيع + مرحلة غلط تترفض", r.status === 400 && /المرحلة/.test(r.data?.error ?? ""), r.data?.error);

// fetch real grade + groups first
r = await req("GET", "/api/academics");
const gradeId = r.data?.grades?.[1]?.id;
const groups: any[] = r.data?.groups ?? [];
const physicsGroup = groups.find((g: any) => g.subject === "فيزياء");
const chemistryGroup = groups.find((g: any) => g.subject === "كيمياء");

r = await req("POST", "/api/students", {
  name: "محمود سيد إبراهيم",
  phone: "٠١٢٣٤٥٦٧٨٩٠", // Arabic-Indic digits
  parentName: "سيد إبراهيم",
  parentPhone: "+201098765432",
  gradeId, groupIds: [physicsGroup?.id, chemistryGroup?.id].filter(Boolean),
  school: "مدرسة الاختبار",
});
check("طالب جديد يتسجل بأرقام عربية في الموبايل", r.status === 201 && /^\d{5}$/.test(r.data?.student?.code ?? ""), r.data);
const newStudentId = r.data?.student?.id;
const newStudentCode = r.data?.student?.code;

// duplicate code rejected
r = await req("POST", "/api/students", {
  name: "طالب تاني للاختبار", phone: "01111111111", parentName: "ولي أمر", parentPhone: "01111111112",
  gradeId, groupIds: [], code: newStudentCode,
});
check("كود مكرر يترفض", r.status === 400 && /مستخدم/.test(r.data?.error ?? ""), r.data?.error);

r = await req("POST", "/api/students", {
  name: "طالب بكود غلط", phone: "01111111111", parentName: "ولي أمر", parentPhone: "01111111112",
  gradeId, groupIds: [], code: "١٢٣٤",
});
check("كود أقل من 5 أرقام يترفض", r.status === 400 && /5 أرقام/.test(r.data?.error ?? ""), r.data?.error);

// ================= 5. SCAN FLOWS =================
console.log("\n[5] المسح (QR / كود)");
r = await req("GET", "/api/sessions");
const openSession = r.data?.sessions?.find((s: any) => s.status === "OPEN");
check("في حصة مفتوحة النهاردة", !!openSession, r.data?.sessions?.map((s: any) => s.status));

// student registered in the open session's group?
const sessionSubject = openSession?.subject;
const registeredInSession = await req("GET", `/api/students?q=${newStudentCode}`);
const studentGroups: string[] = registeredInSession.data?.students?.[0]?.subjects ?? [];
const isRegistered = studentGroups.includes(sessionSubject);

r = await req("POST", "/api/attendance/scan", { query: newStudentCode, sessionId: openSession.id });
check(
  isRegistered ? "طالب مسجل → أخضر" : "طالب مش مسجل في المجموعة → برتقالي",
  r.data?.status === (isRegistered ? "GREEN" : "ORANGE"),
  { got: r.data?.status, studentGroups, sessionSubject }
);
check("الرصيد والمطلوب بيتحسبوا", typeof r.data?.balance === "number");

// RED: nonexistent student
r = await req("POST", "/api/attendance/scan", { query: "99999", sessionId: openSession.id });
check("طالب مش موجود → أحمر", r.data?.status === "RED" && /مش موجود/.test(r.data?.message ?? ""));

// wrong-length code
r = await req("POST", "/api/attendance/scan", { query: "١٢٣", sessionId: openSession.id });
check("كود ٣ أرقام يترفض برسالة واضحة", r.data?.status === "RED" && /5 أرقام/.test(r.data?.message ?? ""), r.data?.message);

// ================= 6. ATTENDANCE + PAYMENT =================
console.log("\n[6] الحضور والدفع");
if (isRegistered) {
  r = await req("POST", "/api/attendance/mark", { studentId: newStudentId, sessionId: openSession.id, status: "PRESENT" });
  check("حضور يتسجل + charge بيتحسب", r.status === 200 && typeof r.data?.balance === "number", r.data);
  const balanceAfterCharge = r.data?.balance;
  check("الرصيد بقى عليه (سالب)", balanceAfterCharge < 0, { balanceAfterCharge });

  // duplicate attendance = idempotent
  r = await req("POST", "/api/attendance/mark", { studentId: newStudentId, sessionId: openSession.id, status: "PRESENT" });
  check("تكرار الحضور مش بيعمل charge تاني", r.status === 200 && r.data?.alreadyAttended === true, r.data);

  // payment less than due → remaining
  r = await req("POST", "/api/payments", { studentId: newStudentId, amount: 20, method: "CASH", sessionId: openSession.id });
  check("دفع أقل من المطلوب → يظهر المتبقي", r.status === 200 && /المطلوب من الطالب/.test(r.data?.message ?? ""), r.data);

  // payment more than due → credit
  r = await req("POST", "/api/payments", { studentId: newStudentId, amount: 200, method: "VODAFONE", sessionId: openSession.id });
  check("دفع زيادة → رصيد للطالب", r.status === 200 && /رصيد الطالب/.test(r.data?.message ?? ""), r.data);
  check("الرصيد بقى موجب (للطالب)", (r.data?.balance ?? 0) > 0, r.data?.balance);
}

// ================= 7. CLOSE SESSION =================
console.log("\n[7] قفل الحصة");
// find/create an open session for closing test — use a fresh ad-hoc session on a group
r = await req("GET", "/api/schedule");
const someGroup = r.data?.groups?.[0];
r = await req("POST", "/api/sessions", { groupId: someGroup?.id, startTime: "22:00", endTime: "23:00", room: "قاعة الاختبار" });
check("حصة ad-hoc تتفتح", r.status === 201, r.data);
const testSessionId = r.data?.session?.id;

// register test student into that group + attend
await req("POST", "/api/attendance/mark", { studentId: newStudentId, sessionId: testSessionId, status: "PRESENT", registerGroup: true });
r = await req("GET", `/api/sessions/${testSessionId}`);
const econ = r.data?.economics;
check("اقتصاديات الحصة بتتحسب", econ && econ.presentCount >= 1 && econ.totalRevenue > 0, econ);

r = await req("POST", `/api/sessions/${testSessionId}`, { action: "close" });
check("قفل الحصة يسجل نصيب مدرس وسنتر", r.status === 200 && r.data?.economics?.teacherShare > 0 && r.data?.economics?.centerShare > 0, r.data);
const teacherShare = r.data?.economics?.teacherShare;
const centerShare = r.data?.economics?.centerShare;
check("نصيب المدرس + السنتر = الإيراد", teacherShare + centerShare === r.data?.economics?.totalRevenue);

// attendance on closed session rejected
r = await req("POST", "/api/attendance/mark", { studentId: newStudentId, sessionId: testSessionId, status: "PRESENT" });
check("حضور على حصة مقفولة يترفض", r.status === 400 && /مقفولة/.test(r.data?.error ?? ""), r.data?.error);

// manager reopen with reason
r = await req("POST", `/api/sessions/${testSessionId}`, { action: "reopen", reason: "اختبار إعادة الفتح" });
check("المدير يعيد فتح حصة بسبب مسجل", r.status === 200, r.data);

// receptionist cannot reopen
const managerCookie = cookie;
await req("POST", "/api/auth", { username: "reception", password: "nokhba123" });
r = await req("POST", `/api/sessions/${testSessionId}`, { action: "close" });
check("الموظف يقفل الحصة (مسموح)", r.status === 200, r.data);
r = await req("POST", `/api/sessions/${testSessionId}`, { action: "reopen", reason: "محاولة موظف" });
check("الموظف مينفعش يفتح حصة مقفولة", r.status === 403, r.data);
cookie = managerCookie;

// ================= 8. PERMISSIONS =================
console.log("\n[8] الصلاحيات");
await req("POST", "/api/auth", { username: "reception2", password: "nokhba123" }); // canAddStudents=false
r = await req("POST", "/api/students", { name: "طالب ممنوع إضافته", phone: "01000000000", parentName: "ولي", parentPhone: "01000000001", gradeId, groupIds: [] });
check("موظف من غير صلاحية إضافة يترفض", r.status === 403, r.data);
r = await req("POST", "/api/accounting", { action: "add-expense", amount: 100, category: "OTHER" });
check("الموظف مينفعش يضيف مصروف", r.status === 403);
r = await req("POST", "/api/payments", { studentId: newStudentId, amount: 50, type: "REFUND" });
check("الموظف مينفعش يعمل استرداد", r.status === 403);
r = await req("PATCH", "/api/settings", { name: "محاولة تغيير" });
check("الموظف مينفعش يغير هوية السنتر", r.status === 403);
cookie = managerCookie;

// ================= 9. TENANT ISOLATION =================
console.log("\n[9] عزل السنترات");
r = await req("GET", "/api/students?q=");
const center1Count = r.data?.total ?? 0;
r = await req("GET", `/api/students/${newStudentId}`);
check("المدير يشوف طالب سنتره", r.status === 200);
// try accessing center-2 student from center-1 session — fetch one via manager2
const managerCookieSave = cookie;
await req("POST", "/api/auth", { username: "manager2", password: "nokhba123" });
r = await req("GET", "/api/students?q=");
const center2First = r.data?.students?.[0];
const center2Count = r.data?.total ?? 0;
check("مدير السنتر التاني يشوف طلابه بس", center2Count > 0 && center2Count < center1Count, { center1Count, center2Count });
r = await req("GET", `/api/students/${newStudentId}`);
check("مدير سنتر مينفعش يشوف طالب سنتر تاني (404)", r.status === 404, r.status);
r = await req("GET", "/api/accounting");
check("حسابات سنتر 2 معزولة (مفيش إيراد سنتر 1)", (r.data?.journal ?? []).length === 0, (r.data?.journal ?? []).length);
cookie = managerCookieSave;

// ================= 10. ACCOUNTING =================
console.log("\n[10] الحسابات");
r = await req("POST", "/api/accounting", { action: "add-expense", amount: 250, category: "SUPPLIES", note: "اختبار مصروف" });
check("مصروف يتسجل", r.status === 201);
r = await req("POST", "/api/accounting", { action: "add-expense", amount: -50, category: "OTHER" });
check("مصروف بالسالب يترفض", r.status === 400);

r = await req("GET", "/api/accounting?section=settlements");
const teacher = r.data?.settlements?.find((t: any) => t.payable > 0);
check("في مدرس ليه مستحقات", !!teacher, r.data?.settlements);
if (teacher) {
  r = await req("POST", "/api/accounting", { action: "pay-teacher", teacherId: teacher.teacherId, amount: teacher.payable + 100000 });
  check("صرف أكتر من المستحق يترفض", r.status === 400, r.data);
  r = await req("POST", "/api/accounting", { action: "pay-teacher", teacherId: teacher.teacherId, amount: 100 });
  check("صرف مستحق مدرس شغال", r.status === 200, r.data);
}

// cash day
r = await req("POST", "/api/accounting", { action: "open-day", openingCash: 750 });
check("فتح صندوق برصيد", r.status === 200);
r = await req("POST", "/api/accounting", { action: "close-day", countedCash: 700 });
check("قفل صندوق بفرق", r.status === 200 && typeof r.data?.difference === "number", r.data);
check("الفرق = المعدود - المتوقع", r.data?.difference === (r.data?.counted - r.data?.expected), r.data);

// ================= 11. REPORTS + CSV =================
console.log("\n[11] التقارير");
for (const type of ["daily", "monthly", "revenue-subject", "revenue-group", "revenue-teacher", "student-balances", "student-credits", "teacher-settlements", "session-revenue", "expenses", "cash-movement", "payment-history", "net-result", "center-revenue", "weekly"]) {
  r = await req("GET", `/api/reports?type=${type}`);
  const okType = r.status === 200 && Array.isArray(r.data?.columns) && Array.isArray(r.data?.rows);
  check(`تقرير: ${r.data?.title ?? type}`, okType, { status: r.status, title: r.data?.title });
}
r = await fetch(`${BASE}/api/reports?type=monthly&export=csv`, { headers: { Cookie: cookie } });
const buf = await r.arrayBuffer();
const bytes = new Uint8Array(buf);
check("تصدير CSV بيبدأ بـ BOM (Excel عربي)", r.status === 200 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, Array.from(bytes.slice(0, 5)));

// ================= 12. WHATSAPP =================
console.log("\n[12] واتساب");
r = await req("GET", "/api/templates");
check("قوالب موجودة", (r.data?.templates ?? []).length >= 3);
const tpl = r.data?.templates?.[0];
r = await req("POST", "/api/templates", { action: "render", id: tpl.id, studentId: newStudentId });
check("قالب بيترندر بالمتغيرات", r.status === 200 && !/\{student_name\}/.test(r.data?.text ?? "") && (r.data?.link ?? "").includes("wa.me"), r.data?.text?.slice(0, 120));
check("توقيع السنتر بيتزاد", /النخبة/.test(r.data?.text ?? ""), r.data?.text?.slice(-120));

// ================= 13. BRANDING =================
console.log("\n[13] هوية السنتر");
r = await req("GET", "/api/settings");
check("البراندنج بيتجاب", r.status === 200 && r.data?.branding?.name);
r = await req("PATCH", "/api/settings", { primaryColor: "#0EA5E9" });
check("لون أساسي يتغير", r.status === 200 && r.data?.branding?.primaryColor === "#0EA5E9", r.data?.branding);
r = await req("PATCH", "/api/settings", { primaryColor: "notacolor" });
check("لون غلط يترفض", r.status === 500 || r.status === 400, r.status);
r = await req("PATCH", "/api/settings", { primaryColor: "#0E9F6E" });
check("اللون يرجع أصلي", r.status === 200);

// ================= 14. STUDENT CARD =================
console.log("\n[14] كارت الطالب");
r = await req("GET", `/api/students/${newStudentId}/card`);
check("كارت فيه QR (dataURL) من غير بيانات حساسة", r.status === 200 && r.data?.cards?.[0]?.qrDataUrl?.startsWith("data:image/png") && !r.data?.cards?.[0]?.qrDataUrl?.includes("phone"), r.data?.cards?.[0]?.name);
check("QR مش بيكشف رقم موبايل أو token", !(JSON.stringify(r.data?.cards ?? {}).includes("qrToken")));

// ================= 15. ADMIN PORTAL =================
console.log("\n[15] بورتال أدمن");
const mgrCookie = cookie;
await req("POST", "/api/auth", { username: "manager", password: "nokhba123" }); // manager first (to reset)
r = await req("GET", "/api/admin");
check("المدير مينفعش يفتح بورتال الأدمن", r.status === 403);
await req("POST", "/api/auth", { username: "admin", password: "nokhba123" });
r = await req("GET", "/api/admin");
check("أدمن يشوف السنترات", r.status === 200 && r.data?.centers?.length === 2, r.data?.centers?.length);
const amalCenter = r.data?.centers?.find((c: any) => c.slug === "amal-center");
check("سنتر الأمل منتهي", amalCenter?.subscription?.status === "EXPIRED", amalCenter?.subscription);
check("طلاب سنتر الأمل بيتعدوا (8)", amalCenter?.activeStudents === 8, amalCenter?.activeStudents);
r = await req("POST", "/api/admin", { action: "renew", centerId: amalCenter.id, months: 1 });
check("تجديد اشتراك يسجل فاتورة", r.status === 200 && r.data?.amount === 8 * 1500, r.data);
cookie = mgrCookie;
await req("POST", "/api/auth", { username: "manager", password: "nokhba123" });

// ================= 16. AUDIT =================
console.log("\n[16] سجل العمليات");
r = await req("GET", "/api/audit");
check("سجل العمليات فيه أفعال", (r.data?.logs ?? []).length > 5, r.data?.total);
const actions = new Set((r.data?.logs ?? []).map((l: any) => l.action));
check("تسجيل دفع موجود في السجل", actions.has("تسجيل دفعة"));
check("قفل حصة موجود في السجل", actions.has("قفل حصة"));

// ================= SUMMARY =================
console.log(`\n${"=".repeat(50)}\nالنتيجة: ${passed} نجح ✅ | ${failed} فشل ❌\n`);
if (failed > 0) process.exit(1);
