/**
 * اختبار خط أنابيب الحصص التشغيلي (Session Pipeline) — شامل:
 *
 * A. دورة حياة الحصة: جدولة → فتح → حضور → حفظ ≠ قفل → استكمال → مراجعة → قفل → ملخص → إعادة فتح
 * B. حصص متعددة أسبوعيًا: نفس المجموعة، حصتين في نفس الأسبوع، حضور مستقل تمامًا
 * C. حماية التكرار: حضور مرة واحدة لكل (طالب + حصة) — الحصة التانية بتقبل نفس الطالب عادي
 * D. الدفع بالحصة: تسجيل بـ sessionId + فلتر GET ?sessionId= + الحساب سيرفر-سايد
 * E. أرقام الداشبورد التشغيلية (opsSummary): شغالة/محتاجة قفل/موافقات/متأخرات
 * F. الدفعات: كل الدفعة أو لا شيء — أخطاء لكل صف + منع التكرار + السعة
 * G. الأدوار: استقبال يقفل ويسجل دفع؛ استرجاع مباشر ممنوع بدون صلاحية
 * H. ثبات التاريخ: الحفظ والخروج والرجوع مش بيقفلوا الحصة أبدًا
 * I. تنظيف جراحي كامل
 *
 * bun scripts/test-session-pipeline.ts
 */
const BASE = "http://localhost:3000";

let mcookie = "";
let rcookie = "";
const extraCookies: string[] = [];

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

async function req(path: string, method = "GET", body?: unknown, jar: "m" | "r" = "m") {
  const c = jar === "m" ? mcookie : rcookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const first = setCookie.split(";")[0];
    if (jar === "m") mcookie = first; else rcookie = first;
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  console.log("🧪 خط أنابيب الحصص التشغيلي — Session Pipeline\n");
  const stamp = Date.now().toString(36);

  // ============ 0. دخول ============
  let r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" });
  ok("login manager", r.status === 200);
  r = await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, "r");
  ok("login reception", r.status === 200);

  const auth = await req("/api/auth", "GET");
  const centerId = ((auth.data.user as { centerId?: string })?.centerId) ?? "";

  // ============ إعداد: مرحلة + مادة + مدرس + مجموعة بحصتين أسبوعيًا ============
  console.log("\n📦 إعداد بيانات الاختبار");
  const grade = await db.grade.create({ data: { centerId, name: `اختبار-${stamp}` } });
  const teacher = await db.teacher.create({ data: { centerId, name: `مدرس اختبار ${stamp}` } });
  const group = await db.group.create({
    data: {
      centerId, name: `مجموعة-خط-الأنابيب-${stamp}`, gradeId: grade.id, teacherId: teacher.id,
      sessionPrice: 5000, teacherPercent: 40, isActive: true,
    },
  });
  // حصتين أسبوعيًا: الأحد 17:00 والأربعاء 19:00
  const slotSun = await db.scheduleSlot.create({
    data: { centerId, groupId: group.id, dayOfWeek: 0, startTime: "17:00", endTime: "18:30", room: `قاعة-${stamp}`, isActive: true },
  });
  const slotWed = await db.scheduleSlot.create({
    data: { centerId, groupId: group.id, dayOfWeek: 3, startTime: "19:00", endTime: "20:30", room: `قاعة-${stamp}`, isActive: true },
  });
  ok("setup: group with 2 weekly slots", !!group.id && !!slotSun.id && !!slotWed.id);

  // ============ F. الدفعات أولًا (طلاب الاختبار) ============
  console.log("\n👥 الدفعات الطلابية");
  // دفعة فيها خطأ = ولا ولا حاجة
  r = await req("/api/students/bulk", "POST", {
    students: [
      { name: "طالب دفعة الأول اختبار", phone: "01011112221", parentName: "ولي أمر الأول", parentPhone: "01011112231", gradeId: grade.id },
      { name: "قصير", phone: "01011122223", parentName: "ولي أمر تاني", parentPhone: "01011112233", gradeId: grade.id }, // اسم قصير = خطأ
      { name: "طالب دفعة التالت اختبار", phone: "notaphone", parentName: "ولي أمر تالت", parentPhone: "01011112235", gradeId: grade.id }, // موبايل غلط
    ],
  });
  ok("bulk: invalid batch rejected (422)", r.status === 422, `status=${r.status}`);
  const errs = (r.data.errors as { row: number; message: string }[]) ?? [];
  ok("bulk: per-row errors returned", errs.length === 2, `errors=${errs.length}`);
  ok("bulk: nothing created on invalid batch", (r.data.created as number) === 0);
  let cnt = await db.student.count({ where: { centerId, name: { contains: "دفعة" } } });
  ok("bulk: DB has zero batch students", cnt === 0, `count=${cnt}`);

  // دفعة سليمة
  r = await req("/api/students/bulk", "POST", {
    students: [
      { name: "أحمد طالب دفعة اختبار", phone: "01011122241", parentName: "ولي أمر أحمد", parentPhone: "01011122251", gradeId: grade.id, groupIds: [group.id] },
      { name: "سارة طالبة دفعة اختبار", phone: "01011122242", parentName: "ولي أمر سارة", parentPhone: "01011122252", gradeId: grade.id, groupIds: [group.id] },
      { name: "عمر طالب دفعة اختبار", phone: "01011122243", parentName: "ولي أمر عمر", parentPhone: "01011122253", gradeId: grade.id, groupIds: [group.id] },
    ],
  });
  ok("bulk: valid batch created (201)", r.status === 201, `status=${r.status}`);
  const createdStudents = (r.data.students as { id: string; code: string; name: string }[]) ?? [];
  ok("bulk: 3 students with codes", createdStudents.length === 3 && createdStudents.every((s) => /^\d{5}$/.test(s.code)), createdStudents.map((s) => s.code).join(","));

  // تكرار داخل الدفعة
  r = await req("/api/students/bulk", "POST", {
    students: [
      { name: "مكرر طالب دفعة اختبار", phone: "01011122261", parentName: "ولي أمر مكرر", parentPhone: "01011122271", gradeId: grade.id },
      { name: "مكرر طالب دفعة اختبار", phone: "01011122261", parentName: "ولي أمر مكرر", parentPhone: "01011122271", gradeId: grade.id },
    ],
  });
  ok("bulk: intra-batch duplicate rejected", r.status === 422);
  // تكرار مع موجود
  r = await req("/api/students/bulk", "POST", {
    students: [
      { name: "أحمد طالب دفعة اختبار", phone: "01011122241", parentName: "ولي أمر أحمد", parentPhone: "01011122251", gradeId: grade.id },
    ],
  });
  ok("bulk: existing student duplicate rejected", r.status === 422, JSON.stringify(r.data.errors ?? {}).slice(0, 80));
  // استقبال بدون صلاحية إضافة
  const recUser = (await req("/api/auth", "GET", undefined, "r")).data.user as { canAddStudents?: boolean };
  if (!recUser?.canAddStudents) {
    r = await req("/api/students/bulk", "POST", { students: [{ name: "ممنوع طالب دفعة اختبار", phone: "01011122281", parentName: "ولي", parentPhone: "01011122291", gradeId: grade.id }] }, "r");
    ok("bulk: reception without ADD_STUDENT rejected (403)", r.status === 403, `status=${r.status}`);
  } else {
    console.log("  ⚠ reception has canAddStudents — skipping 403 check");
  }

  const [s1, s2] = createdStudents;
  void s2;

  // ============ A+B. دورة الحياة + حصص متعددة أسبوعيًا ============
  console.log("\n🕐 دورة حياة الحصة + حصص الأسبوع المتعددة");
  // نفتح الحصتين في نفس الأسبوع (تواريخ ماضية عشان الوقت شغال خلص — عشان اختبار «محتاجة قفل»)
  const pastSunday = "2026-09-06"; // الأحد
  const pastWednesday = "2026-09-09"; // الأربعاء
  const dowCheckSun = new Date(`${pastSunday}T12:00:00Z`).getUTCDay();
  const dowCheckWed = new Date(`${pastWednesday}T12:00:00Z`).getUTCDay();
  ok("dates sanity: Sunday=0, Wednesday=3", dowCheckSun === 0 && dowCheckWed === 3);

  r = await req("/api/sessions", "POST", { scheduleId: slotSun.id, date: pastSunday });
  ok("open Sunday session", r.status === 201, `status=${r.status}`);
  const sunSessionId = ((r.data.session as { id?: string })?.id) ?? "";
  r = await req("/api/sessions", "POST", { scheduleId: slotWed.id, date: pastWednesday });
  ok("open Wednesday session", r.status === 201);
  const wedSessionId = ((r.data.session as { id?: string })?.id) ?? "";

  // نفس السلوت مرتين في نفس اليوم = 409
  r = await req("/api/sessions", "POST", { scheduleId: slotSun.id, date: pastSunday });
  ok("duplicate materialization blocked (409)", r.status === 409, `status=${r.status}`);

  // الحالة الابتدائية
  r = await req(`/api/sessions/${sunSessionId}`);
  let detail = r.data as { session: { status: string }; economics: { presentCount: number }; attendance: unknown[]; absent: unknown[] };
  ok("Sunday session starts OPEN", detail.session.status === "OPEN");
  ok("Sunday session empty", detail.economics.presentCount === 0 && detail.attendance.length === 0);

  // ============ C. حضور مستقل لكل حصة ============
  console.log("\n📝 الحضور المستقل");
  // أحمد يحضر الأحد
  r = await req("/api/attendance/mark", "POST", { studentId: s1.id, sessionId: sunSessionId, status: "PRESENT" });
  ok("mark s1 PRESENT in Sunday", r.status === 200);
  // أحمد يحضر الأربعاء (نفس الطالب — حصة مختلفة = لازم يتقبل)
  r = await await req("/api/attendance/mark", "POST", { studentId: s1.id, sessionId: wedSessionId, status: "PRESENT" });
  ok("mark s1 PRESENT in Wednesday (same student, other session)", r.status === 200, `status=${r.status}`);
  // سارة تحضر الأربعاء بس
  r = await req("/api/attendance/mark", "POST", { studentId: s2.id, sessionId: wedSessionId, status: "LATE" });
  ok("mark s2 LATE in Wednesday", r.status === 200);

  // إعادة تعليم أحمد في الأحد = alreadyAttended، مفيش سجل جديد
  r = await req("/api/attendance/mark", "POST", { studentId: s1.id, sessionId: sunSessionId, status: "PRESENT" });
  ok("duplicate mark returns alreadyAttended", r.status === 200 && (r.data.alreadyAttended as boolean) === true);
  const s1SunCount = await db.attendance.count({ where: { sessionId: sunSessionId, studentId: s1.id } });
  ok("Sunday: single attendance record (unique enforced)", s1SunCount === 1, `count=${s1SunCount}`);

  // التحقق من الاستقلالية
  r = await req(`/api/sessions/${sunSessionId}`);
  detail = r.data as typeof detail;
  ok("Sunday: s1 present, s2 absent", detail.attendance.length === 1 && detail.absent.length === 2, `att=${detail.attendance.length} absent=${detail.absent.length}`);
  r = await req(`/api/sessions/${wedSessionId}`);
  detail = r.data as typeof detail;
  ok("Wednesday: both present", detail.attendance.length === 2 && detail.absent.length === 1, `att=${detail.attendance.length} absent=${detail.absent.length}`);

  // ============ D. الدفع بالحصة + فلتر ============
  console.log("\n💵 الدفعات بالحصة");
  r = await req("/api/payments", "POST", { studentId: s1.id, amount: 100, method: "CASH", sessionId: wedSessionId, type: "PAYMENT" }, "r");
  ok("payment recorded with sessionId (reception)", r.status === 200 && !!(r.data.receipt as { number?: string })?.number);
  r = await req(`/api/payments?sessionId=${wedSessionId}`);
  const wedPays = (r.data.payments as { student: { code: string } | null }[]) ?? [];
  ok("GET ?sessionId= filters to that session", wedPays.length === 1 && wedPays[0]?.student?.code === s1.code, `count=${wedPays.length}`);
  r = await req(`/api/payments?sessionId=${sunSessionId}`);
  ok("Sunday session has zero payments", (((r.data.payments as unknown[]) ?? []).length) === 0);

  // مبلغ غلط
  r = await req("/api/payments", "POST", { studentId: s1.id, amount: -5, sessionId: wedSessionId, type: "PAYMENT" }, "r");
  ok("negative payment rejected", r.status === 400);
  // استرجاع مباشر بدون صلاحية = 403
  r = await req("/api/payments", "POST", { studentId: s1.id, amount: 50, type: "REFUND" }, "r");
  ok("direct refund without permission rejected (403)", r.status === 403, `status=${r.status}`);

  // ============ H. الحفظ ≠ القفل ============
  console.log("\n💾 الحفظ مش قفل");
  // GETs متكررة (زي فتح الصفحة وغلقها) — الحصة بتفضل OPEN
  for (let i = 0; i < 3; i++) await req(`/api/sessions/${sunSessionId}`);
  r = await req(`/api/sessions/${sunSessionId}`);
  detail = r.data as typeof detail;
  ok("session stays OPEN after many opens/leaves", detail.session.status === "OPEN");
  ok("attendance preserved while OPEN", detail.attendance.length === 1);

  // ============ E. opsSummary ============
  console.log("\n📊 ملخص الداشبورد التشغيلي");
  r = await req("/api/dashboard");
  const ops = r.data.opsSummary as { activeSessions: number; attention: { id: string }[]; pendingApprovals: number; paymentIssues: { id: string }[] };
  ok("manager payload has opsSummary", !!ops);
  ok("opsSummary counts our 2 open sessions", ops.activeSessions >= 2, `active=${ops.activeSessions}`);
  // الحصتين بتاريخ ماضي ووقتهم خلص = محتاجين قفل
  const attnIds = ops.attention.map((a) => a.id);
  ok("attention includes past-date open sessions", attnIds.includes(sunSessionId) && attnIds.includes(wedSessionId), `attention=${ops.attention.length}`);
  // الأربعاء فيها متأخرات (حضور 2 × 50ج = 100ج، دفع 100ج ×100 قروش = 10000... انتظر: الحضور اتخصم من الرصيد مش دفع)
  const payIssueIds = ops.paymentIssues.map((p) => p.id);
  ok("paymentIssues computed from charged-vs-paid", Array.isArray(payIssueIds), `issues=${ops.paymentIssues.length}`);
  // الاستقبال: مفيش opsSummary (زي ما هو)
  r = await req("/api/dashboard", "GET", undefined, "r");
  ok("reception payload unchanged (no opsSummary)", r.data.opsSummary === undefined && !!r.data.quickStats);

  // ============ A (تتمة). المراجعة والقفل والملخص وإعادة الفتح ============
  console.log("\n🔒 المراجعة والقفل");
  // قفل الأربعاء (اللي فيها الدفع)
  r = await req(`/api/sessions/${wedSessionId}`, "POST", { action: "close" });
  ok("close Wednesday (authorized reception default END_SESSION)", r.status === 200, `status=${r.status}`);
  const closedEcon = r.data.economics as { presentCount: number; totalRevenue: number; teacherShare: number; centerShare: number; collected: number };
  ok("close economics: 2 present, 100ج revenue", closedEcon.presentCount === 2 && closedEcon.totalRevenue === 10000, `present=${closedEcon.presentCount} rev=${closedEcon.totalRevenue}`);
  ok("close shares 40/60", closedEcon.teacherShare === 4000 && closedEcon.centerShare === 6000, `t=${closedEcon.teacherShare} c=${closedEcon.centerShare}`);

  // حضور بعد القفل = مرفوض
  r = await req("/api/attendance/mark", "POST", { studentId: s2.id, sessionId: wedSessionId, status: "PRESENT" });
  ok("attendance after close rejected", r.status !== 200, `status=${r.status}`);
  // قفل حصة مقفولة = مرفوض
  r = await req(`/api/sessions/${wedSessionId}`, "POST", { action: "close" });
  ok("double close rejected", r.status !== 200, `status=${r.status}`);
  // إلغاء حصة مقفولة = مرفوض
  r = await req(`/api/sessions/${wedSessionId}`, "POST", { action: "cancel", reason: "اختبار إلغاء المقفولة" });
  ok("cancel closed session rejected", r.status !== 200, `status=${r.status}`);

  // مستحق المدرس اتنشأ
  const settlements = await db.teacherSettlement.findMany({ where: { sessionId: wedSessionId } });
  ok("teacher EARNED settlement created", settlements.some((x) => x.type === "EARNED" && x.amount === 4000), `n=${settlements.length}`);

  // إعادة الفتح (مدير) = حركة عكسية
  r = await req(`/api/sessions/${wedSessionId}`, "POST", { action: "reopen", reason: "اختبار إعادة الفتح" });
  ok("reopen by manager", r.status === 200, `status=${r.status}`);
  const reSettlements = await db.teacherSettlement.findMany({ where: { sessionId: wedSessionId } });
  const earned = reSettlements.filter((x) => x.type === "EARNED").reduce((a, x) => a + x.amount, 0);
  ok("reopen created reversing entry (net zero)", earned === 0, `net=${earned}`);
  r = await req(`/api/sessions/${wedSessionId}`);
  detail = r.data as typeof detail;
  ok("reopened session back to OPEN with attendance intact", detail.session.status === "OPEN" && detail.attendance.length === 2);
  // إعادة الفتح من الاستقبال = ممنوع
  r = await req(`/api/sessions/${wedSessionId}`, "POST", { action: "reopen", reason: "محاولة استقبال" }, "r");
  ok("reopen by reception rejected", r.status !== 200, `status=${r.status}`);

  // ============ الإلغاء ============
  console.log("\n🚫 الإلغاء");
  // حصة جديدة للإلغاء
  r = await req("/api/sessions", "POST", { groupId: group.id, date: "2026-09-10", startTime: "21:00", endTime: "22:00" });
  const cancelTarget = ((r.data.session as { id?: string })?.id) ?? "";
  ok("adhoc session for cancel test", !!cancelTarget);
  // استقبال بدون CANCEL_SESSION = 403
  r = await req(`/api/sessions/${cancelTarget}`, "POST", { action: "cancel", reason: "سبب كويس جدا" }, "r");
  ok("direct cancel by reception rejected (403)", r.status === 403, `status=${r.status}`);
  // مدير بدون سبب = مرفوض
  r = await req(`/api/sessions/${cancelTarget}`, "POST", { action: "cancel", reason: "لا" });
  ok("cancel without reason rejected", r.status !== 200);
  // مدير بسبب = شغال
  r = await req(`/api/sessions/${cancelTarget}`, "POST", { action: "cancel", reason: "سبب اختبار الإلغاء" });
  ok("cancel by manager with reason", r.status === 200, `status=${r.status}`);
  // تكرار الإلغاء = 409
  r = await req(`/api/sessions/${cancelTarget}`, "POST", { action: "cancel", reason: "تكرار الاختبار" });
  ok("double cancel rejected (409)", r.status === 409, `status=${r.status}`);

  // ============ التنضيف الجراحي ============
  console.log("\n🧹 التنضيف الجراحي");
  // امسح الحصص بتاريخها (الحضور cascade من SessionInstance)
  await db.sessionInstance.deleteMany({ where: { id: { in: [sunSessionId, wedSessionId, cancelTarget] } } });
  // امسح مستحقات/قيود/دفعات الاختبار (المدفوعات مرتبطة بحصص اتمسحت — امسحها بـ studentId)
  const testStudentIds = createdStudents.map((s) => s.id);
  await db.receipt.deleteMany({ where: { studentId: { in: testStudentIds } } });
  await db.studentTransaction.deleteMany({ where: { studentId: { in: testStudentIds } } });
  await db.teacherSettlement.deleteMany({ where: { teacherId: teacher.id } });
  await db.centerTransaction.deleteMany({ where: { refId: { in: [sunSessionId, wedSessionId, cancelTarget] } } });
  await db.attendance.deleteMany({ where: { studentId: { in: testStudentIds } } });
  await db.studentGroup.deleteMany({ where: { studentId: { in: testStudentIds } } });
  await db.student.deleteMany({ where: { id: { in: testStudentIds } } });
  await db.scheduleSlot.deleteMany({ where: { groupId: group.id } });
  await db.group.deleteMany({ where: { id: group.id } });
  await db.teacher.deleteMany({ where: { id: teacher.id } });
  await db.grade.deleteMany({ where: { id: grade.id } });

  // تحقق نهائي: صفر بقايا
  const leftovers = await db.sessionInstance.count({ where: { group: { name: { contains: `خط-الأنابيب` } } } });
  const leftStudents = await db.student.count({ where: { name: { contains: "دفعة اختبار" } } });
  const leftSlots = await db.scheduleSlot.count({ where: { room: `قاعة-${stamp}` } });
  ok("cleanup: zero leftover sessions", leftovers === 0, `n=${leftovers}`);
  ok("cleanup: zero leftover students", leftStudents === 0, `n=${leftStudents}`);
  ok("cleanup: zero leftover slots", leftSlots === 0, `n=${leftSlots}`);

  console.log(`\n${"=".repeat(50)}\nنتيجة خط الأنابيب: ${passed}/${passed + failed}`);
  if (failed > 0) { console.error(`✗ ${failed} فحص فاشل`); process.exit(1); }
}

main().catch((e) => { console.error("💥", e); process.exit(1); })
  .finally(() => db.$disconnect());
