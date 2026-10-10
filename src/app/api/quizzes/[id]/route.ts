import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { normalizeQuestions } from "@/lib/quiz";
import { logAudit, AUDIT } from "@/lib/audit";
import { notifyGroupStudents } from "@/lib/notify";
import { notifyStaff } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

/**
 * GET /api/quizzes/[id] — تفاصيل الكويز للموظفين (بالأسئلة والإجابات والمحاولات)
 * PATCH — إجراءات: publish | close | reopen | update (DRAFT بس) | grade (تصحيح WRITTEN)
 * DELETE — مسح DRAFT فقط
 */
type RouteCtx = { params: Promise<{ id: string }> };

async function getQuiz(centerId: string, id: string) {
  const quiz = await db.quiz.findFirst({
    where: { id, centerId },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      questions: { orderBy: { order: "asc" } },
      attempts: {
        include: { student: { select: { id: true, name: true, code: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!quiz) throw new ApiError("الكويز مش موجود.", 404);
  return quiz;
}

export const GET = handler(async (_req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "exams");
  const { id } = await ctx.params;
  const quiz = await getQuiz(user.centerId, id);
  return ok({ quiz });
});

export const PATCH = handler(async (req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "exams");
  const { id } = await ctx.params;
  const body = await readJson<{
    action?: string;
    title?: string; description?: string; durationMin?: number;
    opensAt?: string | null; closesAt?: string | null;
    questions?: unknown;
    attemptId?: string; writtenScores?: Record<string, number>;
  }>(req);
  const action = String(body.action ?? "");

  const quiz = await getQuiz(user.centerId, id);

  if (action === "publish" || action === "close" || action === "reopen") {
    const to = action === "publish" ? "PUBLISHED" : action === "close" ? "CLOSED" : "DRAFT";
    const updated = await db.quiz.update({ where: { id }, data: { status: to } });
    if (action === "publish") {
      // إشعار فوري لطلاب المجموعة (كان مفقود — الكويز كان بينشر من غير أي إشعار)
      void notifyGroupStudents(
        user.centerId, updated.groupId, "QUIZ",
        `كويز جديد: ${updated.title}`,
        "افتح تبويب الكويزات في البورتال وحل قبل ما يقفل.",
        "/portal?tab=quizzes",
      ).catch(() => {});
      // إشعار للفريق الشغال (مدير + مدرس)
      void notifyStaff(user.centerId, {
        type: "PUBLISH",
        title: `كويز جديد: ${updated.title}`,
        body: `${quiz.group.subject.name} — ${quiz.group.name}. شاركه مع الطلاب من شاشة الكويزات (زرار مشاركة).`,
        link: "quizzes",
        refId: updated.id,
      }, { roles: ["MANAGER", "TEACHER"] }).catch(() => {});
    }
    await logAudit({
      user, action: AUDIT.ATTENDANCE_UPDATED, entity: "QUIZ", entityId: id,
      before: { status: quiz.status }, after: { status: to }, reason: `تغيير حالة الكويز ${quiz.title}`,
    });
    return ok({ quiz: updated });
  }

  if (action === "update") {
    if (quiz.status !== "DRAFT") throw new ApiError("التعديل مسموح في الكويز المسودة بس — اقفله أو اعمل كويز جديد.", 400);
    const questions = normalizeQuestions(body.questions);
    const durationMin = Number(body.durationMin) > 0 ? Math.round(Number(body.durationMin)) : null;
    await db.$transaction(async (tx) => {
      await tx.quizQuestion.deleteMany({ where: { quizId: id } });
      await tx.quizQuestion.createMany({ data: questions.map((q) => ({ ...q, quizId: id })) });
      await tx.quiz.update({
        where: { id },
        data: {
          title: String(body.title ?? quiz.title).trim() || quiz.title,
          description: body.description !== undefined ? String(body.description).trim() || null : quiz.description,
          durationMin,
          opensAt: body.opensAt !== undefined ? (body.opensAt ? new Date(String(body.opensAt)) : null) : quiz.opensAt,
          closesAt: body.closesAt !== undefined ? (body.closesAt ? new Date(String(body.closesAt)) : null) : quiz.closesAt,
        },
      });
    });
    await logAudit({
      user, action: AUDIT.ATTENDANCE_UPDATED, entity: "QUIZ", entityId: id,
      after: { questions: questions.length }, reason: `تعديل كويز — ${quiz.title}`,
    });
    return ok({ ok: true });
  }

  if (action === "grade") {
    // تصحيح يدوي لأسئلة WRITTEN لمحاولة واحدة
    const attemptId = String(body.attemptId ?? "");
    const att = await db.quizAttempt.findFirst({
      where: { id: attemptId, quizId: id },
      include: { quiz: { include: { questions: true } } },
    });
    if (!att) throw new ApiError("المحاولة مش موجودة.", 404);
    if (att.status === "IN_PROGRESS") throw new ApiError("الطالب لسه ما سلّمش الكويز.", 400);

    const written = att.quiz.questions.filter((q) => q.type === "WRITTEN");
    const scores = body.writtenScores ?? {};
    let autoScore = 0;
    for (const q of att.quiz.questions) {
      if (q.type === "WRITTEN") continue;
      const answers = (JSON.parse(att.answers ?? "[]") as { questionId: string; answer: string }[]);
      const given = answers.find((a) => a.questionId === q.id)?.answer;
      if (given != null && q.correctAnswer != null && String(given) === q.correctAnswer) autoScore += q.points;
    }
    let writtenScore = 0;
    for (const q of written) {
      const v = Number(scores[q.id]);
      if (Number.isFinite(v) && v >= 0 && v <= q.points) writtenScore += v;
    }
    const graded = await db.quizAttempt.update({
      where: { id: attemptId },
      data: {
        score: autoScore + writtenScore,
        maxScore: att.quiz.questions.reduce((s, q) => s + q.points, 0),
        status: "GRADED",
        gradedAt: new Date(),
        gradedById: user.id,
      },
    });
    await logAudit({
      user, action: AUDIT.ATTENDANCE_UPDATED, entity: "QUIZ_ATTEMPT", entityId: attemptId,
      after: { score: graded.score, maxScore: graded.maxScore }, reason: `تصحيح كويز — ${quiz.title}`,
    });
    return ok({ attempt: graded });
  }

  throw new ApiError("الإجراء ده مش معروف.", 400);
});

export const DELETE = handler(async (_req: Request, ctx: RouteCtx) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "exams");
  const { id } = await ctx.params;
  const quiz = await getQuiz(user.centerId, id);
  if (quiz.status !== "DRAFT") throw new ApiError("مينفعش تمسح كويز منشور — اقفله بدل المسح.", 400);
  await db.quiz.delete({ where: { id } });
  await logAudit({
    user, action: AUDIT.ATTENDANCE_UPDATED, entity: "QUIZ", entityId: id,
    before: { title: quiz.title }, reason: "مسح كويز مسودة",
  });
  return ok({ ok: true });
});
