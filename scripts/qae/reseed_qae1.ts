// إعادة بناء سنتر QAE1 الاختباري في الـ dev (SQLite) بالـ ID الثابت اللي
// سكريبتات الـ e2e متوقعة عليه. idempotent. تشغيل: bun scripts/qae/reseed_qae1.ts
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();
const CID = "cmvbb396y0000ovy9n6gmecjy";
const PWD = "Qae#2026";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function main() {
  const center = await db.center.upsert({
    where: { id: CID },
    update: { status: "ACTIVE" },
    create: {
      id: CID,
      name: "QAE1 سنتر اختبار",
      slug: "qae-empty-ob",
      phone: "01000000099",
      whatsapp: "01000000099",
      address: "عنوان اختبار — القاهرة",
      slogan: "بيانات اصطناعية للاختبار",
      status: "ACTIVE",
    },
  });

  // اشتراك نشط (بوابات الأقسام بتفحصه)
  let plan = await db.subscriptionPlan.findFirst({ where: { name: "Professional", isActive: true } });
  if (!plan) {
    plan = await db.subscriptionPlan.create({
      data: { name: "Professional", pricePerStudent: 2500, maxStudents: null, isActive: true },
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const renewal = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  await db.subscription.upsert({
    where: { centerId: CID },
    update: { status: "ACTIVE", renewalDate: renewal },
    create: {
      centerId: CID, planId: plan.id, status: "ACTIVE",
      billingPeriod: "YEARLY", pricePerStudent: plan.pricePerStudent,
      startDate: today, renewalDate: renewal, paymentStatus: "PAID",
    },
  });

  const users: [string, string, Record<string, boolean>?][] = [
    ["qae-mgr-ob", "MANAGER", undefined],
    ["qae-rec-ob", "RECEPTIONIST", undefined],
    ["qae-recl-ob", "RECEPTIONIST", { VIEW_REPORTS: false, EXPORT_REPORTS: false, END_SESSION: false }],
    ["qae-tch-ob", "TEACHER", undefined],
  ];
  for (const [username, role, grants] of users) {
    await db.user.upsert({
      where: { username },
      update: { passwordHash: hashPassword(PWD), isActive: true, centerId: CID, role, permissions: grants ? JSON.stringify({ grants }) : null },
      create: {
        username, passwordHash: hashPassword(PWD), name: `QAE1 ${username}`,
        role, centerId: CID, isActive: true,
        permissions: grants ? JSON.stringify({ grants }) : undefined,
      },
    });
    console.log(`user ${username} (${role}) ready`);
  }
  console.log(`center ${CID} ready`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
