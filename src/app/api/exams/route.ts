import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { normalizeObjectiveQuestions } from "@/lib/exam";
import { assertGroupInCenter } from "@/lib/quiz";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams — قائمة امتحانات السنتر (اختياري ?groupId=)
 * POST /api/exams — إنشاء امتحان بإعداداته وأسئلته (DRAFT أو PUBLISHED)
 * الامتحان نظام صارم منفصل عن الكويزات — السيرفر هو مصدر الوقت والدرجة.
 */

const VIOLATION_TYPES = ["TAB_HIDDEN", "PAGE_LEFT", "FULLSCREEN_EXIT", "FOCUS_LOST", "ATTEMPT_INVALIDATED"];

export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId") ?? undefined;

  const exams = await db.exam.findMany({
    where: { centerId: user.centerId, ...(groupId ? { groupId } : {}) },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      _count: { select: { questions: true, attempts: true } },
      attempts: {
        select: { score: true, status: true, securityEvents: { where: { type: { in: VIOLATION_TYPES } }, select: { id: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return ok({
    exams: exams.map((e) => {
      const graded = e.attempts.filter((a) => a.score != null);
      const avg = graded.length
        ? Math.round(graded.reduce((s, a) => s + ((a.score ?? 0) / (e.maxScore || 1)) * 100, 0) / graded.length)
        : null;
      const securityFlags = e.attempts.reduce((s, a) => s + a.securityEvents.length, 0);
      return {
        id: e.id, title: e.title, instructions: e.instructions, status: e.status,
        groupId: e.groupId, groupName: e.group.name, subject: e.group.subject.name,
        startAt: e.startAt, endAt: e.endAt, durationMin: e.durationMin,
        maxScore: e.maxScore, attemptsAllowed: e.attemptsAllowed,
        shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions,
        allowAnswerEdit: e.allowAnswerEdit, securityMode: e.securityMode,
        reviewVideoUrl: e.reviewVideoUrl,
        questionsCount: e._count.questions, attemptsCount: e._count.attempts,
        avgPct: avg, securityFlags,
        createdAt: e.createdAt, createdByName: e.createdByName,
      };
    }),
  });
});

type CreateBody = {
  groupId?: string;
  title?: string;
  instructions?: string;
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  attemptsAllowed?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  allowAnswerEdit?: boolean;
  securityMode?: string;
  reviewVideoUrl?: string;
  publish?: boolean;
  questions?: unknown;
};

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<CreateBody>(req);

  const groupId = String(body.groupId ?? "");
  const title = String(body.title ?? "").trim();
  if (!groupId) throw new ApiError("اختار المجموعة الأول.", 400);
  if (title.length < 3) throw new ApiError("عنوان الامتحان محتاج 3 حروف على الأقل.", 400);
  await assertGroupInCenter(user.centerId, groupId);

  const startAt = body.startAt ? new Date(String(body.startAt)) : null;
  const endAt = body.endAt ? new Date(String(body.endAt)) : null;
  if (!startAt || isNaN(startAt.getTime())) throw new ApiError("حدد وقت بداية الامتحان.", 400);
  if (!endAt || isNaN(endAt.getTime())) throw new ApiError("حدد وقت نهاية الامتحان.", 400);
  if (endAt <= startAt) throw new ApiError("نهاية الامتحان لازم تكون بعد بدايته.", 400);

  const durationMin = Math.round(Number(body.durationMin));
  if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 300) {
    throw new ApiError("مدة الامتحان لازم تكون بين 1 و 300 دقيقة.", 400);
  }

  const attemptsAllowed = Math.max(1, Math.min(3, Math.round(Number(body.attemptsAllowed) || 1)));
  const securityMode = body.securityMode === "STRICT" ? "STRICT" : "WARNING";
  const questions = normalizeObjectiveQuestions(body.questions, "الامتحان");
  const maxScore = questions.reduce((s, q) => s + q.points, 0);

  const reviewVideoUrl = body.reviewVideoUrl ? String(body.reviewVideoUrl).trim() || null : null;
  if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
    throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
  }

  const exam = await db.exam.create({
    data: {
      centerId: user.centerId,
      groupId,
      title,
      instructions: body.instructions ? String(body.instructions).trim() || null : null,
      status: body.publish ? "PUBLISHED" : "DRAFT",
      startAt, endAt, durationMin,
      maxScore, attemptsAllowed,
      shuffleQuestions: !!body.shuffleQuestions,
      shuffleOptions: !!body.shuffleOptions,
      allowAnswerEdit: body.allowAnswerEdit !== false,
      securityMode,
      reviewVideoUrl,
      createdById: user.id,
      createdByName: user.name,
      questions: { create: questions },
    },
    select: { id: true, title: true, status: true },
  });

  await logAudit({
    user,
    action: AUDIT.EXAM_CREATED,
    entity: "EXAM",
    entityId: exam.id,
    after: { title: exam.title, questions: questions.length, maxScore, status: exam.status, securityMode },
  });

  return ok({ exam });
});
