import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { rateLimit, ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";
import { quizWindowOk, autoGrade } from "@/lib/quiz";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/quizzes — كويزات الطالب (شغالة/مسلّمة/مصححة) + نتايجه
 * GET ?quizId= — أسئلة كويز مسموح يحله (من غير الإجابات الصحيحة أبدًا)
 * POST { quizId, answers } — تسليم المحاولة + تصحيح آلي لـ MCQ/صح وغلط
 */
async function portalStudentOrThrow() {
  const s = await getPortalStudent();
  if (!s) throw new ApiError("لازم تدخل بكودك الأول.", 401);
  return s;
}

export const GET = handler(async (req: Request) => {
  const student = await portalStudentOrThrow();
  const url = new URL(req.url);
  const quizId = url.searchParams.get("quizId");

  // تفاصيل كويز للحل
  if (quizId) {
    const quiz = await db.quiz.findFirst({
      where: { id: quizId, centerId: student.centerId },
      include: {
        questions: { orderBy: { order: "asc" } },
        group: { include: { students: { where: { studentId: student.id, status: "ACTIVE" }, select: { id: true } } } },
      },
    });
    if (!quiz || quiz.group.students.length === 0) {
      throw new ApiError("الكويز ده مش متاح ليك.", 404);
    }
    const win = quizWindowOk(quiz);
    const attempt = await db.quizAttempt.findUnique({
      where: { quizId_studentId: { quizId: quiz.id, studentId: student.id } },
    });
    if (attempt && attempt.status !== "IN_PROGRESS") {
      return ok({ quiz: { id: quiz.id, title: quiz.title }, done: true, attempt });
    }
    if (!win.ok && !attempt) throw new ApiError(win.reason ?? "الكويز مش متاح.", 403);
    return ok({
      quiz: {
        id: quiz.id, title: quiz.title, description: quiz.description,
        durationMin: quiz.durationMin, closesAt: quiz.closesAt,
        questions: quiz.questions
          .filter((q) => q.type !== "WRITTEN" || true) // الطلاب يجاوبون على الكل — الـ WRITTEN يتصحح يدوي
          .map((q) => ({
            id: q.id, order: q.order, text: q.text, type: q.type,
            options: q.options ? (JSON.parse(q.options) as string[]) : null, points: q.points,
            // ⚠️ correctAnswer يُحذف عمدًا — مينفعش يوصل للعميل
          })),
        attempt: attempt ? { id: attempt.id, startedAt: attempt.createdAt } : null,
      },
    });
  }

  // قائمة كويزات الطالب
  const regs = await db.studentGroup.findMany({
    where: { studentId: student.id, status: "ACTIVE" },
    select: { groupId: true },
  });
  const groupIds = regs.map((r) => r.groupId);
  const quizzes = groupIds.length
    ? await db.quiz.findMany({
        where: { centerId: student.centerId, groupId: { in: groupIds }, status: { in: ["PUBLISHED", "CLOSED"] } },
        include: {
          group: { select: { name: true, subject: { select: { name: true } } } },
          attempts: { where: { studentId: student.id } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  return ok({
    quizzes: quizzes.map((q) => {
      const a = q.attempts[0];
      const win = quizWindowOk(q);
      return {
        id: q.id, title: q.title, description: q.description,
        subject: q.group.subject.name, groupName: q.group.name,
        status: q.status, durationMin: q.durationMin,
        open: win.ok && !a,
        closedReason: !win.ok && !a ? win.reason : null,
        done: !!a && a.status !== "IN_PROGRESS",
        score: a?.status === "GRADED" ? a.score : a?.status === "SUBMITTED" ? null : undefined,
        maxScore: a?.maxScore,
        pendingGrading: a?.status === "SUBMITTED",
      };
    }),
  });
});

export const POST = handler(async (req: Request) => {
  const student = await portalStudentOrThrow();
  rateLimit(`portal-quiz:${student.id}`, 20, 60_000);
  const body = await readJson<{ quizId?: string; answers?: { questionId?: string; answer?: string }[] }>(req);
  const quizId = String(body.quizId ?? "");
  if (!quizId) throw new ApiError("الكويز مش محدد.", 400);

  const quiz = await db.quiz.findFirst({
    where: { id: quizId, centerId: student.centerId },
    include: {
      questions: { orderBy: { order: "asc" } },
      group: { include: { students: { where: { studentId: student.id, status: "ACTIVE" }, select: { id: true } } } },
    },
  });
  if (!quiz || quiz.group.students.length === 0) throw new ApiError("الكويز ده مش متاح ليك.", 404);

  const existing = await db.quizAttempt.findUnique({
    where: { quizId_studentId: { quizId, studentId: student.id } },
  });
  if (existing && existing.status !== "IN_PROGRESS") {
    throw new ApiError("سلّمت الكويز ده خلاص.", 409);
  }

  const win = quizWindowOk(quiz);
  if (!win.ok && !existing) throw new ApiError(win.reason ?? "الكويز مش متاح.", 403);

  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .map((a) => ({ questionId: String(a.questionId ?? ""), answer: String(a.answer ?? "").trim().slice(0, 500) }))
    .filter((a) => a.questionId);

  const { score, maxScore, hasWritten } = autoGrade(quiz.questions, answers);

  const data = {
    answers: JSON.stringify(answers),
    submittedAt: new Date(),
    maxScore,
    // في أسئلة مكتوبة → SUBMITTED (بتتصحح يدوي) — غير كده GRADED فورًا
    status: hasWritten ? "SUBMITTED" : "GRADED",
    score: hasWritten ? null : score,
    gradedAt: hasWritten ? null : new Date(),
  };

  const attempt = existing
    ? await db.quizAttempt.update({ where: { id: existing.id }, data })
    : await db.quizAttempt.create({ data: { quizId, studentId: student.id, ...data } });

  return ok({
    attempt: {
      status: attempt.status,
      score: attempt.score,
      maxScore: attempt.maxScore,
      pendingGrading: attempt.status === "SUBMITTED",
    },
  });
});
