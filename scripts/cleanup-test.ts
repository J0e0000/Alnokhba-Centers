/** Revert the API test pollution: test attendance + payment for student 10001 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  // remove my test payment (400 EGP VODAFONE with note شامل الحصة الجاية)
  const pay = await db.studentTransaction.findFirst({
    where: { reason: "شامل الحصة الجاية", type: "PAYMENT" },
    orderBy: { createdAt: "desc" },
  });
  if (pay) {
    await db.studentTransaction.delete({ where: { id: pay.id } });
    console.log("deleted test payment", pay.amount);
  }
  // remove my test attendance on today's session for that student
  if (pay) {
    const att = await db.attendance.findUnique({
      where: { sessionId_studentId: { sessionId: pay.sessionId!, studentId: pay.studentId } },
    });
    if (att) {
      await db.attendance.delete({ where: { id: att.id } });
      console.log("deleted test attendance");
    }
  }
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
