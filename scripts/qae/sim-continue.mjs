/**
 * QAE1 SIM-CONTINUE — keeps qae-c99-stress (5000 students) operating normally.
 * Idempotent catch-up: from the last session date through today (Cairo):
 *   · materialize each scheduled slot as a CLOSED session (3% cancelled)
 *   · attendance rows for ACTIVE regs (per-group observed rate × per-student jitter)
 *     — PRESENT/LATE charged -(priceOverride ?? sessionPrice) · EXCUSED charged 0 · absent no row
 *   · CHARGE txn per non-EXCUSED row (reason "حصة")
 *   · corrections EXCUSED→PRESENT ~2.5% of sessions (+1 charge)
 *   · ~95-115 PAYMENT txns/day ("دفعة والي أمر", method CASH/VODAFONE/INSTAPAY) paying real per-student debt
 *     (type=PAYMENT — same dialect as the app: dashboards/reports/Zaki read PAYMENT, never TOPUP)
 *   · closes stale OPEN sessions dated ≤ today (from previous runs)
 *   · pre-creates tomorrow's (next active day) slots as OPEN sessions — ready for attendance
 * Matches existing prod data shape exactly: id patterns (cstress…/ca…/ct…/ctop…),
 * timestamps = Cairo wall time at fixed UTC+2 (same as original generator), status CLOSED.
 * Real centers are NEVER touched — the script hard-asserts the qae center id.
 * Run: bun scripts/qae/sim-continue.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { Client } from 'pg';

const PWD = readFileSync('/home/z/my-project/scripts/.dbpass', 'utf8').trim();
const CID = 'cmvaippgj0000py23e2mm9ewz'; // qae-c99-stress ONLY
const MGR = 'cmvaiqans007cpy23a2207wsw'; // qae-mgr-99
const REC = 'cmvaiqazs007epy2322a3qq7d'; // qae-rec-99
const OFFSET_MIN = 120; // original generator stored Cairo wall time at fixed +2

// ---------- tiny utils (deterministic) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const ri = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const chance = (rng, p) => rng() < p;
const round100 = (x) => Math.max(0, Math.round(x / 100) * 100);
const cairoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', dateStyle: 'short' }).format(new Date());
const dowOf = (ds) => new Date(`${ds}T12:00:00Z`).getUTCDay();
const ts = (dateStr, hm) => new Date(new Date(`${dateStr}T${hm}:00Z`).getTime() - OFFSET_MIN * 60000); // Cairo(+2) → UTC
const date8 = (ds) => ds.replaceAll('-', '');
const addDays = (ds, n) => new Date(Date.parse(`${ds}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const pad = (n, w) => String(n).padStart(w, '0');

const client = new Client({
  host: 'aws-0-eu-west-2.pooler.supabase.com', port: 6543,
  user: 'postgres.ttydfyqwzkwivucgiegy', password: PWD, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});

async function insertChunked(table, cols, rows) {
  if (!rows.length) return 0;
  let done = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const values = [];
    const params = [];
    chunk.forEach((r, ri2) => {
      const ph = cols.map((_, ci) => `$${ri2 * cols.length + ci + 1}`);
      values.push(`(${ph.join(',')})`);
      for (const c of cols) params.push(r[c] ?? null);
    });
    const res = await client.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${values.join(',')}
       ON CONFLICT (id) DO NOTHING`,
      params,
    );
    done += res.rowCount;
  }
  return done;
}

async function main() {
  const t0 = Date.now();
  await client.connect();

  // ---- safety assert: only the QAE stress center ----
  const c = await client.query(`SELECT id, slug FROM "Center" WHERE id='${CID}'`);
  if (!c.rows.length || c.rows[0].slug !== 'qae-c99-stress') throw new Error('QAE center not found — aborting');
  console.log(`== SIM-CONTINUE for ${c.rows[0].slug} ==`);

  const today = cairoToday();
  console.log(`today(Cairo) = ${today}`);

  // ---- load structures ----
  const groups = (await client.query(`
    SELECT g.id, g.name, g."sessionPrice", g."teacherPercent" FROM "Group" g
    WHERE g."centerId"='${CID}' AND g."isActive"=true ORDER BY g.name`)).rows;
  const slots = (await client.query(`
    SELECT id, "groupId", "dayOfWeek", "startTime", "endTime", room FROM "ScheduleSlot"
    WHERE "centerId"='${CID}' AND "isActive"=true`)).rows;
  const regs = (await client.query(`
    SELECT sg."studentId" sid, sg."groupId" gid, sg."priceOverride" pov, s.name, s.code
    FROM "StudentGroup" sg JOIN "Student" s ON s.id=sg."studentId"
    WHERE s."centerId"='${CID}' AND s.status='ACTIVE' AND sg.status='ACTIVE'`)).rows;
  const byGroup = {};
  for (const r of regs) (byGroup[r.gid] ??= []).push(r);

  const last = (await client.query(`SELECT MAX(date) d FROM "SessionInstance" WHERE "centerId"='${CID}'`)).rows[0].d;
  console.log(`last session date = ${last}`);

  // per-group observed attendance rate
  const gst = (await client.query(`
    SELECT si."groupId" gid, COUNT(DISTINCT si.id) sc, COUNT(a.id) att
    FROM "SessionInstance" si LEFT JOIN "Attendance" a ON a."sessionId"=si.id
    WHERE si."centerId"='${CID}' AND si.status='CLOSED' GROUP BY 1`)).rows;
  const rate = {};
  for (const g of gst) {
    const n = byGroup[g.gid]?.length ?? 0;
    rate[g.gid] = n ? Math.min(0.95, Math.max(0.35, Number(g.att) / Math.max(1, Number(g.sc) * n))) : 0.8;
  }
  const globalRate = gst.length
    ? gst.reduce((a, x) => a + Number(x.att), 0) / Math.max(1, gst.reduce((a, x) => a + Number(x.sc) * (byGroup[x.gid]?.length ?? 0), 0))
    : 0.8;
  console.log(`global observed attendance rate = ${(globalRate * 100).toFixed(1)}%`);

  // current balances (authoritative) + active students
  const balRows = (await client.query(`
    SELECT "studentId" sid, SUM(amount) b FROM "StudentTransaction" WHERE "centerId"='${CID}' GROUP BY 1`)).rows;
  const balance = new Map(balRows.map((r) => [r.sid, Number(r.b)]));
  const activeStudents = (await client.query(`
    SELECT id, name, code FROM "Student" WHERE "centerId"='${CID}' AND status='ACTIVE'`)).rows;

  // payment days already present
  const topupDays = new Set((await client.query(`
    SELECT DISTINCT "createdAt"::date::text d FROM "StudentTransaction"
    WHERE "centerId"='${CID}' AND type='PAYMENT'`)).rows.map((r) => r.d));

  // stale OPEN sessions ≤ today (from previous runs) → close them now
  const staleOpen = (await client.query(`
    SELECT * FROM "SessionInstance" WHERE "centerId"='${CID}' AND status='OPEN' AND date <= '${today}' ORDER BY date`)).rows;

  const out = { startedAt: new Date().toISOString(), today, lastSessionDate: last, days: [], closedStaleOpen: 0, openedNextDay: 0, totals: { sessions: 0, cancelled: 0, attendance: 0, charges: 0, chargesSum: 0, topups: 0, topupsSum: 0 } };

  const propensityOf = (sid, gid) => {
    const u = fnv(sid + '|' + gid) / 4294967296;
    const jitter = 0.6 + 0.7 * u; // 0.6..1.3
    return Math.min(0.97, Math.max(0.05, (rate[gid] ?? globalRate) * jitter));
  };
  const priceOf = (gid, pov) => pov ?? groups.find((g) => g.id === gid)?.sessionPrice ?? 7500;

  // generate one session's attendance+charges (session row must exist / about to exist)
  function genSession(sess, rng, peak, collected) {
    const gRegs = byGroup[sess.groupId] ?? [];
    const price = sess.price;
    let revenue = 0, present = 0;
    const startTs = ts(sess.date, sess.startTime);
    for (const r of gRegs) {
      const p = Math.min(0.98, propensityOf(r.sid, sess.groupId) + (peak ? 0.05 : 0));
      if (rng() > p) continue; // absent → no row
      const r3 = rng();
      const status = r3 < 0.91 ? 'PRESENT' : r3 < 0.96 ? 'LATE' : 'EXCUSED';
      const charged = status === 'EXCUSED' ? 0 : price;
      const method = (() => { const x = rng(); return x < 0.7 ? 'MANUAL' : x < 0.88 ? 'QR_SCAN' : 'SESSION_QR'; })();
      const at = new Date(startTs.getTime() + ri(rng, 0, 25) * 60000);
      const aid = `ca${sess.id}${r.sid}`;
      collected.att.push({
        id: aid, centerId: CID, sessionId: sess.id, studentId: r.sid, status, method,
        idemKey: `simc-a-${sess.id}-${r.sid}`, charged, note: null,
        recordedBy: chance(rng, 0.7) ? MGR : REC, createdAt: at,
        riskScore: 0, studentCode: r.code, studentName: r.name,
        interactionMinus: 0, interactionPlus: 0,
      });
      if (status !== 'EXCUSED') {
        revenue += charged; present++;
        collected.txn.push({
          id: `ct${sess.id}${r.sid}`, centerId: CID, studentId: r.sid, sessionId: sess.id,
          type: 'CHARGE', amount: -charged, method: null, reason: 'حصة',
          idemKey: `simc-c-${sess.id}-${r.sid}`, createdBy: MGR, createdAt: at,
        });
        collected.chargesByStudent.set(r.sid, (collected.chargesByStudent.get(r.sid) ?? 0) + charged);
        // running balance: charges apply in time order — keep simple ordered application
        balance.set(r.sid, (balance.get(r.sid) ?? 0) - charged);
      }
    }
    // correction EXCUSED→PRESENT ~2.5%
    if (chance(rng, 0.025)) {
      const exc = collected.att.find((a) => a.sessionId === sess.id && a.status === 'EXCUSED');
      if (exc) {
        exc.status = 'PRESENT'; exc.charged = price;
        const fixTs = new Date(startTs.getTime() + ri(rng, 40, 90) * 60000);
        collected.txn.push({
          id: `ct${sess.id}${exc.studentId}fix`, centerId: CID, studentId: exc.studentId, sessionId: sess.id,
          type: 'CHARGE', amount: -price, method: null, reason: 'تصحيح حضور — تحويل من إذن لحضور',
          idemKey: `simc-cf-${sess.id}-${exc.studentId}`, createdBy: MGR, createdAt: fixTs,
        });
        revenue += price; present++;
        balance.set(exc.studentId, (balance.get(exc.studentId) ?? 0) - price);
      }
    }
    sess.presentCount = present;
    sess.totalRevenue = revenue;
    sess.teacherShare = Math.round((revenue * sess.teacherPercent) / 100);
    sess.centerShare = revenue - sess.teacherShare;
    sess.status = 'CLOSED';
    sess.closedBy = MGR;
    sess.closedAt = new Date(ts(sess.date, sess.endTime).getTime() + ri(rng, 5, 40) * 60000);
    collected.totals.attendance += present;
    collected.totals.charges += present;
    collected.totals.chargesSum += revenue;
  }

  const collected = { att: [], txn: [], sess: [], topup: [], chargesByStudent: new Map(), totals: out.totals };

  // ---- 1) close stale OPEN sessions (previous runs) ----
  for (const s of staleOpen) {
    const rng = mulberry32(fnv('close-' + s.id));
    const ex = await client.query(`SELECT "studentId" FROM "Attendance" WHERE "sessionId"=$1`, [s.id]);
    const have = new Set(ex.rows.map((r) => r.studentId));
    const gRegs = (byGroup[s.groupId] ?? []).filter((r) => !have.has(r.sid));
    let revenue = 0, present = 0;
    const startTs = ts(s.date, s.startTime);
    for (const r of gRegs) {
      const p = Math.min(0.98, propensityOf(r.sid, s.groupId));
      if (rng() > p) continue;
      const r3 = rng();
      const status = r3 < 0.91 ? 'PRESENT' : r3 < 0.96 ? 'LATE' : 'EXCUSED';
      const price = priceOf(s.groupId, null);
      const charged = status === 'EXCUSED' ? 0 : price;
      const at = new Date(startTs.getTime() + ri(rng, 0, 25) * 60000);
      collected.att.push({ id: `ca${s.id}${r.sid}`, centerId: CID, sessionId: s.id, studentId: r.sid, status, method: 'MANUAL', idemKey: `simc-a-${s.id}-${r.sid}`, charged, note: null, recordedBy: MGR, createdAt: at, riskScore: 0, studentCode: r.code, studentName: r.name, interactionMinus: 0, interactionPlus: 0 });
      if (status !== 'EXCUSED') {
        revenue += charged; present++;
        collected.txn.push({ id: `ct${s.id}${r.sid}`, centerId: CID, studentId: r.sid, sessionId: s.id, type: 'CHARGE', amount: -charged, method: null, reason: 'حصة', idemKey: `simc-c-${s.id}-${r.sid}`, createdBy: MGR, createdAt: at });
        balance.set(r.sid, (balance.get(r.sid) ?? 0) - charged);
      }
      collected.totals.attendance++; collected.totals.charges++; collected.totals.chargesSum += charged;
    }
    s.presentCount = present; s.totalRevenue = revenue;
    s.teacherShare = Math.round((revenue * s.teacherPercent) / 100);
    s.centerShare = revenue - s.teacherShare;
    s.status = 'CLOSED'; s.closedBy = MGR;
    s.closedAt = new Date(ts(s.date, s.endTime).getTime() + ri(rng, 5, 40) * 60000);
    collected.sess.push(s);
    out.closedStaleOpen++;
  }

  // ---- 2) catch-up days: last+1 .. today ----
  if (last && last < today) {
    for (let d = addDays(last, 1); d <= today; d = addDays(d, 1)) {
      const dow = dowOf(d);
      const daySlots = slots.filter((s) => s.dayOfWeek === dow);
      const rng = mulberry32(fnv('day-' + d));
      const peak = chance(rng, 0.1);
      const dayLog = { date: d, dow, sessions: 0, cancelled: 0, attendance: 0, topups: 0 };

      // existing session ids for this date (idempotency)
      const exIds = new Set((await client.query(`SELECT id FROM "SessionInstance" WHERE "centerId"=$1 AND date=$2`, [CID, d])).rows.map((r) => r.id));

      for (const sl of daySlots) {
        const sid = `cstress${date8(d)}${sl.groupId.slice(-6)}${sl.startTime.replace(':', '')}`;
        if (exIds.has(sid)) continue;
        const g = groups.find((x) => x.id === sl.groupId);
        if (!g) continue;
        const cancelled = chance(rng, 0.03);
        const sess = {
          id: sid, centerId: CID, scheduleId: sl.id, groupId: sl.groupId, date: d,
          startTime: sl.startTime, endTime: sl.endTime, room: sl.room,
          price: g.sessionPrice, teacherPercent: g.teacherPercent,
          status: cancelled ? 'CANCELLED' : 'OPEN', openedBy: MGR,
          closedBy: null, closedAt: null, presentCount: null, totalRevenue: null, teacherShare: null, centerShare: null,
          createdAt: ts(d, sl.startTime), allowUnregistered: false, studentSource: 'ROSTER', requireRoomPin: false,
        };
        if (cancelled) { collected.sess.push(sess); dayLog.cancelled++; out.totals.cancelled++; continue; }
        genSession(sess, rng, peak, collected);
        collected.sess.push(sess);
        dayLog.sessions++; out.totals.sessions++;
        dayLog.attendance += sess.presentCount;
      }

      // parent payments for this day
      if (!topupDays.has(d)) {
        const n = ri(rng, 95, 115);
        const nowMs = Date.now() - 60000;
        const startWin = ts(d, '08:30').getTime();
        const endWin = Math.min(ts(d, '20:00').getTime(), d === today ? nowMs : ts(d, '20:00').getTime());
        const span = Math.max(60000, endWin - startWin);
        // candidate payers: active students with debt ≥ 3000 at this moment
        const debtors = [];
        for (const s of activeStudents) {
          const b = balance.get(s.id) ?? 0;
          if (b <= -3000) debtors.push({ id: s.id, debt: -b });
        }
        debtors.sort((a, b2) => a.id.localeCompare(b2.id));
        if (debtors.length) {
          const chosen = new Set();
          for (let i = 0; i < n && chosen.size < debtors.length; i++) {
            const pickIdx = Math.floor(rng() * debtors.length);
            if (chosen.has(pickIdx)) continue;
            chosen.add(pickIdx);
            const st = debtors[pickIdx];
            const r = rng();
            let amount;
            if (r < 0.6) amount = st.debt;                                  // سداد كامل
            else if (r < 0.85) amount = Math.max(5000, round100(st.debt * (0.5 + rng() * 0.3))); // قسط
            else amount = st.debt + round100((1 + Math.floor(rng() * 3)) * 8000);                // سداد + دفعة مقدمة
            amount = Math.min(amount, st.debt + 4 * 9500); // سقف معقول للدفعة المقدمة
            amount = round100(amount);
            const at = new Date(startWin + Math.floor(rng() * span));
            const method = (() => { const x = rng(); return x < 0.7 ? 'CASH' : x < 0.9 ? 'VODAFONE' : 'INSTAPAY'; })();
            collected.topup.push({
              id: `ctop${date8(d)}${st.id}`, centerId: CID, studentId: st.id, sessionId: null,
              type: 'PAYMENT', amount, method, reason: 'دفعة والي أمر', idemKey: `simc-t-${d}-${st.id}`,
              createdBy: MGR, createdAt: at,
            });
            balance.set(st.id, (balance.get(st.id) ?? 0) + amount);
            dayLog.topups++; out.totals.topups++; out.totals.topupsSum += amount;
          }
        }
      }
      out.days.push(dayLog);
    }
  } else {
    console.log('already up to date — no catch-up days');
  }

  // ---- 3) pre-create next active day as OPEN sessions (ready for attendance) ----
  let nextDay = addDays(today, 1);
  for (let i = 0; i < 7 && dowOf(nextDay) === 5; i++) nextDay = addDays(nextDay, 1); // skip Friday
  const nextIds = new Set((await client.query(`SELECT id FROM "SessionInstance" WHERE "centerId"=$1 AND date=$2`, [CID, nextDay])).rows.map((r) => r.id));
  for (const sl of slots.filter((s) => s.dayOfWeek === dowOf(nextDay))) {
    const sid = `cstress${date8(nextDay)}${sl.groupId.slice(-6)}${sl.startTime.replace(':', '')}`;
    if (nextIds.has(sid)) continue;
    const g = groups.find((x) => x.id === sl.groupId);
    if (!g) continue;
    collected.sess.push({
      id: sid, centerId: CID, scheduleId: sl.id, groupId: sl.groupId, date: nextDay,
      startTime: sl.startTime, endTime: sl.endTime, room: sl.room,
      price: g.sessionPrice, teacherPercent: g.teacherPercent, status: 'OPEN', openedBy: MGR,
      closedBy: null, closedAt: null, presentCount: null, totalRevenue: null, teacherShare: null, centerShare: null,
      createdAt: ts(nextDay, sl.startTime), allowUnregistered: false, studentSource: 'ROSTER', requireRoomPin: false,
    });
    out.openedNextDay++;
  }
  out.nextDay = nextDay;

  // ---- persist (dependency order) ----
  const nSess = await insertChunked('SessionInstance',
    ['id','centerId','scheduleId','groupId','date','startTime','endTime','room','price','teacherPercent','status','openedBy','closedBy','closedAt','presentCount','totalRevenue','teacherShare','centerShare','createdAt','allowUnregistered','studentSource','requireRoomPin'],
    collected.sess);
  const nAtt = await insertChunked('Attendance',
    ['id','centerId','sessionId','studentId','status','method','idemKey','charged','note','recordedBy','createdAt','riskScore','studentCode','studentName','interactionMinus','interactionPlus'],
    collected.att);
  const nTxn = await insertChunked('StudentTransaction',
    ['id','centerId','studentId','sessionId','type','amount','method','reason','idemKey','createdBy','createdAt'],
    [...collected.txn, ...collected.topup]);

  // ---- verify ----
  const after = (await client.query(`
    SELECT (SELECT COUNT(*) FROM "SessionInstance" WHERE "centerId"='${CID}') s,
           (SELECT COUNT(*) FROM "Attendance" WHERE "centerId"='${CID}') a,
           (SELECT COUNT(*) FROM "StudentTransaction" WHERE "centerId"='${CID}') t,
           (SELECT MAX(date) FROM "SessionInstance" WHERE "centerId"='${CID}') mx,
           (SELECT COUNT(*) FROM "SessionInstance" WHERE "centerId"='${CID}' AND status='OPEN' AND date>'${today}') fut`)).rows[0];
  out.dbAfter = { sessions: Number(after.s), attendance: Number(after.a), txns: Number(after.t), maxDate: after.mx, openFutureSessions: Number(after.fut) };
  out.inserted = { sessions: nSess, attendance: nAtt, transactions: nTxn };
  out.ms = Date.now() - t0;

  mkdirSync('/home/z/my-project/qae/results', { recursive: true });
  writeFileSync('/home/z/my-project/qae/results/sim-continue.json', JSON.stringify(out, null, 2));
  console.log('\n== RESULT ==');
  console.log(JSON.stringify(out, null, 2));
  await client.end();
}

main().catch(async (e) => { console.error(e); try { await client.end(); } catch {} process.exit(1); });
