import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, rateLimit } from "@/lib/auth";
import { requireAca, assertGroupAccess } from "@/lib/academia/guard";
import { ensureSessionsForDate, defaultWorkspace } from "@/lib/academia/session-gen";
import { findSessionConflicts } from "@/lib/academia/conflicts";
import { todayStr } from "@/lib/academia/dates";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/sessions?date=YYYY-MM-DD — sessions for a date
 *  Teacher: own groups only. Manager/Admin: all. Student: own groups.
 *  Lazily generates scheduled sessions from weekly occurrences (idempotent).
 */
async function GET_impl(req: NextRequest) {
  const user = await requireAca();
  const date = req.nextUrl.searchParams.get("date") || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("التاريخ مش صحيح.", 400);

  if (user.role !== "STUDENT") await ensureSessionsForDate(date);

  const where =
    user.role === "TEACHER" ? { date, teacherId: user.id }
    : user.role === "STUDENT" ? { date, group: { enrollments: { some: { studentId: user.studentProfileId ?? "none", status: "ACTIVE" } } } }
    : { date };

  const sessions = await db.acaSession.findMany({
    where,
    orderBy: { startTime: "asc" },
    include: {
      group: { select: { id: true, name: true, room: true, subject: { select: { name: true, color: true } } } },
      topic: { select: { id: true, title: true } },
      _count: { select: { attendance: true } },
    },
  });

  // enrollment counts per group for roster size hints
  const groupIds = [...new Set(sessions.map((s) => s.groupId))];
  const counts = await db.acaEnrollment.groupBy({ by: ["groupId"], where: { groupId: { in: groupIds }, status: "ACTIVE" }, _count: { _all: true } });
  const countMap = new Map(counts.map((c) => [c.groupId, c._count._all]));

  return NextResponse.json({
    date,
    sessions: sessions.map((s) => ({
      id: s.id, groupId: s.groupId, groupName: s.group.name,
      subject: s.group.subject.name, color: s.group.subject.color,
      date: s.date, startTime: s.startTime, endTime: s.endTime, room: s.room,
      status: s.status, isMakeup: s.isMakeup, title: s.title,
      topic: s.topic ? { id: s.topic.id, title: s.topic.title } : null,
      marked: s._count.attendance, roster: countMap.get(s.groupId) ?? 0,
    })),
  });
}

/** POST /api/academia/sessions — create a manual or makeup session (conflict-checked) */
async function POST_impl(req: NextRequest) {
  const user = await requireAca();
  rateLimit(`aca-session-create:${user.id}`, 30, 60_000);
  const body = await req.json().catch(() => null);
  if (!body) throw new ApiError("البيانات ناقصة.", 400);
  const { groupId, date, startTime, endTime, room, isMakeup, title, topicId } = body;
  if (!groupId || !date || !startTime || !endTime) throw new ApiError("اختار المجموعة والتاريخ والوقت.", 400);
  if (user.role === "STUDENT") throw new ApiError("ده للإدارة والمدرسين بس.", 403);
  if (!user.permissions.includes("sessions.start")) throw new ApiError("مالكش صلاحية فتح الحصص.", 403);
  await assertGroupAccess(user, groupId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError("التاريخ مش صحيح.", 400);
  // تحقق صارم من صيغة الوقت — كان ممكن أي نص يتخزن ويبوظ منطق التعارض
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
    throw new ApiError("صيغة الوقت لازم تكون HH:MM.", 400);
  }
  if (endTime <= startTime) throw new ApiError("وقت النهاية لازم يكون بعد وقت البداية.", 400);
  if (room && String(room).length > 60) throw new ApiError("اسم القاعة طويل أوي.", 400);
  if (title && String(title).length > 120) throw new ApiError("العنوان طويل أوي.", 400);

  const conflicts = await findSessionConflicts({ groupId, date, startTime, endTime, room: room ?? null });
  if (conflicts.length > 0) {
    return NextResponse.json({ conflicts }, { status: 409 });
  }

  const group = await db.acaGroup.findUnique({ where: { id: groupId }, select: { teacherId: true, room: true } });
  if (!group) throw new ApiError("المجموعة دي مش موجودة.", 404);

  const session = await db.acaSession.create({
    data: {
      groupId, date, startTime, endTime,
      room: room ?? group.room ?? null,
      teacherId: group.teacherId,
      isMakeup: Boolean(isMakeup),
      title: title?.trim() || (isMakeup ? "حصة تعويضية" : null),
      topicId: topicId || null,
      status: "SCHEDULED",
      workspace: defaultWorkspace(),
    },
  });
  await logAudit({
    user, action: isMakeup ? "إنشاء حصة تعويضية" : "إنشاء حصة يدوي",
    entity: "ACA_SESSION", entityId: session.id,
    after: { groupId, date, startTime, endTime },
  });
  return NextResponse.json({ session: { id: session.id } }, { status: 201 });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
