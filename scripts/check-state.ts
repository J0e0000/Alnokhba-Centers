/* فحص حالة الجلسات والديمو */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const sessions = await db.sessionInstance.findMany({
    where: { status: "OPEN" },
    include: { group: { include: { subject: { select: { name: true } } } } },
  });
  console.log("OPEN sessions:", sessions.length);
  sessions.forEach((s) => console.log(" -", s.date, s.startTime, s.group?.subject?.name, s.group?.name, "price:", s.price, "groupId:", s.groupId));

  const demo = await db.student.findMany({
    where: { code: { startsWith: "99" } },
    include: { txns: { select: { amount: true } } },
  });
  console.log("demo students:", demo.length);
  demo.forEach((s) => {
    const bal = s.txns.reduce((a, t) => a + t.amount, 0);
    console.log(" -", s.code, s.name, "balance:", bal / 100);
  });

  const demoGroups = await db.group.findMany({ where: { name: { contains: "تجريبي" } }, select: { name: true, sessionPrice: true, subject: { select: { name: true } } } });
  console.log("demo groups:", demoGroups.map((g) => `${g.name} (${g.subject.name}) price=${g.price}`).join(" | "));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
