/** مراقبة نشر Vercel — علامة الكود الجديد: POST /api/portal {action:"qr-login"}
 *  بكود قديم → 400 «طلب غير معروف» · بالكود الجديد → 401 (توكن مرفوض بالفورمات).
 *  + فحص تسجيل الأرقام الذكي: bulk برقم دولي +201012345678 لازم يقبل (201) ويُنضّف. */
const BASE = "https://alnokhba-centers-nine.vercel.app";
const MAX_MIN = 15;

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

const t0 = Date.now();
let done = false;
while ((Date.now() - t0) < MAX_MIN * 60 * 1000) {
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const qr = await api("/api/portal", {
    method: "POST",
    body: JSON.stringify({ action: "qr-login", token: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" }),
  });
  if (qr.status === 401) {
    console.log(`[${elapsed}s] 🚀 الكود الجديد منشور! qr-login = 401 (كان 400 على القديم)`);
    done = true;
    break;
  }
  console.log(`[${elapsed}s] لسه القديم — qr-login = ${qr.status}`);
  await new Promise((r) => setTimeout(r, 30000));
}
if (!done) { console.log("انتهى الوقت من غير ما النشر يبان"); process.exit(1); }

// ===== الفحص الذكي: bulk برقم دولي (+20) — لازم يقبل ويخزّن وطني =====
const acad = await api("/api/academics", {}, cookie);
const tag = Math.floor(Math.random() * 9000 + 1000);
const bulk = await api("/api/students/bulk", {
  method: "POST",
  body: JSON.stringify({ students: [{ name: `فحص ذكي ${tag}`, phone: "+20 101 234 5678", parentPhone: "00201212345678" }] }),
}, cookie);
console.log("bulk برقم دولي:", bulk.status, JSON.stringify(bulk.json)?.slice(0, 120));

// التسجيل الفعلي لازم يكون مطبّع وطني 01012345678 — نتحقق من تكرار نفس الرقم الوطني
if (bulk.status === 201) {
  const dup = await api("/api/students/bulk", {
    method: "POST",
    body: JSON.stringify({ students: [{ name: `فحص تكرار ${tag}`, phone: "01012345678" }] }),
  }, cookie);
  console.log("تكرار نفس الرقم بصيغة تانية →", dup.status, dup.status === 422 ? "(422 صح — التطبيع شغال على السيرفر)" : JSON.stringify(dup.json)?.slice(0, 100));
}

// تنظيف: أرشيف فحص النشر
const list = await api("/api/students?q=" + encodeURIComponent("فحص"), {}, cookie);
let archived = 0;
for (const s of list.json?.students ?? []) {
  if (/^فحص (ذكي|تكرار|نشر)/.test(s.name)) {
    const r = await api(`/api/students/${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, cookie);
    if (r.status === 200) archived++;
  }
}
console.log(`تنظيف: ${archived} طالب فحص اتأرشفوا`);
console.log("ALL_DONE");
