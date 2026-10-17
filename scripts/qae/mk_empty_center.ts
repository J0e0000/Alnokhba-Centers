/**
 * Creates an EMPTY test center on the DEV SQLite database for onboarding-quest
 * walkthroughs (no students/groups/sessions — fresh state).
 * Dev-only: uses the local prisma client (db/custom.db). Never touches prod.
 * Run: bun scripts/qae/mk_empty_center.mjs [--reset]
 *   --reset = delete previous instance first (idempotent re-runs)
 */
import { PrismaClient } from "@prisma/client";
import { hashPasswordSync } from "./hash";

const db = new PrismaClient();
const SLUG = "qae-empty-ob";
const PWD = "Qae#2026";

const reset = process.argv.includes("--reset");

async function main() {
  const existing = await db.center.findUnique({ where: { slug: SLUG } });
  if (existing) {
    if (!reset) {
      console.log(`center exists: ${existing.id} — users kept. (run with --reset to recreate)`);
      await printUsers(existing.id);
      return;
    }
    // delete users first (no cascade on User), then center
    const users = await db.user.findMany({ where: { centerId: existing.id }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await db.userPreference.deleteMany({ where: { userId: { in: ids } } });
    await db.authSession.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.center.delete({ where: { id: existing.id } });
    console.log("previous instance deleted");
  }

  const center = await db.center.create({
    data: {
      name: "QAE1 سنتر فاضي (رحلة البداية)",
      slug: SLUG,
      phone: "01000000099", whatsapp: "01000000099",
      address: "عنوان اختبار — القاهرة", slogan: "بيانات اصطناعية للاختبار",
      status: "ACTIVE",
    },
  });

  const mk = async (username: string, role: string, perms?: Record<string, boolean>) => {
    const u = await db.user.create({
      data: {
        username, passwordHash: hashPasswordSync(PWD), name: `QAE1 ${username}`,
        role, centerId: center.id, isActive: true,
        permissions: perms ? JSON.stringify({ grants: perms }) : undefined,
      },
    });
    console.log(`  user ${username} (${role}) created`);
    return u.id;
  };
  await mk("qae-mgr-ob", "MANAGER");
  // استقبال محدود: من غير تقارير — لاختبار فلترة الناف بالصلاحيات الدقيقة
  await mk("qae-recl-ob", "RECEPTIONIST", { VIEW_REPORTS: false, EXPORT_REPORTS: false });

  console.log(`\ncenter: ${center.id} slug=${SLUG} — EMPTY (0 students/groups/sessions)`);
  console.log("login: qae-mgr-ob / qae-recl-ob — password Qae#2026");
  await db.$disconnect();
}

async function printUsers(centerId: string) {
  const users = await db.user.findMany({ where: { centerId }, select: { username: true, role: true } });
  for (const u of users) console.log(`  ${u.username} (${u.role}) — password Qae#2026`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
