import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, rateLimit } from "@/lib/auth";
import { requireAca, requireAcaPerm, assertGroupAccess } from "@/lib/academia/guard";
import { findOccurrenceConflicts } from "@/lib/academia/conflicts";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/groups — role-scoped list (teacher: own only; student: own enrollments only) */
async function GET_impl() {
  const user = await requireAca();
  // أمان: الطالب يشوف مجموعاته المسجّل فيها بس — مفيش تعداد لكل المجموعات وأسعارها
  const where = user.role === "TEACHER"
    ? { teacherId: user.id }
    : user.role === "STUDENT"
      ? { enrollments: { some: { studentId: user.studentProfileId ?? "none", status: "ACTIVE" } } }
      : {};
  const groups = await db.acaGroup.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: {
      subject: { select: { name: true, color: true } },
      teacher: { select: { id: true, name: true } },
      _count: { select: { enrollments: true, schedules: true, sessions: true } },
    },
  });
  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id, name: g.name, gradeName: g.gradeName, room: g.room, capacity: g.capacity,
      pricePerSession: g.pricePerSession, isActive: g.isActive,
      subject: g.subject, teacher: g.teacher,
      enrolled: g._count.enrollments, scheduleCount: g._count.schedules, sessionCount: g._count.sessions,
    })),
  });
}

/** POST /api/academia/groups — create group (groups.manage) */
async function POST_impl(req: NextRequest) {
  const user = await requireAcaPerm("groups.manage");
  rateLimit(`aca-group-create:${user.id}`, 20, 60_000);
  const body = await req.json().catch(() => null);
  if (!body) throw new ApiError("البيانات ناقصة.", 400);
  const { name, subjectId, teacherId, gradeName, room, capacity, pricePerSession } = body;
  if (!name?.trim() || !subjectId || !teacherId) throw new ApiError("اسم المجموعة والمادة والمدرس مطلوبين.", 400);
  if (name.trim().length > 60) throw new ApiError("اسم المجموعة طويل أوي (60 حرف كحد أقصى).", 400);
  if (gradeName && String(gradeName).trim().length > 40) throw new ApiError("اسم المرحلة طويل أوي.", 400);
  if (room && String(room).trim().length > 60) throw new ApiError("اسم القاعة طويل أوي.", 400);
  const cap = Number(capacity);
  if (capacity != null && (!Number.isFinite(cap) || cap < 1 || cap > 500)) throw new ApiError("سعة المجموعة لازم تكون من 1 لـ 500.", 400);
  const teacher = await db.user.findFirst({ where: { id: teacherId, role: "TEACHER", scope: "academia", isActive: true } });
  if (!teacher) throw new ApiError("المدرس ده مش موجود.", 400);
  const subject = await db.acaSubject.findUnique({ where: { id: subjectId } });
  if (!subject) throw new ApiError("المادة دي مش موجودة.", 400);

  const group = await db.acaGroup.create({
    data: {
      name: name.trim(), subjectId, teacherId,
      gradeName: gradeName?.trim() || null,
      room: room?.trim() || null,
      capacity: Number(capacity) > 0 ? Number(capacity) : 20,
      pricePerSession: pricePerSession != null && Number(pricePerSession) >= 0 ? Math.round(Number(pricePerSession) * 100) : null,
    },
  });
  await logAudit({ user, action: "إنشاء مجموعة", entity: "ACA_GROUP", entityId: group.id, after: { name: group.name } });
  return NextResponse.json({ group: { id: group.id } }, { status: 201 });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
