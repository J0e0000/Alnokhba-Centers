/** prod_residue_deep.ts — READ-ONLY: verify QA-group session attendance ownership before cleanup. */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import { readFileSync } from "fs";

const envFile = readFileSync("/home/z/my-project/scripts/.env.prod-url", "utf8");
const m = envFile.match(/DATABASE_URL_POOLED="(postgres:\/\/[^"]+)"/);
if (!m) { console.error("no DATABASE_URL_POOLED"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url: m[1] } } });

async function main() {
  const tStudents = await db.student.findMany({ where: { name: { contains: "اختبار آلي" } }, select: { id: true, code: true } });
  const tIds = new Set(tStudents.map((s) => s.id));
  console.log("test student ids:", tStudents.map((s) => s.code).join(","));

  const tGroups = await db.group.findMany({ where: { name: { contains: "اختبار آلي QA" } }, select: { id: true, name: true } });
  for (const g of tGroups) {
    const sessions = await db.sessionInstance.findMany({ where: { groupId: g.id }, select: { id: true, date: true, status: true, name: true } });
    for (const s of sessions) {
      const atts = await db.attendance.findMany({ where: { sessionId: s.id }, select: { studentId: true, status: true } });
      const real = atts.filter((a) => !tIds.has(a.studentId));
      console.log(`QA-SESSION ${s.id.slice(-6)} (${g.name.slice(0, 20)}) ${s.date} ${s.status} att=${atts.length} realStudentAtt=${real.length}`);
    }
  }

  // probe session ufs7gj (CANCELLED, 11 att) — who are those students?
  const ufs = await db.sessionInstance.findUnique({ where: { id: "ufs7gj" } }).catch(() => null);
  const probeSessions = await db.sessionInstance.findMany({ where: { name: { startsWith: "probe" } }, select: { id: true, date: true, status: true } });
  for (const s of probeSessions) {
    const atts = await db.attendance.findMany({ where: { sessionId: s.id }, select: { studentId: true } });
    const real = atts.filter((a) => !tIds.has(a.studentId));
    const realStudents = await db.student.findMany({ where: { id: { in: real.map((a) => a.studentId) } }, select: { code: true, name: true } });
    console.log(`PROBE ${s.id.slice(-6)} ${s.date} ${s.status} att=${atts.length} real=${real.length} [${realStudents.map((r) => r.code).join(",")}]`);
  }

  // QA groups members detail (confirm they are the 7 test students)
  for (const g of tGroups) {
    const members = await db.studentGroup.findMany({ where: { groupId: g.id }, include: { student: { select: { code: true, name: true, status: true } } } });
    console.log(`QA-GROUP ${g.id.slice(-6)} members: ${members.map((mm) => `${mm.student.code}(${mm.student.status})`).join(", ")}`);
  }
}
main().finally(() => db.$disconnect());
