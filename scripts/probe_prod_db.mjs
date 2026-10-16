// probe_prod_db.mjs — فحص قاعدة الإنتاج (قراءة فقط) قبل الزرع
// Usage: node scripts/probe_prod_db.mjs "postgresql://user:pass@host:5432/postgres"
import { PrismaClient } from "@prisma/client";

const url = process.argv[2];
if (!url) { console.log("pass DATABASE_URL"); process.exit(1); }
const db = new PrismaClient({ datasources: { db: { url } } });

try {
  const centers = await db.center.findMany({
    select: { id: true, name: true, slug: true, _count: { select: { students: true, users: true } } },
  });
  console.log("CENTERS:", JSON.stringify(centers, null, 1));

  const users = await db.user.groupBy({ by: ["role"], _count: true });
  console.log("USERS BY ROLE:", users.map(u => `${u.role}:${u._count}`).join(", "));

  const students = await db.student.count();
  console.log("TOTAL STUDENTS:", students);

  // هل فيه سنتر qae قديم؟
  const qae = await db.center.findMany({ where: { slug: { startsWith: "qae-" } }, select: { slug: true } });
  console.log("EXISTING QAE CENTERS:", qae.map(c => c.slug));

  // هل فيه مستخدم qae-mgr-99؟
  const mgr = await db.user.findUnique({ where: { username: "qae-mgr-99" }, select: { username: true, role: true } });
  console.log("qae-mgr-99 exists?", mgr ?? "NO");

  console.log("\n✓ CONNECTION OK — production DB is reachable and readable");
} catch (e) {
  console.error("✗ FAILED:", String(e).slice(0, 300));
  process.exit(1);
} finally {
  await db.$disconnect();
}
