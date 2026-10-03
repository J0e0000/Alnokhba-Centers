import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { cleanRaw } from "@/lib/normalize";
import { studentBalance, effectivePrice, amountDueToday } from "@/lib/finance";
import { hasCapability } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

type ScanBody = { query?: string; sessionId?: string };

/**
 * POST /api/attendance/scan — resolve a scan (QR token or 5-digit code) against a session.
 * Returns the GREEN / ORANGE / RED status card with balance & amount due.
 * Pure read — records nothing (mark endpoint does the write).
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  rateLimit(`scan:${user.id}`, 60, 60_000);
  const body = await readJson<ScanBody>(req);

  const raw = String(body.query ?? "").trim();
  const q = cleanRaw(raw);
  if (!q) return ok({ status: "RED", message: "امسح الكود أو اكتب كود الطالب." });

  // بوابة قدرات المركز: مسح توكن الكارت = static_qr — كتابة الكود = static_qr أو name_attendance
  const tokenLike = q.length >= 16 && /^[0-9a-f]+$/i.test(q);
  if (tokenLike) {
    if (!(await hasCapability(user.centerId, "static_qr"))) {
      return ok({ status: "RED", message: "مسح كروت الطلاب مقفول في المركز ده — كلّم المدير." });
    }
  } else if (!(await hasCapability(user.centerId, "static_qr")) && !(await hasCapability(user.centerId, "name_attendance"))) {
    return ok({ status: "RED", message: "حضور الطلاب بالكود/الاسم مقفول في المركز ده — كلّم المدير." });
  }

  // Resolve: QR token (long hex) → exact, else 5-digit code → exact
  const isToken = q.length >= 16 && /^[0-9a-f]+$/i.test(q);
  const isCode = q.length === 5 && /^\d+$/.test(q);
  if (!isToken && !isCode) {
    if (/^\d+$/.test(q)) {
      return ok({
        status: "RED",
        message: `الكود لازم 5 أرقام بالظبط — اللي كتبته ${q.length} رقم.`,
      });
    }
    return ok({ status: "RED", message: "الكود ده مش شكله كود طالب — امسح الـ QR أو اكتب 5 أرقام." });
  }

  const student = await db.student.findFirst({
    where: isToken ? { centerId: user.centerId, qrToken: q } : { centerId: user.centerId, code: q },
    include: {
      grade: { select: { name: true } },
      registrations: {
        where: { status: "ACTIVE" },
        include: { group: { include: { subject: true, teacher: true, grade: true } } },
      },
    },
  });

  if (!student || student.status === "ARCHIVED") {
    return ok({
      status: "RED",
      message: "الطالب مش موجود في النظام",
      hint: student?.status === "ARCHIVED" ? "الطالب ده مؤرشف — راجع المدير." : undefined,
    });
  }

  const balance = await studentBalance(student.id);

  // Session context
  let session: {
    id: string; startTime: string; endTime: string; status: string; date: string;
    subject: string; groupName: string; grade: string; teacher: string | null; groupId: string;
    price: number; room: string | null;
  } | null = null;
  let registration: { groupId: string; priceOverride: number | null; subject: string } | null = null;
  let alreadyAttended = false;
  let attendanceStatus: string | null = null;

  if (body.sessionId) {
    const sess = await db.sessionInstance.findFirst({
      where: { id: String(body.sessionId), centerId: user.centerId },
      include: { group: { include: { subject: true, grade: true, teacher: true } } },
    });
    if (sess) {
      // حصة ملغاة → رد واضح على طول بدل ما المحاولة تفشل برسالة غامضة
      if (sess.status === "CANCELLED") {
        return ok({
          status: "RED",
          message: "الحصة دي ملغاة",
          hint: "اختار حصة تانية من فوق، أو افتح حصة جديدة من الجدول.",
        });
      }
      session = {
        id: sess.id, startTime: sess.startTime, endTime: sess.endTime, status: sess.status, date: sess.date,
        subject: sess.group.subject.name, groupName: sess.group.name, grade: sess.group.grade.name,
        teacher: sess.group.teacher?.name ?? null, groupId: sess.groupId, price: sess.price, room: sess.room,
      };
      const reg = student.registrations.find((r) => r.groupId === sess.groupId);
      registration = reg ? { groupId: reg.groupId, priceOverride: reg.priceOverride, subject: reg.group.subject.name } : null;
      const att = await db.attendance.findUnique({
        where: { sessionId_studentId: { sessionId: sess.id, studentId: student.id } },
      });
      alreadyAttended = !!att;
      attendanceStatus = att?.status ?? null;
    }
  }

  const price = session ? effectivePrice(registration?.priceOverride, null, session.price) : 0;
  // لو الطالب حضر خلاص: سعر الحصة اتخصم بالفعل من رصيده — المطلوب = الدين بس
  // (من غير كده كان بيحسب سعر الحصة مرتين ويطلّع الباقي غلط)
  const due = session && registration
    ? (alreadyAttended ? Math.max(-balance, 0) : amountDueToday(price, balance))
    : null;

  return ok({
    status: registration ? "GREEN" : "ORANGE",
    message: registration
      ? "الطالب مسجل في المجموعة دي"
      : "الطالب مش مسجل في المجموعة دي",
    student: {
      id: student.id,
      name: student.name,
      code: student.code,
      phone: student.phone,
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      grade: student.grade?.name ?? null,
      status: student.status,
      subjects: student.registrations.map((r) => r.group.subject.name),
      groups: student.registrations.map((r) => ({ id: r.groupId, name: r.group.name, subject: r.group.subject.name })),
    },
    session,
    registered: !!registration,
    price,
    balance,
    amountDue: due,
    alreadyAttended,
    attendanceStatus,
    sessionClosed: session?.status === "CLOSED",
    // Receptionist cannot register a student into a group without permission
    canRegister: user.role === "MANAGER" || user.canAddStudents,
  });
});
