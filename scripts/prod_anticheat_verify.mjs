#!/usr/bin/env node
/* تحقق إنتاجي من طبقة مكافحة الغش على الـ production (آمن — بيانات اختبار بتتنضف) */
const BASE = "https://alnokhba-centers.vercel.app";
let COOKIE = "";
let PASS = 0, FAIL = 0;

function check(name, cond, extra = "") {
  if (cond) { PASS++; console.log(`✅ ${name}`); }
  else { FAIL++; console.log(`❌ ${name} ${extra}`); }
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(COOKIE ? { Cookie: COOKIE } : {}), ...(opts.headers || {}) },
  });
  const sc = res.headers.get("set-cookie");
  if (sc && !COOKIE) COOKIE = sc.split(";")[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const uuid = () => crypto.randomUUID();
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

const D1 = uuid(), D2 = uuid(), D3 = uuid(), D4 = uuid();
const FP1 = "f".repeat(32), FP2 = "e".repeat(32), FP3 = "d".repeat(32);

async function main() {
  // 1) login
  const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
  check("login", login.status === 200);

  // 2) create OPEN session with room pin (future time to avoid conflicts)
  const s = new Date(Date.now() + 3600_000).toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit" });
  const e = new Date(Date.now() + 7200_000).toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit", minute: "2-digit" });
  const mk = await api("/api/sessions", { method: "POST", body: JSON.stringify({
    studentSource: "OPEN", name: `اختبار مضاد الغش ${Date.now()}`, studentCodeLength: 5,
    startTime: s, endTime: e, requireRoomPin: true,
  })});
  check("create OPEN session (pin ON)", mk.status === 201, JSON.stringify(mk.body));
  const sessionId = mk.body.session?.id;

  // 3) slot + room pin
  const slot = await api("/api/attendance/session-qr/slot", { method: "POST", body: JSON.stringify({ sessionId, slotSeconds: 60 }) });
  check("slot + roomPin in response", slot.status === 200 && /^\d{4}$/.test(slot.body.roomPin ?? ""), JSON.stringify(slot.body).slice(0, 120));
  const token = slot.body.token;
  const pin = slot.body.roomPin;

  // 4) peek exposes requireRoomPin + pv
  const peek = await api(`/api/attendance/public/peek?token=${token}&deviceId=${D1}`);
  check("peek requireRoomPin=true + pv", peek.body.requireRoomPin === true && !!peek.body.pv);

  // 5) legal check-in (with fp)
  const c1 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: D1, fp: FP1, name: "أحمد الاختبار", code: "61001", pin, pv: peek.body.pv }) });
  check("legal check-in accepted", c1.body.ok === true, JSON.stringify(c1.body).slice(0, 120));

  // 6) incognito/cleared-storage: new device + SAME fingerprint + different code → blocked
  const c2 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: D2, fp: FP1, name: "أحمد التاني", code: "61002", pin, pv: peek.body.pv }) });
  check("fingerprint lock (incognito simulation) → DEVICE_LOCKED", c2.body.reason === "DEVICE_LOCKED", JSON.stringify(c2.body).slice(0, 100));

  // 7) proxy: same code from a totally different device/fingerprint → CODE_ALREADY_USED
  const c3 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: D3, fp: FP2, name: "كريم النيابة", code: "61001", pin, pv: peek.body.pv }) });
  check("code lock (proxy) → CODE_ALREADY_USED", c3.body.reason === "CODE_ALREADY_USED", JSON.stringify(c3.body).slice(0, 100));

  // 8) wrong room pin → rejected
  const wrongPin = pin === "0000" ? "1111" : "0000";
  const c4 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: D4, fp: FP3, name: "سارة البين", code: "61003", pin: wrongPin, pv: peek.body.pv }) });
  check("wrong room PIN → WRONG_ROOM_PIN", c4.body.reason === "WRONG_ROOM_PIN", JSON.stringify(c4.body).slice(0, 100));

  // 9) correct pin → accepted
  const c5 = await api("/api/attendance/public/check-in", { method: "POST", body: JSON.stringify({ token, deviceId: D4, fp: FP3, name: "سارة الاختبار", code: "61003", pin, pv: peek.body.pv }) });
  check("correct PIN → accepted", c5.body.ok === true, JSON.stringify(c5.body).slice(0, 100));

  // 10) close + cancel test session (cleanup — same pattern as Task P)
  await api(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "close" }) });
  const re = await api(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "reopen", reason: "تنظيف جلسة اختبار مضاد الغش" }) });
  const cancel = await api(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "cancel", reason: "تنظيف جلسة اختبار مضاد الغش" }) });
  check("test session cleaned up (close→reopen→cancel)", re.status === 200 && cancel.status === 200, `re:${re.status} ${JSON.stringify(re.body).slice(0, 80)} cancel:${cancel.status} ${JSON.stringify(cancel.body).slice(0, 80)}`);

  console.log(`\nPROD ANTI-CHEAT: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
