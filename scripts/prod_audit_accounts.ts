/**
 * prod_audit_accounts.ts — READ-ONLY production audit.
 * Lists: centers, staff accounts, students, portal-capable students,
 * and detects demo/test artifacts (demo students 99xxx, demo groups, test centers).
 * NEVER writes.
 */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import { readFileSync } from "fs";

const envFile = readFileSync("/home/z/my-project/scripts/.env.prod-url", "utf8");
const m = envFile.match(/DATABASE_URL_POOLED="(postgres:\/\/[^"]+)"/);
if (!m) { console.error("no DATABASE_URL_POOLED"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url: m[1] } } });

async function main() {
  const centers = await db.center.findMany({ select: { id: true, name: true, slug: true, status: true }, orderBy: { name: "asc" } });
  const cName = (id: string | null) => id ? (centers.find((c) => c.id === id)?.name ?? "(unknown)") : "(platform)";

  const users = await db.user.findMany({
    select: { username: true, name: true, role: true, centerId: true, isActive: true, scope: true },
    orderBy: [{ scope: "asc" }, { centerId: "asc" }, { role: "asc" }],
  });

  console.log("=== CENTERS ===");
  for (const c of centers) console.log(`${c.name} | slug=${c.slug} | status=${c.status}`);

  console.log(`\n=== STAFF ACCOUNTS === total=${users.length}`);
  for (const u of users) {
    console.log(`${u.username} | ${u.name} | role=${u.role} | scope=${u.scope} | center=${cName(u.centerId)} | active=${u.isActive}`);
  }

  const students = await db.student.findMany({
    select: { code: true, name: true, phone: true, status: true, centerId: true, notes: true },
    orderBy: { code: "asc" },
  });
  const byCenter = new Map<string, typeof students>();
  for (const s of students) {
    const k = cName(s.centerId);
    if (!byCenter.has(k)) byCenter.set(k, [] as typeof students);
    byCenter.get(k)!.push(s);
  }
  console.log(`\n=== STUDENTS === total=${students.length}`);
  for (const [c, list] of byCenter) {
    const portal = list.filter((s) => s.phone && s.status === "ACTIVE");
    console.log(`\n-- ${c}: ${list.length} students (${portal.length} with portal access: active + phone)`);
    for (const s of list) {
      const demo = (s.notes?.includes("تجريبية") ?? false) || /^99\d{3}$/.test(s.code) ? " [DEMO]" : "";
      console.log(`   ${s.code} | ${s.name} | status=${s.status} | phone=${s.phone ?? "-"}${demo}`);
    }
  }

  // demo/test artifacts
  const demoGroups = await db.group.findMany({ where: { name: { startsWith: "تجريبي " } }, select: { id: true, name: true, centerId: true } });
  const demoTeachers = await db.teacher.findMany({ where: { name: "أ. تجريبي" }, select: { id: true, name: true, centerId: true } });
  const testCenters = centers.filter((c) => /test|تجريبي|demo|caps-test/i.test(c.name));
  console.log(`\n=== DEMO/TEST ARTIFACTS ===`);
  console.log(`demo groups: ${demoGroups.length}`, demoGroups.map((g) => `${g.name}@${cName(g.centerId)}`).join(", "));
  console.log(`demo teachers: ${demoTeachers.length}`, demoTeachers.map((t) => `${t.name}@${cName(t.centerId)}`).join(", "));
  console.log(`test-named centers: ${testCenters.length}`, testCenters.map((c) => c.name).join(", "));

  const counts = {
    sessions: await db.sessionInstance.count(),
    attendance: await db.attendance.count(),
    payments: await db.studentTransaction.count(),
    auditLogs: await db.auditLog.count(),
  };
  console.log(`\n=== DATA VOLUME === ${JSON.stringify(counts)}`);
}
main().finally(() => db.$disconnect());
