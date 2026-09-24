import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { todayStr, addDays } from "@/lib/academia/dates";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/reports?from=&to= — analytics foundation (spec §31):
 * attendance per group, grade averages per subject, session counts,
 * financial visibility perm-gated. */
async function GET_impl(req: NextRequest) {
  const user = await requireAca();
  if (!user.permissions.includes("reports.view")) throw new ApiError("مالكش صلاحية التقارير.", 403);
  const today = todayStr();
  const from = req.nextUrl.searchParams.get("from") || addDays(today, -28);
  const to = req.nextUrl.searchParams.get("to") || today;

  const sessions = await db.acaSession.findMany({
    where: { date: { gte: from, lte: to }, status: { in: ["COMPLETED", "STARTED", "IN_PROGRESS"] }, ...(user.role === "TEACHER" ? { group: { teacherId: user.id } } : {}) },
    include: { group: { select: { id: true, name: true, subject: { select: { id: true, name: true, color: true } }, teacher: { select: { name: true } } } } },
  });

  const groupMap = new Map<string, { name: string; subject: { name: string; color: string }; teacher: string; sessions: number; marked: number; present: number }>();
  for (const s of sessions) {
    const key = s.groupId;
    const cur = groupMap.get(key) ?? { name: s.group.name, subject: s.group.subject, teacher: s.group.teacher.name, sessions: 0, marked: 0, present: 0 };
    cur.sessions += 1;
    groupMap.set(key, cur);
  }
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length) {
    const marks = await db.acaAttendance.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, status: true } });
    for (const m of marks) {
      const sid = sessions.find((s) => s.id === m.sessionId)?.groupId;
      if (!sid) continue;
      const g = groupMap.get(sid);
      if (g) { g.marked += 1; if (m.status === "PRESENT" || m.status === "LATE") g.present += 1; }
    }
  }

  // grades per subject in window
  const exams = await db.acaExam.findMany({
    where: { date: { gte: from, lte: to }, ...(user.role === "TEACHER" ? { group: { teacherId: user.id } } : {}) },
    include: { subject: { select: { name: true, color: true } }, results: { where: { score: { not: null } }, select: { score: true } } },
  });
  const subjMap = new Map<string, { name: string; color: string; exams: number; scoreSum: number; maxSum: number }>();
  for (const e of exams) {
    const cur = subjMap.get(e.subject.name) ?? { name: e.subject.name, color: e.subject.color, exams: 0, scoreSum: 0, maxSum: 0 };
    cur.exams += 1;
    for (const r of e.results) { cur.scoreSum += r.score ?? 0; cur.maxSum += e.maxScore; }
    subjMap.set(e.subject.name, cur);
  }

  // financial visibility (perm-gated, spec §25)
  let financial: { enabled: boolean; pricedGroups: { name: string; price: number; enrolled: number; expectedMonthly: number }[] } | null = null;
  if (user.permissions.includes("financial.view")) {
    const groups = await db.acaGroup.findMany({
      where: { pricePerSession: { not: null }, ...(user.role === "TEACHER" ? { teacherId: user.id } : {}) },
      include: { _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
    });
    financial = {
      enabled: true,
      pricedGroups: groups.map((g) => ({
        name: g.name, price: g.pricePerSession ?? 0, enrolled: g._count.enrollments,
        expectedMonthly: (g.pricePerSession ?? 0) * g._count.enrollments * 8, // ~8 sessions/month
      })),
    };
  }

  return NextResponse.json({
    window: { from, to },
    groups: [...groupMap.values()].map((g) => ({ ...g, attendanceRate: g.marked > 0 ? Math.round((g.present / g.marked) * 100) : null })),
    subjects: [...subjMap.values()].map((s) => ({ ...s, avg: s.maxSum > 0 ? Math.round((s.scoreSum / s.maxSum) * 100) : null })),
    financial,
    totals: { sessions: sessions.length, groups: groupMap.size },
  });
}

export const GET = acaHandler(GET_impl);
