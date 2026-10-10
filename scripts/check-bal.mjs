import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const txns = await db.studentTransaction.findMany({
  orderBy: { createdAt: 'desc' },
  take: 20,
  select: { id: true, type: true, amount: true, method: true, reason: true, createdAt: true, student: { select: { name: true, code: true } } },
});
for (const t of txns) {
  console.log(`${t.createdAt.toISOString().slice(0, 16)} | ${t.type.padEnd(10)} | amt=${String(t.amount).padStart(8)} | ${t.student.name} (${t.student.code}) | ${t.reason ?? ''}`);
}
const agg = await db.studentTransaction.aggregate({ _sum: { amount: true }, _count: true });
console.log('\nTOTAL txns:', agg._count, 'sum:', agg._sum.amount);
await db.$disconnect();
