/**
 * PROD TIMING DIAG — قياس توقيت فشل POST الطالب (pool timeout؟) + اختبار كتابة غير transactional
 * - PUT /api/preferences (upsert بسيط بدون transaction) — كتابة غير مدمرة (نفس القيم)
 * - POST /api/students بتوقيت دقيق
 * - GET سريع للمقارنة
 */
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

// 1) دخول
const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
const cookie = login.cookie;
console.log(`login: ${login.status} (${login.ms}ms)`);

// 2) قراءة التفضيلات الحالية (عشان نكتب نفس القيم)
const prefGet = await api("/api/preferences", {}, cookie);
console.log(`GET preferences: ${prefGet.status} (${prefGet.ms}ms) → ${JSON.stringify(prefGet.json).slice(0, 120)}`);

// 3) كتابة نفس القيم (upsert بدون transaction) — غير مدمرة
const cur = prefGet.json?.preferences ?? {};
const prefPut = await api("/api/preferences", { method: "PUT", body: JSON.stringify({ theme: cur.theme ?? null, language: cur.language ?? "ar", prefs: cur.prefs ?? {} }) }, cookie);
console.log(`PUT preferences (كتابة عادية): ${prefPut.status} (${prefPut.ms}ms) ${prefPut.status !== 200 ? "→ " + JSON.stringify(prefPut.json ?? prefPut.text).slice(0, 160) : ""}`);

// 4) POST الطالب الفاشل — بالتوقيت
const acad = await api("/api/academics", {}, cookie);
const gradeId = acad.json?.grades?.[0]?.id ?? "";
const phone = `015${String(Math.floor(Math.random() * 90000000 + 10000000))}`;
const t0 = Date.now();
const single = await api("/api/students", {
  method: "POST",
  body: JSON.stringify({ name: `فحص توقيت ${Math.floor(Math.random() * 900 + 100)} تجربة`, phone, parentName: "ولي فحص", parentPhone: `010${String(Math.floor(Math.random() * 90000000 + 10000000))}`, gradeId, groupIds: [] }),
}, cookie);
console.log(`POST /api/students: ${single.status} بعد ${single.ms}ms → ${JSON.stringify(single.json ?? single.text).slice(0, 200)}`);

// 5) تحقق: هل اتسجل؟
const rnd = (single.json ? "" : "");
const q = await api(`/api/students?q=${encodeURIComponent("فحص توقيت")}`, {}, cookie);
const found = q.json?.students ?? [];
console.log(`نتائج الفحص: ${found.length} طالب`);
for (const s of found) {
  const patch = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, cookie);
  console.log(`   تنظيف ${s.code}: ${patch.status}`);
}
