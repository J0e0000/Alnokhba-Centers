/** prod_residue_deps.ts — READ-ONLY: dependency check for each test artifact before cleanup. */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import { readFileSync } from "fs";

const envFile = readFileSync("/home/z/my-project/scripts/.env.prod-url", "utf8");
const m = envFile.match(/DATABASE_URL_POOLED="(postgres:\/\/[^"]+)"/);
if (!m) { console.error("no DATABASE_URL_POOLED"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url: m[1] } } });

async function main() {
  const tGroups = await db.group.findMany({ where: { name: { contains: "اختبار آلي QA" } }, select: { id: true, name: true, isActive: true } });
  for (const g of tGroups) {
    const sessions = await db.sessionInstance.count({ where: { groupId: g.id } });
    const members = await db.studentGroup.count({ where: { groupId: g.id } });
    const schedules = -1;
    console.log(`GROUP ${g.id.slice(-6)} "${g.name}" active=${g.isActive} sessions=${sessions} members=${members} schedules=${schedules}`);
  }

  const tStudents = await db.student.findMany({
    where: { name: { contains: "اختبار آلي" } },
    select: { id: true, code: true, name: true, status: true },
  });
  for (const s of tStudents) {
    const att = await db.attendance.count({ where: { studentId: s.id } });
    const txns = await db.studentTransaction.count({ where: { studentId: s.id } });
    const receipts = await db.receipt.count({ where: { studentId: s.id } });
    const groups = await db.studentGroup.count({ where: { studentId: s.id } });
    console.log(`STUDENT ${s.code} "${s.name}" ${s.status} attendance=${att} txns=${txns} receipts=${receipts} groupMemberships=${groups}`);
  }

  const probe = await db.sessionInstance.findMany({ where: { name: { startsWith: "probe" } }, select: { id: true, name: true, date: true, status: true } });
  for (const s of probe) {
    const att = await db.attendance.count({ where: { sessionId: s.id } });
    const receipts = await db.receipt.count({ where: { sessionId: s.id } });
    const txns = await db.studentTransaction.count({ where: { sessionId: s.id } });
    console.log(`PROBE-SESSION ${s.id.slice(-6)} "${s.name}" ${s.date} ${s.status} attendance=${att} receipts=${receipts} txns=${txns}`);
  }

  const ag = await db.user.findUnique({ where: { username: "agent_teach_t" }, select: { id: true, name: true, isActive: true, createdAt: true } });
  console.log(`agent_teach_t:`, JSON.stringify(ag));
}
main().finally(() => db.$disconnect());
