import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaStaff, assertGroupAccess } from "@/lib/academia/guard";
import { parseWorkspace } from "@/lib/academia/session-gen";
import { findSessionConflicts } from "@/lib/academia/conflicts";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/academia/sessions/[id] — full Session Workspace payload (staff only) */
async function GET_impl(_req: NextRequest, ctx: Ctx) {
  // أمان: الـ workspace فيه حضور/تفاعل/واجبات كل زمايله — للإدارة والمدرسين بس.
  // الطالب يشوف سجله هو بس من الشاشات بتاعته.
  const user = await requireAcaStaff();
  const { id } = await ctx.params;
  const session = await db.acaSession.findUnique({
    where: { id },
    include: {
      group: { select: { id: true, name: true, room: true, subject: { select: { id: true, name: true, color: true } } } },
      topic: { select: { id: true, title: true, unit: { select: { id: true, title: true } } } },
      exams: { select: { id: true, title: true, type: true, maxScore: true, date: true } },
    },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  await assertGroupAccess(user, session.groupId);

  const roster = await db.acaEnrollment.findMany({
    where: { groupId: session.groupId, status: "ACTIVE" },
    include: { student: { select: { id: true, code: true, user: { select: { name: true } } } } },
    orderBy: { student: { code: "asc" } },
  });
  const [attendance, interactions, homework] = await Promise.all([
    db.acaAttendance.findMany({ where: { sessionId: id } }),
    db.acaInteraction.findMany({ where: { sessionId: id } }),
    db.acaHomeworkRecord.findMany({ where: { sessionId: id } }),
  ]);

  return NextResponse.json({
    session: {
      id: session.id, groupId: session.groupId, groupName: session.group.name,
      subject: session.group.subject, date: session.date, startTime: session.startTime,
      endTime: session.endTime, room: session.room, status: session.status,
      isMakeup: session.isMakeup, title: session.title, notes: session.notes,
      topic: session.topic, exams: session.exams,
      workspace: parseWorkspace(session.workspace),
    },
    roster: roster.map((e) => ({ profileId: e.student.id, code: e.student.code, name: e.student.user.name })),
    attendance: attendance.map((a) => ({ studentId: a.studentId, status: a.status, note: a.note, markedAt: a.markedAt })),
    interactions: interactions.map((i) => ({ studentId: i.studentId, rating: i.rating, note: i.note })),
    homework: homework.map((h) => ({ studentId: h.studentId, completed: h.completed, score: h.score, note: h.note })),
  });
}

/** PATCH /api/academia/sessions/[id] — lifecycle + notes (server-validated transitions) */
async function PATCH_impl(req: NextRequest, ctx: Ctx) {
  const user = await requireAca();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) throw new ApiError("البيانات ناقصة.", 400);
  const session = await db.acaSession.findUnique({ where: { id } });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  await assertGroupAccess(user, session.groupId);
  const canManage = user.permissions.includes("sessions.start") && user.permissions.includes("attendance.edit");
  if (!canManage) throw new ApiError("مالكش صلاحية تعديل الحصة.", 403);

  const action = body.action as string;

  if (action === "start") {
    if (session.status === "COMPLETED") throw new ApiError("الحصة دي خلصت خلاص.", 400);
    if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغية — اعمل حصة تعويضية بدلها.", 400);
    const updated = await db.acaSession.update({
      where: { id },
      data: { status: "STARTED", startedAt: session.startedAt ?? new Date() },
    });
    return NextResponse.json({ status: updated.status });
  }

  if (action === "progress") {
    if (!["STARTED", "IN_PROGRESS"].includes(session.status)) throw new ApiError("ابدأ الحصة الأول.", 400);
    await db.acaSession.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    return NextResponse.json({ status: "IN_PROGRESS" });
  }

  if (action === "finish") {
    if (session.status === "COMPLETED") return NextResponse.json({ status: "COMPLETED" });
    if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغية.", 400);
    // SAVE ≠ FINISH: finish is explicit; attendance stage must be explicitly done (spec §19)
    const ws = parseWorkspace(session.workspace);
    if (ws.stages.attendance !== "done") throw new ApiError("إتمام الحضور الأول قبل إنهاء الحصة.", 400);
    await db.acaSession.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: user.id },
    });
    await logAudit({ user, action: "إنهاء حصة", entity: "ACA_SESSION", entityId: id, after: { status: "COMPLETED" } });
    return NextResponse.json({ status: "COMPLETED" });
  }

  if (action === "cancel") {
    if (session.status === "COMPLETED") throw new ApiError("الحصة دي خلصت — مينفعش تتلغي.", 400);
    if (!user.permissions.includes("sessions.cancel")) throw new ApiError("الإلغاء للإدارة بس — ابعت طلب إلغاء.", 403);
    await db.acaSession.update({ where: { id }, data: { status: "CANCELLED" } });
    await logAudit({ user, action: "إلغاء حصة", entity: "ACA_SESSION", entityId: id, before: { status: session.status }, after: { status: "CANCELLED" } });
    // contextual notification to enrolled students (spec §28)
    const enrollments = await db.acaEnrollment.findMany({ where: { groupId: session.groupId, status: "ACTIVE" }, include: { student: { select: { userId: true } } } });
    await db.acaNotification.createMany({
      data: enrollments.map((e) => ({
        userId: e.student.userId, type: "SCHEDULE_CHANGE",
        title: "إلغاء حصة",
        body: `حصة ${session.date} (${session.startTime}) اتلغت.`,
        data: JSON.stringify({ sessionId: session.id, groupId: session.groupId }),
      })),
    });
    return NextResponse.json({ status: "CANCELLED" });
  }

  if (action === "reschedule") {
    const { date, startTime, endTime, room } = body;
    if (!date || !startTime || !endTime) throw new ApiError("اختار التاريخ والوقت الجديد.", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new ApiError("التاريخ مش صحيح.", 400);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(startTime)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(endTime))) {
      throw new ApiError("صيغة الوقت لازم تكون HH:MM.", 400);
    }
    if (session.status === "COMPLETED") throw new ApiError("الحصة دي خلصت.", 400);
    const conflicts = await findSessionConflicts({ groupId: session.groupId, date, startTime, endTime, room: room ?? session.room, excludeSessionId: session.id });
    if (conflicts.length > 0) return NextResponse.json({ conflicts }, { status: 409 });
    await db.acaSession.update({ where: { id }, data: { date, startTime, endTime, room: room ?? session.room } });
    await logAudit({ user, action: "تغيير موعد حصة", entity: "ACA_SESSION", entityId: id, before: { date: session.date, startTime: session.startTime }, after: { date, startTime } });
    const enrollments = await db.acaEnrollment.findMany({ where: { groupId: session.groupId, status: "ACTIVE" }, include: { student: { select: { userId: true } } } });
    await db.acaNotification.createMany({
      data: enrollments.map((e) => ({
        userId: e.student.userId, type: "SCHEDULE_CHANGE",
        title: "تغيير موعد حصة",
        body: `حصة المجموعة اتأجلت لـ ${date} (${startTime}).`,
        data: JSON.stringify({ sessionId: session.id }),
      })),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "notes") {
    // debounced autosave target for session notes
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : null;
    await db.acaSession.update({ where: { id }, data: { notes } });
    return NextResponse.json({ ok: true });
  }

  if (action === "setTopic") {
    const topicId = body.topicId || null;
    if (topicId) {
      const exists = await db.acaTopic.findUnique({ where: { id: String(topicId) }, select: { id: true } });
      if (!exists) throw new ApiError("الدرس ده مش موجود في المنهج.", 400);
    }
    await db.acaSession.update({ where: { id }, data: { topicId } });
    return NextResponse.json({ ok: true });
  }

  throw new ApiError("عملية مش معروفة.", 400);
}

export const GET = acaHandler(GET_impl);
export const PATCH = acaHandler(PATCH_impl);
