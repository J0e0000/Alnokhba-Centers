import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { todayStr } from "@/lib/normalize";
import { assertNoSessionConflicts, autoTeacherAttendance } from "@/lib/sessions-core";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || todayStr();

  const sessions = await db.sessionInstance.findMany({
    where: { centerId: user.centerId, date },
    orderBy: { startTime: "asc" },
    include: {
      group: { include: { subject: true, grade: true, teacher: true } },
      attendance: { include: { student: { select: { id: true, name: true, code: true } } } },
    },
  });

  // Suggest schedule slots that are not yet materialized
  // (الحصة الملغاة بترجع اقتراح تاني — عشان أي حد يقدر يفتحها من جديد)
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const slots = await db.scheduleSlot.findMany({
    where: { centerId: user.centerId, dayOfWeek: dow, isActive: true },
    include: { group: { include: { subject: true, grade: true, teacher: true } } },
    orderBy: { startTime: "asc" },
  });
  const unmaterialized = slots.filter((s) => !sessions.some((x) => x.scheduleId === s.id && x.status !== "CANCELLED"));

  return ok({
    date,
    sessions: sessions.map((s) => ({
      id: s.id,
      startTime: s.startTime, endTime: s.endTime, room: s.room, status: s.status,
      // حصص الحضور المفتوح (بدون مجموعة): الاسم هو اللي بيتعرض — حصص الكشف زي ما هي
      subject: s.group?.subject.name ?? s.name ?? "حصة",
      grade: s.group?.grade.name ?? "—", groupName: s.group?.name ?? "—",
      teacher: s.group?.teacher?.name ?? "—", teacherId: s.group?.teacherId ?? null,
      price: s.price, teacherPercent: s.teacherPercent,
      // مصدر الطلاب + إعداداته (شارة "مفتوحة" في القائمة — spec §8)
      studentSource: s.studentSource, studentCodeLength: s.studentCodeLength,
      allowUnregistered: s.allowUnregistered,
      // وقت البداية الفعلي = لحظة فتح الحصة (الجدول بيتخطط — الفتح بيتسجل)
      openedAt: s.status !== "CANCELLED" ? s.createdAt.toISOString() : null,
      attendanceCount: s.attendance.length,
      // حصص الكشف: حاضر = مش بعذر · الحضور المفتوح: كل صف اتسجل = حضور ناجح (مفيش غياب — spec §15)
      presentCount: s.studentSource === "OPEN" ? s.attendance.length : s.attendance.filter((a) => a.status !== "EXCUSED").length,
      closed: s.status === "CLOSED",
      aggregates: s.status === "CLOSED"
        ? { totalRevenue: s.totalRevenue ?? 0, teacherShare: s.teacherShare ?? 0, centerShare: s.centerShare ?? 0, presentCount: s.presentCount ?? 0 }
        : null,
    })),
    suggestions: unmaterialized.map((s) => ({
      scheduleId: s.id,
      startTime: s.startTime, endTime: s.endTime, room: s.room,
      subject: s.group.subject.name, grade: s.group.grade.name, groupName: s.group.name,
      teacher: s.group.teacher?.name ?? "—",
      price: s.group.sessionPrice, teacherPercent: s.group.teacherPercent,
    })),
  });
});

type OpenBody = {
  scheduleId?: string; groupId?: string; date?: string; startTime?: string; endTime?: string; room?: string;
  // وضع الحضور (spec §1): ROSTER (كشف/مجموعة — الافتراضي زي ما كان) | OPEN (حضور مفتوح من غير كشف)
  studentSource?: "ROSTER" | "OPEN";
  name?: string; // اسم الحصة (إجباري للحضور المفتوح)
  studentCodeLength?: number; // للحضور المفتوح: طول كود الطالب المطلوب
  allowUnregistered?: boolean; // للكشف: قبول غير المسجلين بدل رفضهم
  requireRoomPin?: boolean; // مضاد الغش: كود قاعة متغيّر 4 أرقام جنب الـ QR (مضاد مشاركة الكود عن بُعد)
};

/** الـ IP العام لجهاز اللي بيفتح الحصة — بيتبتّعل كمرجع لشبكة القاعة (flag للمخاطر — مش رفض) */
function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 40) || "unknown";
}

/** POST /api/sessions — open/materialize a session from a schedule slot, ad-hoc group, or Open Attendance */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<OpenBody>(req);
  const date = body.date || todayStr();
  const roomPinEnabled = body.requireRoomPin === true;
  const anchorIp = clientIp(req);

  // ============ الحضور المفتوح (spec §1B) — حصة من غير مجموعة/كشف ============
  if (body.studentSource === "OPEN") {
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) throw new ApiError("اكتب اسم الحصة (حرفين على الأقل).", 400);
    // طول الكود قابل للضبط (spec §2 — ممنوع hardcode 5): 3..12 رقم
    const codeLen = Math.max(3, Math.min(12, Math.round(Number(body.studentCodeLength ?? 5))));
    if (!body.startTime || !body.endTime || !/^\d{2}:\d{2}$/.test(body.startTime) || !/^\d{2}:\d{2}$/.test(body.endTime)) {
      throw new ApiError("حدد وقت بداية ونهاية الحصة.");
    }
    if (body.endTime <= body.startTime) throw new ApiError("وقت النهاية لازم يكون بعد وقت البداية.");
    const room = body.room ?? null;
    // تعارض القاعة بس (مفيش مدرس/مجموعة للحضور المفتوح)
    await assertNoSessionConflicts({ centerId: user.centerId, date, startTime: body.startTime, endTime: body.endTime, room, teacherId: null });

    const session = await db.sessionInstance.create({
      data: {
        centerId: user.centerId, groupId: null, name, date, scheduleId: null,
        startTime: body.startTime, endTime: body.endTime, room,
        price: 0, teacherPercent: 0, // مفيش حسابات للحضور المفتوح — تسجيل حضور بس
        studentSource: "OPEN", studentCodeLength: codeLen,
        requireRoomPin: roomPinEnabled, anchorIp,
        status: "OPEN", openedBy: user.id,
      },
    });
    await logAudit({
      user,
      action: AUDIT.SESSION_OPENED,
      entity: "SESSION",
      entityId: session.id,
      after: { name, date, startTime: body.startTime, studentSource: "OPEN", studentCodeLength: codeLen, requireRoomPin: roomPinEnabled },
    });
    return ok({ session: { id: session.id }, teacherAutoAttendance: null }, { status: 201 });
  }

  let group; let startTime: string; let endTime: string; let room: string | null; let scheduleId: string | null = null;

  if (body.scheduleId) {
    const slot = await db.scheduleSlot.findFirst({
      where: { id: String(body.scheduleId), centerId: user.centerId },
      include: { group: { include: { teacher: true, subject: true } } },
    });
    if (!slot) throw new ApiError("الحصة دي مش موجودة في الجدول.", 404);
    const existing = await db.sessionInstance.findFirst({ where: { centerId: user.centerId, date, scheduleId: slot.id } });
    if (existing && existing.status !== "CANCELLED") throw new ApiError("الحصة دي مفتوحة خلاص النهاردة.", 409);

    // إعادة فتح حصة ملغاة (من غير حسابات) — بدل رسالة «الحصة دي مفتوحة خلاص» الملبّسة
    if (existing) {
      await assertNoSessionConflicts({
        centerId: user.centerId, date, startTime: slot.startTime, endTime: slot.endTime,
        room: slot.room, teacherId: slot.group.teacherId, excludeId: existing.id,
      });
      await db.sessionInstance.update({
        where: { id: existing.id },
        data: { status: "OPEN", openedBy: user.id, createdAt: new Date() },
      });
      await logAudit({
        user, action: AUDIT.SESSION_OPENED, entity: "SESSION", entityId: existing.id,
        after: { group: slot.group.name, date, startTime: slot.startTime, revivedFrom: "CANCELLED" },
      });
      const teacherAuto = await autoTeacherAttendance({
        centerId: user.centerId, sessionId: existing.id,
        teacher: slot.group.teacher, openerName: user.name,
      });
      return ok({ session: { id: existing.id }, revived: true, teacherAutoAttendance: teacherAuto });
    }

    scheduleId = slot.id;
    group = slot.group;
    startTime = slot.startTime; endTime = slot.endTime; room = slot.room;
  } else if (body.groupId) {
    group = await db.group.findFirst({
      where: { id: String(body.groupId), centerId: user.centerId, isActive: true },
      include: { subject: true, teacher: true },
    });
    if (!group) throw new ApiError("المجموعة دي مش موجودة.", 404);
    if (!body.startTime || !body.endTime || !/^\d{2}:\d{2}$/.test(body.startTime) || !/^\d{2}:\d{2}$/.test(body.endTime)) {
      throw new ApiError("حدد وقت بداية ونهاية الحصة.");
    }
    if (body.endTime <= body.startTime) throw new ApiError("وقت النهاية لازم يكون بعد وقت البداية.");
    startTime = body.startTime; endTime = body.endTime; room = body.room ?? null;
  } else {
    throw new ApiError("اختار حصة من الجدول أو مجموعة.");
  }

  // كشف التعارض: نفس المدرس أو نفس القاعة بنفس الوقت في نفس اليوم
  await assertNoSessionConflicts({
    centerId: user.centerId, date, startTime, endTime,
    room, teacherId: group.teacherId,
  });

  const session = await db.sessionInstance.create({
    data: {
      centerId: user.centerId, groupId: group.id, date, scheduleId,
      startTime, endTime, room,
      price: group.sessionPrice, teacherPercent: group.teacherPercent,
      studentSource: "ROSTER",
      allowUnregistered: body.allowUnregistered === true,
      requireRoomPin: roomPinEnabled, anchorIp,
      status: "OPEN", openedBy: user.id,
    },
  });

  await logAudit({
    user,
    action: AUDIT.SESSION_OPENED,
    entity: "SESSION",
    entityId: session.id,
    after: { group: group.name, date, startTime, allowUnregistered: body.allowUnregistered === true, requireRoomPin: roomPinEnabled },
  });

  // حضور المدرس التلقائي — بدء الحصة = تسجيل المدرس حاضر (قدرة المركز بتتحكم)
  const teacherAuto = await autoTeacherAttendance({
    centerId: user.centerId, sessionId: session.id,
    teacher: group.teacher, openerName: user.name,
  });

  return ok({ session: { id: session.id }, teacherAutoAttendance: teacherAuto }, { status: 201 });
});
