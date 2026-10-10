/* تنضيف الحصص الملغاة المتLeft من جولات الاختبار
   (12 حصة ملغاة بسبب "تنضيف اختبار" — بتمنع المسح وتظهر "الحصة دي ملغاة")
   الرصيد = مجموع الحركات → حذف حركات الخصم يرجّع الأرصدة تلقائياً */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const cancelled = await p.sessionInstance.findMany({
    where: { status: "CANCELLED" },
    include: { _count: { select: { attendance: true } } },
  });
  console.log(`حصص ملغاة: ${cancelled.length}`);

  let deleted = 0;
  for (const s of cancelled) {
    // حركات الخصم المرتبطة بالحصة → حذفها يرجّع أرصدة الطلاب
    await p.studentTransaction.deleteMany({ where: { sessionId: s.id, type: "CHARGE" } });
    // الإيصالات المرتبطة بحركات محذوفة
    await p.receipt.deleteMany({ where: { txn: { sessionId: s.id } } });
    // الحضور
    await p.attendance.deleteMany({ where: { sessionId: s.id } });
    // قيود اليومية
    await p.centerTransaction.deleteMany({ where: { refType: "SESSION", refId: s.id } });
    await p.sessionInstance.delete({ where: { id: s.id } });
    deleted++;
    console.log(`- حذف: ${s.date} ${s.startTime} (${s._count.attendance} حضور)`);
  }
  console.log(`تم حذف ${deleted} حصة ملغاة`);

  const rest = await p.sessionInstance.count({ where: { status: "CANCELLED" } });
  const students = await p.student.count();
  console.log(`متبقي ملغاة: ${rest} | الطلاب: ${students}`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
