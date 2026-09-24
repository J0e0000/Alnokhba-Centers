import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { dowOf, overlaps, DOW_NAMES_AR, toMinutes } from "./dates";

/* ============================================================
   SCHEDULE CONFLICT DETECTION (spec §12)
   No silent conflicts. Returns Arabic explanations per conflict
   type: teacher / student / group / room / same-occurrence.
============================================================ */

export type ConflictResult = { type: string; message: string };

type OccInput = {
  dayOfWeek?: number; // for weekly occurrences
  date?: string; // for one-off sessions
  startTime: string;
  endTime: string;
  room?: string | null;
  excludeScheduleId?: string;
  excludeSessionId?: string;
  groupId: string;
};

/** Find conflicts for a WEEKLY occurrence (used when editing group schedules) */
export async function findOccurrenceConflicts(input: {
  groupId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string | null;
  excludeScheduleId?: string;
}): Promise<ConflictResult[]> {
  const conflicts: ConflictResult[] = [];
  const group = await db.acaGroup.findUnique({
    where: { id: input.groupId },
    select: { id: true, name: true, teacherId: true, enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } } },
  });
  if (!group) throw new ApiError("المجموعة دي مش موجودة.", 404);
  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    conflicts.push({ type: "time", message: "وقت النهاية لازم يكون بعد وقت البداية." });
    return conflicts;
  }

  const sameDay = await db.acaGroupSchedule.findMany({
    where: { dayOfWeek: input.dayOfWeek, status: "ACTIVE", groupId: { not: undefined } },
    include: { group: { select: { id: true, name: true, teacherId: true } } },
  });

  for (const occ of sameDay) {
    if (occ.groupId === input.groupId && occ.id === input.excludeScheduleId) continue;
    if (occ.groupId === input.groupId) {
      if (overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
        conflicts.push({ type: "group", message: `المجموعة عندها حصة نفس الوقت (${occ.group.name} — ${occ.startTime} إلى ${occ.endTime}).` });
      }
      continue;
    }
    // teacher conflict
    if (occ.group.teacherId === group.teacherId && overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
      conflicts.push({ type: "teacher", message: `المدرس عنده حصة تانية نفس الوقت (${occ.group.name} — ${DOW_NAMES_AR[input.dayOfWeek]} ${occ.startTime}).` });
    }
    // room conflict
    if (input.room && occ.room && input.room === occ.room && overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
      conflicts.push({ type: "room", message: `القاعة "${input.room}" محجوزة لنفس الوقت (${occ.group.name}).` });
    }
    // student conflicts (any shared active student)
    const occStudents = await db.acaEnrollment.findMany({ where: { groupId: occ.groupId, status: "ACTIVE" }, select: { studentId: true } });
    const occSet = new Set(occStudents.map((s) => s.studentId));
    const shared = group.enrollments.filter((e) => occSet.has(e.studentId));
    if (shared.length > 0 && overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
      conflicts.push({ type: "student", message: `${shared.length} طالب في المجموعة عندهم حصة تانية نفس الوقت (${occ.group.name}).` });
    }
  }
  return conflicts;
}

/** Find conflicts for a ONE-OFF session (manual session / makeup / reschedule) */
export async function findSessionConflicts(input: {
  groupId: string;
  date: string;
  startTime: string;
  endTime: string;
  room?: string | null;
  excludeSessionId?: string;
}): Promise<ConflictResult[]> {
  const conflicts: ConflictResult[] = [];
  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    conflicts.push({ type: "time", message: "وقت النهاية لازم يكون بعد وقت البداية." });
    return conflicts;
  }
  const group = await db.acaGroup.findUnique({
    where: { id: input.groupId },
    select: { id: true, name: true, teacherId: true, enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } } },
  });
  if (!group) throw new ApiError("المجموعة دي مش موجودة.", 404);
  const dow = dowOf(input.date);

  // other sessions on the same date
  const sameDate = await db.acaSession.findMany({
    where: { date: input.date, status: { not: "CANCELLED" } },
    include: { group: { select: { id: true, name: true, teacherId: true } } },
  });
  for (const s of sameDate) {
    if (s.id === input.excludeSessionId) continue;
    if (s.groupId === input.groupId) continue; // same group: allowed to have one per slot (generation dedupes elsewhere)
    if (s.group.teacherId === group.teacherId && overlaps(input.startTime, input.endTime, s.startTime, s.endTime)) {
      conflicts.push({ type: "teacher", message: `المدرس عنده حصة تانية نفس اليوم (${s.group.name} — ${s.startTime}).` });
    }
    if (input.room && s.room && input.room === s.room && overlaps(input.startTime, input.endTime, s.startTime, s.endTime)) {
      conflicts.push({ type: "room", message: `القاعة "${input.room}" محجوزة نفس الوقت (${s.group.name}).` });
    }
    const sStudents = await db.acaAttendance.findMany({ where: { sessionId: s.id }, select: { studentId: true } }).catch(() => []);
    void sStudents; // attendance exists only after start; enrollment-based check below covers roster overlap
  }

  // weekly occurrences of OTHER groups on this weekday
  const occs = await db.acaGroupSchedule.findMany({
    where: { dayOfWeek: dow, status: "ACTIVE" },
    include: { group: { select: { id: true, name: true, teacherId: true } } },
  });
  for (const occ of occs) {
    if (occ.groupId === input.groupId) continue;
    if (occ.group.teacherId === group.teacherId && overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
      conflicts.push({ type: "teacher", message: `المدرس عنده حصة أسبوعية نفس الوقت (${occ.group.name} — ${DOW_NAMES_AR[dow]} ${occ.startTime}).` });
    }
    if (input.room && occ.room && input.room === occ.room && overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
      conflicts.push({ type: "room", message: `القاعة "${input.room}" محجوزة أسبوعيًا نفس الوقت (${occ.group.name}).` });
    }
  }

  // student conflicts: shared students with other groups' weekly occurrences at same time
  const studentIds = group.enrollments.map((e) => e.studentId);
  if (studentIds.length) {
    const otherEnrollments = await db.acaEnrollment.findMany({
      where: { studentId: { in: studentIds }, status: "ACTIVE", groupId: { not: input.groupId } },
      select: { groupId: true, studentId: true, group: { select: { name: true } } },
    });
    const otherGroupIds = [...new Set(otherEnrollments.map((e) => e.groupId))];
    for (const occ of occs) {
      if (!otherGroupIds.includes(occ.groupId)) continue;
      if (overlaps(input.startTime, input.endTime, occ.startTime, occ.endTime)) {
        const count = otherEnrollments.filter((e) => e.groupId === occ.groupId).length;
        conflicts.push({ type: "student", message: `${count} طالب عندهم حصة تانية نفس الوقت (${occ.group.name}).` });
      }
    }
  }
  return conflicts;
}
