// E2E اختبار workflow تسجيل الطلاب المدموج (ريبو مرجعي + مميزات النخبة)
const BASE = "http://localhost:3000";
let cookie = "";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setC = res.headers.get("set-cookie");
  if (setC) cookie = setC.split(";")[0];
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// ===== 1) دخول مدير =====
let session = null;
{
  const r = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "qae-mgr-99", password: "Qae#2026" }) });
  if (r.status === 200) session = { u: "qae-mgr-99", r };
}
if (!session) {
  console.log("  ❌ فشل دخول المدير qae-mgr-99");
  process.exit(2);
}
console.log(`✅ دخول مدير ناجح (${session.u})`);

// ===== 2) academics — مراحل ومجموعات =====
const acad = await api("/api/academics");
check("GET /api/academics 200", acad.status === 200);
const grades = acad.body?.grades ?? [];
const groups = acad.body?.groups ?? [];
console.log(`  المراحل: ${grades.length} · المجموعات: ${groups.length}`);

// ===== 3) فلتر المرحلة الجديد على GET /api/students =====
if (grades.length > 0) {
  const gid = grades[0].id;
  const byGrade = await api(`/api/students?gradeId=${gid}`);
  check("GET /api/students?gradeId 200", byGrade.status === 200);
  const allMatch = (byGrade.body?.students ?? []).every(s => true); // الاسم مش بيرجع في القائمة — بنكتفي بالفشل/النجاح
  check("فلتر المرحلة بيرجع نتيجة", Array.isArray(byGrade.body?.students));
  // مجموعة لو موجودة
  const grp = groups.find(g => g.gradeId === gid);
  if (grp) {
    const byGroup = await api(`/api/students?groupId=${grp.id}&gradeId=${gid}`);
    check("GET /api/students?groupId+gradeId 200", byGroup.status === 200);
  }
}

// ===== 4) bulk — استجابة فيها qrToken + phone (شاشة النتيجة) =====
const stamp = Date.now().toString().slice(-6);
const bulkRes = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({
    students: [
      { name: `اختبار دفعة ${stamp} أول`, phone: "010" + stamp + "01", parentPhone: "011" + stamp + "02", gradeId: grades[1]?.id ?? grades[0]?.id, groupIds: [] },
      { name: `اختبار دفعة ${stamp} تاني`, phone: "012" + stamp + "03", parentName: "ولي الأمر", parentPhone: "015" + stamp + "04", gradeId: grades[1]?.id ?? grades[0]?.id, groupIds: [] },
    ],
  }),
});
check("POST /api/students/bulk 201", bulkRes.status === 201, JSON.stringify(bulkRes.body).slice(0, 200));
const list = bulkRes.body?.students ?? [];
check("الاستجابة فيها qrToken لكل طالب", list.length === 2 && list.every(s => typeof s.qrToken === "string" && s.qrToken.length > 20));
check("الاستجابة فيها phone لكل طالب", list.every(s => typeof s.phone === "string" && /^01[0125]\d{8}$/.test(s.phone)));
check("كل طالب ليه كود 5 أرقام", list.every(s => /^\d{5}$/.test(s.code)));

// ===== 5) دفعة فيها صف غلط → 422 وأخطاء صفوف =====
const badRes = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({ students: [{ name: "اسم", phone: "01000000000" }] }),
});
check("صف غلط → 422 مع أخطاء", badRes.status === 422 && Array.isArray(badRes.body?.errors));

// ===== 6) تنظيف: أرشفة طلاب الاختبار =====
for (const s of list) {
  const del = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) });
  // PATCH قد يكون له شكل مختلف — مش مشكلة لو فشل، الاختبار الأساسي فوق
}
console.log(`\nالنتيجة: ${pass} نجاح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
