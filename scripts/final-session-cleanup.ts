/* فحص وتنضيف آخر حاجة: الجلستين المفتوحتين + أي حضور تجريبي على حصص حقيقية */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const open = await db.sessionInstance.findMany({
    where: { status: "OPEN" },
    include: { group: { include: { subject: { select: { name: true } } } }, attendance: { include: { student: { select: { code: true, name: true } } } } },
  });
  for (const s of open) {
    console.log(`OPEN: ${s.date} ${s.startTime} ${s.group.subject.name} ${s.group.name} — attendance: ${s.attendance.length}`);
    s.attendance.forEach((a) => console.log(`   - ${a.student.code} ${a.student.name} (${a.status})`));
  }

  // حضور طلاب تجريبيين (99xxx) على أي جلسة → امسحه
  const demoAtt = await db.attendance.findMany({
    where: { student: { code: { startsWith: "99" } } },
    select: { id: true, student: { select: { code: true } }, session: { select: { date: true, status: true } } },
  });
  console.log("demo attendance records:", demoAtt.length, demoAtt.map((a) => `${a.student.code}→${a.session.date}(${a.session.status})`).join(" | "));
  if (demoAtt.length) {
    // امسح الحركات المرتبطة بالحضور التجريبي الأول (خصومات الحصص)
    for (const a of demoAtt) {
      await db.studentTransaction.deleteMany({ where: { attendanceId: a.id } }).catch(() => {});
      await db.attendance.delete({ where: { id: a.id } }).catch(() => {});
    }
    console.log("demo attendance cleaned");
  }

  // قفل الجلستين المفتوحتين (من الاختبارات — الموظف يقدر يفتحها بضغطة)
  await db.sessionInstance.updateMany({
    where: { status: "OPEN" },
    data: { status: "COMPLETED", closedAt: new Date() },
  });
  console.log("sessions closed");

  const fin = await db.sessionInstance.count({ where: { status: "OPEN" } });
  const students = await db.student.count();
  console.log(`FINAL: open=${fin} · students=${students}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
