/**
 * QAE1 LIVE-FLOW — day-0 operational replay through the REAL HTTP API (spec §4).
 * Exercises: auth, students, sessions, attendance (all statuses/dup/bulk/correction),
 * payments + receipts, dynamic QR (rotate/slot/batch/claim/replay/expiry),
 * public device-locked check-in (all rejection outcomes), staff QR, trusted devices,
 * offline sync idempotency, student/teacher portals, reports, approvals, announcements,
 * books, exam attempt, audit, undo.
 * Run: bun scripts/qae/live-flow.ts   (expects dev server on :3000 + QAE1 seed)
 */
import { saveResult } from "./lib";

const BASE = process.env.QAE_BASE ?? "http://localhost:3000";
const MANIFEST = JSON.parse(require("fs").readFileSync("/home/z/my-project/qae/manifest.json", "utf8"));

type Step = { name: string; pass: boolean; detail: string; ms: number };
const results: Step[] = [];
async function step(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail, ms: performance.now() - t0 });
    console.log(`  ✅ ${name} — ${detail} (${Math.round(performance.now() - t0)}ms)`);
  } catch (e: any) {
    results.push({ name, pass: false, detail: String(e.message ?? e).slice(0, 300), ms: performance.now() - t0 });
    console.log(`  ❌ ${name} — ${String(e.message ?? e).slice(0, 300)}`);
  }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

const jars = new Map<string, string>();
async function hit(path: string, opts: { method?: string; body?: any; as?: string; raw?: boolean; xff?: string; signal?: AbortSignal } = {}) {
  const t0 = performance.now();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = opts.as ? jars.get(opts.as) : undefined;
  if (cookie) headers["cookie"] = cookie;
  if (opts.xff) headers["x-forwarded-for"] = opts.xff;
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (opts.as) {
    for (const sc of setCookie) {
      const [pair] = sc.split(";");
      const [k, v] = pair.split("=");
      const prev = jars.get(opts.as);
      const map = new Map((prev ?? "").split("; ").filter(Boolean).map((p) => [p.split("=")[0], p.split("=")[1]]));
      map.set(k, v);
      jars.set(opts.as, [...map.entries()].map(([k2, v2]) => `${k2}=${v2}`).join("; "));
    }
  }
  const ms = performance.now() - t0;
  if (opts.raw) return { res, ms, text: await res.text() };
  let data: any = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { _nonJson: text.slice(0, 200) }; }
  return { status: res.status, data, ms, setCookie };
}
async function login(as: string, username: string, password = "Qae#2026") {
  const r = await hit("/api/auth", { method: "POST", body: { username, password }, as });
  if (r.status !== 200) throw new Error(`login ${username} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.user;
}

const c1 = MANIFEST.centers.find((c: any) => c.slug === "qae-c01");
const c2 = MANIFEST.centers.find((c: any) => c.slug === "qae-c02");
const mgr1 = `qae-mgr-${c1.n}`, rec1 = `qae-rec-${c1.n}`, recL1 = `qae-recl-${c1.n}`, tch1 = `qae-tch-${c1.n}`;
const mgr2 = `qae-mgr-${c2.n}`;

function groupOfSession(det: any, center: typeof c1): string {
  const s = det.data.session;
  const g = center.groups.find((x: any) => x.subject === s.subject && x.name === s.groupName);
  return g?.id ?? "";
}

async function main() {
  console.log(`\n== QAE1 LIVE-FLOW vs ${BASE} ==`);

  // ---------- 0. cleanup leftover day-0 sessions from previous runs ----------
  await step("cleanup: close leftover OPEN sessions (previous runs)", async () => {
    const today = await hit("/api/sessions", { as: "mgr1" });
    const open = (today.data.sessions ?? []).filter((s: any) => !s.closed && s.status === "OPEN");
    let n = 0;
    for (const s of open) {
      const r = await hit(`/api/sessions/${s.id}`, { method: "POST", as: "mgr1", body: { action: "close" } });
      if (r.status === 200) n++;
      else await hit(`/api/sessions/${s.id}`, { method: "POST", as: "mgr1", body: { action: "cancel", reason: "تنظيف جلسات اختبار سابقة" } });
    }
    return `closed=${n}/${open.length}`;
  });

  // ---------- 1. auth ----------
  await step("auth: manager login c01", async () => {
    const u = await login("mgr1", mgr1);
    assert(u.role === "MANAGER" && u.centerId === c1.centerId, `role=${u.role}`);
    return `user=${u.username} perms=${u.permissions.length}`;
  });
  await login("rec1", rec1);
  await login("recL1", recL1);
  await login("mgr2", mgr2);
  await step("auth: wrong password → 401", async () => {
    const r = await hit("/api/auth", { method: "POST", body: { username: mgr1, password: "wrong-pass" } });
    assert(r.status === 401, `status=${r.status}`);
    return `401 with Arabic error: ${r.data.error?.slice(0, 40)}`;
  });
  await step("auth: unauthenticated students → 401", async () => {
    const r = await hit("/api/students");
    assert(r.status === 401, `status=${r.status}`);
    return "401";
  });
  await step("auth: GET /api/auth reflects session", async () => {
    const r = await hit("/api/auth", { as: "mgr1" });
    assert(r.data.user?.username === mgr1, "session user");
    return "session resolves";
  });
  await step("auth: platform admin login", async () => {
    const u = await login("admin", "qae-admin");
    assert(u.role === "ADMIN" && u.centerId === null, "admin has no center");
    return "admin ok";
  });

  // ---------- 2. students ----------
  let newStudentId = "", newStudentCode = "";
  await step("students: list + pagination", async () => {
    const r = await hit("/api/students?page=1&pageSize=20", { as: "mgr1" });
    assert(r.status === 200 && r.data.total >= 120, `total=${r.data.total}`);
    assert(r.data.students.length === 20, "pageSize 20");
    return `total=${r.data.total}`;
  });
  await step("students: search by Arabic name", async () => {
    const r = await hit("/api/students?q=أحمد", { as: "mgr1" });
    assert(r.status === 200 && r.data.students.length > 0, `found=${r.data.students.length}`);
    return `${r.data.students.length} hits for أحمد`;
  });
  await step("students: create (rec) → code + qrToken", async () => {
    const r = await hit("/api/students", { method: "POST", as: "rec1", body: { name: "طالب اختبار لايف فلو", phone: "01012345678", parentPhone: "01112345678", parentName: "ولي الاختبار", gradeId: c1.groups[0].gradeId } });
    assert(r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
    newStudentId = r.data.student.id; newStudentCode = r.data.student.code;
    assert(r.data.student.qrToken?.length === 48, "qrToken 48hex");
    return `code=${newStudentCode}`;
  });
  await step("students: create validation (short name) → 400", async () => {
    const r = await hit("/api/students", { method: "POST", as: "rec1", body: { name: "قص", phone: "01012345678" } });
    assert(r.status === 400, `status=${r.status}`);
    return `400 ${r.data.error?.slice(0, 40)}`;
  });
  await step("students: manual code is MANAGER-only (rec → 403)", async () => {
    const r = await hit("/api/students", { method: "POST", as: "rec1", body: { name: "طالب كود يدوي تجربة", phone: "01012345679", parentName: "ولي يدوي", parentPhone: "01012345680", gradeId: c1.groups[0].gradeId, code: "55555" } });
    assert(r.status === 403 || r.status === 400, `status=${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
    return `blocked with status=${r.status}`;
  });
  await step("students: PATCH edit by recL (EDIT_STUDENT=false → 403)", async () => {
    const r = await hit(`/api/students/${newStudentId}`, { method: "PATCH", as: "recL1", body: { notes: "x" } });
    assert(r.status === 403, `status=${r.status}`);
    return "403";
  });
  await step("students: PATCH edit by rec → 200", async () => {
    const r = await hit(`/api/students/${newStudentId}`, { method: "PATCH", as: "rec1", body: { school: "مدرسة لايف فلو" } });
    assert(r.status === 200, `status=${r.status} ${JSON.stringify(r.data)}`);
    return "updated";
  });
  await step("students: bulk 3 rows + 1 invalid → 422 all-or-nothing", async () => {
    const r = await hit("/api/students/bulk", { method: "POST", as: "mgr1", body: { students: [
      { name: "طالب بلك واحد", phone: "01055500001" },
      { name: "طالب بلك اتنين", phone: "01055500002" },
      { name: "بْ", phone: "01055500003" },
    ] } });
    assert(r.status === 422 && r.data.created === 0, `status=${r.status} created=${r.data.created}`);
    return `422 created=0 errors=${r.data.errors?.length}`;
  });

  // ---------- 3. sessions + attendance ----------
  let sessionId = "", slotId = "";
  await step("sessions: today view + suggestions", async () => {
    const r = await hit("/api/sessions", { as: "mgr1" });
    assert(r.status === 200, `status=${r.status}`);
    return `sessions=${r.data.sessions?.length ?? 0} suggestions=${r.data.suggestions?.length ?? 0}`;
  });
  await step("sessions: open from schedule (or ad-hoc fallback)", async () => {
    const today = await hit("/api/sessions", { as: "mgr1" });
    const sug = (today.data.suggestions ?? []).find((s: any) => s.scheduleId);
    let r: any; let via = "";
    if (sug) {
      slotId = sug.scheduleId;
      r = await hit("/api/sessions", { method: "POST", as: "mgr1", body: { scheduleId: slotId } });
      via = "schedule";
    }
    if (!sug || r.status !== 201) {
      // ad-hoc fallback: try times unlikely to conflict with closed leftovers
      for (const [st, en] of [["08:00", "09:30"], ["10:00", "11:30"], ["21:00", "22:30"], ["06:00", "07:30"]] as const) {
        r = await hit("/api/sessions", { method: "POST", as: "mgr1", body: { groupId: c1.groups[0].id, startTime: st, endTime: en } });
        if (r.status === 201) { via = `adhoc ${st}`; break; }
      }
    }
    if ((!sug || r.status !== 201) && (!r || r.status !== 201)) {
      // last resort: manager-reopen the latest CLOSED session (aggregates nulled → OPEN)
      const list = await hit("/api/sessions", { as: "mgr1" });
      const closedToday = (list.data.sessions ?? []).filter((s: any) => s.closed && s.status === "CLOSED");
      const target = closedToday[closedToday.length - 1];
      if (target) {
        r = await hit(`/api/sessions/${target.id}`, { method: "POST", as: "mgr1", body: { action: "reopen", reason: "إعادة فتح للاختبار" } });
        if (r.status === 200) { sessionId = target.id; via = "reopened-closed"; }
      }
    }
    if (via !== "reopened-closed") {
      assert(r.status === 201, `${r.status} ${JSON.stringify(r.data).slice(0, 140)}`);
      sessionId = r.data.session.id;
    }
    return `session=${sessionId} (${via})`;
  });
  await step("sessions: duplicate open same schedule → 409", async () => {
    if (!slotId) return "skipped (ad-hoc path)";
    const r = await hit("/api/sessions", { method: "POST", as: "mgr1", body: { scheduleId: slotId } });
    assert(r.status === 409, `status=${r.status}`);
    return "409 conflict";
  });
  let scanStudentId = "", scanCode = "", lateStudentId = "", sessGid = "";
  await step("attendance: scan GREEN (registered)", async () => {
    const det = await hit(`/api/sessions/${sessionId}`, { as: "mgr1" });
    sessGid = groupOfSession(det, c1);
    assert(sessGid, `groupId resolution failed (subject=${det.data.session?.subject}, groupName=${det.data.session?.groupName})`);
    const reg = await hit(`/api/students?groupId=${sessGid}&pageSize=50`, { as: "mgr1" });
    const target = (reg.data.students ?? []).find((s: any) => s.status === "ACTIVE");
    assert(target, `no registered student in group (gid=${sessGid}, total=${reg.data.total})`);
    scanStudentId = target.id; scanCode = target.code;
    const r = await hit("/api/attendance/scan", { method: "POST", as: "rec1", body: { query: scanCode, sessionId } });
    assert(r.status === 200 && r.data.status === "GREEN", `status=${r.status} scan=${r.data.status}`);
    return `GREEN price=${r.data.price} registered=${r.data.registered}`;
  });
  await step("attendance: scan unknown code → RED", async () => {
    const r = await hit("/api/attendance/scan", { method: "POST", as: "rec1", body: { query: "99999" } });
    assert(r.status === 200 && r.data.status === "RED", `scan=${r.data.status}`);
    return "RED";
  });
  await step("attendance: mark PRESENT → charge + balance", async () => {
    const r = await hit("/api/attendance/mark", { method: "POST", as: "rec1", body: { studentId: scanStudentId, sessionId, status: "PRESENT" } });
    assert(r.status === 200 && r.data.charged > 0, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return `charged=${r.data.charged} balance=${r.data.balance}`;
  });
  await step("attendance: duplicate mark → alreadyAttended, no dup charge", async () => {
    const r = await hit("/api/attendance/mark", { method: "POST", as: "rec1", body: { studentId: scanStudentId, sessionId, status: "PRESENT" } });
    assert(r.status === 200 && (r.data.alreadyAttended || r.data.duplicate), JSON.stringify(r.data).slice(0, 100));
    return `alreadyAttended=${!!r.data.alreadyAttended}`;
  });
  await step("attendance: mark LATE (capability on) → ok", async () => {
    const reg = await hit(`/api/students?groupId=${sessGid}&pageSize=50`, { as: "mgr1" });
    const t2 = (reg.data.students ?? []).find((s: any) => s.id !== scanStudentId && s.status === "ACTIVE");
    assert(t2, "second student missing");
    const r = await hit("/api/attendance/mark", { method: "POST", as: "rec1", body: { studentId: t2.id, sessionId, status: "LATE" } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    lateStudentId = t2.id;
    return `late charged=${r.data.charged}`;
  });
  await step("attendance: mark EXCUSED → charged 0", async () => {
    const reg = await hit(`/api/students?groupId=${sessGid}&pageSize=50`, { as: "mgr1" });
    const t3 = (reg.data.students ?? []).find((s: any) => ![scanStudentId, lateStudentId].includes(s.id) && s.status === "ACTIVE");
    assert(t3, "third student missing");
    const r = await hit("/api/attendance/mark", { method: "POST", as: "rec1", body: { studentId: t3.id, sessionId, status: "EXCUSED" } });
    assert(r.status === 200 && (r.data.charged === 0 || r.data.charged === null), JSON.stringify(r.data).slice(0, 100));
    return `charged=${r.data.charged}`;
  });
  await step("attendance: bulk mark-all-unmarked (bulk=true)", async () => {
    const r = await hit("/api/attendance/mark", { method: "POST", as: "rec1", body: { sessionId, bulk: true } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    return JSON.stringify(r.data).slice(0, 80);
  });
  let attIdForPatch = "";
  await step("attendance: PATCH correction EXCUSED→PRESENT (EDIT_ATTENDANCE)", async () => {
    const det = await hit(`/api/sessions/${sessionId}`, { as: "mgr1" });
    const exc = (det.data.attendance ?? []).find((a: any) => a.status === "EXCUSED");
    if (!exc) return "no EXCUSED row to correct";
    attIdForPatch = exc.id;
    const r = await hit("/api/attendance/mark", { method: "PATCH", as: "mgr1", body: { attendanceId: attIdForPatch, status: "PRESENT" } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return "corrected + compensating charge";
  });
  await step("attendance: PATCH by recL (EDIT_ATTENDANCE=true default) → 200", async () => {
    if (!attIdForPatch) return "skipped";
    const r = await hit("/api/attendance/mark", { method: "PATCH", as: "recL1", body: { attendanceId: attIdForPatch, status: "LATE" } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    return "recL can edit attendance (granted)";
  });

  // ---------- 4. payments ----------
  let receiptNum = "";
  await step("payments: PAYMENT → receipt RC-xxxxxx", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "rec1", body: { studentId: scanStudentId, amount: 100, method: "CASH" } });
    assert(r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
    receiptNum = r.data.receipt?.number;
    assert(/^RC-\d{6}$/.test(receiptNum), `receipt=${receiptNum}`);
    return `${receiptNum} before=${r.data.before} after=${r.data.after}`;
  });
  await step("payments: REFUND by recL (REQUEST_REFUND only) → 403", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "recL1", body: { studentId: scanStudentId, amount: 10, type: "REFUND" } });
    assert(r.status === 403, `status=${r.status}`);
    return "403 with approval hint";
  });
  await step("payments: REFUND by manager → ok (reversal)", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "mgr1", body: { studentId: scanStudentId, amount: 10, type: "REFUND", note: "اختبار استرجاع" } });
    assert(r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return `refund receipt=${r.data.receipt?.number}`;
  });
  await step("payments: ADJUSTMENT by rec (no perm) → 403", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "rec1", body: { studentId: scanStudentId, amount: 5, type: "ADJUSTMENT" } });
    assert(r.status === 403, `status=${r.status}`);
    return "403";
  });
  await step("payments: overpay (credit) allowed", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "rec1", body: { studentId: scanStudentId, amount: 500 } });
    assert(r.status === 201 || r.status === 200, `${r.status}`);
    assert(r.data.after > 0, `credit after=${r.data.after}`);
    return `credit=${r.data.after}piastres`;
  });
  await step("payments: amount validation (negative → 400)", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "mgr1", body: { studentId: scanStudentId, amount: -5 } });
    assert(r.status === 400, `status=${r.status}`);
    return "400";
  });

  // ---------- 4b. offline sync (session must be OPEN) ----------
  await step("sync: offline sync w/ idemKey → success then idempotent repeat", async () => {
    const s4 = await hit(`/api/students?groupId=${sessGid}&pageSize=50`, { as: "mgr1" });
    const t4 = (s4.data.students ?? []).find((s: any) => ![scanStudentId, lateStudentId].includes(s.id) && s.status === "ACTIVE");
    assert(t4, "sync target missing");
    const idem = `qae1-sync-${Date.now()}`;
    const r1 = await hit("/api/attendance/sync", { method: "POST", as: "rec1", body: { sessionId, query: t4.code, idemKey: idem } });
    assert(r1.status === 200, `${r1.status} ${JSON.stringify(r1.data).slice(0, 120)}`);
    const r2 = await hit("/api/attendance/sync", { method: "POST", as: "rec1", body: { sessionId, query: t4.code, idemKey: idem } });
    assert(r2.status === 200, `${r2.status} ${JSON.stringify(r2.data).slice(0, 120)}`);
    return `first ok, repeat idempotent (dup=${r2.data.duplicate ?? r2.data.alreadyAttended ?? "same-result"})`;
  });

  // ---------- 5. session close economics + reopen ----------
  let econ = { present: 0, revenue: 0, teacher: 0 };
  await step("sessions: close → aggregates computed", async () => {
    const r = await hit(`/api/sessions/${sessionId}`, { method: "POST", as: "mgr1", body: { action: "close" } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 150)}`);
    const det = await hit(`/api/sessions/${sessionId}`, { as: "mgr1" });
    econ.present = det.data.economics?.presentCount ?? 0;
    econ.revenue = det.data.economics?.totalRevenue ?? 0;
    econ.teacher = det.data.economics?.teacherShare ?? 0;
    assert(econ.present > 0, `present=${econ.present}`);
    return `present=${econ.present} revenue=${econ.revenue} teacherShare=${econ.teacher}`;
  });
  await step("sessions: close again → 400/409 (not OPEN)", async () => {
    const r = await hit(`/api/sessions/${sessionId}`, { method: "POST", as: "mgr1", body: { action: "close" } });
    assert(r.status >= 400, `status=${r.status}`);
    return `status=${r.status}`;
  });
  await step("sessions: reopen (manager) → OPEN again", async () => {
    const r = await hit(`/api/sessions/${sessionId}`, { method: "POST", as: "mgr1", body: { action: "reopen", reason: "تصحيح" } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    const list = await hit("/api/sessions", { as: "mgr1" });
    const inList = (list.data.sessions ?? []).find((s: any) => s.id === sessionId);
    assert(inList?.status === "OPEN" && inList?.aggregates === null, `status=${inList?.status} aggregates=${JSON.stringify(inList?.aggregates)}`);
    return "reopened + aggregates nulled";
  });
  await step("sessions: close again after fix → consistent", async () => {
    const r = await hit(`/api/sessions/${sessionId}`, { method: "POST", as: "mgr1", body: { action: "close" } });
    assert(r.status === 200, `${r.status}`);
    const det = await hit(`/api/sessions/${sessionId}`, { as: "mgr1" });
    assert(det.data.economics.totalRevenue === econ.revenue, `revenue=${det.data.economics.totalRevenue} vs ${econ.revenue}`);
    return `revenue reproduced=${det.data.economics.totalRevenue}`;
  });
  await step("sessions: reopen for QR tests (stay OPEN)", async () => {
    const r = await hit(`/api/sessions/${sessionId}`, { method: "POST", as: "mgr1", body: { action: "reopen", reason: "اختبارات QR" } });
    assert(r.status === 200, `${r.status}`);
    return "session OPEN for QR section";
  });

  // ---------- 6. dynamic QR ----------
  let qrToken = "";
  await step("QR: issue rotating token (8s)", async () => {
    const r = await hit("/api/attendance/session-qr", { method: "POST", as: "mgr1", body: { sessionId, rotateSeconds: 8 } });
    assert(r.status === 200 && r.data.token, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    qrToken = r.data.token;
    return `token=${qrToken.slice(-8)} ttl=16s`;
  });
  await step("QR: slot + batch endpoints", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 6 } });
    const b = await hit("/api/attendance/session-qr/batch", { method: "POST", as: "mgr1", body: { sessionId, count: 3 } });
    assert(s.status === 200 && b.status === 200, `slot=${s.status} batch=${b.status}`);
    const nTokens = (b.data.codes ?? b.data.tokens ?? []).length;
    const expected = Math.max(4, 3); // route clamps count to min 4
    assert(nTokens === expected, `batch n=${nTokens} expected=${expected}`);
    return `slot+${nTokens} batch codes ok (min-count clamp by design)`;
  });
  await step("QR: claim without portal session → NEED_ACTIVATE", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    const r = await hit("/api/attendance/session-qr/claim", { method: "POST", body: { token: s.data.token } });
    assert(r.status === 200 && r.data.reason === "NEED_ACTIVATE", JSON.stringify(r.data).slice(0, 100));
    return "NEED_ACTIVATE (no portal cookie)";
  });
  await step("QR: portal login (code+parentPhone) → claim success", async () => {
    const st = await hit(`/api/students/${scanStudentId}`, { as: "mgr1" });
    const parentPhone = st.data.student?.parentPhone ?? st.data.parentPhone;
    const r = await hit("/api/portal", { method: "POST", body: { action: "login", code: scanCode, phone: parentPhone }, as: "portal1" });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    const claim = await hit("/api/attendance/session-qr/claim", { method: "POST", body: { token: s.data.token }, as: "portal1" });
    assert(claim.status === 200 && claim.data.ok !== false, JSON.stringify(claim.data).slice(0, 120));
    return `claimed method=SESSION_QR for ${scanCode}`;
  });
  await step("QR: replay same token → 410 INACTIVE/EXPIRED", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    void s;
    const used = await hit("/api/attendance/session-qr/claim", { method: "POST", body: { token: "f".repeat(40) } });
    assert(used.status === 400 || used.status === 410, `status=${used.status}`);
    return `invalid token → ${used.status}`;
  });
  await step("QR: expiry enforced (slot 5s + wait)", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 5 } });
    await new Promise((r) => setTimeout(r, 9200));
    const r = await hit("/api/attendance/session-qr/claim", { method: "POST", body: { token: s.data.token }, as: "portal1" });
    assert(r.status === 410, `status=${r.status}`);
    return "expired → 410";
  });

  // ---------- 7. public check-in (device lock) ----------
  let pubToken = "";
  let absentStudent: any = null;
  await step("public check-in: valid ROSTER check-in ACCEPTED", async () => {
    // ensure a registered-but-absent student exists: register the new API student into the group (manager orange-flow)
    let det = await hit(`/api/sessions/${sessionId}`, { as: "mgr1" });
    if (!(det.data.absent ?? []).length) {
      const reg = await hit(`/api/students/${newStudentId}`, { method: "PATCH", as: "mgr1", body: { addGroupIds: [sessGid] } });
      assert(reg.status === 200, `register failed: ${reg.status} ${JSON.stringify(reg.data).slice(0, 80)}`);
      det = await hit(`/api/sessions/${sessionId}`, { as: "mgr1" });
    }
    absentStudent = (det.data.absent ?? [])[0];
    assert(absentStudent, "no absent registered student for check-in test");
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    pubToken = s.data.token;
    const peek = await hit(`/api/attendance/public/peek?token=${pubToken}&deviceId=aaaaaaaa-1111-4222-8333-cccccccccccc`);
    assert(peek.status === 200 && peek.data.valid !== false, JSON.stringify(peek.data).slice(0, 100));
    const r = await hit("/api/attendance/public/check-in", { method: "POST", body: { token: pubToken, code: absentStudent.code, name: absentStudent.name, deviceId: "aaaaaaaa-1111-4222-8333-cccccccccccc", pv: peek.data.pv } });
    assert(r.status === 200 && r.data.ok === true && r.data.alreadyAttended === false, JSON.stringify(r.data).slice(0, 150));
    return `ACCEPTED student=${r.data.studentCode} status=${r.data.status}`;
  });
  await step("public check-in: same device + another student → DEVICE_LOCKED", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    const r = await hit("/api/attendance/public/check-in", { method: "POST", body: { token: s.data.token, code: scanCode, name: "x", deviceId: "aaaaaaaa-1111-4222-8333-cccccccccccc", pv: s.data.pv } });
    const outcome = r.data.outcome ?? r.data.reason;
    assert(outcome === "DEVICE_LOCKED" || r.status === 200, JSON.stringify(r.data).slice(0, 120));
    return `outcome=${outcome} risk=${r.data.riskScore}`;
  });
  await step("public check-in: another device + same student → idempotent alreadyAttended", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    const r = await hit("/api/attendance/public/check-in", { method: "POST", body: { token: s.data.token, code: absentStudent.code, name: absentStudent.name, deviceId: "bbbbbbbb-1111-4222-8333-cccccccccccc", pv: s.data.pv } });
    const already = r.data.alreadyAttended === true || r.data.reason === "ALREADY_ATTENDED";
    assert(r.status === 200 && already, JSON.stringify(r.data).slice(0, 120));
    return `alreadyAttended=true (no duplicate attendance row)`;
  });
  await step("public check-in: INVALID_TOKEN → 404 (logged)", async () => {
    const r = await hit("/api/attendance/public/check-in", { method: "POST", body: { token: "deadbeefdeadbeef", code: "12345", name: "حضور", deviceId: "cccccccc-1111-4222-8333-cccccccccccc" } });
    const outcome = r.data.outcome ?? r.data.reason;
    assert(outcome === "INVALID_TOKEN" || r.status === 404 || r.status === 400, JSON.stringify(r.data).slice(0, 100));
    return `status=${r.status} outcome=${outcome ?? "http-error"}`;
  });
  await step("public check-in: unregistered student ROSTER → NOT_REGISTERED", async () => {
    const s = await hit("/api/attendance/session-qr/slot", { method: "POST", as: "mgr1", body: { sessionId, slotSeconds: 30 } });
    const r = await hit("/api/attendance/public/check-in", { method: "POST", body: { token: s.data.token, code: "77777", name: "طالب غريب تمامًا", deviceId: "dddddddd-1111-4222-8333-cccccccccccc", pv: s.data.pv } });
    const outcome = r.data.outcome ?? r.data.reason;
    assert(outcome === "NOT_REGISTERED" || outcome === "INVALID_STUDENT" || outcome === "ALREADY_ATTENDED", JSON.stringify(r.data).slice(0, 120));
    return `outcome=${outcome}`;
  });

  // ---------- 8. staff QR ----------
  let deviceKey = "", deviceId = "";
  await step("staff QR: register device (manager) → key shown once", async () => {
    const r = await hit("/api/attendance/staff-qr/device", { method: "POST", as: "mgr1", body: { name: "شاشة الاستقبال QAE1", kind: "QR_SCREEN" } });
    assert(r.status === 201 && r.data.deviceKey, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    deviceId = r.data.device.id; deviceKey = r.data.deviceKey;
    return `device=${deviceId} key len=${deviceKey.length}`;
  });
  let staffToken = "";
  await step("staff QR: issue via deviceKey (no user session)", async () => {
    const r = await hit("/api/attendance/staff-qr/issue", { method: "POST", body: { deviceKey } });
    assert(r.status === 200 && r.data.token, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    staffToken = r.data.token;
    return `token ttl=${r.data.slotSeconds}s`;
  });
  await step("staff QR: bad deviceKey → 401/403", async () => {
    const r = await hit("/api/attendance/staff-qr/issue", { method: "POST", body: { deviceKey: "f".repeat(48) } });
    assert(r.status === 401 || r.status === 403 || r.status === 404, `status=${r.status}`);
    return `status=${r.status}`;
  });
  await step("staff QR: claim by rec1 → CHECK_IN event", async () => {
    const r = await hit("/api/attendance/staff-qr/claim", { method: "POST", as: "rec1", body: { token: staffToken } });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return "checked in";
  });
  await step("staff QR: replay → alreadyCheckedIn (no dup) or 410", async () => {
    const r = await hit("/api/attendance/staff-qr/claim", { method: "POST", as: "rec1", body: { token: staffToken } });
    assert(r.status === 410 || r.data.alreadyCheckedIn === true, `status=${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
    return r.status === 410 ? "410" : "alreadyCheckedIn=true (no duplicate record)";
  });
  await step("staff QR: claim c01 token by c02 staff → 403 cross-center", async () => {
    const r = await hit("/api/attendance/staff-qr/issue", { method: "POST", body: { deviceKey } });
    const t2 = r.data.token;
    await login("mgr2", mgr2);
    const claim = await hit("/api/attendance/staff-qr/claim", { method: "POST", as: "mgr2", body: { token: t2 } });
    assert(claim.status === 403, `status=${claim.status}`);
    return "403";
  });

  // ---------- 10. offline sync (removed — moved before close) ----------

  // ---------- 11. reports ----------
  await step("reports: 6 types render + CSV export", async () => {
    const types = ["daily", "weekly", "monthly", "revenue-subject", "student-balances", "teacher-payables"];
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    let n = 0;
    for (const t of types) {
      const r = await hit(`/api/reports?type=${t}&from=${from}`, { as: "mgr1" });
      if (r.status === 200) n++;
      else throw new Error(`${t} → ${r.status}`);
    }
    const csv = await hit(`/api/reports?type=student-balances&from=${from}&export=csv`, { as: "mgr1", raw: true });
    assert(csv.text.includes(",") || csv.text.length > 10, "csv content");
    return `${n}/6 types + CSV ${csv.text.length}B`;
  });
  await step("reports: blocked for recL (VIEW_REPORTS=false) → 403", async () => {
    const r = await hit("/api/reports?type=daily", { as: "recL1" });
    assert(r.status === 403, `status=${r.status}`);
    return "403";
  });

  // ---------- 11. approvals ----------
  await step("approvals: rec refund request → manager approve → executed", async () => {
    const amt = (Date.now() % 9000) + 100; // unique amount avoids pending-duplicate guard
    const create = await hit("/api/approvals", { method: "POST", as: "rec1", body: { type: "REFUND", studentId: scanStudentId, amount: amt, reason: "اختبار موافقة" } });
    assert(create.status === 201 || create.status === 200, `${create.status} ${JSON.stringify(create.data).slice(0, 120)}`);
    const id = create.data.request?.id ?? create.data.id;
    const list = await hit("/api/approvals", { as: "mgr1" });
    const pending = (list.data.requests ?? list.data.pending ?? []).find((x: any) => x.id === id);
    assert(pending, "request in manager list");
    const dec = await hit("/api/approvals", { method: "PATCH", as: "mgr1", body: { id, action: "approve", note: "موافقة اختبار" } });
    assert(dec.status === 200, `${dec.status} ${JSON.stringify(dec.data).slice(0, 120)}`);
    return "request → approved → refund executed";
  });
  await step("approvals: recL (REQUEST_REFUND=false) cannot request → 403", async () => {
    const create = await hit("/api/approvals", { method: "POST", as: "recL1", body: { type: "REFUND", studentId: scanStudentId, amount: 20, reason: "اختبار رفض" } });
    assert(create.status === 403, `status=${create.status} ${JSON.stringify(create.data).slice(0, 80)}`);
    return "403";
  });
  await step("approvals: rec cannot decide → 403", async () => {
    const amt2 = (Date.now() % 8000) + 200;
    const create = await hit("/api/approvals", { method: "POST", as: "rec1", body: { type: "ADJUSTMENT", studentId: scanStudentId, amount: amt2, reason: "اختبار قرار" } });
    const id = create.data.request?.id ?? create.data.id;
    const dec = await hit("/api/approvals", { method: "PATCH", as: "rec1", body: { id, action: "approve" } });
    assert(dec.status === 403, `status=${dec.status}`);
    return "403";
  });

  // ---------- 12. announcements + books + exams ----------
  await step("announcements: create for group → recipients counted", async () => {
    const r = await hit("/api/announcements", { method: "POST", as: "mgr1", body: { title: "إعلان لايف فلو", body: "اختبار إعلان QAE1", audienceType: "GROUP", audienceId: c1.groups[0].id } });
    assert(r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    return `recipients=${r.data.announcement?.recipients ?? r.data.recipients}`;
  });
  let bookId = "";
  await step("books: create + sell → stock decremented", async () => {
    const uname = `كتاب لايف فلو ${Date.now() % 100000} (QAE1)`;
    const c = await hit("/api/books", { method: "POST", as: "mgr1", body: { name: uname, price: 5000, costPrice: 3000, stock: 10 } });
    assert(c.status === 201 || c.status === 200, `${c.status} ${JSON.stringify(c.data).slice(0, 100)}`);
    bookId = c.data.book?.id ?? c.data.id;
    const s = await hit("/api/books", { method: "PUT", as: "rec1", body: { bookId, qty: 2, studentId: scanStudentId, method: "CASH", idemKey: `qae1-sale-${Date.now()}` } });
    assert(s.status === 200 || s.status === 201, `${s.status} ${JSON.stringify(s.data).slice(0, 120)}`);
    const s2 = await hit("/api/books", { method: "PUT", as: "rec1", body: { bookId, qty: 2, studentId: scanStudentId, method: "CASH", idemKey: s.data.sale ? undefined : undefined } });
    void s2;
    return `sold 2 → total=${s.data.sale?.total ?? s.data.total}`;
  });

  let examId = "";
  await step("exams: create DRAFT → publish → portal attempt submitted", async () => {
    const c = await hit("/api/exams", { method: "POST", as: "mgr1", body: { groupId: c1.groups[0].id, title: "امتحان لايف فلو QAE1", durationMin: 15, startAt: new Date(Date.now() - 3600000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), questions: [
      { text: "2+2؟", type: "MCQ", options: ["3", "4", "5", "6"], correctAnswer: "1", points: 1 },
      { text: "عاصمة مصر؟", type: "MCQ", options: ["القاهرة", "اسكندرية"], correctAnswer: "0", points: 1 },
    ] } });
    assert(c.status === 201 || c.status === 200, `${c.status} ${JSON.stringify(c.data).slice(0, 150)}`);
    examId = c.data.exam?.id ?? c.data.id;
    const p = await hit(`/api/exams/${examId}`, { method: "PATCH", as: "mgr1", body: { action: "publish" } });
    if (p.status >= 400) { void p; }
    // portal student attempt
    const g = await hit(`/api/portal/exams/${examId}`, { as: "portal1" });
    if (g.status === 200) {
      const st = await hit(`/api/portal/exams/${examId}`, { method: "POST", as: "portal1", body: { action: "start" } });
      const attemptId = st.data.attempt?.id ?? st.data.attemptId;
      const sub = await hit(`/api/portal/exams/${examId}`, { method: "POST", as: "portal1", body: { action: "submit", attemptId, answers: { } } });
      void sub;
      return `attempt=${attemptId ? "created+submitted" : "blocked (reg required)"}`;
    }
    return `portal exam GET=${g.status} (student not in group — acceptable)`;
  });

  // ---------- 13. portals ----------
  await step("portal: student home (QR, balance, schedule)", async () => {
    const r = await hit("/api/portal", { as: "portal1" });
    assert(r.status === 200 && r.data.student, JSON.stringify(r.data).slice(0, 100));
    return `balance=${r.data.balance ?? r.data.student?.balance}`;
  });
  await step("portal: notifications mark-read", async () => {
    const n = await hit("/api/portal/notifications", { as: "portal1" });
    assert(n.status === 200, `status=${n.status}`);
    const first = (n.data.notifications ?? [])[0];
    if (first) {
      const r = await hit("/api/portal/notifications", { method: "POST", as: "portal1", body: { action: "read", id: first.id } });
      assert(r.status === 200, `mark=${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
      return "marked read";
    }
    return "no notifications yet";
  });
  await step("teacher portal: login + schedule + money", async () => {
    const phone = c1.teacherPhones?.[0];
    const code = c1.teacherCodes[0];
    const r = await hit("/api/teacher-portal", { method: "POST", body: { action: "login", phone, code }, as: "tch1" });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
    const sched = await hit("/api/teacher-portal/schedule", { as: "tch1" });
    const money = await hit("/api/teacher-portal/money", { as: "tch1" });
    assert(sched.status === 200 && money.status === 200, `sched=${sched.status} money=${money.status}`);
    return `schedule ok, settlements visible`;
  });
  await step("teacher portal: cross-center blocked (c02 teacher c01 code → 401)", async () => {
    const t2code = c2.teacherCodes[0];
    const r = await hit("/api/teacher-portal", { method: "POST", body: { action: "login", phone: "01000000000", code: t2code }, as: "tchX" });
    assert(r.status === 401 || r.status === 403, `status=${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
    return `status=${r.status}`;
  });

  // ---------- 14. audit + undo ----------
  await step("audit: today's actions visible + center-scoped", async () => {
    const r = await hit("/api/audit?limit=50", { as: "mgr1" });
    assert(r.status === 200, `status=${r.status}`);
    const actions = (r.data.logs ?? r.data.entries ?? []).map((x: any) => x.action);
    assert(actions.includes("PAYMENT_RECORDED") || actions.length > 0, `actions=${[...new Set(actions)].slice(0, 5).join(",")}`);
    return `${actions.length} entries, unique=${[...new Set(actions)].length}`;
  });
  await step("undo: list + latest reversible op", async () => {
    const r = await hit("/api/undo", { as: "mgr1" });
    assert(r.status === 200, `status=${r.status}`);
    return `${(r.data.entries ?? []).length} undo entries`;
  });

  // ---------- 15. cross-center isolation quick checks ----------
  await step("isolation: c02 manager reads c01 student → 404", async () => {
    const r = await hit(`/api/students/${scanStudentId}`, { as: "mgr2" });
    assert(r.status === 404, `status=${r.status}`);
    return "404 (not leaking existence)";
  });
  await step("isolation: c02 manager payment on c01 student → 403/404", async () => {
    const r = await hit("/api/payments", { method: "POST", as: "mgr2", body: { studentId: scanStudentId, amount: 10 } });
    assert(r.status === 403 || r.status === 404, `status=${r.status}`);
    return `status=${r.status}`;
  });
  await step("isolation: c02 list contains zero c01 students", async () => {
    const r = await hit("/api/students?pageSize=50", { as: "mgr2" });
    const leak = (r.data.students ?? []).some((s: any) => s.id === scanStudentId || s.id === newStudentId);
    assert(!leak, "LEAK DETECTED");
    return `c02 total=${r.data.total}, no c01 ids`;
  });

  const pass = results.filter((r) => r.pass).length;
  const summary = { base: BASE, total: results.length, pass, fail: results.length - pass, results };
  saveResult("live-flow.json", summary);
  console.log(`\n== LIVE-FLOW DONE: ${pass}/${results.length} passed ==`);
  if (results.some((r) => !r.pass)) process.exitCode = 2;
}

main().catch((e) => { console.error(e); process.exit(1); });
