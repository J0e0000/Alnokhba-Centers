/* تنظيف جلسة اختبار الإلغاء (كيمياء النهاردة اللي اتفتحت في الاختبار) — بدون أثر */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // الحصة المفتوحة النهاردة اللي اتفتحت في اختبار الإلغاء (كيمياء 15:00)
  const today = new Date().toISOString().slice(0, 10);
  const s = await p.sessionInstance.findFirst({
    where: { date: today, status: "OPEN", group: { subject: { name: "كيمياء" } } },
    include: { _count: { select: { attendance: true } } },
  });
  if (!s) { console.log("مفيش حصة اختبار مفتوحة"); return; }
  if (s._count.attendance > 0) { console.log(`الحصة فيها ${s._count.attendance} حضور — مش هنمسحها`); return; }
  await p.studentTransaction.deleteMany({ where: { sessionId: s.id, type: "CHARGE" } });
  await p.receipt.deleteMany({ where: { txn: { sessionId: s.id } } });
  await p.attendance.deleteMany({ where: { sessionId: s.id } });
  await p.centerTransaction.deleteMany({ where: { refType: "SESSION", refId: s.id } });
  await p.sessionInstance.delete({ where: { id: s.id } });
  // طلبات الموافقة المتتبقية من الاختبار
  const del = await p.approvalRequest.deleteMany({ where: { number: "AR-000001" } });
  console.log(`اتحذفت حصة الاختبار (${s.id}) + ${del.count} طلب موافقة`);
  await p.$disconnect();
}
void main();
