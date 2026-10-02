import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const runs = await db.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 });
  for (const r of runs) console.log(r.type, r.target, r.status, r.fileName, 'err:', r.error);
}
main().finally(() => db.$disconnect());
