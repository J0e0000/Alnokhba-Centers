import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { getPortalTeacher } from "@/lib/teacher-auth";
import { normalizeObjectiveQuestions } from "@/lib/exam";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * بورتال المدرس — الامتحانات
 * المدرس بيعمل ويدير امتحانات مجموعاته هو بس — كل حاجة متحققة على السيرفر.
 * GET            — امتحانات مجموعاتي + إحصائياتها
 * GET ?id=       — تفاصيل امتحان (بالأسئلة + المحاولات) بشرط يكون لمجموعة من مجموعاتي
 * POST           — إنشاء امتحان (DRAFT أو PUBLISHED)
 * PATCH {id,...} — publish | close | reopen | update
 * DELETE ?id=    — مسح مسودة من غير محاولات بس
 */

async function requireTeacher() {
  const teacher = await getPortalTeacher();
  if (!teacher) throw new ApiError("سجل دخولك الأول.", 401);
  return teacher;
}

async function myGroupIds(teacherId: string): Promise<string[]> {
  const gs = await db.group.findMany({
    where: { teacherId, isActive: true },
    select: { id: true },
  });
  return gs.map((g) => g.id);
}

/** الامتحان لازم يكون لمجموعة من مجموعات المدرس وفي نفس السنتر */
async function myExam(teacher: { id: string; centerId: string }, id: string) {
  const ids = await myGroupIds(teacher.id);
  const exam = await db.exam.findFirst({
    where: { id, centerId: teacher.centerId, groupId: { in: ids } },
    include: {
      group: { select: { name: true, subject: { select: { name: true } } } },
      questions: { orderBy: { order: "asc" } },
      attempts: {
        include: {
          student: { select: { id: true, name: true, code: true } },
          securityEvents: { where: { type: { in: VIOLATION_TYPES } }, select: { id: true, type: true } },
        },
        orderBy: { startedAt: "desc" },
      },
    },
  });
  if (!exam) throw new ApiError("الامتحان ده مش من امتحانات مجموعاتك.", 404);
  return exam;
}

const VIOLATION_TYPES = ["TAB_HIDDEN", "PAGE_LEFT", "FULLSCREEN_EXIT", "FOCUS_LOST", "ATTEMPT_INVALIDATED"];

/** تدقيق باسم المدرس — userId بيتخزن null (مفيش صف موظف) والاسم بيوثّق مين */
function teacherAudit(teacher: { name: string; centerId: string }) {
  return { id: "anonymous", name: `مدرس: ${teacher.name}`, centerId: teacher.centerId };
}

export const GET = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  // ===== تفاصيل امتحان =====
  if (id) {
    const exam = await myExam(teacher, id);
    return ok({
      exam: {
        id: exam.id, title: exam.title, instructions: exam.instructions, status: exam.status,
        groupId: exam.groupId, groupName: exam.group.name, subject: exam.group.subject.name,
        startAt: exam.startAt, endAt: exam.endAt, durationMin: exam.durationMin,
        maxScore: exam.maxScore, attemptsAllowed: exam.attemptsAllowed,
        shuffleQuestions: exam.shuffleQuestions, shuffleOptions: exam.shuffleOptions,
        allowAnswerEdit: exam.allowAnswerEdit, securityMode: exam.securityMode,
        reviewVideoUrl: exam.reviewVideoUrl,
        questions: exam.questions.map((q) => ({
          id: q.id, order: q.order, text: q.text, type: q.type, options: q.options,
          correctAnswer: q.correctAnswer, points: q.points, // المدرس صاحب الامتحان — يشوف الإجابات
        })),
        attempts: exam.attempts.map((a) => ({
          id: a.id, studentName: a.student.name, studentCode: a.student.code,
          status: a.status, score: a.score, maxScore: exam.maxScore,
          startedAt: a.startedAt, submittedAt: a.submittedAt,
          securityFlags: a.securityEvents.length,
        })),
        attemptsCount: exam.attempts.length,
      },
    });
  }

  // ===== قائمة امتحانات مجموعاتي =====
  const [ids, groups] = await Promise.all([
    myGroupIds(teacher.id),
    db.group.findMany({
      where: { teacherId: teacher.id, isActive: true },
      select: { id: true, name: true, subject: { select: { name: true } }, grade: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const exams = ids.length
    ? await db.exam.findMany({
        where: { centerId: teacher.centerId, groupId: { in: ids } },
        include: {
          group: { select: { name: true, subject: { select: { name: true } } } },
          _count: { select: { questions: true, attempts: true } },
          attempts: {
            select: { score: true, status: true, securityEvents: { where: { type: { in: VIOLATION_TYPES } }, select: { id: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return ok({
    teacher: { name: teacher.name, center: teacher.center },
    groups: groups.map((g) => ({ id: g.id, name: g.name, subject: g.subject.name, grade: g.grade.name })),
    exams: exams.map((e) => {
      const graded = e.attempts.filter((a) => a.score != null);
      const avg = graded.length
        ? Math.round(graded.reduce((s, a) => s + ((a.score ?? 0) / (e.maxScore || 1)) * 100, 0) / graded.length)
        : null;
      return {
        id: e.id, title: e.title, instructions: e.instructions, status: e.status,
        groupId: e.groupId, groupName: e.group.name, subject: e.group.subject.name,
        startAt: e.startAt, endAt: e.endAt, durationMin: e.durationMin,
        maxScore: e.maxScore, attemptsAllowed: e.attemptsAllowed,
        shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions,
        allowAnswerEdit: e.allowAnswerEdit, securityMode: e.securityMode,
        reviewVideoUrl: e.reviewVideoUrl,
        questionsCount: e._count.questions, attemptsCount: e._count.attempts,
        avgPct: avg,
        securityFlags: e.attempts.reduce((s, a) => s + a.securityEvents.length, 0),
        createdAt: e.createdAt, createdByName: e.createdByName,
      };
    }),
  });
});

type ExamBody = {
  id?: string;
  action?: string;
  groupId?: string;
  title?: string;
  instructions?: string;
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  allowAnswerEdit?: boolean;
  securityMode?: string;
  reviewVideoUrl?: string;
  publish?: boolean;
  questions?: unknown;
};

export const POST = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  rateLimit(`teacher-exam:${teacher.id}`, 30, 60_000);
  const body = await readJson<ExamBody>(req);

  const groupId = String(body.groupId ?? "");
  const title = String(body.title ?? "").trim();
  if (!groupId) throw new ApiError("اختار المجموعة الأول.", 400);
  if (title.length < 3) throw new ApiError("عنوان الامتحان محتاج 3 حروف على الأقل.", 400);

  // المدرس بيعمل امتحان لمجموعته هو بس
  const ids = await myGroupIds(teacher.id);
  if (!ids.includes(groupId)) throw new ApiError("المجموعة دي مش من مجموعاتك.", 403);

  const startAt = body.startAt ? new Date(String(body.startAt)) : null;
  const endAt = body.endAt ? new Date(String(body.endAt)) : null;
  if (!startAt || isNaN(startAt.getTime())) throw new ApiError("حدد وقت بداية الامتحان.", 400);
  if (!endAt || isNaN(endAt.getTime())) throw new ApiError("حدد وقت نهاية الامتحان.", 400);
  if (endAt <= startAt) throw new ApiError("نهاية الامتحان لازم تكون بعد بدايته.", 400);

  const durationMin = Math.round(Number(body.durationMin));
  if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 300) {
    throw new ApiError("مدة الامتحان لازم تكون بين 1 و 300 دقيقة.", 400);
  }

  const securityMode = body.securityMode === "STRICT" ? "STRICT" : "WARNING";
  const questions = normalizeObjectiveQuestions(body.questions, "الامتحان");
  const maxScore = questions.reduce((s, q) => s + q.points, 0);

  const reviewVideoUrl = body.reviewVideoUrl ? String(body.reviewVideoUrl).trim() || null : null;
  if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
    throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
  }

  const exam = await db.exam.create({
    data: {
      centerId: teacher.centerId,
      groupId,
      title,
      instructions: body.instructions ? String(body.instructions).trim() || null : null,
      status: body.publish ? "PUBLISHED" : "DRAFT",
      startAt, endAt, durationMin,
      maxScore, attemptsAllowed: 1,
      shuffleQuestions: !!body.shuffleQuestions,
      shuffleOptions: !!body.shuffleOptions,
      allowAnswerEdit: body.allowAnswerEdit !== false,
      securityMode,
      reviewVideoUrl,
      createdById: teacher.id,
      createdByName: teacher.name,
      questions: { create: questions },
    },
    select: { id: true, title: true, status: true },
  });

  await logAudit({
    user: teacherAudit(teacher),
    action: AUDIT.EXAM_CREATED,
    entity: "EXAM",
    entityId: exam.id,
    after: { title: exam.title, questions: questions.length, maxScore, status: exam.status, by: "teacher-portal" },
  });

  return ok({ exam });
});

export const PATCH = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  rateLimit(`teacher-exam:${teacher.id}`, 30, 60_000);
  const body = await readJson<ExamBody>(req);
  const exam = await myExam(teacher, String(body.id ?? ""));
  const action = String(body.action ?? "");

  // ===== نشر / قفل / إعادة =====
  if (action === "publish" || action === "close" || action === "reopen") {
    if (action === "publish") {
      if (exam.status === "PUBLISHED") throw new ApiError("الامتحان منشور بالفعل.", 400);
      if (exam.questions.length === 0) throw new ApiError("الامتحان محتاج أسئلة قبل النشر.", 400);
      await db.exam.update({ where: { id: exam.id }, data: { status: "PUBLISHED" } });
    } else if (action === "close") {
      if (exam.status !== "PUBLISHED") throw new ApiError("الامتحان مش منشور أصلاً.", 400);
      await db.exam.update({ where: { id: exam.id }, data: { status: "CLOSED" } });
      // قفل المحاولات الشغالة فورًا (تصحيح أوتوماتيك) — زي السيرفر بالظبط
      const { gradeObjectiveAttempt } = await import("@/lib/exam");
      const live = exam.attempts.filter((a) => a.status === "IN_PROGRESS");
      for (const a of live) {
        const answers = await db.examAnswer.findMany({ where: { attemptId: a.id } });
        const { score } = gradeObjectiveAttempt(exam.questions, answers, a.optionOrder ? JSON.parse(a.optionOrder) : null);
        await db.examAttempt.update({
          where: { id: a.id },
          data: { status: "AUTO_SUBMITTED", submittedAt: new Date(), score },
        });
        await db.examSecurityEvent.create({
          data: { centerId: teacher.centerId, attemptId: a.id, studentId: a.studentId, type: "EXAM_AUTO_SUBMITTED", meta: JSON.stringify({ reason: "closed_by_teacher" }) },
        }).catch(() => {});
      }
    } else {
      if (exam.status !== "CLOSED") throw new ApiError("الامتحان مش مقفول.", 400);
      await db.exam.update({ where: { id: exam.id }, data: { status: "PUBLISHED" } });
    }
    await logAudit({
      user: teacherAudit(teacher), entity: "EXAM", entityId: exam.id,
      action: action === "publish" ? AUDIT.EXAM_PUBLISHED : action === "close" ? AUDIT.EXAM_CLOSED : AUDIT.EXAM_UPDATED,
      after: { status: action === "close" ? "CLOSED" : "PUBLISHED", by: "teacher-portal" },
    });
    return ok({ ok: true });
  }

  // ===== تعديل =====
  if (action === "update") {
    if (exam.status === "CLOSED") throw new ApiError("الامتحان مقفول — مينفعش يتعدل.", 400);
    const hasAttempts = exam.attempts.length > 0;
    const questions = body.questions !== undefined ? normalizeObjectiveQuestions(body.questions, "الامتحان") : null;

    const startAt = body.startAt ? new Date(String(body.startAt)) : exam.startAt;
    const endAt = body.endAt ? new Date(String(body.endAt)) : exam.endAt;
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new ApiError("نافذة الامتحان مش مظبوطة.", 400);
    }
    const maxExpires = exam.attempts.filter((a) => a.status === "IN_PROGRESS").reduce((m, a) => (a.expiresAt > m ? a.expiresAt : m), new Date(0));
    if (endAt < maxExpires) throw new ApiError("في محاولات شغالة تمتد بعد النهاية الجديدة — اقفلها الأول.", 400);

    const durationMin = body.durationMin !== undefined ? Math.round(Number(body.durationMin)) : exam.durationMin;
    if (!Number.isFinite(durationMin) || durationMin < 1 || durationMin > 300) {
      throw new ApiError("مدة الامتحان لازم تكون بين 1 و 300 دقيقة.", 400);
    }
    if (hasAttempts && questions) {
      throw new ApiError("مينفعش تعدل الأسئلة بعد بدء المحاولات.", 400);
    }
    const reviewVideoUrl = body.reviewVideoUrl !== undefined
      ? (String(body.reviewVideoUrl ?? "").trim() || null)
      : exam.reviewVideoUrl;
    if (reviewVideoUrl && !/^https?:\/\//i.test(reviewVideoUrl)) {
      throw new ApiError("رابط فيديو المراجعة لازم يبدأ بـ http(s).", 400);
    }

    const data: Record<string, unknown> = {
      title: body.title !== undefined ? String(body.title).trim() || exam.title : exam.title,
      instructions: body.instructions !== undefined ? (String(body.instructions ?? "").trim() || null) : exam.instructions,
      startAt, endAt, durationMin,
      shuffleQuestions: body.shuffleQuestions !== undefined ? !!body.shuffleQuestions : exam.shuffleQuestions,
      shuffleOptions: body.shuffleOptions !== undefined ? !!body.shuffleOptions : exam.shuffleOptions,
      allowAnswerEdit: body.allowAnswerEdit !== undefined ? !!body.allowAnswerEdit : exam.allowAnswerEdit,
      securityMode: body.securityMode !== undefined ? (body.securityMode === "STRICT" ? "STRICT" : "WARNING") : exam.securityMode,
      reviewVideoUrl,
    };
    if (questions) {
      data.maxScore = questions.reduce((s, q) => s + q.points, 0);
      data.questions = { deleteMany: {}, create: questions };
    }

    await db.exam.update({ where: { id: exam.id }, data });
    await logAudit({
      user: teacherAudit(teacher), action: AUDIT.EXAM_UPDATED, entity: "EXAM", entityId: exam.id,
      after: { title: data.title, by: "teacher-portal" },
    });
    return ok({ ok: true });
  }

  throw new ApiError("إجراء غير معروف.", 400);
});

export const DELETE = handler(async (req: Request) => {
  const teacher = await requireTeacher();
  const url = new URL(req.url);
  const exam = await myExam(teacher, url.searchParams.get("id") ?? "");
  if (exam.status !== "DRAFT") throw new ApiError("بتمسح المسودات بس — امتحان منشور اقفله الأول.", 400);
  if (exam.attempts.length > 0) throw new ApiError("في محاولات على الامتحان ده — مينفعش يمسح.", 400);
  await db.exam.delete({ where: { id: exam.id } });
  await logAudit({
    user: teacherAudit(teacher), action: AUDIT.EXAM_UPDATED, entity: "EXAM", entityId: exam.id,
    after: { deleted: true, by: "teacher-portal" },
  });
  return ok({ ok: true });
});
