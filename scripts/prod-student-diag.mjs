/**
 * PROD DIAGNOSTIC — «حدث خطأ فالسيرڤر» عند إضافة طالب (alnokhba-centers-nine.vercel.app)
 * =================================================================================================
 * يسأل الإنتاج أسئلة محسوبة (GET غير مدمرة + POST إنشاء طالب اختبار واحد يتنضف بعده):
 *  1) دخول مدير
 *  2) GET /api/undo        → هل جدول UndoRecord موجود ويُقرأ؟ (recordUndo داخل POST الطلاب)
 *  3) GET /api/audit       → هل جدول AuditLog موجود؟ (logAudit داخل POST الطلاب)
 *  4) GET /api/academics   → المراحل/المجموعات (نفس ما تظهر للمالك)
 *  5) POST /api/students   → طالب اختبار واحد بأقل بيانات صالحة — نطبع الستاتس والجسم كامل
 *  6) GET /api/students?q= → هل الطالب اتسجل فعلًا رغم الـ 500؟ (يميّز فشل ما قبل الإنشاء عن ما بعده)
 *  7) POST /api/students/bulk → صف واحد اختبار (نفس فلسفة زرار الدفعة)
 *  8) تنظيف: أرشفة أي طالب اختبار اتضاف (PATCH status=ARCHIVED) + سؤال التراجع
 */
const BASE = "https://alnokhba-centers-nine.vercel.app";
const results = [];
const step = (n, ok, detail) => {
  results.push({ n, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${n} — ${detail}`);
};

function cookieOf(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  return set.map((c) => c.split(";")[0]).join("; ");
}

async function api(path, opts = {}, cookie = "") {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, res, cookie: cookieOf(res) };
}

const rnd = Math.floor(Math.random() * 900 + 100); // لاحقة فريدة للأرقام والأسماء
const TEST_TAG = `فحص سيرفر ${rnd}`;               // اسم واضح إنه اختبار

// ================= 1) دخول مدير =================
const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
const cookie = login.cookie || cookieOf(login.res);
step("1-login", login.status === 200 && !!cookie, `دخول المدير = ${login.status} ${login.status !== 200 ? JSON.stringify(login.json ?? login.text).slice(0, 200) : ""}`);

// ================= 2-3) جداول ما بعد الإنشاء =================
const undo = await api("/api/undo", {}, cookie);
step("2-undo-get", true, `GET /api/undo = ${undo.status} ${undo.status !== 200 ? JSON.stringify(undo.json ?? undo.text).slice(0, 160) : `(عناصر: ${undo.json?.items?.length ?? undo.json?.entries?.length ?? "?"})`}`);

const audit = await api("/api/audit?page=1&pageSize=1", {}, cookie);
step("3-audit-get", true, `GET /api/audit = ${audit.status} ${audit.status !== 200 ? JSON.stringify(audit.json ?? audit.text).slice(0, 160) : ""}`);

// ================= 4) المراحل والمجموعات =================
const acad = await api("/api/academics", {}, cookie);
const grades = acad.json?.grades ?? [];
const groups = acad.json?.groups ?? [];
step("4-academics", acad.status === 200 && grades.length > 0, `المراحل = ${grades.length} (${grades.map((g) => g.name).join(" / ")}) — المجموعات = ${groups.length}`);
const gradeId = grades[0]?.id ?? "";

// ================= 5) إضافة طالب فردي (نفس رحلة المالك) =================
const phone = `010${String(Math.floor(Math.random() * 90000000 + 10000000))}`; // 010 + 8 أرقام
const single = await api("/api/students", {
  method: "POST",
  body: JSON.stringify({
    name: `${TEST_TAG} تجربة`,
    phone,
    parentName: "ولي فحص",
    parentPhone: `011${String(Math.floor(Math.random() * 90000000 + 10000000))}`,
    gradeId,
    school: "",
    groupIds: [],
    notes: "طالب فحص آلي — يتشال",
  }),
}, cookie);
step("5-single-post", true, `POST /api/students = ${single.status} → ${JSON.stringify(single.json ?? single.text).slice(0, 300)}`);

// ================= 6) هل اتسجل فعلًا؟ =================
const q = await api(`/api/students?q=${encodeURIComponent(String(rnd))}`, {}, cookie);
const found = q.json?.students ?? [];
step("6-verify-created", true, `GET students?q=${rnd} = ${q.status} → عدد النتائج: ${found.length} ${found.length ? `(كود: ${found.map((s) => s.code).join(",")})` : ""}`);

// ================= 7) إضافة دفعة (صف واحد اختبار) =================
const bulk = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({
    students: [
      {
        name: `${TEST_TAG} دفعة`,
        phone: `012${String(Math.floor(Math.random() * 90000000 + 10000000))}`,
      },
    ],
  }),
}, cookie);
step("7-bulk-post", true, `POST /api/students/bulk = ${bulk.status} → ${JSON.stringify(bulk.json ?? bulk.text).slice(0, 300)}`);

const q2 = await api(`/api/students?q=${encodeURIComponent(String(rnd))}`, {}, cookie);
const found2 = q2.json?.students ?? [];
step("7b-verify-bulk", true, `بعد الدفعة → عدد نتائج الفحص: ${found2.length}`);

// ================= 8) تنظيف: أرشفة كل اللي اتضاف =================
let cleaned = 0;
for (const s of found2) {
  const patch = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, cookie);
  cleaned += patch.status === 200 ? 1 : 0;
  if (patch.status !== 200) console.log(`   تنظيف فشل لـ ${s.code}: ${patch.status} ${JSON.stringify(patch.json ?? {}).slice(0, 120)}`);
}
step("8-cleanup", cleaned === found2.length, `اتأرشف ${cleaned}/${found2.length} طالب فحص (بقوا ARCHIVED — مش باينين للمستخدم)`);

console.log("\n=== خلاصة التشخيص ===");
console.log(`login=${login.status} undo=${undo.status} audit=${audit.status} academics=${acad.status} single=${single.status} bulk=${bulk.status}`);
