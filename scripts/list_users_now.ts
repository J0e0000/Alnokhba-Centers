import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const aca = await db.user.findMany({ where: { scope: 'academia', isActive: true }, select: { username: true, role: true }, take: 10 });
  console.log('ACADEMIA:', JSON.stringify(aca));
  const cen = await db.user.findMany({ where: { scope: 'centers', isActive: true }, select: { username: true, role: true, centerId: true }, take: 12 });
  console.log('CENTERS:', JSON.stringify(cen));
  const centers = await db.center.findMany({ select: { id: true, name: true, slug: true } });
  console.log('CENTERS_TABLE:', JSON.stringify(centers));
}
main().finally(() => db.$disconnect());
