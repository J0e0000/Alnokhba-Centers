/** اختبار حاسم: الدفعة القديمة المنشورة على الإنتاج (ببيانات صالحة تتجاوز الفاليديشن)
 *  لو نجحت 201 → الـ transactions شغالة والمشكلة في assertStudentQuotaTx بس
 *  لو فشلت 500 بعد ~5s → كل الـ transactions فيها nested global-read بتعلق
 *  بعد كده تنظيف فوري للطالب المضاف (أرشفة). */
const BASE = "https://alnokhba-centers-nine.vercel.app";

function cookieOf(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  return set.map((c) => c.split(";")[0]).join("; ");
}

async function api(path, opts = {}, cookie = "") {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t0, cookie: cookieOf(res) };
}

const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
const cookie = login.cookie;
console.log(`login: ${login.status}`);

const acad = await api("/api/academics", {}, cookie);
const gradeId = acad.json?.grades?.[0]?.id ?? "";
console.log(`gradeId: ${gradeId}`);

const tag = Math.floor(Math.random() * 9000 + 1000);
const bulk = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({
    students: [{
      name: `فحص دفعة ${tag} تجربة`,
      phone: `010${String(Math.floor(Math.random() * 90000000 + 10000000))}`,
      parentName: "ولي فحص",
      parentPhone: `011${String(Math.floor(Math.random() * 90000000 + 10000000))}`,
      gradeId,
    }],
  }),
}, cookie);
console.log(`POST bulk (بيانات صالحة): ${bulk.status} بعد ${bulk.ms}ms`);
console.log(`   ← ${JSON.stringify(bulk.json ?? bulk.text).slice(0, 300)}`);

// تنظيف فوري لو اتضاف
const q = await api(`/api/students?q=${encodeURIComponent(String(tag))}`, {}, cookie);
const found = q.json?.students ?? [];
for (const s of found) {
  const patch = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, cookie);
  console.log(`تنظيف ${s.code}: ${patch.status}`);
}
console.log(`نتائج الفحص: ${found.length}`);
