import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { todayStr } from "@/lib/normalize";
import { getCenterCapabilities, capabilityBool } from "@/lib/center-capabilities";
import { recordAttendanceEvent, hasPhysicalAttendanceToday } from "@/lib/attendance-core";

export const dynamic = "force-dynamic";

/* ============================================================
   كشف تعارض الحصص (server-side):
   نفس اليوم + (نفس المدرس أو نفس القاعة) + تداخل وقتي
   التداخل: existing.start < newEnd AND existing.end > newStart
   (الحصص الملاصقة مسموحة — الشرط strict)
   الحصص الملغاة (CANCELLED) مش بتسدّ الخانة.
============================================================ */

async function assertNoSessionConflicts(opts: {
  centerId: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string | null;
  teacherId: string | null;
  excludeId?: string;
}) {
  const sessions = await db.sessionInstance.findMany({
    where: {
      centerId: opts.centerId,
      date: opts.date,
      status: { not: "CANCELLED" },
      ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
    },
    include: { group: { include: { subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });

  for (const s of sessions) {
    const overlaps = s.startTime < opts.endTime && s.endTime > opts.startTime;
    if (!overlaps) continue;

    // تعارض قاعة — نفس القاعة بنفس الوقت
    if (opts.room && s.room && s.room === opts.room) {
      throw new ApiError(
        `القاعة محجوزة في نفس الوقت — عندها حصة ${s.group.subject.name} من ${s.startTime} لـ ${s.endTime}. اختار وقت أو قاعة تانية.`,
        409,
      );
    }
    // تعارض مدرس — المدرس واحد في قاعتين في نفس الوقت
    if (opts.teacherId && s.group.teacherId === opts.teacherId) {
      throw new ApiError(
        `المدرس محجوز في حصة تانية في نفس الوقت (${s.group.subject.name} من ${s.startTime} لـ ${s.endTime}) — اختار وقت تاني.`,
        409,
      );
    }
  }
}

/**
 * حضور المدرس التلقائي (SESSION_START): فتح الحصة = تسجيل المدرس حاضر بتوقيت البدء.
 * - قدرة teacher_auto_attendance لازم تكون مفعّلة على المركز.
 * - لو config.requireCenterPresence: المدرس لازم يكون سجّل حضور مادي النهاردة
 *   (شاشة QR / بصمة) — من غير كده فتح الحصة بيرفض برسالة واضحة.
 * - Dedupe: حدث واحد لكل (حصة × مدرس) — إعادة فتح حصة ملغاة مش بيسجل تاني.
 * - بيرجع اسم المدرس للـ UI (toast «اتسجل حاضر تلقائيًا») أو null.
 */
async function autoTeacherAttendance(opts: {
  centerId: string;
  sessionId: string;
  teacher: { id: string; name: string } | null | undefined;
  openerName: string;
}): Promise<{ teacherName: string } | null> {
  if (!opts.teacher) return null;
  const caps = await getCenterCapabilities(opts.centerId);
  if (!caps.teacher_auto_attendance.enabled) return null;

  if (capabilityBool(caps.teacher_auto_attendance.config, "requireCenterPresence", false)) {
    const present = await hasPhysicalAttendanceToday({ centerId: opts.centerId, teacherId: opts.teacher.id });
    if (!present) {
      throw new ApiError(
        "المركز بيطلب إثبات الحضور المادي قبل بدء الحصة — المدرس يسجّل حضوره الأول من شاشة المركز أو البصمة، وبعدها افتح الحصة.",
        403,
      );
    }
  }

  const dup = await db.attendanceEvent.findFirst({
    where: { sessionId: opts.sessionId, method: "SESSION_START", teacherId: opts.teacher.id },
    select: { id: true },
  });
  if (dup) return null;

  await recordAttendanceEvent({
    centerId: opts.centerId,
    personType: "STAFF",
    method: "SESSION_START",
    status: "PRESENT",
    teacherId: opts.teacher.id,
    displayName: opts.teacher.name,
    role: "TEACHER",
    sessionId: opts.sessionId,
    metadata: { auto: true, openedBy: opts.openerName },
  }, { critical: true });
  await logAudit({
    user: { id: "system", name: "النظام", centerId: opts.centerId },
    action: AUDIT.TEACHER_AUTO_ATTENDANCE,
    entity: "SESSION",
    entityId: opts.sessionId,
    after: { teacher: opts.teacher.name, method: "SESSION_START" },
    reason: `حضور تلقائي عند بدء الحصة (الافتتاح بيد ${opts.openerName})`,
  }).catch(() => {});
  return { teacherName: opts.teacher.name };
}

/** GET /api/sessions?date=YYYY-MM-DD — sessions for a date (default today) */
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
      subject: s.group.subject.name, grade: s.group.grade.name, groupName: s.group.name,
      teacher: s.group.teacher?.name ?? "—", teacherId: s.group.teacherId,
      price: s.price, teacherPercent: s.teacherPercent,
      // وقت البداية الفعلي = لحظة فتح الحصة (الجدول بيتخطط — الفتح بيتسجل)
      openedAt: s.status !== "CANCELLED" ? s.createdAt.toISOString() : null,
      attendanceCount: s.attendance.length,
      presentCount: s.attendance.filter((a) => a.status !== "EXCUSED").length,
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

type OpenBody = { scheduleId?: string; groupId?: string; date?: string; startTime?: string; endTime?: string; room?: string };

/** POST /api/sessions — open/materialize a session from a schedule slot (or ad-hoc) */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<OpenBody>(req);
  const date = body.date || todayStr();

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
      status: "OPEN", openedBy: user.id,
    },
  });

  await logAudit({
    user,
    action: AUDIT.SESSION_OPENED,
    entity: "SESSION",
    entityId: session.id,
    after: { group: group.name, date, startTime },
  });

  // حضور المدرس التلقائي — بدء الحصة = تسجيل المدرس حاضر (قدرة المركز بتتحكم)
  const teacherAuto = await autoTeacherAttendance({
    centerId: user.centerId, sessionId: session.id,
    teacher: group.teacher, openerName: user.name,
  });

  return ok({ session: { id: session.id }, teacherAutoAttendance: teacherAuto }, { status: 201 });
});
