import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { normalizeQuestions, assertGroupInCenter } from "@/lib/quiz";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/quizzes — قائمة كويزات السنتر (اختياري ?groupId=)
 * POST /api/quizzes — إنشاء كويز جديد (DRAFT) بأسئلته
 */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId") ?? undefined;

  const quizzes = await db.quiz.findMany({
    where: { centerId: user.centerId, ...(groupId ? { groupId } : {}) },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      _count: { select: { questions: true, attempts: true } },
      attempts: { select: { score: true, maxScore: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return ok({
    quizzes: quizzes.map((q) => {
      const graded = q.attempts.filter((a) => a.score != null);
      const avg = graded.length
        ? Math.round(graded.reduce((s, a) => s + ((a.score ?? 0) / (a.maxScore || 1)) * 100, 0) / graded.length)
        : null;
      return {
        id: q.id, title: q.title, description: q.description, status: q.status,
        groupId: q.groupId, groupName: q.group.name, subject: q.group.subject.name,
        durationMin: q.durationMin, opensAt: q.opensAt, closesAt: q.closesAt,
        questionsCount: q._count.questions, attemptsCount: q._count.attempts,
        avgPct: avg, createdAt: q.createdAt, createdByName: q.createdByName,
      };
    }),
  });
});

type CreateBody = {
  groupId?: string;
  title?: string;
  description?: string;
  durationMin?: number;
  opensAt?: string | null;
  closesAt?: string | null;
  publish?: boolean;
  questions?: unknown;
};

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<CreateBody>(req);

  const groupId = String(body.groupId ?? "");
  const title = String(body.title ?? "").trim();
  if (!groupId) throw new ApiError("اختار المجموعة الأول.", 400);
  if (title.length < 3) throw new ApiError("عنوان الكويز محتاج 3 حروف على الأقل.", 400);
  await assertGroupInCenter(user.centerId, groupId);

  const questions = normalizeQuestions(body.questions);
  const durationMin = Number(body.durationMin) > 0 ? Math.round(Number(body.durationMin)) : null;

  const quiz = await db.quiz.create({
    data: {
      centerId: user.centerId,
      groupId,
      title,
      description: body.description ? String(body.description).trim() || null : null,
      status: body.publish ? "PUBLISHED" : "DRAFT",
      durationMin,
      opensAt: body.opensAt ? new Date(String(body.opensAt)) : null,
      closesAt: body.closesAt ? new Date(String(body.closesAt)) : null,
      createdById: user.id,
      createdByName: user.name,
      questions: { create: questions },
    },
    select: { id: true, title: true, status: true },
  });

  await logAudit({
    user,
    action: AUDIT.STUDENT_REGISTERED, // generic create action; label clarifies
    entity: "QUIZ",
    entityId: quiz.id,
    after: { title: quiz.title, questions: questions.length, status: quiz.status },
    reason: `إنشاء كويز — ${quiz.title}`,
  });

  return ok({ quiz });
});
