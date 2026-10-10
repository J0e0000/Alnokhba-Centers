/** تشخيص: هل الحضور بيتسجل فعلاً في الحصة التجريبية؟ */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const center = await db.center.findFirst();
  // كل الحصص النهاردة
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await db.sessionInstance.findMany({
    where: { centerId: center.id, date: today },
    include: { group: { include: { subject: true } }, _count: { select: { attendance: true } } },
  });
  console.log("حصص النهاردة:");
  for (const s of sessions) {
    console.log(`  ${s.id.slice(-6)} | ${s.group.name} ${s.group.subject.name} | ${s.startTime}-${s.endTime} | attendance=${s._count.attendance} | status=${s.status}`);
  }
  // حضور مرتبط بالحصص دي
  const att = await db.attendance.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
    include: { student: { select: { code: true, name: true } } },
  });
  console.log("الحضور:", att.map((a) => `${a.student.code} (${a.status}, charged=${a.charged})`));
  await db.$disconnect();
}
main();
