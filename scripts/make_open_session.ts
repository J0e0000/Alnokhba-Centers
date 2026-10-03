import { PrismaClient } from "@prisma/client";

/** إنشاء حصة مفتوحة النهاردة للاختبار (idempotent: بتجيب حصة مفتوحة موجودة الأول) */
const p = new PrismaClient();
async function main() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  // المجموعة من سنتر المدير الرئيسي تحديدًا (مش أي مجموعة — عشان مراكز الاختبار ماتلخبطش)
  const mainUser = await p.user.findUnique({ where: { username: "manager" }, select: { centerId: true } });
  const existing = await p.sessionInstance.findFirst({
    where: { date: today, status: "OPEN", ...(mainUser?.centerId ? { centerId: mainUser.centerId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    console.log("EXISTS", existing.id);
    return;
  }
  const group = await p.group.findFirst({
    where: { isActive: true, ...(mainUser?.centerId ? { centerId: mainUser.centerId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!group) throw new Error("no active group");
  const s = await p.sessionInstance.create({
    data: {
      centerId: group.centerId,
      groupId: group.id,
      date: today,
      startTime: "20:00",
      endTime: "21:30",
      price: group.sessionPrice,
      teacherPercent: group.teacherPercent,
      status: "OPEN",
    },
  });
  console.log("CREATED", s.id);
}
main().finally(() => p.$disconnect());
