/* إحصائيات سريعة للداتابيز المحلية — للتشخيص قبل/بعد اختبار الحمل */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
const [attempts, attendance, audit, events, tokens, sessions, students] = await Promise.all([
  db.checkInAttempt.count(),
  db.attendance.count(),
  db.auditLog.count(),
  db.attendanceEvent.count(),
  db.sessionQRToken.count(),
  db.sessionInstance.count(),
  db.student.count(),
]);
console.log({ attempts, attendance, audit, events, tokens, sessions, students });
// أكبر جدول: توزيع المحاولات على آخر أيام
const recent = await db.checkInAttempt.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
console.log({ attemptsLast24h: recent });
await db.$queryRawUnsafe("PRAGMA journal_mode;").then((r) => console.log("journal_mode:", r));
}
main().finally(() => db.$disconnect());
