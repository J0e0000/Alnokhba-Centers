import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAcaStaff } from "@/lib/academia/guard";
import { todayStr, addDays } from "@/lib/academia/dates";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/dashboard — "What needs my attention right now?" (spec §26) */
async function GET_impl() {
  const user = await requireAcaStaff();
  const today = todayStr();

  const [pendingRequests, todaySessions, completedToday, upcomingExams, atRiskGroups] = await Promise.all([
    db.acaRequest.count({ where: { status: "PENDING" } }),
    db.acaSession.findMany({
      where: { date: today, status: { not: "CANCELLED" }, ...(user.role === "TEACHER" ? { teacherId: user.id } : {}) },
      include: { group: { select: { name: true, subject: { select: { name: true, color: true } } } } },
      orderBy: { startTime: "asc" },
    }),
    db.acaSession.count({ where: { date: today, status: "COMPLETED", ...(user.role === "TEACHER" ? { teacherId: user.id } : {}) } }),
    db.acaExam.findMany({
      where: { date: { gte: today, lte: addDays(today, 7) }, ...(user.role === "TEACHER" ? { group: { teacherId: user.id } } : {}) },
      include: { group: { select: { name: true } }, subject: { select: { name: true, color: true } } },
      orderBy: { date: "asc" },
      take: 6,
    }),
    db.acaSession.findMany({ where: { date: today, status: "SCHEDULED", startTime: { lt: new Date(new Date().getTime() + 2 * 3600 * 1000).toISOString().slice(11, 16) } }, select: { id: true, startTime: true, group: { select: { name: true } } } }),
  ]);

  const needsAttendance = todaySessions.filter((s) => s.status === "SCHEDULED");
  const running = todaySessions.filter((s) => s.status === "STARTED" || s.status === "IN_PROGRESS");

  return NextResponse.json({
    pendingRequests, todayCount: todaySessions.length, completedToday,
    running: running.map((s) => ({ id: s.id, name: s.group.name, subject: s.group.subject, startTime: s.startTime, status: s.status })),
    needsAttendance: needsAttendance.map((s) => ({ id: s.id, name: s.group.name, subject: s.group.subject, startTime: s.startTime })),
    upcomingExams: upcomingExams.map((e) => ({ id: e.id, title: e.title, date: e.date, group: e.group.name, subject: e.subject })),
    overdueStarts: atRiskGroups.map((s) => ({ id: s.id, name: s.group.name, startTime: s.startTime })),
  });
}

export const GET = acaHandler(GET_impl);
