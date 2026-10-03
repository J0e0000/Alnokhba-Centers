import { PrismaClient } from "@prisma/client";

/**
 * تجهيز مركزين اختبار لقدرات الحضور (idempotent — بيمسح القديم ويعيد البناء):
 * - Center A (caps-test-a): اسم + QR ثابت فقط — dynamic/student_self_scan/staff_qr/fingerprint OFF، late OFF
 * - Center B (caps-test-b): dynamic + self_scan + staff_qr + fingerprint ON — name/static OFF
 * كل مركز: مدير + استقبال + مدرس + مجموعة + طالب مسجل.
 * الإخراج: JSON بالـ ids على stdout → بيستخدمه سكربت الـ e2e.
 */

const p = new PrismaClient();

const hash = (s: string) => {
  // نفس scrypt المستخدم في النظام — بنتجنب تعقيدها: بنستخدم login API بعد الإنشاء؟
  // لأ — لازم passwordHash هنا. بنستخدم نفس خوارزمية lib/auth (scrypt).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes, scryptSync } = require("crypto") as typeof import("crypto");
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(s, salt, 64).toString("hex")}`;
}

const randToken = () => require("crypto").randomBytes(20).toString("hex");

async function ensureUser(centerId: string, username: string, name: string, role: string) {
  const existing = await p.user.findUnique({ where: { username } });
  if (existing) {
    await p.user.update({ where: { id: existing.id }, data: { passwordHash: hash("nokhba123"), isActive: true, centerId, role } });
    return existing.id;
  }
  const u = await p.user.create({
    data: { centerId, username, passwordHash: hash("nokhba123"), name, role, canAddStudents: true, scope: "centers" },
  });
  return u.id;
}

async function buildCenter(slug: string, name: string, usernames: { mgr: string; rec: string }, studentCode: string, studentPhone: string) {
  let center = await p.center.findUnique({ where: { slug } });
  if (!center) {
    center = await p.center.create({ data: { name, slug } });
  }
  const mgrId = await ensureUser(center.id, usernames.mgr, "مدير " + name, "MANAGER");
  const recId = await ensureUser(center.id, usernames.rec, "استقبال " + name, "RECEPTIONIST");

  // grade + subject + teacher + group + student (idempotent بالأسماء)
  const grade = await p.grade.upsert({
    where: { centerId_name: { centerId: center.id, name: "الأول الثانوي" } },
    create: { centerId: center.id, name: "الأول الثانوي" },
    update: {},
  });
  const subject = await p.subject.upsert({
    where: { centerId_name: { centerId: center.id, name: "كيمياء" } },
    create: { centerId: center.id, name: "كيمياء" },
    update: {},
  });
  let teacher = await p.teacher.findFirst({ where: { centerId: center.id, name: "مستر اختبار" } });
  if (!teacher) teacher = await p.teacher.create({ data: { centerId: center.id, name: "مستر اختبار", loginCode: "9911" } });

  let group = await p.group.findFirst({ where: { centerId: center.id, name: "A" } });
  if (!group) {
    group = await p.group.create({
      data: { centerId: center.id, name: "A", gradeId: grade.id, subjectId: subject.id, teacherId: teacher.id, sessionPrice: 5000, teacherPercent: 50 },
    });
  }

  const student = await p.student.upsert({
    where: { centerId_code: { centerId: center.id, code: studentCode } },
    create: { centerId: center.id, code: studentCode, qrToken: randToken(), name: "طالب اختبار القدرات", phone: studentPhone },
    update: { phone: studentPhone },
  });
  await p.studentGroup.upsert({
    where: { studentId_groupId: { studentId: student.id, groupId: group.id } },
    create: { studentId: student.id, groupId: group.id },
    update: {},
  });

  // قفل أي حصص مفتوحة قديمة (اختبار نظيف)
  await p.sessionInstance.updateMany({ where: { centerId: center.id, status: "OPEN" }, data: { status: "CANCELLED" } });

  return {
    centerId: center.id, slug, name,
    mgr: { id: mgrId, username: usernames.mgr },
    rec: { id: recId, username: usernames.rec },
    groupId: group.id, teacherId: teacher.id, studentId: student.id,
    studentCode, studentPhone,
  };
}

async function setCap(centerId: string, key: string, enabled: boolean, config?: Record<string, unknown>) {
  await p.centerCapability.upsert({
    where: { centerId_key: { centerId, key } },
    create: { centerId, key, enabled, config: config ? JSON.stringify(config) : JSON.stringify({}) },
    update: { enabled, ...(config ? { config: JSON.stringify(config) } : {}) },
  });
}

async function main() {
  const a = await buildCenter("caps-test-a", "اختبار القدرات A", { mgr: "capsmgr_a", rec: "capsrec_a" }, "50001", "01000050001");
  const b = await buildCenter("caps-test-b", "اختبار القدرات B", { mgr: "capsmgr_b", rec: "capsrec_b" }, "50002", "01000050002");

  // Center A: اسم + QR ثابت فقط (وفق مثال المستخدم) + late OFF + staff_qr OFF + teacher_auto ON
  await setCap(a.centerId, "name_attendance", true);
  await setCap(a.centerId, "static_qr", true);
  await setCap(a.centerId, "dynamic_qr", false);
  await setCap(a.centerId, "student_self_scan", false);
  await setCap(a.centerId, "staff_qr_checkin", false);
  await setCap(a.centerId, "fingerprint", false);
  await setCap(a.centerId, "late_checkin", false);
  await setCap(a.centerId, "teacher_auto_attendance", true, { requireCenterPresence: false });

  // Center B: dynamic + self_scan + staff_qr + fingerprint (حد 3) — name/static OFF + late ON
  await setCap(b.centerId, "name_attendance", false);
  await setCap(b.centerId, "static_qr", false);
  await setCap(b.centerId, "dynamic_qr", true);
  await setCap(b.centerId, "student_self_scan", true);
  await setCap(b.centerId, "staff_qr_checkin", true, { slotSeconds: 5 });
  await setCap(b.centerId, "fingerprint", true, { maxUsers: 3 });
  await setCap(b.centerId, "late_checkin", true);
  await setCap(b.centerId, "teacher_auto_attendance", true, { requireCenterPresence: false });

  // تنظيف بصمات/أجهزة/أحداث الاختبار القديمة (بداية نظيفة لكل تشغيلة)
  await p.fingerprintEnrollment.deleteMany({ where: { centerId: { in: [a.centerId, b.centerId] } } });
  await p.attendanceDevice.deleteMany({ where: { centerId: { in: [a.centerId, b.centerId] } } });
  await p.attendanceEvent.deleteMany({ where: { centerId: { in: [a.centerId, b.centerId] } } });

  console.log(JSON.stringify({ a, b }, null, 1));
}

main().finally(() => p.$disconnect());
