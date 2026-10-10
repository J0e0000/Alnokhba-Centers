import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

/** توليد كود 4 أرقام فريد داخل السنتر */
async function genCode(centerId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    const clash = await p.teacher.findFirst({ where: { centerId, loginCode: code } });
    if (!clash) return code;
  }
  throw new Error("impossible");
}

async function main() {
  const before = await p.teacher.count();
  let updated = 0;
  const teachers = await p.teacher.findMany({ where: { loginCode: null }, select: { id: true, centerId: true, name: true } });
  for (const t of teachers) {
    const code = await genCode(t.centerId);
    await p.teacher.update({ where: { id: t.id }, data: { loginCode: code } });
    updated++;
    console.log(`${t.name} → ${code}`);
  }
  const after = await p.teacher.count({ where: { loginCode: { not: null } } });
  console.log(`\nteachers total: ${before} | codes assigned: ${updated} | with code now: ${after}`);
  await p.$disconnect();
}
main();
