import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaPerm, assertGroupAccess } from "@/lib/academia/guard";
import { findOccurrenceConflicts } from "@/lib/academia/conflicts";
import { DOW_NAMES_AR } from "@/lib/academia/dates";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/academia/groups/[id] — group detail: schedules, enrollments, curriculum */
async function GET_impl(_req: NextRequest, ctx: Ctx) {
  const user = await requireAca();
  const { id } = await ctx.params;
  const group = await db.acaGroup.findUnique({
    where: { id },
    include: {
      subject: { select: { id: true, name: true, color: true } },
      teacher: { select: { id: true, name: true } },
      schedules: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
      enrollments: {
        where: { status: { not: "LEFT" } },
        include: { student: { select: { id: true, code: true, gradeName: true, user: { select: { name: true } } } } },
        orderBy: { student: { code: "asc" } },
      },
    },
  });
  if (!group) throw new ApiError("المجموعة دي مش موجودة.", 404);
  await assertGroupAccess(user, id);
  return NextResponse.json({
    group: {
      id: group.id, name: group.name, gradeName: group.gradeName, room: group.room,
      capacity: group.capacity, pricePerSession: group.pricePerSession, isActive: group.isActive,
      subject: group.subject, teacher: group.teacher,
    },
    schedules: group.schedules,
    enrollments: group.enrollments.map((e) => ({
      id: e.id, status: e.status, customPrice: e.customPrice,
      student: { profileId: e.student.id, code: e.student.code, name: e.student.user.name, gradeName: e.student.gradeName },
    })),
  });
}

/** POST /api/academia/groups/[id] — action-based mutations (schedules, enrollments) */
async function POST_impl(req: NextRequest, ctx: Ctx) {
  const user = await requireAca();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body?.action) throw new ApiError("البيانات ناقصة.", 400);
  const group = await assertGroupAccess(user, id);
  const action = body.action as string;

  // -------- schedules (conflict-checked, spec §12) --------
  if (action === "addSchedule") {
    if (!user.permissions.includes("schedules.manage") && !user.permissions.includes("schedules.request")) {
      throw new ApiError("مالكش صلاحية على الجداول.", 403);
    }
    const { dayOfWeek, startTime, endTime, room } = body;
    if (![0, 1, 2, 3, 4, 5, 6].includes(Number(dayOfWeek))) throw new ApiError("اختار اليوم.", 400);
    if (!startTime || !endTime) throw new ApiError("اختار وقت البداية والنهاية.", 400);
    const conflicts = await findOccurrenceConflicts({ groupId: id, dayOfWeek: Number(dayOfWeek), startTime, endTime, room: room || null });
    if (conflicts.length > 0) return NextResponse.json({ conflicts }, { status: 409 });
    if (user.role === "TEACHER") {
      // teachers request schedule changes; managers add directly (spec §8, §27)
      const request = await db.acaRequest.create({
        data: {
          type: "RESCHEDULE",
          payload: JSON.stringify({ groupId: id, schedule: { dayOfWeek: Number(dayOfWeek), startTime, endTime, room: room || null } }),
          requestedById: user.id, groupId: id, status: "PENDING",
        },
      });
      await notifyManagers(user, "طلب تعديل جدول", `${user.name} طلب إضافة موعد جديد لمجموعة ${group.name} (${DOW_NAMES_AR[Number(dayOfWeek)]} ${startTime}).`, request.id);
      return NextResponse.json({ ok: true, requested: true, message: "اتبعت طلب للإدارة — هنطبق التعديل بعد الموافقة." }, { status: 201 });
    }
    const occ = await db.acaGroupSchedule.create({
      data: { groupId: id, dayOfWeek: Number(dayOfWeek), startTime, endTime, room: room || null },
    });
    await logAudit({ user, action: "إضافة موعد أسبوعي", entity: "ACA_SCHEDULE", entityId: occ.id, after: { groupId: id, dayOfWeek, startTime, endTime } });
    return NextResponse.json({ schedule: occ }, { status: 201 });
  }

  if (action === "updateSchedule") {
    if (!user.permissions.includes("schedules.manage")) throw new ApiError("مالكش صلاحية تعديل الجداول.", 403);
    const { scheduleId, dayOfWeek, startTime, endTime, room } = body;
    const occ = await db.acaGroupSchedule.findUnique({ where: { id: scheduleId } });
    if (!occ || occ.groupId !== id) throw new ApiError("الموعد ده مش موجود.", 404);
    const newOcc = {
      dayOfWeek: Number(dayOfWeek ?? occ.dayOfWeek),
      startTime: startTime ?? occ.startTime,
      endTime: endTime ?? occ.endTime,
      room: room === undefined ? occ.room : room || null,
    };
    const conflicts = await findOccurrenceConflicts({ groupId: id, ...newOcc, excludeScheduleId: occ.id });
    if (conflicts.length > 0) return NextResponse.json({ conflicts }, { status: 409 });
    await db.acaGroupSchedule.update({ where: { id: occ.id }, data: newOcc });
    await logAudit({ user, action: "تعديل موعد أسبوعي", entity: "ACA_SCHEDULE", entityId: occ.id, before: occ, after: newOcc });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancelSchedule") {
    if (!user.permissions.includes("schedules.manage")) throw new ApiError("مالكش صلاحية الجداول.", 403);
    const { scheduleId } = body;
    const occ = await db.acaGroupSchedule.findUnique({ where: { id: scheduleId } });
    if (!occ || occ.groupId !== id) throw new ApiError("الموعد ده مش موجود.", 404);
    await db.acaGroupSchedule.update({ where: { id: scheduleId }, data: { status: occ.status === "ACTIVE" ? "CANCELLED" : "ACTIVE" } });
    await logAudit({ user, action: occ.status === "ACTIVE" ? "إلغاء موعد أسبوعي" : "إعادة تنشيط موعد", entity: "ACA_SCHEDULE", entityId: scheduleId });
    return NextResponse.json({ ok: true });
  }

  // -------- enrollments --------
  if (action === "addEnrollment") {
    if (!user.permissions.includes("students.manage") && user.role !== "TEACHER") throw new ApiError("مالكش صلاحية.", 403);
    const { studentId } = body;
    if (!studentId) throw new ApiError("اختار الطالب.", 400);
    const student = await db.acaStudentProfile.findUnique({ where: { id: studentId } });
    if (!student) throw new ApiError("الطالب ده مش موجود.", 404);
    // سعة المجموعة — منع التسجيل فوق السعة المعلنة
    const g = await db.acaGroup.findUnique({ where: { id }, select: { capacity: true, isActive: true } });
    if (!g) throw new ApiError("المجموعة دي مش موجودة.", 404);
    if (!g.isActive) throw new ApiError("المجموعة دي موقوفة — مينفعش إضافة طلاب.", 400);
    const activeCount = await db.acaEnrollment.count({ where: { groupId: id, status: "ACTIVE" } });
    const dupForCap = await db.acaEnrollment.findUnique({ where: { groupId_studentId: { groupId: id, studentId } } });
    if (g.capacity != null && !dupForCap && activeCount >= g.capacity) {
      throw new ApiError(`المجموعة مليانة (السعة ${g.capacity}) — زوّد السعة الأول.`, 409);
    }
    const dup = dupForCap;
    if (dup && dup.status === "ACTIVE") throw new ApiError("الطالب مسجل خلاص في المجموعة دي.", 400);
    if (dup) {
      await db.acaEnrollment.update({ where: { id: dup.id }, data: { status: "ACTIVE" } });
    } else {
      await db.acaEnrollment.create({ data: { groupId: id, studentId } });
    }
    await logAudit({ user, action: "تسجيل طالب في مجموعة", entity: "ACA_ENROLLMENT", entityId: `${id}:${studentId}` });
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (action === "removeEnrollment") {
    if (!user.permissions.includes("students.manage")) throw new ApiError("مالكش صلاحية.", 403);
    const { enrollmentId } = body;
    const enr = await db.acaEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enr || enr.groupId !== id) throw new ApiError("التسجيل ده مش موجود.", 404);
    await db.acaEnrollment.update({ where: { id: enrollmentId }, data: { status: "LEFT" } });
    await logAudit({ user, action: "إلغاء تسجيل طالب من مجموعة", entity: "ACA_ENROLLMENT", entityId: enrollmentId, before: { status: enr.status }, after: { status: "LEFT" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "patchGroup") {
    if (!user.permissions.includes("groups.manage")) throw new ApiError("مالكش صلاحية.", 403);
    const { name, gradeName, room, capacity, pricePerSession, isActive, teacherId } = body;
    const before = await db.acaGroup.findUnique({ where: { id } });
    if (!before) throw new ApiError("المجموعة دي مش موجودة.", 404);
    // أمان: الـ teacherId الجديد لازم يكون مدرس أكاديميا فعّال — مينفعش أي user id من العميل
    let nextTeacherId = before.teacherId;
    if (teacherId !== undefined && teacherId !== before.teacherId) {
      const t = await db.user.findFirst({ where: { id: String(teacherId), role: "TEACHER", scope: "academia", isActive: true } });
      if (!t) throw new ApiError("المدرس ده مش موجود أو مش فعال.", 400);
      nextTeacherId = t.id;
    }
    const cap = Number(capacity);
    if (capacity !== undefined && capacity != null && (!Number.isFinite(cap) || cap < 1 || cap > 500)) {
      throw new ApiError("سعة المجموعة لازم تكون من 1 لـ 500.", 400);
    }
    await db.acaGroup.update({
      where: { id },
      data: {
        name: name?.trim() || before.name,
        gradeName: gradeName === undefined ? before.gradeName : gradeName || null,
        room: room === undefined ? before.room : room || null,
        capacity: Number(capacity) > 0 ? Number(capacity) : before.capacity,
        pricePerSession: pricePerSession === undefined ? before.pricePerSession : (pricePerSession == null ? null : Math.round(Number(pricePerSession) * 100)),
        isActive: isActive === undefined ? before.isActive : Boolean(isActive),
        teacherId: nextTeacherId,
      },
    });
    await logAudit({ user, action: "تعديل بيانات مجموعة", entity: "ACA_GROUP", entityId: id, before: { name: before.name, teacherId: before.teacherId }, after: { name: name ?? before.name, teacherId: nextTeacherId } });
    return NextResponse.json({ ok: true });
  }

  throw new ApiError("عملية مش معروفة.", 400);
}

async function notifyManagers(byUser: { id: string }, title: string, bodyText: string, refId: string) {
  const managers = await db.user.findMany({ where: { scope: "academia", role: { in: ["ADMIN", "MANAGER"] }, isActive: true }, select: { id: true } });
  if (managers.length) {
    await db.acaNotification.createMany({
      data: managers.map((m) => ({ userId: m.id, type: "REQUEST", title, body: bodyText, data: JSON.stringify({ requestId: refId }) })),
    });
  }
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
