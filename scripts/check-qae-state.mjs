// فحص حالة سنتر الـ QAE stress وحسابات اختبار الـ 5000 طالب
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const center = await db.center.findUnique({ where: { slug: 'qae-c99-stress' } });
console.log('CENTER:', center ? `${center.name} id=${center.id} active=${center.isActive}` : 'NOT FOUND');

if (center) {
  const students = await db.student.count({ where: { centerId: center.id } });
  console.log('STUDENTS IN QAE CENTER:', students);
  const users = await db.user.findMany({ where: { centerId: center.id }, select: { username: true, role: true, isActive: true, name: true } });
  console.log('USERS:', JSON.stringify(users, null, 1));
}

const total = await db.student.count();
console.log('TOTAL STUDENTS IN DB:', total);

const centers = await db.center.findMany({ select: { slug: true, name: true, status: true } });
console.log('ALL CENTERS:', JSON.stringify(centers, null, 1));

await db.$disconnect();
