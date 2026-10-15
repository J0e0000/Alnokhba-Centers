import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
// تنظيف بقايا فحوصات: سنترات fahs-* مع طلابها وخططها
const centers = await db.center.findMany({ where: { slug: { startsWith: "fahs-" } }, select: { id: true } });
for (const c of centers) {
  await db.studentTransaction.deleteMany({ where: { student: { centerId: c.id } } }).catch(() => {});
  await db.studentGroup.deleteMany({ where: { student: { centerId: c.id } } }).catch(() => {});
  await db.student.deleteMany({ where: { centerId: c.id } }).catch(() => {});
  await db.subscription.deleteMany({ where: { centerId: c.id } }).catch(() => {});
  await db.centerCapability.deleteMany({ where: { centerId: c.id } }).catch(() => {});
  await db.center.delete({ where: { id: c.id } }).catch(() => {});
}
const plans = await db.subscriptionPlan.deleteMany({ where: { name: "فحص حد 1" } });
console.log(`اتنضف: ${centers.length} سنتر فحص + ${plans.count} خطة`);
await db.$disconnect();
