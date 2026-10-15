import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/sessions/[id]/exam — إعداد امتحان الحصة + الدرجات المسجلة.
 * بيقرأ من امتحان الحصة (امتحان واحد لكل حصة — تبسيط السنترز لنفس workflow المنصة الأساسية).
 */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;

  const session = await db.sessionInstance.findFirst({
    where: { id, centerId: user.centerId },
    select: { id: true, exam: { include: { scores: { select: { studentId: true, score: true, updatedAt: true } } } } },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);

  return ok({
    exam: session.exam ? { id: session.exam.id, title: session.exam.title, maxScore: session.exam.maxScore } : null,
    scores: session.exam?.scores.map((s) => ({ studentId: s.studentId, score: s.score })) ?? [],
  });
});

type ExamBody = {
  // ===== إنشاء/تعديل إعداد الامتحان =====
  title?: string;
  maxScore?: number;
  // ===== حفظ الدرجات دفعة واحدة (رصد المستخدم داخل الشبكة) =====
  scores?: { studentId: string; score: number | null }[]; // null = مسح الدرجة
};

/**
 * POST /api/sessions/[id]/exam — إعداد امتحان الحصة ورصد الدرجات.
 * • {title, maxScore} → إنشاء/تعديل الإعداد (تعديل الدرجة النهائية **مش** بيغير درجات الطلاب — زي المنصة الأساسية).
 * • {scores:[...]} → حفظ دفعة واحد. الغايب (مفيش صف حضور ليه) بيرفض — القاعدة: اللي امتحن هو اللي حضر.
 * الحصة المفتوحة: أي موظف. المقفولة: المدير أو EDIT_ATTENDANCE (إضافة امتحان لحصة منتهية مسموحة زي المنصة).
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;
  const body = await readJson<ExamBody>(req);

  const session = await db.sessionInstance.findFirst({ where: { id, centerId: user.centerId } });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status !== "OPEN" && !(user.role === "MANAGER" || hasPermission(user, "EDIT_ATTENDANCE"))) {
    throw new ApiError("الحصة مقفولة — رصد الامتحان للمدير أو صاحب صلاحية تعديل الحضور.", 403);
  }
  if (session.status === "CANCELLED") throw new ApiError("الحصة دي متلغاة.", 409);

  // ===== حفظ الدرجات =====
  if (Array.isArray(body.scores)) {
    const exam = await db.sessionExam.findUnique({ where: { sessionId: id } });
    if (!exam) throw new ApiError("مفيش امتحان مرتبط بالحصة دي — اعمل إعداد الامتحان الأول.", 400);

    const max = exam.maxScore;
    // صفوف الحضور المسموحة (الحاضرين بس — الطلاب الحقيقيين)
    const attendanceRows = await db.attendance.findMany({
      where: { sessionId: id, studentId: { not: null } },
      select: { studentId: true },
    });
    const allowed = new Set(attendanceRows.map((a) => a.studentId as string));

    const cleaned = body.scores.map((r) => {
      const studentId = String(r.studentId ?? "");
      if (!allowed.has(studentId)) throw new ApiError("فيه طالب مش مسجل حاضر في الحصة — الغايب مش بياخد درجة.", 400);
      if (r.score === null) return { studentId, score: null };
      const n = Number(r.score);
      if (!Number.isFinite(n) || n < 0) throw new ApiError("الدرجة لازم تكون رقم موجب.", 400);
      if (n > max) throw new ApiError(`الدرجة أكبر من النهائي (${max}).`, 400);
      return { studentId, score: Math.round(n * 100) / 100 };
    });

    await db.$transaction(async (tx) => {
      for (const r of cleaned) {
        if (r.score === null) {
          await tx.sessionExamScore.deleteMany({ where: { examId: exam.id, studentId: r.studentId } });
        } else {
          await tx.sessionExamScore.upsert({
            where: { examId_studentId: { examId: exam.id, studentId: r.studentId } },
            create: { examId: exam.id, studentId: r.studentId, score: r.score, updatedByName: user.name },
            update: { score: r.score, updatedByName: user.name },
          });
        }
      }
    });

    const scores = await db.sessionExamScore.findMany({
      where: { examId: exam.id },
      select: { studentId: true, score: true },
    });
    return ok({ saved: true, scores });
  }

  // ===== إنشاء/تعديل الإعداد =====
  const title = String(body.title ?? "").trim().slice(0, 120);
  const maxScore = Number(body.maxScore);
  if (!title) throw new ApiError("اكتب عنوان الامتحان.", 400);
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000) throw new ApiError("الدرجة النهائية غير صحيحة.", 400);

  const existing = await db.sessionExam.findUnique({ where: { sessionId: id } });
  if (existing) {
    // تعديل الدرجة النهائية مبيوازنش درجات الطلاب المخزنة (32 بتفضل 32) — نفس قاعدة المنصة الأساسية
    if (maxScore < existing.maxScore) {
      const over = await db.sessionExamScore.count({ where: { examId: existing.id, score: { gt: maxScore } } });
      if (over > 0) throw new ApiError(`فيه ${over} درجة أعلى من النهائي الجديد — صغّر الدرجات الأول.`, 400);
    }
    await db.sessionExam.update({ where: { id: existing.id }, data: { title, maxScore } });
  } else {
    await db.sessionExam.create({
      data: { centerId: user.centerId, sessionId: id, title, maxScore, createdByName: user.name },
    });
  }

  const exam = await db.sessionExam.findUnique({
    where: { sessionId: id },
    include: { scores: { select: { studentId: true, score: true } } },
  });
  return ok({
    exam: exam ? { id: exam.id, title: exam.title, maxScore: exam.maxScore } : null,
    scores: exam?.scores.map((s) => ({ studentId: s.studentId, score: s.score })) ?? [],
  });
});
