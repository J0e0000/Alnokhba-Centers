import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, hashPassword } from "@/lib/auth";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/teachers — list with academic workload (spec §31) */
async function GET_impl() {
  const user = await requireAca();
  if (!user.permissions.includes("teachers.view")) throw new ApiError("مالكش صلاحية.", 403);
  const teachers = await db.user.findMany({
    where: { role: "TEACHER", scope: "academia" },
    select: {
      id: true, name: true, username: true, isActive: true, createdAt: true,
      acaTeacherGroups: { select: { id: true, name: true, isActive: true, subject: { select: { name: true, color: true } }, _count: { select: { enrollments: true, sessions: true } } } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    teachers: teachers.map((t) => ({
      id: t.id, name: t.name, username: t.username, isActive: t.isActive, since: t.createdAt,
      groups: t.acaTeacherGroups.map((g) => ({ id: g.id, name: g.name, isActive: g.isActive, subject: g.subject, students: g._count.enrollments, sessions: g._count.sessions })),
      workloadWeekly: t.acaTeacherGroups.filter((g) => g.isActive).reduce((s, g) => s + g._count.sessions, 0),
    })),
  });
}

/** POST /api/academia/teachers — create teacher user (teachers.manage) */
async function POST_impl(req: NextRequest) {
  const user = await requireAcaPerm("teachers.manage");
  const body = await req.json().catch(() => null);
  const { name, username, password } = body ?? {};
  if (!name?.trim() || !username?.trim() || !password) throw new ApiError("الاسم واسم المستخدم وكلمة السر مطلوبين.", 400);
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(uname)) throw new ApiError("اسم المستخدم: حروف إنجليزية وأرقام و . و _ بس.", 400);
  if (password.length < 6) throw new ApiError("كلمة السر: 6 حروف على الأقل.", 400);
  const exists = await db.user.findUnique({ where: { username: uname } });
  if (exists) throw new ApiError("اسم المستخدم ده متاخد خلاص.", 400);
  const u = await db.user.create({ data: { username: uname, passwordHash: hashPassword(password), name: name.trim(), role: "TEACHER", scope: "academia", centerId: null } });
  await logAudit({ user, action: "إضافة مدرس", entity: "ACA_TEACHER", entityId: u.id, after: { name: name.trim() } });
  return NextResponse.json({ teacher: { id: u.id } }, { status: 201 });
}

/** PATCH /api/academia/teachers — activate/deactivate (teachers.manage) */
async function PATCH_impl(req: NextRequest) {
  const user = await requireAcaPerm("teachers.manage");
  const body = await req.json().catch(() => null);
  const { teacherId, isActive } = body ?? {};
  if (!teacherId) throw new ApiError("بيانات ناقصة.", 400);
  const t = await db.user.findFirst({ where: { id: teacherId, role: "TEACHER", scope: "academia" } });
  if (!t) throw new ApiError("المدرس ده مش موجود.", 404);
  await db.user.update({ where: { id: teacherId }, data: { isActive: Boolean(isActive) } });
  await logAudit({ user, action: isActive ? "تنشيط حساب مدرس" : "إيقاف حساب مدرس", entity: "ACA_TEACHER", entityId: teacherId, before: { isActive: t.isActive }, after: { isActive: Boolean(isActive) } });
  return NextResponse.json({ ok: true });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
export const PATCH = acaHandler(PATCH_impl);
