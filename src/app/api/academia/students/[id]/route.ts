import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, assertStudentAccess } from "@/lib/academia/guard";
import { acaHandler } from "@/lib/academia/handler";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/academia/students/[id] — ONE coherent academic profile (spec §7):
 * identity, groups/subjects/teachers, schedule, attendance, homework,
 * exams/grades, performance, strengths/weaknesses, curriculum progress,
 * academic history. */
async function GET_impl(_req: NextRequest, ctx: Ctx) {
  const user = await requireAca();
  const { id } = await ctx.params;
  await assertStudentAccess(user, id);

  const profile = await db.acaStudentProfile.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, username: true, isActive: true, createdAt: true } },
      enrollments: {
        include: {
          group: {
            select: {
              id: true, name: true, gradeName: true, room: true, isActive: true,
              subject: { select: { id: true, name: true, color: true } },
              teacher: { select: { id: true, name: true } },
              schedules: { where: { status: "ACTIVE" }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
            },
          },
        },
      },
    },
  });
  if (!profile) throw new ApiError("الطالب ده مش موجود.", 404);

  const groupIds = profile.enrollments.filter((e) => e.status === "ACTIVE").map((e) => e.groupId);

  const [attendance, homework, examResults, sessionsCount] = await Promise.all([
    db.acaAttendance.findMany({ where: { studentId: id, session: { groupId: { in: groupIds } } }, include: { session: { select: { id: true, date: true, startTime: true, group: { select: { name: true, subject: { select: { name: true, color: true } } } } } } }, orderBy: { markedAt: "desc" }, take: 100 }),
    db.acaHomeworkRecord.findMany({ where: { studentId: id, session: { groupId: { in: groupIds } } }, include: { session: { select: { id: true, date: true, group: { select: { name: true, subject: { select: { name: true } } } } } } }, orderBy: { updatedAt: "desc" }, take: 60 }),
    db.acaExamResult.findMany({ where: { studentId: id, exam: { groupId: { in: groupIds } } }, include: { exam: { select: { id: true, title: true, type: true, date: true, maxScore: true, subject: { select: { name: true, color: true } }, topic: { select: { title: true } } } } }, orderBy: { updatedAt: "desc" }, take: 60 }),
    db.acaSession.count({ where: { groupId: { in: groupIds }, status: { in: ["COMPLETED", "STARTED", "IN_PROGRESS"] } } }),
  ]);

  // ---- aggregates ----
  const attTotal = attendance.length;
  const attPresent = attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const attRate = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : null;

  const hwDone = homework.filter((h) => h.completed);
  const hwRate = homework.length > 0 ? Math.round((hwDone.length / homework.length) * 100) : null;
  const hwScoreSum = hwDone.reduce((s, h) => s + (h.score ?? 0), 0);

  // per-subject grade averages
  const bySubject = new Map<string, { name: string; color: string; scores: number; max: number; count: number }>();
  for (const r of examResults) {
    if (r.score == null) continue;
    const key = r.exam.subject.name;
    const cur = bySubject.get(key) ?? { name: r.exam.subject.name, color: r.exam.subject.color, scores: 0, max: 0, count: 0 };
    cur.scores += r.score; cur.max += r.exam.maxScore; cur.count += 1;
    bySubject.set(key, cur);
  }
  const subjectsPerf = [...bySubject.values()].map((s) => ({
    name: s.name, color: s.color, count: s.count,
    avg: s.max > 0 ? Math.round((s.scores / s.max) * 100) : null,
  }));

  // strengths (≥85%) & weaknesses (<60%) from per-subject averages (≥2 assessments)
  const strengths = subjectsPerf.filter((s) => s.avg != null && s.avg >= 85 && s.count >= 2);
  const weaknesses = subjectsPerf.filter((s) => s.avg != null && s.avg < 60 && s.count >= 2);

  // curriculum progress: completed sessions per subject vs curriculum lessons count
  const subjectIds = [...new Set(profile.enrollments.filter((e) => e.status === "ACTIVE").map((e) => e.group.subject.id))];
  const units = await db.acaUnit.findMany({ where: { subjectId: { in: subjectIds } }, include: { topics: { include: { lessons: true } } } });
  const progress = profile.enrollments.filter((e) => e.status === "ACTIVE").map((e) => {
    const subjUnits = units.filter((u) => u.subjectId === e.group.subject.id);
    const totalLessons = subjUnits.reduce((s, u) => s + u.topics.reduce((s2, t) => s2 + t.lessons.length, 0), 0);
    const subjSessions = attendance.filter((a) => a.session.group.subject.name === e.group.subject.name).length;
    return {
      groupId: e.group.id, subject: e.group.subject.name, color: e.group.subject.color,
      totalLessons, attendedSessions: subjSessions,
      pct: totalLessons > 0 ? Math.min(100, Math.round((subjSessions / Math.max(totalLessons, 1)) * 100)) : null,
    };
  });

  return NextResponse.json({
    student: {
      profileId: profile.id, code: profile.code, name: profile.user.name,
      username: profile.user.username, gradeName: profile.gradeName,
      parentName: profile.parentName, parentPhone: profile.parentPhone,
      notes: profile.notes, since: profile.user.createdAt, isActive: profile.user.isActive,
    },
    groups: profile.enrollments.filter((e) => e.status !== "LEFT").map((e) => ({
      id: e.group.id, name: e.group.name, status: e.status,
      subject: e.group.subject, teacher: e.group.teacher,
      schedules: e.group.schedules,
    })),
    stats: { attendanceRate: attRate, attendanceTotal: attTotal, homeworkRate: hwRate, homeworkDone: hwDone.length, homeworkTotal: homework.length, homeworkPoints: hwScoreSum, sessionsTotal: sessionsCount },
    subjectsPerf, strengths, weaknesses, progress,
    recent: {
      attendance: attendance.slice(0, 30),
      homework: homework.slice(0, 20),
      exams: examResults.slice(0, 30),
    },
  });
}

export const GET = acaHandler(GET_impl);
