import { PrismaClient } from "@prisma/client";

/**
 * تنظيف حصص اختبار وضعا الحضور (e2e_attendance_modes) — dev فقط:
 * - حصص الحضور المفتوحة للاختبار (الاسم يبدأ بـ"اختبار مفتوح")
 * - حصص الكشف الاختبارية (allowUnregistered=true بتاريخ النهاردة)
 * بتحذف آثارها (توكنز/محاولات/حضور) عشان السكريبت يبقى rerunable —
 * تعارض المدرس/القاعة بيمنع إعادة التشغيل لو الحصص القديمة فضلت موجودة.
 */
const p = new PrismaClient();

async function main() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const olds = await p.sessionInstance.findMany({
    where: {
      date: today,
      OR: [
        { studentSource: "OPEN", name: { startsWith: "اختبار مفتوح" } },
        { studentSource: "ROSTER", allowUnregistered: true },
      ],
    },
    select: { id: true },
  });
  for (const s of olds) {
    await p.checkInAttempt.deleteMany({ where: { sessionId: s.id } });
    await p.sessionQRToken.deleteMany({ where: { sessionId: s.id } });
    await p.sessionInstance.delete({ where: { id: s.id } }); // الحضور بيتحذف cascade
  }
  console.log(JSON.stringify({ cleaned: olds.length }));
}
main().finally(() => p.$disconnect());
