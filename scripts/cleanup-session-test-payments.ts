/* تنضيف دفعات الاختبار اللي اتعملت على الطالب الحقيقي يوسف حسن عبد الله (10004)
   خلال جلسة الإصلاحات (دفعة 50+30+20+70 أثناء الفحص اليدوي + 20 من اختبار E2E)
   وبيرجع رصيده لأصله. كمان بيشيل أي دفعات تجريبية باقية على طلاب تجريبيين. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const student = await db.student.findFirst({ where: { code: "10004" }, select: { id: true, name: true } });
  if (!student) { console.log("الطالب 10004 مش موجود"); return; }

  // دفعات النهاردة (تاريخ القاهرة 2026-08-30/31 UTC boundary: من 2026-08-30T20:50Z)
  const cutoff = new Date("2026-08-30T20:50:00.000Z");
  const txns = await db.studentTransaction.findMany({
    where: { studentId: student.id, type: "PAYMENT", createdAt: { gte: cutoff } },
    include: { receipt: true },
  });
  console.log(`لقينا ${txns.length} دفعة اختبار على ${student.name}:`);
  for (const t of txns) {
    console.log(`  - ${t.amount / 100} ج at ${t.createdAt.toISOString()} receipt=${t.receipt?.number ?? "—"}`);
  }

  // امسح الإيصالات المرتبطة ثم الحركات
  for (const t of txns) {
    if (t.receipt) await db.receipt.delete({ where: { id: t.receipt.id } });
    await db.studentTransaction.delete({ where: { id: t.id } });
  }

  // امسح audit logs المرتبطة بالعمليات دي (تنضيف كامل)
  const auditIds = txns.map((t) => t.id);
  if (auditIds.length) {
    await db.auditLog.deleteMany({ where: { entityId: { in: auditIds } } });
  }

  // رجّع رصيده
  const agg = await db.studentTransaction.aggregate({ _sum: { amount: true }, where: { studentId: student.id } });
  console.log(`\nتم. رصيد ${student.name} دلوقتي: ${(agg._sum.amount ?? 0) / 100} ج (المفروض يرجع -170 ج)`);

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
