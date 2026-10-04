// تحقق إنتاجي سريع — وضعا الحضور (Roster/Open) على الإنتاج
// لا ينشئ بيانات غير قابلة للتنظيف: كل الحصص باسم "اختبار مفتوح" وتُقفل (تُحذف يدويًا أو بالسكريبت لاحقًا)
const BASE = "https://alnokhba-centers.vercel.app";
let PASS = 0, FAIL = 0;
const ok = (name, cond) => { if (cond) { PASS++; console.log(`✅ ${name}`); } else { FAIL++; console.log(`❌ ${name}`); } };

async function api(path, opts = {}, jar) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(jar?.cookie ? { cookie: jar.cookie } : {}), ...(opts.headers ?? {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && jar) jar.cookie = setCookie.split(";")[0];
  let data = null;
  try { data = await res.json(); } catch { /* csv etc */ }
  return { status: res.status, data, text: data ? null : await res.text() };
}

const jar = {};
const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) }, jar);
ok("login", login.status === 200);

// 1) إنشاء حصة مفتوحة بطول كود 7 (لو السكيما مازالت قديمة → 500 هنا)
const create = await api("/api/sessions", { method: "POST", body: JSON.stringify({
  studentSource: "OPEN", name: "اختبار مفتوح 7 — إنتاج", studentCodeLength: 7, startTime: "23:50", endTime: "23:59",
}) }, jar);
ok(`create OPEN session (${create.status})`, create.status === 201 && create.data?.session?.id);
const sid = create.data?.session?.id;

if (sid) {
  // 2) كود QR + peek
  const slot = await api("/api/attendance/session-qr/slot", { method: "POST", body: JSON.stringify({ sessionId: sid }) }, jar);
  ok("slot QR", slot.status === 200 && slot.data?.token);
  const token = slot.data.token;
  const dev = "77777777-7777-4777-8777-777777777001";
  const peek = await api(`/api/attendance/public/peek?token=${token}&deviceId=${dev}`);
  ok("peek OPEN + codeLength=7", peek.data?.valid === true && peek.data?.studentSource === "OPEN" && peek.data?.expectedCodeLength === 7);

  // 3) حضور مفتوح بدون تسجيل دخول (7 أرقام) + طول غلط + قفل جهاز
  const c1 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: dev, name: "طالب إنتاج اختبار", code: "7654321" }) });
  ok("open check-in accepted", c1.data?.ok === true);
  const c2 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: dev, name: "نفس الجهاز", code: "1111111" }) });
  ok("same device locked", c2.data?.reason === "DEVICE_LOCKED");
  const c3 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: "88888888-8888-4888-8888-888888888001", name: "طول غلط", code: "12345" }) });
  ok("wrong length rejected", c3.data?.reason === "INVALID_CODE_LENGTH");

  // 4) قفل + CSV
  const close = await api(`/api/sessions/${sid}`, { method: "POST", body: JSON.stringify({ action: "close" }) }, jar);
  ok(`close OPEN (mode=${close.data?.mode})`, close.data?.closed === true && close.data?.mode === "OPEN");
  const csvRes = await fetch(`${BASE}/api/sessions/${sid}/export`, { headers: { cookie: jar.cookie } });
  const buf = new Uint8Array(await csvRes.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  ok("CSV 200 + BOM bytes + name", csvRes.status === 200 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF && text.includes("طالب إنتاج اختبار"));
  ok("CSV clean (no device/token)", !text.includes("77777777") && !text.includes(token));

  // تنظيف: إعادة فتح ثم إلغاء جلسة الاختبار (مش بتتمسح — بتتلغي وبتفضل في السجل زي باقي جلسات الاختبار)
  await api(`/api/sessions/${sid}`, { method: "POST", body: JSON.stringify({ action: "reopen", reason: "تنظيف جلسة اختبار إنتاج (وضعا الحضور)" }) }, jar);
  await api(`/api/sessions/${sid}`, { method: "POST", body: JSON.stringify({ action: "cancel", reason: "جلسة اختبار وضعا الحضور — تنظيف آلي" }) }, jar);
  console.log(`\nsession: ${sid} (cancelled)`);
}

console.log(`\nPASS ${PASS} / FAIL ${FAIL}`);
process.exit(FAIL ? 1 : 0);
