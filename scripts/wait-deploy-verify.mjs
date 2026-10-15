/** متابعة نشر Vercel — بيعمل probe كل 30 ثانية على الإنتاج:
 *  العلامة: POST bulk بـ(اسم+رقم فقط) → 422 (كود قديم) vs 201 (كود جديد منشور)
 *  + POST فردي → 500 (عطل) vs 201 (مصلّح). أول ما الاتنين ينجحوا → تنظيف فوري ونتيجة. */
const BASE = "https://alnokhba-centers-nine.vercel.app";
const MAX_MIN = 14;

function cookieOf(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  return set.map((c) => c.split(";")[0]).join("; ");
}
async function api(path, opts = {}, cookie = "") {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, cookie: cookieOf(res) };
}

const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
const cookie = login.cookie;
if (login.status !== 200) { console.log("فشل الدخول", login.status); process.exit(1); }
const acad = await api("/api/academics", {}, cookie);
const gradeId = acad.json?.grades?.[0]?.id ?? "";

const t0 = Date.now();
while ((Date.now() - t0) < MAX_MIN * 60 * 1000) {
  const tag = Math.floor(Math.random() * 9000 + 1000);
  const bulk = await api("/api/students/bulk", {
    method: "POST",
    body: JSON.stringify({ students: [{ name: `فحص نشر ${tag}`, phone: `010${Math.floor(Math.random() * 90000000 + 10000000)}` }] }),
  }, cookie);
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (bulk.status === 201) {
    console.log(`[${elapsed}s] 🚀 الكود الجديد منشور! bulk = 201 (created=${bulk.json?.created})`);
    // الفردية كمان
    const single = await api("/api/students", {
      method: "POST",
      body: JSON.stringify({ name: `فحص نشر فردي ${tag}`, phone: `011${Math.floor(Math.random() * 90000000 + 10000000)}`, parentName: "ولي الفحص", parentPhone: `012${Math.floor(Math.random() * 90000000 + 10000000)}`, gradeId, groupIds: [] }),
    }, cookie);
    console.log(`       الإضافة الفردية = ${single.status} ${single.status === 201 ? `(كود ${single.json?.student?.code}) — العطل اتحل نهائيًا ✅` : "⚠️ لسه بترجع خطأ: " + JSON.stringify(single.json ?? single.text).slice(0, 160)}`);
    // تنظيف كل فحوصات «فحص نشر»
    const q = await api(`/api/students?q=${encodeURIComponent("فحص نشر")}&pageSize=20`, {}, cookie);
    const found = q.json?.students ?? [];
    let cleaned = 0;
    for (const s of found) {
      const p = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, cookie);
      if (p.status === 200) cleaned++;
    }
    console.log(`       تنظيف: اتأرشف ${cleaned}/${found.length} طالب فحص`);
    process.exit(0);
  }
  console.log(`[${elapsed}s] لسه القديم شغال — bulk=${bulk.status} (${bulk.json?.error ? String(bulk.json.error).slice(0, 60) : ""}) — مستني...`);
  await new Promise((r) => setTimeout(r, 30000));
}
console.log("انتهى وقت الانتظار — النشر مكتملش بعد. جرّب تاني بعدين أو شوف لوحة Vercel.");
process.exit(2);
