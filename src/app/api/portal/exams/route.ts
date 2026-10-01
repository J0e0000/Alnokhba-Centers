import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/exams — امتحانات مجموعات الطالب + حالة كل امتحان (سيرفر-محسوبة)
 * الحالات: NOT_YET | AVAILABLE | IN_PROGRESS | SUBMITTED | INVALIDATED | MISSED | CLOSED
 * لو المحاولة عدّى وقتها وهي شغالة → auto-submit فورًا هنا (السيرفر هو اللي بيقرر).
 */

export const GET = handler(async () => {
  const st = await getPortalStudent();
  if (!st) throw new ApiError("سجل دخولك الأول.", 401);

  const regs = await db.studentGroup.findMany({
    where: { studentId: st.id, status: "ACTIVE" },
    select: { groupId: true },
  });
  const groupIds = regs.map((r) => r.groupId);
  const now = new Date();

  const exams = groupIds.length
    ? await db.exam.findMany({
        where: { centerId: st.centerId, groupId: { in: groupIds }, status: { in: ["PUBLISHED", "CLOSED"] } },
        include: {
          group: { select: { name: true, subject: { select: { name: true } } } },
          attempts: { where: { studentId: st.id } },
        },
        orderBy: { startAt: "desc" },
        take: 60,
      })
    : [];

  type ExamRowOut = {
    id: string; title: string; subject: string; groupName: string;
    startAt: Date; endAt: Date; durationMin: number; maxScore: number;
    securityMode: string; state: string; score: number | null;
    submittedAt: Date | null; serverNow: Date;
  };
  const rows: ExamRowOut[] = [];
  for (const e of exams) {
    const attempt = e.attempts[0] ?? null;

    // auto-submit للمحاولة اللي وقتها خلص وهي لسه شغالة (السيرفر بيقفلها بنفسه)
    if (attempt && attempt.status === "IN_PROGRESS" && attempt.expiresAt < now) {
      const full = await db.exam.findUnique({ where: { id: e.id }, select: { questions: true } });
      const answers = await db.examAnswer.findMany({ where: { attemptId: attempt.id } });
      const { score } = (await import("@/lib/exam")).gradeObjectiveAttempt(
        full?.questions ?? [],
        answers,
        attempt.optionOrder ? JSON.parse(attempt.optionOrder) : null,
      );
      await db.examAttempt.update({
        where: { id: attempt.id },
        data: { status: "AUTO_SUBMITTED", submittedAt: attempt.expiresAt, score },
      });
      await db.examSecurityEvent.create({
        data: { centerId: st.centerId, attemptId: attempt.id, studentId: st.id, type: "EXAM_AUTO_SUBMITTED" },
      }).catch(() => {});
      attempt.status = "AUTO_SUBMITTED";
      attempt.score = score;
    }

    let state: string;
    if (e.status === "CLOSED") state = "CLOSED";
    else if (!attempt) {
      if (now < e.startAt) state = "NOT_YET";
      else if (now <= e.endAt) state = "AVAILABLE";
      else state = "MISSED";
    } else if (attempt.status === "IN_PROGRESS") state = "IN_PROGRESS";
    else if (attempt.status === "INVALIDATED") state = "INVALIDATED";
    else state = "SUBMITTED";

    rows.push({
      id: e.id,
      title: e.title,
      subject: e.group.subject.name,
      groupName: e.group.name,
      startAt: e.startAt,
      endAt: e.endAt,
      durationMin: e.durationMin,
      maxScore: e.maxScore,
      securityMode: e.securityMode,
      state,
      score: attempt?.score ?? null,
      submittedAt: attempt?.submittedAt ?? null,
      serverNow: now,
    });
  }

  return ok({ exams: rows, serverNow: now });
});
