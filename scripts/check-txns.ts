/* فحص معاملات طالبة الديمو 99006 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const st = await db.student.findFirst({ where: { code: "99006" }, include: { txns: true } });
  console.log("student:", st?.name, "· txns:", st?.txns.length);
  st?.txns.forEach((t) => console.log(" -", t.type, t.amount, t.reason));
  const st1 = await db.student.findFirst({ where: { code: "99001" }, include: { txns: true } });
  console.log("student:", st1?.name, "· txns:", st1?.txns.length);
  st1?.txns.forEach((t) => console.log(" -", t.type, t.amount, t.reason));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
