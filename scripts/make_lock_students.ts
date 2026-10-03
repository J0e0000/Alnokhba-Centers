import { PrismaClient } from "@prisma/client";

/**
 * تجهيزات اختبار الحضور بقفل الجهاز (device-locked attendance):
 * - حصة مفتوحة النهاردة لمركز المدير الرئيسي (idempotent — نفس منطق make_open_session)
 * - 7 طلاب تجريبيين بأكواد 99001..99007 مسجلين في مجموعة الحصة (idempotent)
 * Output JSON: { sessionId, groupId, codes[] }
 */
const p = new PrismaClient();

const CODES = ["99001", "99002", "99003", "99004", "99005", "99006", "99007", "99008"];

async function main() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const mainUser = await p.user.findUnique({ where: { username: "manager" }, select: { centerId: true } });
  if (!mainUser?.centerId) throw new Error("manager user not found");

  let session = await p.sessionInstance.findFirst({
    where: { date: today, status: "OPEN", centerId: mainUser.centerId },
    orderBy: { createdAt: "desc" },
  });
  if (!session) {
    const group = await p.group.findFirst({
      where: { isActive: true, centerId: mainUser.centerId },
      orderBy: { createdAt: "asc" },
    });
    if (!group) throw new Error("no active group");
    session = await p.sessionInstance.create({
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
  }

  // الطلاب التجريبيون + تسجيلهم في مجموعة الحصة
  const studentIds: string[] = [];
  for (let i = 0; i < CODES.length; i++) {
    const code = CODES[i];
    let student = await p.student.findUnique({
      where: { centerId_code: { centerId: mainUser.centerId, code } },
    });
    if (!student) {
      student = await p.student.create({
        data: {
          centerId: mainUser.centerId,
          code,
          name: `طالب اختبار القفل ${i + 1} محمد علي`,
          phone: `0100009900${i}`,
          parentName: `ولي اختبار ${i + 1}`,
          parentPhone: `0110009900${i}`,
          qrToken: `locktest-${code}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      });
    }
    if (student.status !== "ACTIVE") {
      await p.student.update({ where: { id: student.id }, data: { status: "ACTIVE" } });
    }
    const reg = await p.studentGroup.findUnique({
      where: { studentId_groupId: { studentId: student.id, groupId: session.groupId } },
    });
    if (!reg) {
      await p.studentGroup.create({
        data: { studentId: student.id, groupId: session.groupId, status: "ACTIVE" },
      });
    } else if (reg.status !== "ACTIVE") {
      await p.studentGroup.update({ where: { id: reg.id }, data: { status: "ACTIVE" } });
    }
    studentIds.push(student.id);
  }

  // نظافة إعادة التشغيل: امسح آثار التشغيلات السابقة لطلاب الاختبار في حصة النهاردة
  // (حضورهم/قفل أجهزتهم/محاولاتهم/خصومات الـ QR) عشان السويت تبان رابلة إعادة تشغيل.
  await p.attendance.deleteMany({ where: { sessionId: session.id, studentId: { in: studentIds } } });
  await p.studentTransaction.deleteMany({
    where: { sessionId: session.id, studentId: { in: studentIds }, createdBy: { in: ["PUBLIC_QR", "SESSION_QR"] } },
  });
  await p.checkInAttempt.deleteMany({ where: { sessionId: session.id } });

  console.log(JSON.stringify({ sessionId: session.id, groupId: session.groupId, codes: CODES }));
}
main().finally(() => p.$disconnect());
