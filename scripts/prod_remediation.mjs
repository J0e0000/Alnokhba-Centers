/**
 * REMEDIATION — undo the accidental cleanup damage (production):
 * 1. Restore the 19 real students to ACTIVE (they were wrongly archived).
 * 2. Reverse the "تصفير رصيد اختبار آلي" ADJUSTMENT rows with compensating
 *    negative adjustments (ledger-driven, then verified against the
 *    pre-incident balance snapshot captured in the e2e output).
 * Test students (codes 38013/52911/55791) stay archived with zero balance.
 */
const BASE = "https://alnokhba-centers.vercel.app";
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

// Pre-incident balances (piastres) — captured BEFORE any adjustment ran
const ORIGINAL = {
  "84478": 64000, "10018": 0, "10017": 0, "10016": 35000, "10015": 0,
  "10014": -7000, "10013": -8000, "10012": 14000, "10011": -4000, "10010": -17500,
  "10009": 0, "10008": -30000, "10007": 0, "10006": -18500, "10005": -6500,
  "10004": -11500, "10003": -13000, "10002": -43000, "10001": 0,
};
const TEST_CODES = new Set(["38013", "52911", "55791"]);

(async () => {
  const login = await api("/api/auth", { method: "POST", body: { username: "manager", password: "nokhba123" } });
  if (login.status !== 200) throw new Error("login failed");
  console.log("login OK");

  const all = await api("/api/students?pageSize=100");
  const students = all.json?.students ?? [];
  if (students.length === 0) throw new Error("student list EMPTY — aborting (auth/list failure)");
  console.log(`loaded ${students.length} students`);
  let failures = 0;

  for (const s of students) {
    if (TEST_CODES.has(s.code)) { console.log(`skip (test, archived): ${s.code}`); continue; }
    const orig = ORIGINAL[s.code];
    if (orig === undefined) { console.log(`⚠️ unknown student ${s.code} — leaving untouched`); continue; }

    // 1) restore ACTIVE
    if (s.status !== "ACTIVE") {
      const r = await api(`/api/students/${s.id}`, { method: "PATCH", body: { status: "ACTIVE" } });
      if (r.status !== 200) { console.log(`❌ ACTIVE restore failed ${s.code}: HTTP ${r.status} ${JSON.stringify(r.json)}`); failures++; continue; }
    }

    // 2) balance reversal (delta-driven)
    const delta = s.balance - orig; // what my erroneous adjustment added
    if (delta !== 0) {
      const egp = Math.round(-delta) / 100; // negative ADJUSTMENT reverses it exactly
      const adj = await api("/api/payments", { method: "POST", body: {
        studentId: s.id, amount: egp, type: "ADJUSTMENT",
        note: "عكس تسوية خاطئة (تصفير رصيد اختبار آلي) — استعادة الرصيد الأصلي",
      }});
      if (adj.status !== 200) { console.log(`❌ reversal failed ${s.code}: HTTP ${adj.status} ${JSON.stringify(adj.json)}`); failures++; continue; }
    }

    // 3) verify
    const after = await api(`/api/students/${s.id}`);
    const fin = after.json?.student ?? after.json;
    const finalBalance = fin?.balance;
    const finalStatus = fin?.status;
    const ok = finalBalance === orig && finalStatus === "ACTIVE";
    if (!ok) failures++;
    console.log(`${ok ? "✅" : "❌"} ${s.code} ${s.name.slice(0, 25)} status=${finalStatus} balance=${finalBalance} (target ${orig}, delta fixed ${delta})`);
  }

  console.log(failures === 0 ? "\n═══ REMEDIATION COMPLETE — all students restored ═══" : `\n═══ ${failures} FAILURES — need manual attention ═══`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
