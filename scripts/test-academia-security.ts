/**
 * Academia security regression — RBAC, ownership (IDOR), validation.
 * Run: bun scripts/test-academia-security.ts
 */
const BASE = "http://localhost:3000";

type Jar = Record<string, string>;

async function call(path: string, opts: { method?: string; body?: unknown } = {}, jar: Jar = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const [kv] = c.split(";");
    const [k, v] = kv.split("=");
    jar[k.trim()] = v;
  }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* html */ }
  return { status: res.status, data } as { status: number; data: (Record<string, unknown>) | null };
}

async function login(username: string, password: string, jar: Jar) {
  const r = await call("/api/auth", { method: "POST", body: { username, password } }, jar);
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status}`);
  return r.data as { user: { id: string; role: string; scope: string } };
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`); }
  else { fail += 1; console.log(`  ❌ ${name} ${extra}`); }
}

const anon: Jar = {};
const t1: Jar = {}; // teacher1 (math A + math B)
const t2: Jar = {}; // teacher2 (physics)
const mgr: Jar = {};
const std1: Jar = {};
const std2: Jar = {};

console.log("— auth & bootstrap");
{
  const r = await call("/api/academia/bootstrap", {}, anon);
  check("anonymous bootstrap → user:null", r.status === 200 && (r.data as { user: unknown }).user === null);
  const s = await call("/api/academia/sessions", {}, anon);
  check("anonymous sessions API → 401", s.status === 401);
}

console.log("— login");
await login("aca-teacher1", "academia123", t1);
await login("aca-teacher2", "academia123", t2);
await login("aca-manager", "academia123", mgr);
await login("aca-student1", "academia123", std1);
await login("aca-student8", "academia123", std2);
const boot = await call("/api/academia/bootstrap", {}, t1);
check("teacher scope=academia", (boot.data as { user: { scope: string; role: string } }).user.scope === "academia");

console.log("— IDOR: cross-teacher session access");
{
  const d = await call("/api/academia/sessions?date=" + new Date(Date.now() + 2 * 3600 * 1000 + 7 * 86400000).toISOString().slice(0, 10), {}, t1);
  // teacher1 sees only own sessions; find a teacher2 (physics) session id from manager
  const dm = await call("/api/academia/sessions?date=" + new Date(Date.now() + 2 * 3600 * 1000 + 8 * 86400000).toISOString().slice(0, 10), {}, mgr);
  const dmBody = dm.data as unknown as { sessions?: { id: string; subject: string }[] } | null; const phys = dmBody?.sessions?.find((s) => s.subject === "الفيزياء");
  if (phys) {
    const r = await call(`/api/academia/sessions/${phys.id}`, {}, t1);
    check("teacher1 → teacher2's session detail → 403", r.status === 403, `got ${r.status}`);
    const rm = await call(`/api/academia/sessions/${phys.id}`, {}, mgr);
    check("manager → any session → 200", rm.status === 200, `got ${rm.status}`);
  } else {
    check("physics session exists for cross-test", false, "not found");
  }
  void d;
}

console.log("— student isolation");
{
  const prof1Raw = await call("/api/academia/students?q=", {}, mgr);
  const prof1 = prof1Raw.data as unknown as { students: { profileId: string; name: string }[] };
  const me = prof1.students.find((s) => s.name.includes("أحمد"));
  const other = prof1.students.find((s) => s.name.includes("مازن"));
  if (me && other) {
    const own = await call(`/api/academia/students/${me.profileId}`, {}, std1);
    check("student views OWN profile → 200", own.status === 200, `got ${own.status}`);
    const notAllowed = await call(`/api/academia/students/${other.profileId}`, {}, std1);
    check("student views OTHER profile → 403", notAllowed.status === 403, `got ${notAllowed.status}`);
  }
  const sList = await call("/api/academia/students", {}, std1);
  const sListBody = sList.data as unknown as { students?: unknown[] };
  check("student cannot list other students (empty)", (sListBody.students ?? []).length === 0);
}

console.log("— RBAC: teacher cannot manage/permissions/financial");
{
  const r = await call("/api/academia/teachers", { method: "POST", body: { name: "X", username: "x1", password: "123456" } }, t1);
  check("teacher create-teacher → 403", r.status === 403, `got ${r.status}`);
  const rp = await call("/api/academia/insights", {}, t1);
  check("teacher insights.view → 403", rp.status === 403, `got ${rp.status}`);
  const rfin = await call("/api/academia/reports", {}, t1);
  check("teacher reports view → 200 but financial disabled", rfin.status === 200 && ((rfin.data as { financial: unknown }).financial === null), `got ${rfin.status}`);
}

console.log("— business rules");
{
  // homework score validation
  const dm = await call("/api/academia/sessions?date=" + new Date(Date.now() + 2 * 3600 * 1000 + 9 * 86400000).toISOString().slice(0, 10), {}, mgr);
  const dmBody = dm.data as unknown as { sessions?: { id: string }[] } | null;
  const anySession = dmBody?.sessions?.[0];
  if (anySession) {
    const roster = await call(`/api/academia/sessions/${anySession.id}`, {}, mgr);
    const rosterBody = roster.data as unknown as { roster?: { profileId: string }[] } | null;
    const first = rosterBody?.roster?.[0];
    if (!first) { console.log("  ⚠️ roster empty on that date — skip"); }
    const bad = first ? await call(`/api/academia/sessions/${anySession.id}/records`, { method: "POST", body: { kind: "homework", studentId: first.profileId, completed: true, score: 7 } }, mgr) : null;
    check("homework score 7 rejected", bad ? bad.status === 400 : false, bad ? `got ${bad.status}` : "skipped");
    const stage = await call(`/api/academia/sessions/${anySession.id}/records`, { method: "POST", body: { kind: "stage", stage: "attendance", done: true } }, mgr);
    check("empty attendance stage blocked", stage.status === 400, `got ${stage.status} ${JSON.stringify(stage.data)}`);
  }
  // bad schedule conflict: overlapping occurrence same teacher same day
  const groupsRaw = await call("/api/academia/groups", {}, mgr);
  const groups = groupsRaw.data as unknown as { data?: { groups: { id: string; name: string; teacher: { name: string } }[] } } | null;
  void groups;
  const mathA = (await call("/api/academia/groups", {}, mgr)).data && ((groupsRaw.data as unknown as { groups?: { id: string; name: string }[] }).groups ?? []).find((g) => g.name.includes("أولى ثانوي — A") && g.name.includes("الرياضيات"));
  if (mathA) {
    const conf = await call(`/api/academia/groups/${mathA.id}`, { method: "POST", body: { action: "addSchedule", dayOfWeek: 0, startTime: "16:00", endTime: "17:30", room: "قاعة 9" } }, mgr);
    // same teacher already has MathA Sunday 16:00 (its own occurrence) → group-conflict expected 409
    check("conflicting occurrence → 409 with Arabic reasons", conf.status === 409 && Array.isArray((conf.data as { conflicts: unknown[] }).conflicts), `got ${conf.status}`);
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
