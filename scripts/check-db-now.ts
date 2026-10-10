import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const counts = {
    centers: await p.center.count(),
    users: await p.user.count(),
    authSessions: await p.authSession.count(),
    students: await p.student.count(),
    teachers: await p.teacher.count(),
    groups: await p.group.count(),
    subjects: await p.subject.count(),
    grades: await p.grade.count(),
    rooms: await p.room.count(),
    slots: await p.scheduleSlot.count(),
    sessions: await p.sessionInstance.count(),
    attendance: await p.attendance.count(),
    txns: await p.studentTransaction.count(),
    settlements: await p.teacherSettlement.count(),
    journal: await p.centerTransaction.count(),
    announcements: await p.announcement.count(),
    notifications: await p.studentNotification.count(),
    portalSessions: await p.studentPortalSession.count(),
  };
  console.log("=== COUNTS ===");
  console.log(JSON.stringify(counts, null, 1));

  // per-center students (worklog baseline: elite 18, amal 8, capacity 5000)
  const perCenter = await p.student.groupBy({ by: ["centerId"], _count: true });
  const centers = await p.center.findMany({ select: { id: true, name: true, status: true } });
  console.log("=== STUDENTS PER CENTER ===");
  for (const c of perCenter) {
    const name = centers.find((x) => x.id === c.centerId)?.name ?? "?";
    console.log(`${name}: ${c._count}`);
  }
  console.log("centers:", centers.map((c) => `${c.name} (${c.status})`).join(" | "));

  // integrity check via raw
  const integrity = await p.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
  console.log("integrity:", integrity[0]?.integrity_check);

  // foreign_key_check
  const fk = await p.$queryRawUnsafe<{ table: string; rowid: number; parent: string; fkid: number }[]>(
    "PRAGMA foreign_key_check"
  );
  console.log("fk violations:", fk.length, JSON.stringify(fk.slice(0, 10)));

  // elite center txn baseline was 279
  const eliteTxns = await p.studentTransaction.count({
    where: { student: { centerId: "cmta2e4y20003qxs4ixxwy41f" } },
  });
  console.log("elite txns (baseline 279):", eliteTxns);

  await p.$disconnect();
}
main();
