/** مسح بيانات الفحص البصري المؤقتة — npx tsx scripts/dev-clean-visual.mts */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const centers = await db.center.findMany({ where: { slug: { startsWith: "vis-" } }, select: { id: true } });
  for (const c of centers) {
    const cid = c.id;
    await db.attendance.deleteMany({ where: { centerId: cid } });
    await db.sessionInstance.deleteMany({ where: { centerId: cid } });
    const students = await db.student.findMany({ where: { centerId: cid }, select: { id: true } });
    for (const s of students) await db.studentGroup.deleteMany({ where: { studentId: s.id } });
    await db.student.deleteMany({ where: { centerId: cid } });
    await db.scheduleSlot.deleteMany({ where: { centerId: cid } });
    await db.group.deleteMany({ where: { centerId: cid } });
    await db.subject.deleteMany({ where: { centerId: cid } });
    await db.grade.deleteMany({ where: { centerId: cid } });
    await db.teacher.deleteMany({ where: { centerId: cid } });
    await db.user.deleteMany({ where: { centerId: cid } });
    await db.center.delete({ where: { id: cid } });
  }
  console.log(`CLEANED: ${centers.length} center(s)`);
  process.exit(0);
}
main().catch((e) => { console.error("ERR:", String(e).slice(0, 300)); process.exit(1); });
