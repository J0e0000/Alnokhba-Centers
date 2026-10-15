// هات طالب نشط له qrToken من سنتر الديمو + فحص توزيع الحالات
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const CID = 'cmv954yva0000vaz8mm8ibkwq';
const statuses = await db.$queryRawUnsafe(`SELECT status, COUNT(*) as n FROM Student WHERE centerId = '${CID}' GROUP BY status`);
console.log('STATUSES:', JSON.stringify(statuses.map((r) => ({ status: r.status, n: Number(r.n) }))));

const s = await db.student.findFirst({
  where: { centerId: CID },
  select: { qrToken: true, name: true, phone: true, status: true, id: true },
});
console.log('FIRST STUDENT:', JSON.stringify(s));

const withToken = await db.student.count({ where: { centerId: CID, qrToken: { not: null } } });
console.log('WITH TOKEN:', withToken);

await db.$disconnect();
