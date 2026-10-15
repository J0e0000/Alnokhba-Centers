// فحص محتوى باك أب الداتابيز (db-backup-20261015/custom.db) عبر Prisma بـ DATABASE_URL مؤقت
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const centers = await db.center.findMany({ select: { id: true, slug: true, name: true, status: true } });
console.log('CENTERS:', JSON.stringify(centers, null, 1));

const total = await db.student.count();
console.log('TOTAL STUDENTS:', total);

const users = await db.user.findMany({
  select: { username: true, name: true, role: true, isActive: true, centerId: true },
  take: 50,
});
console.log('USERS:', JSON.stringify(users, null, 1));

const qaeStudents = await db.student.count({ where: { centerId: 'cmv954yva0000vaz8mm8ibkwq' } });
console.log('QAE STRESS CENTER STUDENTS:', qaeStudents);

await db.$disconnect();
