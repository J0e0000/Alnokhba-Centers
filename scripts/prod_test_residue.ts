/** prod_test_residue.ts — READ-ONLY scan for test leftovers that affect product behavior. */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import { readFileSync } from "fs";

const envFile = readFileSync("/home/z/my-project/scripts/.env.prod-url", "utf8");
const m = envFile.match(/DATABASE_URL_POOLED="(postgres:\/\/[^"]+)"/);
if (!m) { console.error("no DATABASE_URL_POOLED"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url: m[1] } } });

const TEST_MARKERS = /اختبار|تجربة|تجريبي|test|loadtest|caps-test|demo/i;

async function main() {
  // 1) OPEN sessions (any date) — leftover open sessions hijack attendance resolution
  const open = await db.sessionInstance.findMany({
    where: { status: "OPEN" },
    select: { id: true, date: true, startTime: true, endTime: true, status: true, centerId: true, name: true, createdAt: true, groupId: true },
    orderBy: { date: "desc" },
  });
  const centers = await db.center.findMany({ select: { id: true, name: true } });
  const cName = (id: string | null) => id ? (centers.find((c) => c.id === id)?.name ?? "?") : "(platform)";
  const groups = await db.group.findMany({ select: { id: true, name: true } });
  const gName = (id: string | null) => id ? (groups.find((g) => g.id === id)?.name ?? "?") : "(no group)";
  console.log(`=== OPEN SESSIONS === count=${open.length}`);
  for (const s of open) {
    const flagged = TEST_MARKERS.test(gName(s.groupId)) || TEST_MARKERS.test(s.name ?? "") ? " [TEST-LIKE]" : "";
    console.log(`${s.id.slice(-6)} | ${s.date} ${s.startTime}-${s.endTime} | center=${cName(s.centerId)} | group=${gName(s.groupId)} | name=${s.name ?? "-"}${flagged}`);
  }

  // 2) Test-named groups / teachers (any state)
  const tGroups = await db.group.findMany({ select: { id: true, name: true, centerId: true, isActive: true } });
  const flaggedGroups = tGroups.filter((g) => TEST_MARKERS.test(g.name));
  console.log(`\n=== TEST-NAMED GROUPS === ${flaggedGroups.length}`);
  for (const g of flaggedGroups) console.log(`${g.name} | center=${cName(g.centerId)} | active=${g.isActive}`);

  const tTeachers = await db.teacher.findMany({ select: { id: true, name: true, centerId: true, isActive: true } });
  const flaggedTeachers = tTeachers.filter((t) => TEST_MARKERS.test(t.name));
  console.log(`\n=== TEST-NAMED TEACHERS === ${flaggedTeachers.length}`);
  for (const t of flaggedTeachers) console.log(`${t.name} | center=${cName(t.centerId)} | active=${t.isActive}`);

  // 3) Archived test students (detail)
  const tStudents = await db.student.findMany({
    where: { OR: [{ status: "ARCHIVED" }, { name: { contains: "اختبار" } }] },
    select: { code: true, name: true, status: true, centerId: true, createdAt: true },
  });
  console.log(`\n=== ARCHIVED/TEST STUDENTS === ${tStudents.length}`);
  for (const s of tStudents) console.log(`${s.code} | ${s.name} | ${s.status} | ${cName(s.centerId)}`);

  // 4) agent tasks + usages leftovers (agent test data)
  const tasks = await db.agentTask.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, status: true, createdAt: true } });
  console.log(`\n=== AGENT TASKS (last 5) === ${JSON.stringify(tasks).slice(0, 500)}`);
}
main().finally(() => db.$disconnect());
