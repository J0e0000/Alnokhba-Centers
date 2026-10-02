import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAca } from "@/lib/academia/guard";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/schedules — weekly recurring grid (teacher: own; student: enrolled groups only) */
async function GET_impl() {
  const user = await requireAca();
  // أمان: الطالب يشوف جدول مجموعاته بس — مش الجدول الأسبوعي الكامل للسنتر
  const scope = user.role === "TEACHER"
    ? { group: { teacherId: user.id } }
    : user.role === "STUDENT"
      ? { group: { enrollments: { some: { studentId: user.studentProfileId ?? "none", status: "ACTIVE" } } } }
      : {};
  const occs = await db.acaGroupSchedule.findMany({
    where: { status: "ACTIVE", ...scope },
    include: {
      group: { select: { id: true, name: true, room: true, subject: { select: { name: true, color: true } }, teacher: { select: { id: true, name: true } } } },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  return NextResponse.json({
    occurrences: occs.map((o) => ({
      id: o.id, groupId: o.groupId, groupName: o.group.name, room: o.room ?? o.group.room,
      subject: o.group.subject, teacher: o.group.teacher,
      dayOfWeek: o.dayOfWeek, startTime: o.startTime, endTime: o.endTime,
    })),
  });
}

export const GET = acaHandler(GET_impl);
