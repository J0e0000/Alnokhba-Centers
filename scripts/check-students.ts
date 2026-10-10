/* فحص حالة الطلاب */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const all = await db.student.groupBy({ by: ["status"], _count: true });
  console.log("students by status:", all.map((g) => `${g.status}=${g._count}`).join(" · "));
  const total = await db.student.count();
  console.log("total students:", total);
  const archived = await db.student.findMany({ where: { status: { not: "ACTIVE" } }, select: { code: true, name: true, status: true, notes: true } });
  archived.forEach((s) => console.log(" -", s.code, s.name, s.status, (s.notes ?? "").slice(0, 40)));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
