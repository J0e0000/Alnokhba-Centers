import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const sess = await db.sessionInstance.findMany({
    where: { date: today, OR: [{ name: { contains: "حضور مفتوح" } }, { name: { contains: "فيزياء" } }, { name: { contains: "كيمياء" } }] },
    select: { id: true, name: true, status: true, studentSource: true },
  });
  for (const s of sess) {
    console.log("cancelling:", s.name, s.status, s.studentSource);
    await db.sessionInstance.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
    await db.checkInAttempt.deleteMany({ where: { sessionId: s.id } });
  }
  // حذف آثار الاختبار من قاعدة البيانات المحلية فقط
  await db.attendance.deleteMany({ where: { session: { date: today, studentSource: "OPEN", name: { contains: "حضور مفتوح" } } } });
  console.log("done");
  await db.$disconnect();
}
main();
