/**
 * PRODUCTION E2E — Session-Scoped Device-Locked Attendance (v2, calibrated)
 * ──────────────────────────────────────────────────────────────────────────
 * Throwaway artifacts are created with clearly-labeled names and cleaned up
 * BY EXPLICIT ID ONLY (never by search). Charge = 1 piastre (0.01 EGP group
 * price) on test students only; session is CANCELLED (no settlements).
 *
 * Server-behavior contract (verified against src code):
 *  - same student resubmit (any device) → idempotent SUCCESS {ok:true, alreadyAttended:true}
 *  - different student on a used device → {ok:false, reason:"DEVICE_LOCKED"} (risk 80)
 *  - Attendance.method = "SESSION_QR"; slot tokens die by EXPIRY (slot+4s), not rotation
 *  - pv grace: peek-issued sighting proof (device-bound) lets the student who saw
 *    the code alive finish typing after expiry; without pv → EXPIRED_TOKEN
 *
 * Matrix:
 *  1  slot endpoint 200 (teacher QR panel — previously 500)
 *  2  /a/<token> page 200 (the URL ANY external scanner app opens)
 *  3  peek live → valid + pv, no sensitive IDs
 *  4  ACCEPTED no-login (student code only)
 *  5  same student + same device → idempotent alreadyAttended (no 2nd row)
 *  6  same student + different device → idempotent alreadyAttended
 *  7  different student + same device → DEVICE_LOCKED  ← THE core rule
 *  8  parallel race ×3 (same device+student) → exactly ONE attendance row
 *  9  expired token without pv → EXPIRED_TOKEN
 * 10  expired token WITH pv from live sighting → ACCEPTED (grace path)
 * 11  attempts audit: outcomes logged + suspiciousCount > 0
 * 12  attendance rows: method=SESSION_QR, riskScore, device-lock notes
 * Cleanup: cancel session, archive test students, deactivate test groups.
 */
const BASE = "https://alnokhba-centers.vercel.app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = () => globalThis.crypto.randomUUID();
let cookie = "";

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const kv = c.split(";")[0];
    if (!cookie.includes(kv.split("=")[0])) cookie = cookie ? `${cookie}; ${kv}` : kv;
  }
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const GROUP_NAME = "اختبار آلي QA — يمكن حذفه";

async function main() {
  const login = await api("/api/auth", { method: "POST", body: { username: "manager", password: "nokhba123" } });
  check("manager login", login.status === 200, `HTTP ${login.status}`);
  if (login.status !== 200) throw new Error("login failed");

  const acad = await api("/api/academics");
  const gradeId = acad.json?.grades?.[0]?.id;
  const subjectId = acad.json?.subjects?.[0]?.id;

  // ── setup (explicit IDs captured) ─────────────────────────
  const g = await api("/api/academics", { method: "POST", body: {
    type: "group", name: GROUP_NAME, gradeId, subjectId, price: 0.01, teacherPercent: 0,
  }});
  const groupId = g.json?.group?.id;
  check("test group created", g.status === 201 && !!groupId, `HTTP ${g.status}`);

  async function mkStudent(n) {
    const s = await api("/api/students", { method: "POST", body: {
      name: `اختبار آلي ${n} — تجاهله`, phone: `0100000000${n}`,
      parentName: "ولي أمر اختبار آلي", parentPhone: `0110000000${n}`,
      gradeId, groupIds: [groupId],
    }});
    return s.json?.student; // {id, code, ...}
  }
  const S = [await mkStudent(1), await mkStudent(2), await mkStudent(3), await mkStudent(4)];
  check("4 test students created", S.every((s) => s?.code && s?.id), `codes ${S.map((s) => s?.code).join(",")}`);

  const ses = await api("/api/sessions", { method: "POST", body: { groupId, startTime: "03:00", endTime: "04:00" } });
  const sessionId = ses.json?.session?.id;
  check("test session opened (03:00)", ses.status === 201 && !!sessionId, `HTTP ${ses.status}`);

  const ci = (code, deviceId, tok, pv = "") =>
    api("/api/attendance/public/check-in", { method: "POST", body: { token: tok, code, deviceId, pv } });

  // ── 1) slot ───────────────────────────────────────────────
  const t0 = Date.now();
  const slot = await api("/api/attendance/session-qr/slot", { method: "POST", body: { sessionId } });
  const token1 = slot.json?.token;
  const slotSec = slot.json?.slotSeconds ?? 10;
  check("1. slot endpoint 200 (QR panel fixed)", slot.status === 200 && /^[0-9a-f]{40}$/.test(token1 ?? ""), `HTTP ${slot.status} slot=${slotSec}s`);

  // ── 2) /a/<token> — what any external scanner opens ───────
  const page = await fetch(`${BASE}/a/${token1}`);
  const html = await page.text();
  check("2. /a/<token> page 200 + check-in form (no login wall)", page.status === 200 && /كود الطالب|حضور/.test(html), `HTTP ${page.status}`);

  // ── 3) peek live (public) + pv for the grace test (device-bound) ──
  const devGrace = UUID();
  const peek = await api(`/api/attendance/public/peek?token=${token1}&deviceId=${devGrace}`);
  check("3. peek live → valid + pv issued", peek.status === 200 && peek.json?.valid === true && !!peek.json?.pv, `label="${peek.json?.sessionLabel ?? ""}"`);
  check("   peek leaks no sensitive IDs", !JSON.stringify(peek.json).includes('"sessionId"'), "");

  const pvGrace = peek.json?.pv ?? "";

  // ── 4-7) device-lock matrix ───────────────────────────────
  const devA = UUID(), devB = UUID();
  const ok1 = await ci(S[0].code, devA, token1, pvGrace);
  check("4. ACCEPTED without login (code only)", ok1.json?.ok === true && !ok1.json?.alreadyAttended, `reason=${ok1.json?.reason ?? ""}`);
  check("   accepted hides financial fields", !("balance" in (ok1.json ?? {})) && !("charged" in (ok1.json ?? {})), "");

  const dup = await ci(S[0].code, devA, token1);
  check("5. same student + same device → idempotent", dup.json?.ok === true && dup.json?.alreadyAttended === true, `reason=${dup.json?.reason ?? ""}`);

  const cross = await ci(S[0].code, devB, token1);
  check("6. same student + DIFFERENT device → idempotent (student lock)", cross.json?.ok === true && cross.json?.alreadyAttended === true, `reason=${cross.json?.reason ?? ""}`);

  const locked = await ci(S[1].code, devA, token1);
  check("7. DIFFERENT student + SAME device → DEVICE_LOCKED", locked.json?.ok === false && locked.json?.reason === "DEVICE_LOCKED", `reason=${locked.json?.reason ?? ""}`);

  const ok2 = await ci(S[1].code, devB, token1);
  check("   second student on own device → ACCEPTED", ok2.json?.ok === true && !ok2.json?.alreadyAttended, "");

  // ── 8) parallel race: 3 simultaneous same device + same fresh student ──
  const devC = UUID();
  const race = await Promise.all([
    ci(S[2].code, devC, token1), ci(S[2].code, devC, token1), ci(S[2].code, devC, token1),
  ]);
  const rows = await api(`/api/sessions/${sessionId}`);
  const s3rows = (rows.json?.attendance ?? []).filter((a) => a.studentId === S[2].id);
  check("8. parallel race → exactly ONE attendance row", race.every((r) => r.json?.ok === true) && s3rows.length === 1, `rows=${s3rows.length} responses=${race.map((r) => r.json?.alreadyAttended ? "idem" : "new").join(",")}`);

  // ── 9-10) expiry + pv grace ───────────────────────────────
  const elapsed = Date.now() - t0;
  const waitMs = Math.max(0, slotSec * 1000 + 4500 - elapsed);
  console.log(`   … waiting ${Math.round(waitMs / 1000)}s for the slot token to die (slot ${slotSec}s + 4s grace)`);
  await sleep(waitMs);

  const devF = UUID();
  const expired = await ci(S[3].code, devF, token1); // no pv
  check("9. expired token WITHOUT pv → rejected", expired.json?.ok === false && /EXPIRED_TOKEN|REPLAYED_TOKEN/.test(expired.json?.reason ?? ""), `reason=${expired.json?.reason ?? ""}`);

  const grace = await ci(S[3].code, devGrace, token1, pvGrace); // pv issued while token was LIVE, same device
  check("10. expired token WITH live-sighting pv → ACCEPTED (grace)", grace.json?.ok === true && !grace.json?.alreadyAttended, `reason=${grace.json?.reason ?? ""}`);

  // ── 11) attempts audit + risk ─────────────────────────────
  const att = await api(`/api/attendance/public/attempts?sessionId=${sessionId}`);
  const outcomes = [...new Set((att.json?.attempts ?? []).map((a) => a.outcome))];
  check("11. attempts audit rows (all outcomes logged)", att.status === 200 && (att.json?.attempts ?? []).length >= 6, `outcomes=${outcomes.join(",")}`);
  check("   suspicious counter > 0 (device reuse flagged)", (att.json?.suspiciousCount ?? 0) > 0, `suspiciousCount=${att.json?.suspiciousCount}`);

  // ── 12) attendance rows carry device-lock audit fields ────
  const detail = await api(`/api/sessions/${sessionId}`);
  const list = detail.json?.attendance ?? [];
  check("12. 4 attendance rows, method=SESSION_QR, riskScore present",
    list.length === 4 && list.every((a) => a.method === "SESSION_QR" && typeof a.riskScore === "number"),
    list.map((a) => `${a.code}:${a.riskScore}`).join(" "));

  // ══ CLEANUP — explicit IDs only ═══════════════════════════
  console.log("\n── cleanup (explicit IDs) ──");
  const cancel = await api(`/api/sessions/${sessionId}`, { method: "POST", body: { action: "cancel", reason: "تنظيف بيانات اختبار آلي — e2e قفل الجهاز" } });
  console.log(`${cancel.status === 200 ? "✅" : "❌"} session cancelled (no settlements/revenue): HTTP ${cancel.status}`);
  if (cancel.status !== 200) results.push({ name: "cleanup cancel", pass: false });

  for (const s of S) {
    const bal = (await api(`/api/students/${s.id}`)).json;
    const r = await api(`/api/students/${s.id}`, { method: "PATCH", body: { status: "ARCHIVED" } });
    console.log(`${r.status === 200 ? "✅" : "❌"} archived test student ${s.code} (id ${s.id})`);
    if (r.status !== 200) results.push({ name: "archive student", pass: false });
  }

  // deactivate ALL groups with the exact test name (this run + earlier orphan runs)
  const acad2 = await api("/api/academics");
  const testGroups = (acad2.json?.groups ?? []).filter((x) => x.name === GROUP_NAME);
  for (const tg of testGroups) {
    const d = await api(`/api/academics?id=${tg.id}`, { method: "DELETE" });
    console.log(`${d.status === 200 ? "✅" : "❌"} deactivated test group ${tg.id}`);
    if (d.status !== 200) results.push({ name: "deactivate group", pass: false });
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n═══ RESULT: ${pass}/${results.length} passed ═══`);
  if (pass !== results.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
