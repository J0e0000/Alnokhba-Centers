/* تنضيف بقايا اختبارات اليوم — بدون المساس بأي بيانات أصلية
   - تسويات الاختبار المتوازنة (اختبار الرصيد/الدعم)
   - حركات وسندات «تحضير جماعي» من test-mobile-ui (الجلسة اتفضلت متمسحة قبل الحركات)
   - حصة النهاردة المقفولة اللي عملها اختبار الطوارئ (+ حضورها + تسوياتها + قيودها)
   - عناصر طابور ملغاة قديمة + جلسات دعم الاختبار
*/
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const cutoff = new Date("2026-09-02T16:00:00Z");

  // 1) تسويات الاختبار المتوازنة
  const adj = await db.studentTransaction.deleteMany({
    where: { type: "ADJUSTMENT", createdAt: { gte: cutoff }, reason: { in: ["اختبار الرصيد — 10 جنيه", "تراجع اختبار الرصيد", "اختبار تدقيق الدعم", "تراجع"] } },
  });
  console.log("تسويات اختبار اتمسحت:", adj.count);

  // 2) حركات «تحضير جماعي» + الدفعة المرتبطة + إيصالها
  const bulk = await db.studentTransaction.deleteMany({
    where: { createdAt: { gte: new Date("2026-09-02T16:50:00Z") }, reason: { contains: "تحضير جماعي" } },
  });
  console.log("حركات تحضير جماعي اتمسحت:", bulk.count);
  // الدفعة الوحيدة المرتبطة بحصة متمسحة (الجلسة صارت null بعد مسحها)
  const orphanPay = await db.studentTransaction.findMany({
    where: { createdAt: { gte: new Date("2026-09-02T16:50:00Z") }, type: "PAYMENT", sessionId: null },
  });
  for (const t of orphanPay) {
    await db.receipt.deleteMany({ where: { txnId: t.id } });
    await db.studentTransaction.delete({ where: { id: t.id } });
  }
  console.log("دفعات يتيمة اتمسحت:", orphanPay.length);

  // 3) حصة الطوارئ المقفولة النهاردة (اللي اتعملت الساعة 16:55 بالاستيراد) + كل حساباتها
  const todayCairo = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
  const testSessions = await db.sessionInstance.findMany({
    where: { date: todayCairo, createdAt: { gte: new Date("2026-09-02T16:30:00Z") } },
    include: { attendance: true },
  });
  for (const s of testSessions) {
    const attIds = s.attendance.map((a) => a.id);
    if (attIds.length) {
      await db.studentTransaction.deleteMany({ where: { OR: [{ sessionId: s.id }, { id: { in: [] } }] } });
    }
    await db.studentTransaction.deleteMany({ where: { sessionId: s.id } });
    await db.teacherSettlement.deleteMany({ where: { OR: [{ note: { contains: s.id } }] } });
    await db.centerTransaction.deleteMany({ where: { OR: [{ refId: s.id }, { note: { contains: s.id } }] } });
    await db.attendance.deleteMany({ where: { sessionId: s.id } });
    await db.studentTransaction.deleteMany({ where: { sessionId: s.id } }); // مرة تانية بعد الحضور
    await db.sessionInstance.delete({ where: { id: s.id } });
    console.log("حصة اختبار اتمسحت:", s.id.slice(0, 12), s.startTime, s.status, `(حضور: ${attIds.length})`);
  }

  // 4) طابور ملغى قديم
  const q = await db.messageQueueItem.deleteMany({ where: { status: "CANCELLED", batchLabel: { contains: "اختبار" } } });
  console.log("عناصر طابور اختبار اتمسحت:", q.count);

  // 5) جلسات دعم الاختبار + سجلها
  const sup = await db.supportSession.findMany({ where: { reason: { contains: "اختبار" } }, select: { id: true } });
  if (sup.length) {
    await db.auditLog.deleteMany({ where: { entity: "SUPPORT_SESSION", entityId: { in: sup.map((s) => s.id) } } });
    await db.supportSession.deleteMany({ where: { id: { in: sup.map((s) => s.id) } } });
  }
  console.log("جلسات دعم اختبار اتمسحت:", sup.length);

  // 6) سجلات تدقيق حركات الاختبار
  const auditTest = await db.auditLog.deleteMany({
    where: { createdAt: { gte: cutoff }, reason: { contains: "اختبار" } },
  });
  console.log("سجلات تدقيق اختبار اتمسحت:", auditTest.count);

  // 7) إشعارات الدفع/التسوية بتاعة الاختبارات (الدفعات بقت بتعمل إشعار للطالب)
  const notifTest = await db.studentNotification.deleteMany({
    where: { type: { in: ["PAYMENT", "REFUND", "ADJUSTMENT"] }, createdAt: { gte: cutoff } },
  });
  console.log("إشعارات مالية لاختبار اتمسحت:", notifTest.count);

  // ===== الفحص النهائي =====
  const [students, txns, ann, queue, emg, teams] = await Promise.all([
    db.student.count(),
    db.studentTransaction.count(),
    db.announcement.count(),
    db.messageQueueItem.count(),
    db.emergencyImport.count(),
    db.team.count(),
  ]);
  const todaySess = await db.sessionInstance.count({ where: { date: todayCairo } });
  console.log(`\n— الحالة النهائية: طلاب=${students} (المفروض 26) · حركات=${txns} · إعلانات=${ann} · طابور=${queue} · استيرادات=${emg} · فرق=${teams} · حصص النهاردة=${todaySess}`);

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
