// تجهيز بيانات اختبار اللوحة الموحدة: فتح حصتين مختلفتين في نفس الوقت + طباعة أكواد الطلاب
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const CENTER = "cmvaippgj0000py23e2mm9ewz"; // qae-c99-stress فقط — لا نلمس سنترات حقيقية

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
console.log("TODAY=", today);

const sessions = await db.sessionInstance.findMany({
  where: { centerId: CENTER, date: today },
  include: { group: { include: { subject: true, grade: true } } },
  orderBy: { startTime: "asc" },
});
console.log("TODAY SESSIONS:", sessions.map((s) => ({
  id: s.id, status: s.status, start: s.startTime, src: s.studentSource,
  name: `${s.group?.subject.name} ${s.group?.grade?.name ?? ""} ${s.group?.name}`,
})));

const groups = await db.studentGroup.groupBy({
  by: ["groupId"],
  where: { status: "ACTIVE", student: { status: "ACTIVE" }, group: { centerId: CENTER, isActive: true } },
  _count: { groupId: true },
});
console.log("GROUPS WITH STUDENTS:", groups);

// اطبع أول 8 طلاب نشطين بأكوادهم + مجموعاتهم
const regs = await db.studentGroup.findMany({
  where: { status: "ACTIVE", student: { status: "ACTIVE" }, group: { centerId: CENTER, isActive: true } },
  include: { student: { select: { code: true, name: true } }, group: { include: { subject: true, grade: true } } },
  take: 8,
});
console.log("SAMPLE STUDENTS:", regs.map((r) => ({
  code: r.student.code, name: r.student.name,
  group: `${r.group.subject.name} ${r.group.grade?.name ?? ""} ${r.group.name}`, groupId: r.groupId,
})));

await db.$disconnect();
