import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { getCenterCapabilities, capabilityBool } from "@/lib/center-capabilities";
import { recordAttendanceEvent, hasPhysicalAttendanceToday } from "@/lib/attendance-core";

/* ============================================================
   SESSIONS CORE — منطق الحصص المشترك بين الـ API والوكيل الذكي
   (اتفكّ من route الحصص عشان أداة attendance.start_session في
   طبقة الوكيل تستخدم نفس القواعد بالظبط — مصدر حقيقة واحد)
============================================================ */

/** كشف تعارض الحصص: نفس اليوم + (نفس المدرس أو نفس القاعة) + تداخل وقتي.
 *  الحصص الملغاة (CANCELLED) مش بتسدّ الخانة. */
export async function assertNoSessionConflicts(opts: {
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
        `القاعة محجوزة في نفس الوقت — عندها حصة ${s.group?.subject.name ?? s.name ?? "تانية"} من ${s.startTime} لـ ${s.endTime}. اختار وقت أو قاعة تانية.`,
        409,
      );
    }
    // تعارض مدرس — المدرس واحد في قاعتين في نفس الوقت (حصص الحضور المفتوح مالهاش مدرس)
    if (opts.teacherId && s.group?.teacherId === opts.teacherId) {
      throw new ApiError(
        `المدرس محجوز في حصة تانية في نفس الوقت (${s.group?.subject.name ?? ""} من ${s.startTime} لـ ${s.endTime}) — اختار وقت تاني.`,
        409,
      );
    }
  }
}

/**
 * حضور المدرس التلقائي (SESSION_START): فتح الحصة = تسجيل المدرس حاضر بتوقيت البدء.
 * - قدرة teacher_auto_attendance لازم تكون مفعّلة على المركز.
 * - لو config.requireCenterPresence: المدرس لازم يكون سجّل حضور مادي النهاردة.
 * - Dedupe: حدث واحد لكل (حصة × مدرس) — إعادة فتح حصة ملغاة مش بيسجل تاني.
 * - بيرجع اسم المدرس للـ UI (toast «اتسجل حاضر تلقائيًا») أو null.
 */
export async function autoTeacherAttendance(opts: {
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
  });
  return { teacherName: opts.teacher.name };
}
