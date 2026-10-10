/* تنضيف بقايا اختبارات الليلة (بعد نص ليل القاهرة — rollover لتاريخ جديد) — نفس نمط cleanup-today-tests
   - زوج تسوية اختبار الرصيد المتوازن (+10ج / -10ج)
   - حصص النهاردة الفارغة (صفر حضور/حركات/تسويات/قيود) اللي عملتها اختبارات UI بعد الرول أوفر
   - إشعارات اختبارية سريعة
   مفيش أي بيانات أصلية بتتمسح — كل حاجة لازم تكون مرتبطة بعلامة اختبار أو قفلة صفرية مثبتة.
*/
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CUTOFF = new Date("2026-09-02T21:00:00Z");

async function main() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

  // 1) تسويات اختبار الرصيد المتوازنة
  const adj = await db.studentTransaction.deleteMany({
    where: {
      type: "ADJUSTMENT",
      createdAt: { gte: CUTOFF },
      reason: { in: ["اختبار الرصيد — 10 جنيه", "تراجع اختبار الرصيد", "اختبار تدقيق الدعم"] },
    },
  });
  console.log("تسويات اختبار اتمسحت:", adj.count);

  // 2) حصص النهاردة الفارغة تمامًا (صفر روابط — مثبتة قبل المسح)
  const todaySessions = await db.sessionInstance.findMany({
    where: { date: today, createdAt: { gte: CUTOFF } },
    select: { id: true, startTime: true, status: true, center: { select: { slug: true } } },
  });
  for (const s of todaySessions) {
    // سنتر اختبار السعة (cap-load-5000) بياناته مقصودة — مبنعوشها
    if (s.center.slug === "cap-load-5000") continue;
    const [att, txns, settles, journal] = await Promise.all([
      db.attendance.count({ where: { sessionId: s.id } }),
      db.studentTransaction.count({ where: { sessionId: s.id } }),
      db.teacherSettlement.count({ where: { note: { contains: s.id } } }),
      db.centerTransaction.count({ where: { OR: [{ refId: s.id }, { note: { contains: s.id } }] } }),
    ]);
    if (att === 0 && txns === 0 && settles === 0 && journal === 0) {
      await db.sessionInstance.delete({ where: { id: s.id } });
      console.log("حصة فاضية اتمسحت:", s.startTime, s.status, `(${s.center.slug})`);
    } else {
      console.log("⚠️ حصة النهاردة ليها روابط — متمسحتش:", s.startTime, `حضور=${att} حركات=${txns}`);
    }
  }

  // 3) إشعارات اختبارية من الليلة
  const notif = await db.studentNotification.deleteMany({
    where: { createdAt: { gte: CUTOFF }, title: { contains: "اختبار" } },
  });
  console.log("إشعارات اختبار اتمسحت:", notif.count);

  // 4) طلاب استيراد الطوارئ التجريبيون (أسماؤهم بالظبط «التجريبي» — حذفهم cascades كل روابطهم)
  const emgStudents = await db.student.findMany({
    where: { name: { contains: "التجريبي" }, createdAt: { gte: CUTOFF } },
    select: { id: true, code: true, name: true },
  });
  if (emgStudents.length) {
    await db.student.deleteMany({ where: { id: { in: emgStudents.map((s) => s.id) } } });
    console.log("طلاب طوارئ تجريبيين اتمسحوا:", emgStudents.map((s) => s.code).join(", "));
  }

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
