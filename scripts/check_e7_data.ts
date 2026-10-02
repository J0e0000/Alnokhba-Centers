import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const t2 = await db.user.findUnique({ where: { username: 'aca-teacher2' }, select: { id: true } });
  const groups = await db.acaGroup.findMany({ where: { teacherId: t2!.id }, select: { id: true, name: true } });
  console.log('t2 groups:', groups.length, groups.map(g => g.id));
  const allStudents = await db.acaStudentProfile.findMany({ select: { id: true } });
  const enrolled = await db.acaEnrollment.findMany({ select: { studentId: true, groupId: true, status: true } });
  const enrolledIds = new Set(enrolled.filter(e => e.status === 'ACTIVE').map(e => e.studentId));
  const outsiders = allStudents.filter(s => !enrolledIds.has(s.id));
  console.log('total students:', allStudents.length, '| outsiders (not actively enrolled anywhere):', outsiders.length, outsiders.slice(0, 2).map(o => o.id));
  // exam owned by teacher1 (not teacher2) — for cross-teacher grading attempt
  const t1 = await db.user.findUnique({ where: { username: 'aca-teacher1' }, select: { id: true } });
  const t1Exam = await db.acaExam.findFirst({ where: { group: { teacherId: t1!.id } }, select: { id: true, title: true, groupId: true } });
  console.log('t1 exam:', t1Exam);
}
main().finally(() => db.$disconnect());
