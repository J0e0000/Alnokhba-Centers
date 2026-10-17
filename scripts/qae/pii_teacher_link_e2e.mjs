// e2e لفجوة #6 (PII reads) + ربط حساب المدرس بكيانه + نطاق داشبورد المدرس
// تشغيل: bun scripts/qae/pii_teacher_link_e2e.mjs   (dev: QAE1 — سنتر الاختبار)
const BASE = process.env.QAE_BASE || "http://127.0.0.1:3000";
const CID = "cmvbb396y0000ovy9n6gmecjy";
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function login(username, password = "Qae#2026") {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get("set-cookie") ?? "").match(/nokhba_session=[^;]+/)?.[0] ?? "";
}
async function api(cookie, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function main() {
  console.log("=== e2e: #6 PII + ربط المدرس + نطاق الداشبورد ===");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  const mgr = await login("qae-mgr-ob");
  const rec = await login("qae-rec-ob");
  const tch = await login("qae-tch-ob");
  ok("logins", mgr && rec && tch);

  // مادة اختبار PII: طالب واحد
  let st = await db.student.findFirst({ where: { centerId: CID } });
  if (!st) {
    st = await db.student.create({ data: { centerId: CID, code: "99911", qrToken: "e2e" + "a".repeat(20), name: "طالب اختبار PII", gradeId: (await db.grade.findFirst({ where: { centerId: CID } })).id } });
  }

  // ===== 1) فجوة #6: قراءة الطلاب محتاجة صلاحية =====
  const tList = await api(tch, "/api/students?pageSize=5");
  ok("TEACHER GET students → 403", tList.status === 403, `got ${tList.status}`);
  const tLookup = await api(tch, `/api/lookup?q=${st.code}`);
  ok("TEACHER lookup → 403", tLookup.status === 403, `got ${tLookup.status}`);
  const tProf = await api(tch, `/api/students/${st.id}`);
  ok("TEACHER profile → 403", tProf.status === 403, `got ${tProf.status}`);
  const tScan = await api(tch, "/api/attendance/scan", { method: "POST", body: { query: st.code, sessionId: "x" } });
  ok("TEACHER scan → RED بصلاحية", tScan.status === 200 && tScan.data?.status === "RED" && String(tScan.data?.message || "").includes("صلاحية"), JSON.stringify(tScan.data).slice(0, 80));
  const rList = await api(rec, "/api/students?pageSize=5");
  ok("RECEPTIONIST GET students → 200", rList.status === 200, `got ${rList.status}`);
  const mScan = await api(rec, "/api/attendance/scan", { method: "POST", body: { query: st.code, sessionId: "x" } });
  ok("RECEPTIONIST scan → مش رفض صلاحية", !(String(mScan.data?.message || "").includes("صلاحية")), JSON.stringify(mScan.data).slice(0, 80));

  // ===== 2) ربط حساب المدرس بكيانه =====
  const teacher = await db.teacher.findFirst({ where: { centerId: CID, name: "أ. محمد" } });
  ok("teacher entity موجود", !!teacher);

  // idempotency: نفك أي ربط قديم من تشغيلة سابقة
  await db.user.updateMany({ where: { centerId: CID, teacherRefId: teacher.id }, data: { teacherRefId: null } });

  const staffList0 = await api(mgr, "/api/staff");
  const tchUser0 = staffList0.data.staff.find((s) => s.username === "qae-tch-ob");
  ok("staff GET فيه teacherRefId", "teacherRefId" in tchUser0 && "teacherRefName" in tchUser0);

  const link1 = await api(mgr, "/api/staff", { method: "PATCH", body: { id: tchUser0.id, teacherRefId: teacher.id } });
  ok("ربط المدرس → ok", link1.status === 200, JSON.stringify(link1.data).slice(0, 80));

  // تكرار الربط بحساب تاني → 409 (اسم المستخدم من غير شرطات — cleanRaw بيمسحها)
  await api(mgr, "/api/staff", { method: "POST", body: { name: "QAE1 مدرس تاني", username: "qaetch2ob", password: "Qae#2026", role: "TEACHER" } });
  const staffList1 = await api(mgr, "/api/staff");
  const tchUser2 = staffList1.data.staff.find((s) => s.username === "qaetch2ob");
  const linkDup = await api(mgr, "/api/staff", { method: "PATCH", body: { id: tchUser2.id, teacherRefId: teacher.id } });
  ok("ربط نفس المدرس لحساب تاني → 409", linkDup.status === 409, `got ${linkDup.status}`);

  // ربط بحساب استقبال → 400
  const recUser = staffList1.data.staff.find((s) => s.username === "qae-rec-ob");
  const linkWrongRole = await api(mgr, "/api/staff", { method: "PATCH", body: { id: recUser.id, teacherRefId: teacher.id } });
  ok("ربط موظف استقبال بمدرس → 400", linkWrongRole.status === 400, `got ${linkWrongRole.status}`);

  // ===== 3) نطاق داشبورد المدرس المربوط =====
  // النهاردة لازم يكون فيه plannedSlots بتاعة أ. محمد بس (عربي-أ) من سييد البيئة
  const dashT = await api(tch, "/api/dashboard");
  const plannedSubjects = (dashT.data.plannedSessions ?? []).map((p) => p.subject);
  ok("داشبورد مدرس مربوط: plannedSessions لمدرسه بس", dashT.status === 200 && plannedSubjects.every((s) => s === "عربي") && plannedSubjects.length >= 1, JSON.stringify(plannedSubjects));
  ok("داشبورد مدرس مربوط: teacherLinked=true", dashT.data.teacherLinked === true);
  const dashSessionsTeachers = new Set((dashT.data.sessions ?? []).map((s) => s.teacher));
  ok("مفيش حصص مدرس تاني في sessions", [...dashSessionsTeachers].every((t) => t === "أ. محمد"), [...dashSessionsTeachers].join(","));

  // /api/sessions GET — نفس النطاق (بيغذي «مسار الجيم» = الرئيسية)
  const sessT = await api(tch, "/api/sessions");
  const sessTeachers = new Set([...(sessT.data.sessions ?? []), ...(sessT.data.suggestions ?? [])].map((x) => x.teacher));
  ok("sessions GET مدرس مربوط: حصصه هو بس", sessT.status === 200 && [...sessTeachers].every((t) => t === "أ. محمد") && (sessT.data.sessions.length + sessT.data.suggestions.length) >= 1, [...sessTeachers].join(","));

  // فك الربط → teacherLinked=false + قوائم فاضية (مش جدول السنتر كله)
  const unlink = await api(mgr, "/api/staff", { method: "PATCH", body: { id: tchUser0.id, teacherRefId: null } });
  ok("فك الربط → ok", unlink.status === 200);
  const dashU = await api(tch, "/api/dashboard");
  ok("مدرس مش مربوط: teacherLinked=false", dashU.data.teacherLinked === false);
  ok("مدرس مش مربوط: مفيش تسريب حصص (داشبورد)", (dashU.data.sessions ?? []).length === 0 && (dashU.data.plannedSessions ?? []).length === 0, JSON.stringify({ s: dashU.data.sessions?.length, p: dashU.data.plannedSessions?.length }));
  const sessU = await api(tch, "/api/sessions");
  ok("مدرس مش مربوط: مفيش تسريب حصص (sessions)", sessU.status === 200 && (sessU.data.sessions ?? []).length === 0 && (sessU.data.suggestions ?? []).length === 0, JSON.stringify({ s: sessU.data.sessions?.length, g: sessU.data.suggestions?.length }));

  // تنظيف: امسح الحساب التاني اللي اتعمل للاختبار
  await db.user.deleteMany({ where: { username: "qaetch2ob" } });

  await db.$disconnect();
  console.log(`\nالنتيجة: ${pass} نجاح / ${fail} فشل`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
