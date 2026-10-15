/** E2E نهائي على سيرفر تطوير محلي موصول بـ PostgreSQL (connection_limit=1 زي الإنتاج)
 *  الاختبارات: دخول → إضافة فردية (201 متوقع — كانت 500) → دفعة بالحد الأدنى (اسم+رقم فقط = الطلب الجديد للمالك) → دفعة 3 صفوف → تنظيف */
const BASE = "http://127.0.0.1:3000";

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
const ok = (c, msg) => console.log(`${c ? "✓" : "✗"} ${msg}`);
const tag = Math.floor(Math.random() * 9000 + 1000);

// 0) حساب المدير اتعمل من سكريبت الزرع (diagmgr / nokhba123)
const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "diagmgr", password: "nokhba123" }) });
const cookie = login.cookie;
ok(login.status === 200 && !!cookie, `دخول diagmgr = ${login.status} (${login.ms}ms)`);
if (login.status !== 200) { console.log(login.text.slice(0, 200)); process.exit(1); }

const acad = await api("/api/academics", {}, cookie);
const gradeId = acad.json?.grades?.[0]?.id ?? "";
ok(!!gradeId, `المراحل = ${acad.json?.grades?.length ?? 0}`);

// 1) الإضافة الفردية — اللي كانت بترجع 500 على الإنتاج
const single = await api("/api/students", {
  method: "POST",
  body: JSON.stringify({ name: `فحص فردي ${tag} تجربة`, phone: `010${Math.floor(Math.random() * 90000000 + 10000000)}`, parentName: "ولي الفرد", parentPhone: `011${Math.floor(Math.random() * 90000000 + 10000000)}`, gradeId, groupIds: [] }),
}, cookie);
ok(single.status === 201, `إضافة فردية = ${single.status} (${single.ms}ms) ${single.status !== 201 ? "→ " + JSON.stringify(single.json ?? single.text).slice(0, 200) : `كود: ${single.json?.student?.code}`}`);

// 2) الدفعة بالحد الأدنى — اسم + رقم واحد بس (طلب المالك بالظبط — كانت بترجع 422/500)
const bulkMin = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({ students: [{ name: `فحص دفعة ${tag} تجربة`, phone: `012${Math.floor(Math.random() * 90000000 + 10000000)}` }] }),
}, cookie);
ok(bulkMin.status === 201 && bulkMin.json?.created === 1, `دفعة (اسم + رقم بس) = ${bulkMin.status} (${bulkMin.ms}ms) ${bulkMin.status !== 201 ? "→ " + JSON.stringify(bulkMin.json ?? bulkMin.text).slice(0, 200) : ""}`);

// 3) دفعة 3 صفوف من غير مرحلة ولا اسم ولي أمر — استنتاج كامل
const bulk3 = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({
    students: [
      { name: `فحص ثلاثي أ ${tag}`, parentPhone: `010${Math.floor(Math.random() * 90000000 + 10000000)}` }, // رقم ولي أمر بس
      { name: `فحص ثلاثي ب ${tag}`, phone: `011${Math.floor(Math.random() * 90000000 + 10000000)}` },        // رقم طالب بس
      { name: `فحص ثلاثي ج ${tag}`, phone: `015${Math.floor(Math.random() * 90000000 + 10000000)}`, parentPhone: `012${Math.floor(Math.random() * 90000000 + 10000000)}` }, // الاتنين
    ],
  }),
}, cookie);
ok(bulk3.status === 201 && bulk3.json?.created === 3, `دفعة 3 صفوف (احتياطي الأرقام) = ${bulk3.status} (${bulk3.ms}ms) ${bulk3.status !== 201 ? "→ " + JSON.stringify(bulk3.json ?? bulk3.text).slice(0, 250) : ""}`);

// 4) تحقق الأسماء استُنتجت + الأرقام اتحجزت بالاحتياطي
const q = await api(`/api/students?q=${encodeURIComponent(String(tag))}&pageSize=10`, {}, cookie);
const found = q.json?.students ?? [];
ok(found.length === 5, `الطلاب المضافين ظاهرون = ${found.length}/5`);

// 5) تنظيف: أرشفة كل فحوصات النهاردة
let archived = 0;
for (const s of found) {
  const p = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, cookie);
  if (p.status === 200) archived++;
}
ok(archived === found.length, `تنظيف (أرشفة) = ${archived}/${found.length}`);

console.log(`\n=== E2E: ${[single, bulkMin, bulk3].every((r) => r.status === 201) ? "🎉 كله نجاح" : "⚠️ فيه إخفاق"} ===`);
