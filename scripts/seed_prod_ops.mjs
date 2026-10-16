/**
 * seed_prod_ops.mjs — operations history for the production stress center
 * (adapted from scripts/qae/perf.ts history generation — benchmarks removed,
 *  topup pass added for mixed wallet balances).
 * Run: DATABASE_URL="postgres://..." node scripts/seed_prod_ops.mjs
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const dayStr = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const cairoTs = (date, hm) => {
  // Cairo is UTC+2/+3 — approximate via fixed +03 in summer / +02 winter; ±1h irrelevant for created-at ordering
  return new Date(`${date}T${hm}:00+02:00`);
};

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

async function main() {
  const stress = await db.center.findUnique({ where: { slug: "qae-c99-stress" } });
  if (!stress) throw new Error("stress center missing — run seed first");
  const centerId = stress.id;
  const existingAtt = await db.attendance.count({ where: { centerId } });
  if (existingAtt > 1000) { console.log(`history already present (${existingAtt} rows) — skip`); return; }

  const t0 = Date.now();
  console.log("-- generating 28-day history (30 groups) --");
  const groups = await db.group.findMany({ where: { centerId } });
  const slots = await db.scheduleSlot.findMany({ where: { centerId } });
  const regs = await db.studentGroup.findMany({ where: { student: { centerId } }, select: { studentId: true, groupId: true, priceOverride: true } });
  const students = await db.student.findMany({ where: { centerId }, select: { id: true, name: true, code: true, status: true } });
  const stById = new Map(students.map((s) => [s.id, s]));
  const byGroup = new Map();
  for (const r of regs) { if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, []); byGroup.get(r.groupId).push(r); }
  const mgr = await db.user.findFirst({ where: { username: "qae-mgr-99" } });
  const mgrId = mgr?.id ?? stress.id;
  const rng = makeRng(99202610);

  const sessions = [], att = [], txns = [];
  for (let d = 28; d >= 1; d--) {
    const date = dayStr(-d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const g of groups) {
      const gSlots = slots.filter((s) => s.groupId === g.id && s.dayOfWeek === dow);
      for (const slot of gSlots) {
        const startTs = cairoTs(date, slot.startTime);
        if (startTs.getTime() > Date.now()) continue;
        const sessId = `cstress${date.replace(/-/g, "")}${g.id.slice(-6)}${slot.startTime.replace(":", "")}`;
        sessions.push({ id: sessId, centerId, scheduleId: slot.id, groupId: g.id, date, startTime: slot.startTime, endTime: slot.endTime, room: slot.room, price: g.sessionPrice, teacherPercent: g.teacherPercent, status: "CLOSED", openedBy: mgrId, closedBy: mgrId, closedAt: new Date(startTs.getTime() + 5400000), createdAt: startTs });
        for (const r of (byGroup.get(g.id) ?? [])) {
          const st = stById.get(r.studentId);
          if (!st || st.status !== "ACTIVE") continue;
          if (rng() > 0.8) continue;
          const price = r.priceOverride ?? g.sessionPrice;
          const at = new Date(startTs.getTime() + ri(rng, 0, 25) * 60000);
          const sfx = r.studentId.slice(-8);
          att.push({ id: `ca${sessId}${sfx}`, centerId, sessionId: sessId, studentId: r.studentId, status: "PRESENT", method: "MANUAL", charged: price, recordedBy: mgrId, createdAt: at, studentName: st.name, studentCode: st.code });
          txns.push({ id: `ct${sessId}${sfx}`, centerId, studentId: r.studentId, sessionId: sessId, type: "CHARGE", amount: -price, reason: "حصة", createdBy: mgrId, createdAt: at });
        }
      }
    }
  }
  console.log(`  sessions=${sessions.length} attendance=${att.length} charges=${txns.length}`);

  // topup pass: ~60% of ACTIVE students pay 200..600 EGP once (mixed wallet balances)
  const activeIds = students.filter((s) => s.status === "ACTIVE").map((s) => s.id);
  let topups = 0;
  for (const sid of activeIds) {
    if (rng() > 0.6) continue;
    const amount = ri(rng, 200, 600) * 100;
    const at = new Date(Date.now() - ri(rng, 1, 26) * 86_400_000);
    txns.push({ id: `ctop${sid.slice(-8)}`, centerId, studentId: sid, sessionId: null, type: "TOPUP", amount, reason: "دفعة والي أمر", createdBy: mgrId, createdAt: at });
    topups++;
  }
  console.log(`  topups=${topups} total txns=${txns.length}`);

  const put = async (model, rows, size) => {
    for (let i = 0; i < rows.length; i += size) {
      await db[model].createMany({ data: rows.slice(i, i + size), skipDuplicates: true });
      if ((i / size) % 10 === 0) process.stdout.write(`  ${model}: ${Math.min(i + size, rows.length)}/${rows.length}\n`);
    }
  };
  await put("sessionInstance", sessions, 500);
  await put("attendance", att, 1000);
  await put("studentTransaction", txns, 1000);

  const [sC, aC, tC] = await Promise.all([
    db.sessionInstance.count({ where: { centerId } }),
    db.attendance.count({ where: { centerId } }),
    db.studentTransaction.count({ where: { centerId } }),
  ]);
  console.log(`✅ DONE in ${((Date.now() - t0) / 1000).toFixed(0)}s — sessions=${sC} attendance=${aC} txns=${tC}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
