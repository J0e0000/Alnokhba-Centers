// جداول الباك أب + عدد الصفوف — لتحديد نطاق الترحيل
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const tables = await db.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations' ORDER BY name`);
const CID = 'cmv954yva0000vaz8mm8ibkwq';
let total = 0;
for (const { name } of tables) {
  try {
    const n = await db.$queryRawUnsafe(`SELECT COUNT(*) as n FROM "${name}"`);
    const rows = Number(n[0].n);
    total += rows;
    if (rows > 0) console.log(`${name}: ${rows}`);
  } catch { /* skip */ }
}
console.log('TOTAL ROWS:', total);
await db.$disconnect();
