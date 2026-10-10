/**
 * prod_test_cleanup.ts — TEST-MODE → FULL-PRODUCT-MODE cleanup.
 * Removes ONLY verified test-origin rows from production Postgres:
 *   - 4 QA groups "اختبار آلي QA — يمكن حذفه" (+ their 3 sessions, attendance = test students only)
 *   - 7 archived test students "اختبار آلي — تجاهله" (+ cascaded test attendance/txns)
 *   - 1 OPEN probe session (0 attendance)
 *   - deactivates staff test account agent_teach_t (reversible, row kept)
 * SAFETY: full JSON backup BEFORE delete; assertions abort if real-student data found;
 *         single transaction; AuditLog entry written (system actor).
 * Does NOT touch: stale open real-group sessions, CANCELLED probe ufs7gj, subscriptions.
 */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import { readFileSync, writeFileSync } from "fs";

const envFile = readFileSync("/home/z/my-project/scripts/.env.prod-url", "utf8");
const m = envFile.match(/DATABASE_URL_POOLED="(postgres:\/\/[^"]+)"/);
if (!m) { console.error("no DATABASE_URL_POOLED"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url: m[1] } } });

const DRY = process.argv.includes("--dry");

async function main() {
  /* ---------- 1) collect targets ---------- */
  const qaGroups = await db.group.findMany({ where: { name: { contains: "اختبار آلي QA" } } });
  const qaGroupIds = qaGroups.map((g) => g.id);
  const qaSessions = await db.sessionInstance.findMany({ where: { groupId: { in: qaGroupIds } } });
  const qaSessionIds = qaSessions.map((s) => s.id);

  const tStudents = await db.student.findMany({ where: { name: { contains: "اختبار آلي" } } });
  const tIds = tStudents.map((s) => s.id);

  const probeSessions = await db.sessionInstance.findMany({ where: { name: { startsWith: "probe" }, status: "OPEN" } });
  const deletableProbes = [];
  for (const s of probeSessions) {
    const att = await db.attendance.count({ where: { sessionId: s.id } });
    if (att === 0) deletableProbes.push(s);
  }

  const agentUser = await db.user.findUnique({ where: { username: "agent_teach_t" } });
  if (!agentUser || !agentUser.isActive) { console.error("agent_teach_t missing or already inactive"); }

  /* ---------- 2) SAFETY ASSERTIONS ---------- */
  if (tIds.length !== 7) throw new Error(`expected 7 test students, found ${tIds.length} — abort`);
  if (qaGroupIds.length !== 4) throw new Error(`expected 4 QA groups, found ${qaGroupIds.length} — abort`);
  const receiptsOnTest = await db.receipt.count({ where: { studentId: { in: tIds } } });
  if (receiptsOnTest > 0) throw new Error(`test students have ${receiptsOnTest} receipts — manual review needed, abort`);
  // QA session attendance must be 100% test students
  for (const s of qaSessions) {
    const atts = await db.attendance.findMany({ where: { sessionId: s.id }, select: { studentId: true } });
    const real = atts.filter((a) => a.studentId && !tIds.includes(a.studentId));
    if (real.length) throw new Error(`QA session ${s.id} has ${real.length} real-student attendance — abort`);
  }
  // probe sessions must be empty
  for (const s of deletableProbes) {
    const att = await db.attendance.count({ where: { sessionId: s.id } });
    if (att > 0) throw new Error(`probe ${s.id} gained attendance — abort`);
  }
  console.log(`✓ assertions passed: 7 test students, 4 QA groups, ${qaSessions.length} QA sessions, ${deletableProbes.length} empty open probes`);

  /* ---------- 3) BACKUP (before any delete) ---------- */
  const att = await db.attendance.findMany({ where: { OR: [{ sessionId: { in: qaSessionIds } }, { studentId: { in: tIds } }] } });
  const txns = await db.studentTransaction.findMany({ where: { studentId: { in: tIds } } });
  const mem = await db.studentGroup.findMany({ where: { OR: [{ studentId: { in: tIds } }, { groupId: { in: qaGroupIds } }] } });
  const backup = { exportedAt: new Date().toISOString(), qaGroups, qaSessions, tStudents, attendance: att, txns, memberships: mem, deletableProbes, agentUser };
  const backupPath = `/home/z/my-project/backups/prod-test-cleanup-${Date.now()}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`✓ backup written: ${backupPath} (students=${tStudents.length}, attendance=${att.length}, txns=${txns.length}, sessions=${qaSessions.length + deletableProbes.length})`);

  if (DRY) { console.log("DRY RUN — no writes."); await db.$disconnect(); return; }

  /* ---------- 4) TRANSACTION ---------- */
  const result = await db.$transaction(async (tx) => {
    // bookSale has RESTRICT on student — detach any (expected 0)
    const bookSales = await tx.bookSale.findMany({ where: { studentId: { in: tIds } }, select: { id: true } });
    if (bookSales.length) {
      await tx.bookSale.updateMany({ where: { studentId: { in: tIds } }, data: { studentId: null } });
    }
    const r: Record<string, number> = {};
    r.attendance = (await tx.attendance.deleteMany({ where: { OR: [{ sessionId: { in: qaSessionIds } }, { studentId: { in: tIds } }] } })).count;
    r.txns = (await tx.studentTransaction.deleteMany({ where: { studentId: { in: tIds } } })).count;
    r.memberships = (await tx.studentGroup.deleteMany({ where: { OR: [{ studentId: { in: tIds } }, { groupId: { in: qaGroupIds } }] } })).count;
    r.sessions = (await tx.sessionInstance.deleteMany({ where: { id: { in: [...qaSessionIds, ...deletableProbes.map((s) => s.id)] } } })).count;
    r.groups = (await tx.group.deleteMany({ where: { id: { in: qaGroupIds } } })).count;
    r.students = (await tx.student.deleteMany({ where: { id: { in: tIds } } })).count;
    // deactivate test staff account (reversible)
    if (agentUser?.isActive) {
      await tx.user.update({ where: { id: agentUser.id }, data: { isActive: false } });
      r.staffDeactivated = 1;
    }
    // audit entry (system actor, no user row)
    await tx.auditLog.create({
      data: {
        centerId: qaGroups[0]?.centerId ?? null,
        userId: null,
        userName: "نظام تنظيف بيانات الاختبار (Super Z)",
        action: "TEST_DATA_CLEANUP",
        entity: "SYSTEM",
        reason: "تحويل الخادم من وضع الاختبار إلى وضع المنتج الكامل — بناء على طلب المالك",
        before: JSON.stringify({ students: tStudents.length, groups: qaGroupIds.length, sessions: qaSessionIds.length + deletableProbes.length, attendance: att.length, txns: txns.length, agent_teach_t: "ACTIVE" }),
        after: JSON.stringify({ ...r, agent_teach_t: "INACTIVE", backup: backupPath.split("/").pop() }),
      },
    });
    return r;
  });
  console.log("✓ cleanup done:", JSON.stringify(result));

  /* ---------- 5) POST-VERIFY ---------- */
  const left = {
    tStudents: await db.student.count({ where: { name: { contains: "اختبار آلي" } } }),
    qaGroups: await db.group.count({ where: { name: { contains: "اختبار آلي QA" } } }),
    openProbes: await db.sessionInstance.count({ where: { name: { startsWith: "probe" }, status: "OPEN" } }),
    agentActive: (await db.user.findUnique({ where: { username: "agent_teach_t" } }))?.isActive ?? false,
    realStudents: await db.student.count(),
  };
  console.log("POST-VERIFY:", JSON.stringify(left));
  if (left.tStudents || left.qaGroups || left.openProbes || left.agentActive) {
    console.error("✗ residue remains!");
    process.exitCode = 2;
  } else {
    console.log("✓ SERVER IS NOW IN FULL PRODUCT MODE (test residue = 0)");
  }
}
main().finally(() => db.$disconnect());
