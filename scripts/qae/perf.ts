/**
 * QAE1 PERF — spec §9: database performance & scalability on the stress center
 * (5000 students / 30 groups / ~72k ledger rows). Query plans + timings + index audit.
 * Run: bun scripts/qae/perf.ts
 */
import { PrismaClient } from "@prisma/client";
import { saveResult, makeRng, ri, pick, cairoTs, dayStr, qrToken } from "./lib";

const db = new PrismaClient();

async function main() {
  console.log(`\n== QAE1 PERF ==`);
  const stress = await db.center.findUnique({ where: { slug: "qae-c99-stress" } });
  if (!stress) throw new Error("stress center missing");
  const centerId = stress.id;

  // ---- extend stress center with month history (bulk, invariants-lite: no receipts needed for query perf) ----
  const s0 = Date.now();
  const existingAtt = await db.attendance.count({ where: { centerId } });
  if (existingAtt < 1000) {
    console.log("-- generating stress history (30 days × 30 groups) --");
    const groups = await db.group.findMany({ where: { centerId } });
    const slots = await db.scheduleSlot.findMany({ where: { centerId } });
    const regs = await db.studentGroup.findMany({ where: { student: { centerId } }, select: { studentId: true, groupId: true, priceOverride: true } });
    const students = await db.student.findMany({ where: { centerId }, select: { id: true, name: true, code: true, status: true } });
    const stById = new Map(students.map((s) => [s.id, s]));
    const byGroup = new Map<string, typeof regs>();
    for (const r of regs) (byGroup.get(r.groupId) ?? byGroup.set(r.groupId, []).get(r.groupId)!).push(r);
    const mgr = await db.user.findFirst({ where: { username: { startsWith: "qae-mgr-99" } } });
    const mgrId = mgr?.id ?? stress.id;
    const rng = makeRng(99202610);
    const sessions: any[] = [];
    const att: any[] = [];
    const txns: any[] = [];
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
          let revenue = 0;
          for (const r of (byGroup.get(g.id) ?? [])) {
            const st = stById.get(r.studentId)!;
            if (st.status !== "ACTIVE") continue;
            if (rng() > 0.8) continue;
            const price = r.priceOverride ?? g.sessionPrice;
            const at = new Date(startTs.getTime() + ri(rng, 0, 25) * 60000);
            att.push({ id: `ca${sessId}${r.studentId.slice(-8)}`, centerId, sessionId: sessId, studentId: r.studentId, status: "PRESENT", method: "MANUAL", charged: price, recordedBy: mgrId, createdAt: at, studentName: st.name, studentCode: st.code });
            txns.push({ id: `ct${sessId}${r.studentId.slice(-8)}`, centerId, studentId: r.studentId, sessionId: sessId, type: "CHARGE", amount: -price, reason: `حصة`, createdBy: mgrId, createdAt: at });
            revenue += price;
          }
        }
      }
    }
    console.log(`  sessions=${sessions.length} attendance=${att.length} txns=${txns.length}`);
    for (let i = 0; i < sessions.length; i += 500) await db.sessionInstance.createMany({ data: sessions.slice(i, i + 500) as any }).catch(async (e: any) => { if (!String(e).includes("UNIQUE")) throw e; });
    for (let i = 0; i < att.length; i += 1000) await db.attendance.createMany({ data: att.slice(i, i + 1000) as any }).catch(async (e: any) => { if (!String(e).includes("UNIQUE")) throw e; });
    for (let i = 0; i < txns.length; i += 1000) await db.studentTransaction.createMany({ data: txns.slice(i, i + 1000) as any }).catch(async (e: any) => { if (!String(e).includes("UNIQUE")) throw e; });
  }
  console.log(`  history ready in ${Date.now() - s0}ms`);

  // ---- measured queries (cold + warm) ----
  const results: any = { queries: [] };
  const timeQuery = async (name: string, sql: string, args: any[] = [], runs = 3): Promise<any> => {
    const times: number[] = [];
    let plan: any = null;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      await db.$queryRawUnsafe(sql, ...args);
      times.push(performance.now() - t0);
      if (i === 0) {
        try { plan = await db.$queryRawUnsafe(`EXPLAIN QUERY PLAN ${sql}`, ...args); } catch { plan = null; }
      }
    }
    times.sort((a, b) => a - b);
    const row = { name, min: +times[0].toFixed(1), max: +times[times.length - 1].toFixed(1), plan: plan ? plan.map((p: any) => String(p.detail)).join(" | ").slice(0, 200) : null };
    results.queries.push(row);
    console.log(`  ⏱ ${name}: min=${row.min}ms max=${row.max}ms ${row.plan ? `\n     plan: ${row.plan}` : ""}`);
    return row;
  };

  // pagination deep page
  await timeQuery("students pagination page 1 (5000 center)", `SELECT s.id, s.code, s.name, s.status FROM Student s WHERE s.centerId = ? ORDER BY s.createdAt DESC LIMIT 20 OFFSET 0`, [centerId]);
  await timeQuery("students pagination page 100 (deep offset)", `SELECT s.id, s.code, s.name FROM Student s WHERE s.centerId = ? ORDER BY s.createdAt DESC LIMIT 20 OFFSET 1980`, [centerId]);
  await timeQuery("students search by code (indexed)", `SELECT id FROM Student WHERE centerId = ? AND code = '59500'`, [centerId]);
  await timeQuery("students search by name LIKE (index scan)", `SELECT id FROM Student WHERE centerId = ? AND name LIKE '%أحمد%' LIMIT 20`, [centerId]);
  await timeQuery("attendance join sessions date range", `SELECT COUNT(*) n FROM Attendance a JOIN SessionInstance si ON si.id = a.sessionId WHERE a.centerId = ? AND si.date >= ?`, [centerId, dayStr(-14)]);
  await timeQuery("balances groupBy (groupBy studentId)", `SELECT studentId, SUM(amount) bal FROM StudentTransaction WHERE centerId = ? GROUP BY studentId`, [centerId]);
  await timeQuery("dashboard today sessions", `SELECT * FROM SessionInstance WHERE centerId = ? AND date = ?`, [centerId, dayStr(-1)]);
  await timeQuery("session close economics aggregate", `SELECT COALESCE(SUM(charged),0) rev, COUNT(*) n FROM Attendance WHERE sessionId IN (SELECT id FROM SessionInstance WHERE centerId = ? AND date = ?) AND status IN ('PRESENT','LATE')`, [centerId, dayStr(-7)]);
  await timeQuery("receipts count + sum", `SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM Receipt WHERE centerId = ?`, [centerId]);
  await timeQuery("audit recent 50 (centerId,createdAt)", `SELECT id, action FROM AuditLog WHERE centerId = ? ORDER BY createdAt DESC LIMIT 50`, [centerId]);

  // ---- index audit ----
  const idx = await db.$queryRawUnsafe(`SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name IN ('Student','Attendance','StudentTransaction','Receipt','AuditLog','SessionInstance')`);
  results.indexes = (idx as any[]).map((i) => `${i.tbl_name}.${i.name}`);
  const counts = {
    students: await db.student.count({ where: { centerId } }),
    groups: await db.group.count({ where: { centerId } }),
    sessions: await db.sessionInstance.count({ where: { centerId } }),
    attendance: await db.attendance.count({ where: { centerId } }),
    txns: await db.studentTransaction.count({ where: { centerId } }),
  };
  results.counts = counts;
  // full-DB size
  const all = await db.$queryRawUnsafe(`SELECT page_count * page_size AS size FROM pragma_page_count, pragma_page_size`);
  results.totalDbBytes = Number((all as any[])[0].size);
  console.log(`\n  counts: ${JSON.stringify(counts)}`);
  console.log(`  total DB size: ${(results.totalDbBytes / 1024 / 1024).toFixed(2)} MB`);
  saveResult("perf.json", results);
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
