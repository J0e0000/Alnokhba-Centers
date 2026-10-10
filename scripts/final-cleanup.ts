import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // 1. demo students (99xxx) — cascade their txns/attendance/receipts/registrations
  const r1 = await p.student.deleteMany({ where: { code: { startsWith: "99" } } });
  console.log("demo students deleted:", r1.count);
  // 2. test teams
  const r2 = await p.team.deleteMany({});
  console.log("teams deleted:", r2.count);
  // 3. stale portal/teacher sessions from tests
  const r3 = await p.studentPortalSession.deleteMany({});
  const r4 = await p.teacherPortalSession.deleteMany({});
  console.log("portal sessions cleared:", r3.count, "+ teacher:", r4.count);
  // 4. final verification
  const counts = {
    students: await p.student.count(),
    txns: await p.studentTransaction.count(),
    attendance: await p.attendance.count(),
    sessions: await p.sessionInstance.count(),
    receipts: await p.receipt.count(),
    settlements: await p.teacherSettlement.count(),
    journal: await p.centerTransaction.count(),
    teams: await p.team.count(),
    announcements: await p.announcement.count(),
    notifications: await p.studentNotification.count(),
  };
  console.log("final counts:", JSON.stringify(counts));
  const elite = await p.student.count({ where: { centerId: "cmta2e4y20003qxs4ixxwy41f" } });
  const eliteTxns = await p.studentTransaction.count({ where: { student: { centerId: "cmta2e4y20003qxs4ixxwy41f" } } });
  console.log(`elite: ${elite} students (baseline 18) · ${eliteTxns} txns (baseline 279)`);
  await p.$disconnect();
}
main();
