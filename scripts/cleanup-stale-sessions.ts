/* تنضيف: جلسات قديمة OPEN (غير النهاردة) + بيانات ديمو متبقية */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const stale = await db.sessionInstance.findMany({
    where: { status: "OPEN", date: { lt: today } },
    select: { id: true, date: true, startTime: true },
  });
  if (stale.length) {
    await db.sessionInstance.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { status: "COMPLETED", closedAt: new Date() },
    });
  }
  console.log("closed stale sessions:", stale.length, stale.map((s) => `${s.date} ${s.startTime}`).join(" | "));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
