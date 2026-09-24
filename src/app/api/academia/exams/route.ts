import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaPerm, assertGroupAccess, assertStudentAccess } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/exams?groupId= — exams with results summary (grades view) */
async function GET_impl(req: NextRequest) {
  const user = await requireAca();
  const groupId = req.nextUrl.searchParams.get("groupId");

  if (user.role === "STUDENT") {
    const profileId = user.studentProfileId;
    const results = await db.acaExamResult.findMany({
      where: { studentId: profileId ?? "none" },
      include: { exam: { select: { id: true, title: true, type: true, date: true, maxScore: true, subject: { select: { name: true, color: true } }, group: { select: { name: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ exams: results.map((r) => ({ ...r.exam, myScore: r.score, myNote: r.note })) });
  }

  if (user.role === "TEACHER") {
    const teacherGroups = user.teacherGroupIds ?? [];
    if (groupId && !teacherGroups.includes(groupId)) throw new ApiError("دي مش مجموعتك.", 403);
    const exams = await db.acaExam.findMany({
      where: { groupId: groupId ? groupId : { in: teacherGroups } },
      include: { subject: { select: { name: true, color: true } }, group: { select: { name: true } }, results: { select: { score: true } } },
      orderBy: { date: "desc" },
      take: 100,
    });
    return NextResponse.json({ exams: exams.map((e) => ({ id: e.id, title: e.title, type: e.type, date: e.date, maxScore: e.maxScore, subject: e.subject, group: e.group, graded: e.results.filter((r) => r.score != null).length })) });
  }

  const exams = await db.acaExam.findMany({
    where: groupId ? { groupId } : {},
    include: { subject: { select: { name: true, color: true } }, group: { select: { name: true } }, results: { select: { score: true } } },
    orderBy: { date: "desc" },
    take: 100,
  });
  return NextResponse.json({ exams: exams.map((e) => ({ id: e.id, title: e.title, type: e.type, date: e.date, maxScore: e.maxScore, subject: e.subject, group: e.group, graded: e.results.filter((r) => r.score != null).length })) });
}

/** POST /api/academia/exams — create exam OR bulk-set results (grades.edit, audited) */
async function POST_impl(req: NextRequest) {
  const user = await requireAca();
  const body = await req.json().catch(() => null);
  if (!body?.action) throw new ApiError("البيانات ناقصة.", 400);

  if (body.action === "create") {
    if (!user.permissions.includes("exams.manage")) throw new ApiError("مالكش صلاحية إنشاء الامتحانات.", 403);
    const { groupId, title, type, date, maxScore, topicId, termId } = body;
    if (!groupId || !title?.trim() || !date) throw new ApiError("اختار المجموعة واكتب العنوان والتاريخ.", 400);
    const g = await assertGroupAccess(user, groupId);
    const max = Number(maxScore) > 0 ? Math.round(Number(maxScore)) : 100;
    const exam = await db.acaExam.create({
      data: { groupId, subjectId: g.subjectId, title: title.trim(), type: type || "QUIZ", date, maxScore: max, topicId: topicId || null, termId: termId || null, createdBy: user.id },
    });
    await logAudit({ user, action: "إنشاء امتحان", entity: "ACA_EXAM", entityId: exam.id, after: { title: exam.title, date, maxScore: max } });
    return NextResponse.json({ exam: { id: exam.id } }, { status: 201 });
  }

  if (body.action === "results") {
    if (!user.permissions.includes("grades.edit")) throw new ApiError("مالكش صلاحية رصد الدرجات.", 403);
    const { examId, results } = body; // results: [{studentId, score|null, note?}]
    if (!examId || !Array.isArray(results)) throw new ApiError("بيانات الدرجات ناقصة.", 400);
    const exam = await db.acaExam.findUnique({ where: { id: examId } });
    if (!exam) throw new ApiError("الامتحان ده مش موجود.", 404);
    await assertGroupAccess(user, exam.groupId);
    let changed = 0;
    type ResultInput = { studentId: string; score?: number | string | null; note?: string };
    for (const r of results as ResultInput[]) {
      await assertStudentAccess(user, r.studentId);
      const score = r.score === null || r.score === "" ? null : Number(r.score);
      if (score != null && (Number.isNaN(score) || score < 0 || score > exam.maxScore)) {
        throw new ApiError(`درجة بره النطاق (0 - ${exam.maxScore}).`, 400);
      }
      const before = await db.acaExamResult.findUnique({ where: { examId_studentId: { examId, studentId: r.studentId } } });
      await db.acaExamResult.upsert({
        where: { examId_studentId: { examId, studentId: r.studentId } },
        create: { examId, studentId: r.studentId, score, note: r.note || null, enteredById: user.id },
        update: { score, note: r.note || null, enteredById: user.id },
      });
      if (before && before.score !== score) {
        changed += 1;
        await logAudit({ user, action: "تعديل درجة", entity: "ACA_EXAM_RESULT", entityId: `${examId}:${r.studentId}`, before: { score: before.score }, after: { score } });
      } else if (!before && score != null) {
        changed += 1;
        await logAudit({ user, action: "رصد درجة", entity: "ACA_EXAM_RESULT", entityId: `${examId}:${r.studentId}`, after: { score } });
      }
    }
    // contextual notification: exam results published → notify students with new scores (spec §28)
    const withScore = (results as ResultInput[]).filter((r) => r.score !== null && r.score !== "" && r.score !== undefined);
    if (withScore.length) {
      const students = await db.acaStudentProfile.findMany({ where: { id: { in: withScore.map((r: { studentId: string }) => r.studentId) } }, select: { id: true, userId: true } });
      const userMap = new Map(students.map((s) => [s.id, s.userId]));
      await db.acaNotification.createMany({
        data: withScore
          .filter((r) => userMap.has(r.studentId))
          .map((r) => ({
            userId: userMap.get(r.studentId)!, type: "EXAM_RESULT",
            title: "نتيجة امتحان",
            body: `درجتك في "${exam.title}": ${r.score} من ${exam.maxScore}.`,
            data: JSON.stringify({ examId }),
          })),
      });
    }
    return NextResponse.json({ ok: true, changed });
  }

  throw new ApiError("عملية مش معروفة.", 400);
}

/** GET results for one exam (grades view/edit) */
async function PUT_impl(req: NextRequest) {
  const user = await requireAca();
  const body = await req.json().catch(() => null);
  const { examId } = body ?? {};
  if (!examId) throw new ApiError("بيانات ناقصة.", 400);
  const exam = await db.acaExam.findUnique({ where: { id: examId } });
  if (!exam) throw new ApiError("الامتحان ده مش موجود.", 404);
  await assertGroupAccess(user, exam.groupId);
  const [results, roster] = await Promise.all([
    db.acaExamResult.findMany({ where: { examId } }),
    db.acaEnrollment.findMany({ where: { groupId: exam.groupId, status: "ACTIVE" }, include: { student: { select: { id: true, code: true, user: { select: { name: true } } } } }, orderBy: { student: { code: "asc" } } }),
  ]);
  return NextResponse.json({
    exam: { id: exam.id, title: exam.title, type: exam.type, date: exam.date, maxScore: exam.maxScore },
    roster: roster.map((e) => ({ profileId: e.student.id, code: e.student.code, name: e.student.user.name })),
    results: results.map((r) => ({ studentId: r.studentId, score: r.score, note: r.note })),
  });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
export const PUT = acaHandler(PUT_impl);
