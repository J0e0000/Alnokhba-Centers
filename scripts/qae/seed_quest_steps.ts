/**
 * Seeds quest steps 2-5 on the qae-empty-ob DEV center (enrollment, session,
 * attendance, payment) — leaves notifications at 0 so the LAST step can be
 * performed live to test the celebration flow. Dev SQLite only.
 * Run: bun scripts/qae/seed_quest_steps.ts [--with-notify]
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const SLUG = "qae-empty-ob";
const withNotify = process.argv.includes("--with-notify");

async function main() {
  const center = await db.center.findUnique({ where: { slug: SLUG } });
  if (!center) throw new Error("center not found — run mk_empty_center.ts first");
  const mgr = await db.user.findFirst({ where: { centerId: center.id, role: "MANAGER" } });
  const student = await db.student.findFirst({ where: { centerId: center.id } });
  if (!mgr || !student) throw new Error("manager/student missing");

  // subject + teacher + group (idempotent-ish: only create if absent)
  let subject = await db.subject.findFirst({ where: { centerId: center.id } });
  if (!subject) subject = await db.subject.create({ data: { centerId: center.id, name: "رياضيات" } });
  let teacher = await db.teacher.findFirst({ where: { centerId: center.id } });
  if (!teacher) teacher = await db.teacher.create({ data: { centerId: center.id, name: "أ. تجريبي", phone: "01000000098", loginCode: "7099", isActive: true } });
  let group = await db.group.findFirst({ where: { centerId: center.id } });
  if (!group) group = await db.group.create({
    data: { centerId: center.id, name: "أ", gradeId: student.gradeId, subjectId: subject.id, teacherId: teacher.id, sessionPrice: 7500, teacherPercent: 50, room: "قاعة 1" },
  });

  // 2) enrollment
  const reg = await db.studentGroup.findFirst({ where: { studentId: student.id, groupId: group.id } });
  if (!reg) await db.studentGroup.create({ data: { studentId: student.id, groupId: group.id, registeredBy: mgr.id } });

  // 3) session today
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", dateStyle: "short" }).format(new Date());
  let session = await db.sessionInstance.findFirst({ where: { centerId: center.id, date: today } });
  if (!session) session = await db.sessionInstance.create({
    data: {
      centerId: center.id, groupId: group.id, scheduleId: null, date: today,
      startTime: "16:00", endTime: "17:30", room: "قاعة 1",
      price: 7500, teacherPercent: 50, status: "OPEN", openedBy: mgr.id,
    },
  });

  // 4) attendance
  const att = await db.attendance.findFirst({ where: { centerId: center.id, sessionId: session.id } });
  if (!att) await db.attendance.create({
    data: {
      centerId: center.id, sessionId: session.id, studentId: student.id,
      status: "PRESENT", method: "MANUAL", charged: 7500, recordedBy: mgr.id,
      studentCode: student.code, studentName: student.name,
    },
  });
  const charge = await db.studentTransaction.findFirst({ where: { centerId: center.id, sessionId: session.id } });
  if (!charge) await db.studentTransaction.create({
    data: { centerId: center.id, studentId: student.id, sessionId: session.id, type: "CHARGE", amount: -7500, reason: "حصة", createdBy: mgr.id },
  });

  // 5) payment
  const pay = await db.studentTransaction.findFirst({ where: { centerId: center.id, studentId: student.id, type: "PAYMENT" } });
  if (!pay) await db.studentTransaction.create({
    data: { centerId: center.id, studentId: student.id, type: "PAYMENT", amount: 7500, method: "CASH", reason: "دفعة والي أمر", createdBy: mgr.id },
  });

  // 6) notification — only with --with-notify (final celebration step)
  if (withNotify) {
    const n = await db.notificationAttempt.findFirst({ where: { centerId: center.id } });
    if (!n) await db.notificationAttempt.create({
      data: {
        centerId: center.id, studentId: student.id, template: "تأكيد دفعة", channel: "WA_HANDOFF",
        recipient: student.parentPhone ?? "01000000000", status: "SENT",
        bodySnapshot: "تم استلام دفعة 75.0 جنيه من أحمد أول طالب.",
        createdBy: mgr.id,
      },
    });
  }

  const counts = {
    students: await db.student.count({ where: { centerId: center.id } }),
    enrollments: await db.studentGroup.count({ where: { student: { centerId: center.id } } }),
    sessions: await db.sessionInstance.count({ where: { centerId: center.id } }),
    attendance: await db.attendance.count({ where: { centerId: center.id } }),
    payments: await db.studentTransaction.count({ where: { centerId: center.id, type: "PAYMENT" } }),
    notifications: await db.notificationAttempt.count({ where: { centerId: center.id } }),
  };
  console.log("counts:", JSON.stringify(counts));
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
