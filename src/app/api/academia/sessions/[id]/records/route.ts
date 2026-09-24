import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, assertGroupAccess } from "@/lib/academia/guard";
import { parseWorkspace } from "@/lib/academia/session-gen";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/* POST /api/academia/sessions/[id]/records — targeted workspace mutations
   (autosave layer, spec §21): one optimistic client tap → one targeted
   server persistence. Never saves the whole session.
   kinds: attendance | interaction | homework | stage | note */
async function POST_impl(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAca();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.kind !== "string") throw new ApiError("البيانات ناقصة.", 400);

  const session = await db.acaSession.findUnique({
    where: { id },
    select: { id: true, groupId: true, status: true, date: true, startTime: true, workspace: true },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  await assertGroupAccess(user, session.groupId);

  const kind = body.kind;

  if (kind === "attendance") {
    if (!user.permissions.includes("attendance.edit")) throw new ApiError("مالكش صلاحية تسجيل الحضور.", 403);
    if (session.status === "COMPLETED" && user.role === "TEACHER") throw new ApiError("الحصة مقفولة — كلّم الإدارة لتصحيح الحضور.", 403);
    if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغية.", 400);
    const { studentId, status, note } = body;
    if (!studentId || !["PRESENT", "ABSENT", "LATE", "EXCUSED"].includes(status)) {
      throw new ApiError("اختار الطالب والحالة الصح.", 400);
    }
    const enrolled = await db.acaEnrollment.findFirst({ where: { groupId: session.groupId, studentId, status: "ACTIVE" } });
    if (!enrolled) throw new ApiError("الطالب ده مش مسجل في المجموعة دي.", 400);
    const rec = await db.acaAttendance.upsert({
      where: { sessionId_studentId: { sessionId: id, studentId } },
      create: { sessionId: id, studentId, status, note: note || null, markedById: user.id },
      update: { status, note: note || null, markedById: user.id, markedAt: new Date() },
    });
    return NextResponse.json({ saved: true, record: { studentId: rec.studentId, status: rec.status } });
  }

  if (kind === "interaction") {
    if (!user.permissions.includes("interaction.edit")) throw new ApiError("مالكش صلاحية تسجيل التفاعل.", 403);
    const { studentId, rating, note } = body;
    if (!studentId || !["GREAT", "GOOD", "QUIET", "DISRUPTIVE"].includes(rating)) {
      throw new ApiError("التقييم مش صح.", 400);
    }
    const enrolled = await db.acaEnrollment.findFirst({ where: { groupId: session.groupId, studentId, status: "ACTIVE" } });
    if (!enrolled) throw new ApiError("الطالب ده مش مسجل في المجموعة دي.", 400);
    await db.acaInteraction.upsert({
      where: { sessionId_studentId: { sessionId: id, studentId } },
      create: { sessionId: id, studentId, rating, note: note || null },
      update: { rating, note: note || null },
    });
    return NextResponse.json({ saved: true });
  }

  if (kind === "homework") {
    if (!user.permissions.includes("homework.edit")) throw new ApiError("مالكش صلاحية تسجيل الواجب.", 403);
    const { studentId, completed, score, note } = body;
    if (!studentId || typeof completed !== "boolean") throw new ApiError("البيانات مش مكتملة.", 400);
    if (score !== null && score !== undefined && ![10, 5, -5].includes(Number(score))) {
      throw new ApiError("درجة الواجب تبقى 10 أو 5 أو -5.", 400);
    }
    const enrolled = await db.acaEnrollment.findFirst({ where: { groupId: session.groupId, studentId, status: "ACTIVE" } });
    if (!enrolled) throw new ApiError("الطالب ده مش مسجل في المجموعة دي.", 400);
    await db.acaHomeworkRecord.upsert({
      where: { sessionId_studentId: { sessionId: id, studentId } },
      create: { sessionId: id, studentId, completed, score: score ?? null, note: note || null },
      update: { completed, score: score ?? null, note: note || null },
    });
    return NextResponse.json({ saved: true });
  }

  if (kind === "stage") {
    // explicit stage completion (spec §19) — "إتمام الحضور" etc. Never computed from %.
    if (!user.permissions.includes("attendance.edit")) throw new ApiError("مالكش صلاحية.", 403);
    const { stage, done } = body;
    const valid = ["attendance", "interaction", "homework", "exams", "review"];
    if (!valid.includes(stage) || typeof done !== "boolean") throw new ApiError("مرحلة مش معروفة.", 400);
    if (session.status === "COMPLETED") throw new ApiError("الحصة خلصت خلاص.", 400);

    const ws = parseWorkspace(session.workspace);
    if (done && stage === "attendance") {
      // stage completion is explicit, but block absurd emptiness: roster exists & nothing marked
      const rosterCount = await db.acaEnrollment.count({ where: { groupId: session.groupId, status: "ACTIVE" } });
      const marked = await db.acaAttendance.count({ where: { sessionId: id } });
      if (rosterCount > 0 && marked === 0) throw new ApiError("سجّل حضور طالب واحد على الأقل قبل الإتمام.", 400);
      // contextual communication: absence report to parents/students (spec §28)
      const roster = await db.acaEnrollment.findMany({ where: { groupId: session.groupId, status: "ACTIVE" }, include: { student: { select: { userId: true } } } });
      const absent = await db.acaAttendance.findMany({ where: { sessionId: id, status: "ABSENT" }, select: { studentId: true } });
      const absentSet = new Set(absent.map((a) => a.studentId));
      const absentUsers = roster.filter((r) => absentSet.has(r.student.userId)).map((r) => r.student.userId);
      if (absentUsers.length) {
        await db.acaNotification.createMany({
          data: absentUsers.map((uid) => ({
            userId: uid, type: "ABSENCE",
            title: "غياب مسجل",
            body: `اتسجل غيابك في حصة ${session.date} (${session.startTime}). لو في ملاحظة كلّم الإدارة.`,
            data: JSON.stringify({ sessionId: id }),
          })),
        });
      }
    }
    ws.stages[stage as keyof typeof ws.stages] = done ? "done" : "pending";
    await db.acaSession.update({ where: { id }, data: { workspace: JSON.stringify(ws) } });
    return NextResponse.json({ saved: true, stages: ws.stages });
  }

  throw new ApiError("نوع عملية مش معروف.", 400);
}

export const POST = acaHandler(POST_impl);
