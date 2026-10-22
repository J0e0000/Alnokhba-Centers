/**
 * بيانات تجريبية مؤقتة للفحص البصري للرئيسية الجديدة — بتتمسح بعدها.
 * مينفعش تفضل في الإنتاج — دي قاعدة التطوير المحلية بس.
 * تشغيل: npx tsx scripts/dev-seed-visual.mts
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const db = new PrismaClient();
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function nowHM(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  await clean();

  const center = await db.center.create({ data: { name: "النخبة — تجريبي", slug: `vis-${Date.now()}`, phone: "01000000000" } });
  const cid = center.id;

  await db.user.create({ data: { centerId: cid, username: "vismgr", passwordHash: hashPassword("vis1234"), name: "أحمد المدير", role: "MANAGER" } });
  await db.user.create({ data: { centerId: cid, username: "visrec", passwordHash: hashPassword("vis1234"), name: "سارة الاستقبال", role: "RECEPTIONIST" } });

  const grade = await db.grade.create({ data: { centerId: cid, name: "الثالث الثانوي" } });
  const subject = await db.subject.create({ data: { centerId: cid, name: "رياضة" } });
  const teacher = await db.teacher.create({ data: { centerId: cid, name: "أ. محمود سعيد", phone: "01111111111" } });

  const g1 = await db.group.create({ data: { centerId: cid, name: "A", gradeId: grade.id, subjectId: subject.id, teacherId: teacher.id, sessionPrice: 5000, teacherPercent: 60, room: "قاعة 1" } });
  const g2 = await db.group.create({ data: { centerId: cid, name: "B", gradeId: grade.id, subjectId: subject.id, teacherId: teacher.id, sessionPrice: 4000, teacherPercent: 55, room: "قاعة 2" } });

  const students = [];
  for (let i = 1; i <= 3; i++) {
    const s = await db.student.create({
      data: { centerId: cid, name: `طالب تجريبي ${i}`, code: String(90000 + i), qrToken: `vis-${Date.now()}-${i}`, gradeId: grade.id, parentPhone: `0120000000${i}` },
    });
    await db.studentGroup.create({ data: { studentId: s.id, groupId: g1.id } });
    students.push(s);
  }
  const s4 = await db.student.create({ data: { centerId: cid, name: "طالب تجريبي 4", code: "90004", qrToken: `vis-${Date.now()}-4`, gradeId: grade.id } });
  await db.studentGroup.create({ data: { studentId: s4.id, groupId: g2.id } });

  const today = todayISO();
  const dow = new Date(`${today}T00:00:00`).getDay();

  const slot1 = await db.scheduleSlot.create({ data: { centerId: cid, dayOfWeek: dow, startTime: nowHM(-40), endTime: nowHM(50), groupId: g1.id, room: "قاعة 1" } });
  await db.scheduleSlot.create({ data: { centerId: cid, dayOfWeek: dow, startTime: nowHM(120), endTime: nowHM(210), groupId: g2.id, room: "قاعة 2" } });
  await db.scheduleSlot.create({ data: { centerId: cid, dayOfWeek: dow, startTime: nowHM(240), endTime: nowHM(330), groupId: g1.id } });

  // حصة شغالة: 2 من 3 مسجلين → شارة «ناقص 1 رصد»
  const session = await db.sessionInstance.create({
    data: { centerId: cid, scheduleId: slot1.id, groupId: g1.id, date: today, startTime: nowHM(-40), endTime: nowHM(50), room: "قاعة 1", price: 5000, teacherPercent: 60, status: "OPEN", openedBy: "vis" },
  });
  for (const s of students.slice(0, 2)) {
    await db.attendance.create({ data: { centerId: cid, sessionId: session.id, studentId: s.id, status: "PRESENT", method: "QR_SCAN", charged: 5000, recordedBy: "vis" } });
  }

  // حصة منتهية (للبصمة الكاملة)
  const doneSession = await db.sessionInstance.create({
    data: { centerId: cid, groupId: g2.id, date: today, startTime: nowHM(-300), endTime: nowHM(-180), room: "قاعة 2", price: 4000, teacherPercent: 55, status: "CLOSED", openedBy: "vis", closedAt: new Date(), presentCount: 1, totalRevenue: 4000, teacherShare: 2200, centerShare: 1800 },
  });
  await db.attendance.create({ data: { centerId: cid, sessionId: doneSession.id, studentId: s4.id, status: "PRESENT", method: "MANUAL", charged: 4000 } });

  console.log("SEEDED: vismgr/vis1234 (مدير) · visrec/vis1234 (استقبال)");
  process.exit(0);
}

/** مسح بترتيب الـ FK اليدوي — لبيانات السنتر التجريبي بس */
export async function clean() {
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
}

main().catch((e) => { console.error("ERR:", String(e).slice(0, 400)); process.exit(1); });
