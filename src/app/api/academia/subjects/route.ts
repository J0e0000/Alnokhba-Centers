import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/subjects — subjects + curriculum tree (Subject→Unit→Topic→Lesson) */
async function GET_impl() {
  const user = await requireAca();
  const subjects = await db.acaSubject.findMany({
    orderBy: { name: "asc" },
    include: {
      units: {
        orderBy: { order: "asc" },
        include: { topics: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } } },
      },
      _count: { select: { groups: true } },
    },
  });
  return NextResponse.json({
    subjects: subjects.map((s) => ({
      id: s.id, name: s.name, code: s.code, color: s.color, isActive: s.isActive, groups: s._count.groups,
      units: s.units.map((u) => ({
        id: u.id, title: u.title, order: u.order,
        topics: u.topics.map((t) => ({ id: t.id, title: t.title, order: t.order, lessons: t.lessons.map((l) => ({ id: l.id, title: l.title, order: l.order })) })),
      })),
    })),
  });
}

/** POST /api/academia/subjects — create subject/unit/topic/lesson (subjects.manage) */
async function POST_impl(req: NextRequest) {
  const user = await requireAcaPerm("subjects.manage");
  const body = await req.json().catch(() => null);
  const { type, name, title, subjectId, unitId, topicId, color, code } = body ?? {};
  if (type === "subject") {
    if (!name?.trim()) throw new ApiError("اكتب اسم المادة.", 400);
    const dup = await db.acaSubject.findUnique({ where: { name: name.trim() } });
    if (dup) throw new ApiError("المادة دي موجودة خلاص.", 400);
    const s = await db.acaSubject.create({ data: { name: name.trim(), color: color || "#0E9F6E", code: code || null } });
    await logAudit({ user, action: "إضافة مادة", entity: "ACA_SUBJECT", entityId: s.id, after: { name: s.name } });
    return NextResponse.json({ subject: { id: s.id } }, { status: 201 });
  }
  if (type === "unit") {
    if (!subjectId || !title?.trim()) throw new ApiError("اختار المادة واكتب اسم الوحدة.", 400);
    const count = await db.acaUnit.count({ where: { subjectId } });
    const u = await db.acaUnit.create({ data: { subjectId, title: title.trim(), order: count } });
    return NextResponse.json({ unit: { id: u.id } }, { status: 201 });
  }
  if (type === "topic") {
    if (!unitId || !title?.trim()) throw new ApiError("اختار الوحدة واكتب اسم الدرس.", 400);
    const count = await db.acaTopic.count({ where: { unitId } });
    const t = await db.acaTopic.create({ data: { unitId, title: title.trim(), order: count } });
    return NextResponse.json({ topic: { id: t.id } }, { status: 201 });
  }
  if (type === "lesson") {
    if (!topicId || !title?.trim()) throw new ApiError("اختار الدرس الأب واكتب اسم الجزء.", 400);
    const count = await db.acaLesson.count({ where: { topicId } });
    const l = await db.acaLesson.create({ data: { topicId, title: title.trim(), order: count } });
    return NextResponse.json({ lesson: { id: l.id } }, { status: 201 });
  }
  throw new ApiError("نوع مش معروف.", 400);
}

/** PATCH /api/academia/subjects — rename/toggle subject */
async function PATCH_impl(req: NextRequest) {
  const user = await requireAcaPerm("subjects.manage");
  const body = await req.json().catch(() => null);
  const { subjectId, name, isActive, color } = body ?? {};
  if (!subjectId) throw new ApiError("بيانات ناقصة.", 400);
  const s = await db.acaSubject.findUnique({ where: { id: subjectId } });
  if (!s) throw new ApiError("المادة دي مش موجودة.", 404);
  await db.acaSubject.update({
    where: { id: subjectId },
    data: { name: name?.trim() || s.name, isActive: isActive === undefined ? s.isActive : Boolean(isActive), color: color || s.color },
  });
  await logAudit({ user, action: "تعديل مادة", entity: "ACA_SUBJECT", entityId: subjectId, before: { name: s.name }, after: { name: name ?? s.name } });
  return NextResponse.json({ ok: true });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
export const PATCH = acaHandler(PATCH_impl);
