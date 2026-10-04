#!/usr/bin/env node
/* ============================================================
   Load test — الحضور العام (peek + check-in) تحت ضغط متزامن
   ------------------------------------------------------------
   الأسئلة اللي بيجاوب عليها:
   - حصة واحدة: كام طالب يقدر يمسح ويتسجل في نفس اللحظة؟
   - كذا حصة متزامنة: السعة الكلية بتزيد خطيًا ولا فيه سقف؟

   كل "طالب افتراضي" بيعمل نفس رحلة الطالب الحقيقي:
     GET /a/<token> (الصفحة العامة) → GET peek → POST check-in

   الاستخدام:
     node scripts/loadtest.mjs --base http://localhost:3000 --single --tiers 25,50,100,200
     node scripts/loadtest.mjs --base http://localhost:3000 --multi --sessions 10 --per-session 40
     node scripts/loadtest.mjs --base https://... --single --tiers 50,100,200 --stagger 3000
   ============================================================ */
import { randomUUID } from "crypto";

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const BASE = getArg("--base", "http://localhost:3000");
const STAGGER_MS = Number(getArg("--stagger", "2000")); // كل الطلبة "بيمسحوا" خلال المدة دي
const TIMEOUT_MS = Number(getArg("--timeout", "30000"));
const TIERS = (getArg("--tiers", "25,50,100,200")).split(",").map(Number);
const MULTI_SESSIONS = Number(getArg("--sessions", "10"));
const MULTI_PER = Number(getArg("--per-session", "40"));
const SLOT_SECONDS = Number(getArg("--slot", "60"));

const ARABIC_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";

function uName(i) {
  // أسماء بحروف عربية بس (السيرفر بيرفض الأرقام في الاسم)
  const a = ARABIC_LETTERS[i % ARABIC_LETTERS.length];
  const b = ARABIC_LETTERS[Math.floor(i / ARABIC_LETTERS.length) % ARABIC_LETTERS.length];
  const c = ARABIC_LETTERS[Math.floor(i / (ARABIC_LETTERS.length ** 2)) % ARABIC_LETTERS.length];
  return `طالب الحمل ${a}${b}${c}`;
}

let jarCookie = "";

async function api(path, opts = {}, useJar = true) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (useJar && jarCookie) headers.Cookie = jarCookie;
  const res = await fetch(BASE + path, { ...opts, headers, redirect: "manual" });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    // خد كوكي الجلسة (auth) — كوكي التسجيل بييجي مع أول رد بعد اللوجين
    const m = setCookie.match(/(?:^|,\s*)([^=;]+)=[^;]+/);
    if (m) jarCookie = `${m[1]}=${setCookie.split(";")[0].split(/=(.*)/)[1]}`;
    const full = setCookie.split(";")[0];
    if (full) jarCookie = full;
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function pctl(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function login() {
  const r = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  if (!jarCookie) throw new Error("no session cookie captured");
  return jarCookie;
}

async function createSession(jar, i) {
  const r = await api("/api/sessions", { method: "POST", body: JSON.stringify({
    studentSource: "OPEN", name: `loadtest ${Date.now()}-${i}`, studentCodeLength: 5,
    startTime: "05:00", endTime: "06:00", requireRoomPin: false,
  })});
  if (r.status !== 201) throw new Error(`create session failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.session.id;
}

async function issueSlot(jar, sessionId) {
  const r = await api("/api/attendance/session-qr/slot", { method: "POST", body: JSON.stringify({ sessionId, slotSeconds: SLOT_SECONDS }) });
  if (r.status !== 200) throw new Error(`slot failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

async function closeSession(jar, sessionId) {
  await api(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "close" }) }).catch(() => {});
}

async function virtualStudent(sessionIdx, token, code, name, out, startAt) {
  // انتظار حتى لحظة الانطلاق (توزيع الانطلاق على مدة الـ stagger)
  const wait = startAt + Math.random() * STAGGER_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const device = randomUUID();
  const fp = randomUUID().replace(/-/g, "") + "abcd"; // 36 hex
  const t0 = Date.now();
  let pageMs = 0, peekMs = 0;
  try {
    const p0 = Date.now();
    await fetch(`${BASE}/a/${token}`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.arrayBuffer()).catch(() => {});
    pageMs = Date.now() - p0;
    const p1 = Date.now();
    await fetch(`${BASE}/api/attendance/public/peek?token=${token}&deviceId=${device}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.json()).catch(() => {});
    peekMs = Date.now() - p1;
    const t1 = Date.now();
    const res = await fetch(`${BASE}/api/attendance/public/check-in`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, deviceId: device, fp, name, code, pv: "x" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - t1;
    const body = await res.json().catch(() => ({}));
    out.record({ status: res.status, ms, body, pageMs, peekMs });
  } catch (e) {
    out.record({ status: 0, ms: Date.now() - t1, body: { error: String(e?.message || e).slice(0, 80) }, pageMs, peekMs });
  }
}

function makeCollector() {
  const rows = [];
  return {
    record: (r) => rows.push(r),
    get rows() { return rows; },
  };
}

function report(title, rows, elapsedMs) {
  const ok = rows.filter((r) => r.status === 200 && r.body?.ok === true && r.body?.alreadyAttended !== true);
  const already = rows.filter((r) => r.body?.alreadyAttended === true);
  const biz = rows.filter((r) => r.status === 200 && r.body?.ok === false);
  const r429 = rows.filter((r) => r.status === 429);
  const r5xx = rows.filter((r) => r.status >= 500);
  const fail = rows.filter((r) => r.status === 0);
  const other = rows.filter((r) => r.status !== 200 && r.status !== 429 && r.status !== 0 && r.status < 500);
  const lat = ok.map((r) => r.ms);
  const reasons = {};
  biz.forEach((r) => { reasons[r.body?.reason ?? "?"] = (reasons[r.body?.reason ?? "?"] || 0) + 1; });
  console.log(`\n──── ${title} ────`);
  console.log(`students: ${rows.length} | elapsed: ${(elapsedMs / 1000).toFixed(1)}s | throughput: ${rows.length / (elapsedMs / 1000)}/s`);
  console.log(`accepted: ${ok.length} | already: ${already.length} | business-reject: ${biz.length} ${JSON.stringify(reasons)}`);
  console.log(`429: ${r429.length} | 5xx: ${r5xx.length} | net-fail: ${fail.length} | other: ${other.length}`);
  if (r5xx.length) console.log(`  5xx sample: ${r5xx.slice(0, 2).map((r) => JSON.stringify(r.body).slice(0, 120)).join(" | ")}`);
  if (fail.length) console.log(`  fail sample: ${fail.slice(0, 2).map((r) => r.body.error).join(" | ")}`);
  if (other.length) console.log(`  other sample: ${other.slice(0, 2).map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`).join(" | ")}`);
  if (lat.length) console.log(`check-in latency → p50: ${pctl(lat, 50)}ms | p95: ${pctl(lat, 95)}ms | p99: ${pctl(lat, 99)}ms | max: ${Math.max(...lat)}ms`);
  const okRatios = (ok.length / rows.length) * 100;
  console.log(`success rate: ${okRatios.toFixed(1)}%`);
  return { ok: ok.length, total: rows.length };
}

const jar = await login();

/* ============ الوضع 1: حصة واحدة — سلالم تزامن (حصة مستقلة لكل درجة) ============ */
if (has("--single") || !has("--multi")) {
  console.log("single-session load test — session per tier");
  const results = [];
  for (const n of TIERS) {
    const sessionId = await createSession(jar, `t${n}`);
    let token = await issueSlot(jar, sessionId);
    // مهمّة تجديد التوكن — السلوت بيموت كل 60ث والطلبة بيكتبوا بعده
    const rotator = setInterval(async () => { try { token = await issueSlot(jar, sessionId); } catch {} }, (SLOT_SECONDS - 8) * 1000);
    const out = makeCollector();
    const startAt = Date.now();
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const myToken = token; // اللي انطلق بدالكود ده — لو اتدوّر والهو بيكتب، الـ pv مش هيكون عنده (زي الواقع)
      jobs.push(virtualStudent(0, myToken, String(30000 + i), uName(i), out, startAt));
    }
    await Promise.all(jobs);
    clearInterval(rotator);
    const elapsed = Date.now() - startAt;
    results.push(report(`single session — ${n} concurrent students`, out.rows, elapsed));
    await closeSession(jar, sessionId);
    await new Promise((r) => setTimeout(r, 1500)); // نفس بين الطبقات
  }
  console.log(`\nSUMMARY single-session: ${results.map((r) => `${r.ok}/${r.total}`).join(" → ")}`);
}

/* ============ الوضع 2: كذا حصة متزامنة ============ */
if (has("--multi")) {
  console.log(`multi-session load test — ${MULTI_SESSIONS} sessions × ${MULTI_PER} students = ${MULTI_SESSIONS * MULTI_PER} total`);
  const sessionIds = [];
  for (let i = 0; i < MULTI_SESSIONS; i++) sessionIds.push(await createSession(jar, i));
  const tokens = [];
  for (const sid of sessionIds) tokens.push(await issueSlot(jar, sid));
  const rotator = setInterval(async () => {
    for (let i = 0; i < sessionIds.length; i++) { try { tokens[i] = await issueSlot(jar, sessionIds[i]); } catch {} }
  }, (SLOT_SECONDS - 8) * 1000);
  const out = makeCollector();
  const startAt = Date.now();
  const jobs = [];
  let k = 0;
  for (let s = 0; s < MULTI_SESSIONS; s++) {
    for (let i = 0; i < MULTI_PER; i++) {
      const myToken = tokens[s];
      jobs.push(virtualStudent(s, myToken, String(30000 + (k % 60000)), uName(k), out, startAt));
      k++;
    }
  }
  await Promise.all(jobs);
  clearInterval(rotator);
  const elapsed = Date.now() - startAt;
  const r = report(`${MULTI_SESSIONS} sessions × ${MULTI_PER} students`, out.rows, elapsed);
  for (const sid of sessionIds) await closeSession(jar, sid);
  console.log(`\nSUMMARY multi-session: ${r.ok}/${r.total}`);
}

console.log("\nملاحظة: الحصص اتقفلت (CLOSED) — التنظيف النهائي بيتم بـ scripts/cleanup_loadtest.ts");
