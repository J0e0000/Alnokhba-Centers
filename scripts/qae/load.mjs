/**
 * QAE1 LOAD — spec §10: progressive concurrency capacity test (25→50→100→250→500).
 * Mixed realistic workload vs local production build (:3001).
 * Targets (provisional per spec): read p95 < 500ms · write p95 < 1s · 5xx < 1%.
 * Run: node scripts/qae/load.mjs [tiers]
 */
const BASE = process.env.LT_BASE ?? "http://localhost:3001";
const TIERS = (process.argv[2] ?? "25,50,100,250,500").split(",").map(Number);
const DURATION_MS = 30_000; // per tier
const RAMP_MS = 5_000;

import { readFileSync, writeFileSync } from "fs";

const MGR = { username: "qae-mgr-01", password: "Qae#2026" };
const REC = { username: "qae-rec-01", password: "Qae#2026" };
const MANIFEST = JSON.parse(readFileSync("/home/z/my-project/qae/manifest.json", "utf8"));
const c1 = MANIFEST.centers.find((c) => c.slug === "qae-c01");
const c2 = MANIFEST.centers.find((c) => c.slug === "qae-c02");
const codes = c1.students.slice(0, 400).map((s) => s.code);
const codes2 = c2.students.slice(0, 200).map((s) => s.code);

function randXff() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}
async function hit(path, { method = "GET", body, cookie } = {}) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}), "x-forwarded-for": randXff() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const ms = performance.now() - t0;
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    return { ms, status: res.status, data };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, data: null, error: String(e).slice(0, 60) };
  }
}
async function login(username, password) {
  const r = await hit("/api/auth", { method: "POST", body: { username, password } });
  return (r.data?._setCookie) ?? (r.status === 200 ? "ok" : null);
}
// capture cookies via getSetCookie
async function loginCookie(username, password) {
  const res = await fetch(BASE + "/api/auth", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error(`login failed ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).filter((c) => c.startsWith("nokhba_session")).join("; ");
}

function pctl(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[i]);
}

// workload mix (read-heavy realistic): 40% student search, 15% dashboard, 10% today/sessions,
// 10% reports, 10% scan (read), 10% zaki rules (GET), 5% writes (attendance mark on rotating students)
const WRITE_STUDENTS = c1.students.slice(0, 60); // 60 dedicated students for write load (no repeats)
let writeIdx = 0;

async function worker(stopAt, mgrCookie, recCookie, stats) {
  while (Date.now() < stopAt) {
    const r = Math.random();
    let res;
    if (r < 0.40) {
      const q = codes[Math.floor(Math.random() * codes.length)];
      res = await hit(`/api/students?q=${q}&pageSize=10`, { cookie: recCookie });
      stats.bucket("read:students-search", res);
    } else if (r < 0.55) {
      res = await hit("/api/dashboard", { cookie: mgrCookie });
      stats.bucket("read:dashboard", res);
    } else if (r < 0.65) {
      res = await hit("/api/sessions", { cookie: recCookie });
      stats.bucket("read:sessions-today", res);
    } else if (r < 0.75) {
      res = await hit("/api/reports?type=student-balances", { cookie: mgrCookie });
      stats.bucket("read:reports", res);
    } else if (r < 0.85) {
      const q = codes2[Math.floor(Math.random() * codes2.length)];
      res = await hit("/api/attendance/scan", { method: "POST", body: { query: q }, cookie: recCookie });
      stats.bucket("read:scan", res);
    } else if (r < 0.95) {
      res = await hit("/api/zaki", { cookie: mgrCookie });
      stats.bucket("read:zaki-rules", res);
    } else {
      // write: mark attendance for a rotating dedicated student (registered via bulk below)
      const st = WRITE_STUDENTS[writeIdx++ % WRITE_STUDENTS.length];
      res = await hit("/api/attendance/mark", { method: "POST", body: { studentId: st.id, sessionId: stats.sessionId, status: "PRESENT", idemKey: `lt-${st.id}-${stats.sessionId}` }, cookie: recCookie });
      stats.bucket("write:attendance-mark", res);
    }
    stats.total++;
  }
}

async function main() {
  console.log(`== QAE1 LOAD vs ${BASE} — tiers: ${TIERS.join(",")} — ${DURATION_MS / 1000}s each ==`);
  const mgrCookie = await loginCookie(MGR.username, MGR.password);
  const recCookie = await loginCookie(REC.username, REC.password);
  // dedicated write session (roster, group 0)
  const sess = await hit("/api/sessions", { method: "POST", body: { groupId: c1.groups[0].id, startTime: "03:00", endTime: "04:00" }, cookie: mgrCookie });
  let sessionId;
  if (sess.status === 201) sessionId = sess.data.session.id;
  else {
    // reuse: reopen yesterday's? simpler: pick an OPEN one
    const list = await hit("/api/sessions", { cookie: mgrCookie });
    const open = (list.data.sessions ?? []).find((s) => s.status === "OPEN");
    sessionId = open.id;
  }
  console.log(`  write session: ${sessionId}`);
  // ensure write students are registered (orange-flow via bulk would be manager; use direct mark with allowUnregistered? simpler: register via API per student once)
  for (const st of WRITE_STUDENTS.slice(0, 20)) {
    await hit(`/api/students/${st.id}`, { method: "PATCH", body: { addGroupIds: [c1.groups[0].id] }, cookie: mgrCookie }).catch(() => {});
  }

  const report = [];
  for (const tier of TIERS) {
    const stats = {
      total: 0,
      buckets: new Map(),
      sessionId,
      bucket(name, res) {
        const b = stats.buckets.get(name) ?? { lat: [], errs: 0, statuses: {} };
        b.lat.push(res.ms);
        if (res.status >= 500 || res.status === 0) b.errs++;
        b.statuses[res.status] = (b.statuses[res.status] ?? 0) + 1;
        stats.buckets.set(name, b);
      },
    };
    const stopAt = Date.now() + DURATION_MS + RAMP_MS;
    const started = Date.now();
    // warmup during ramp: half workers from the start, rest staggered over RAMP_MS
    const workers = [];
    for (let i = 0; i < tier; i++) {
      const delay = Math.floor((i / tier) * RAMP_MS);
      workers.push(new Promise((done) => setTimeout(async () => {
        await worker(stopAt, mgrCookie, recCookie, stats);
        done();
      }, delay)));
    }
    await Promise.all(workers);
    const wall = (Date.now() - started - RAMP_MS) / 1000;

    const allLat = [];
    let totalErrs = 0;
    const perEndpoint = {};
    for (const [name, b] of stats.buckets) {
      allLat.push(...b.lat);
      totalErrs += b.errs;
      perEndpoint[name] = { n: b.lat.length, p50: pctl(b.lat, 50), p95: pctl(b.lat, 95), p99: pctl(b.lat, 99), errs: b.errs, statuses: b.statuses };
    }
    allLat.sort((a, b) => a - b);
    const row = {
      tier,
      wallSec: +wall.toFixed(1),
      requests: allLat.length,
      rps: +(allLat.length / wall).toFixed(1),
      p50: pctl(allLat, 50),
      p95: pctl(allLat, 95),
      p99: pctl(allLat, 99),
      err5xx: totalErrs,
      errRate: +((totalErrs / Math.max(1, allLat.length)) * 100).toFixed(2),
      readP95: Math.max(...Object.entries(perEndpoint).filter(([k]) => k.startsWith("read")).map(([, v]) => v.p95), 0),
      writeP95: Math.max(...Object.entries(perEndpoint).filter(([k]) => k.startsWith("write")).map(([, v]) => v.p95), 0),
      perEndpoint,
    };
    report.push(row);
    console.log(`  ${tier} users → ${row.requests} reqs, ${row.rps} rps, p50=${row.p50}ms p95=${row.p95}ms p99=${row.p99}ms, 5xx=${row.errRate}% (read p95=${row.readP95}, write p95=${row.writeP95})`);
  }

  writeFileSync("/home/z/my-project/qae/results/load.json", JSON.stringify({ base: BASE, tiers: TIERS, durationMs: DURATION_MS, report }, null, 2));
  console.log("  📄 saved qae/results/load.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
