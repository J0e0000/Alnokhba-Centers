/* checkpoint للـ WAL قبل commit — يدمج بيانات الـ WAL جوه ملف الداتابيز الرئيسي */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const r = await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
  console.log("checkpoint:", r);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
