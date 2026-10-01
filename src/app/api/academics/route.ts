import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toPiastres, cleanRaw } from "@/lib/normalize";
import { generateTeacherCode } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

/** GET /api/academics — all academic references for the center */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const [grades, subjects, teachers, groups] = await Promise.all([
    db.grade.findMany({ where: { centerId: user.centerId }, orderBy: { order: "asc" } }),
    db.subject.findMany({ where: { centerId: user.centerId }, orderBy: { name: "asc" } }),
    db.teacher.findMany({ where: { centerId: user.centerId }, orderBy: { name: "asc" } }),
    db.group.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: {
        subject: true, grade: true, teacher: true,
        _count: { select: { students: true, schedules: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return ok({
    grades: grades.map((g) => ({ id: g.id, name: g.name, order: g.order })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
    // كود دخول المدرس للبورتال بيتوزع للمدير بس — موظف الاستقبال/الامتحانات ميشوفوش
    teachers: teachers.map((t) => ({
      id: t.id, name: t.name, phone: t.phone, isActive: t.isActive,
      ...(user.role === "MANAGER" ? { loginCode: t.loginCode } : {}),
    })),
    groups: groups.map((g) => ({
      id: g.id, name: g.name,
      subject: g.subject.name, subjectId: g.subjectId,
      grade: g.grade.name, gradeId: g.gradeId,
      teacher: g.teacher?.name ?? null, teacherId: g.teacherId,
      price: g.sessionPrice, teacherPercent: g.teacherPercent, room: g.room,
      students: g._count.students, schedules: g._count.schedules,
    })),
  });
});

type CreateBody = {
  type?: "group" | "subject" | "grade" | "teacher";
  name?: string;
  // group
  gradeId?: string; subjectId?: string; teacherId?: string;
  price?: number; teacherPercent?: number; room?: string;
  // teacher
  phone?: string;
  regenCode?: boolean; // توليد كود جديد لبورتال المدرس
};

/** POST /api/academics — create {group|subject|grade|teacher} (manager) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<CreateBody>(req);
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError("الاسم مطلوب.");

  if (body.type === "grade") {
    const exists = await db.grade.findFirst({ where: { centerId: user.centerId, name } });
    if (exists) throw new ApiError(`المرحلة "${name}" موجودة قبل كده.`);
    const order = await db.grade.count({ where: { centerId: user.centerId } });
    const grade = await db.grade.create({ data: { centerId: user.centerId, name, order } });
    await logAudit({ user, action: AUDIT.GRADE_CREATED, entity: "GRADE", entityId: grade.id, after: { name } });
    return ok({ grade: { id: grade.id } }, { status: 201 });
  }

  if (body.type === "subject") {
    const exists = await db.subject.findFirst({ where: { centerId: user.centerId, name } });
    if (exists) throw new ApiError(`المادة "${name}" موجودة قبل كده.`);
    const subject = await db.subject.create({ data: { centerId: user.centerId, name } });
    await logAudit({ user, action: AUDIT.SUBJECT_CREATED, entity: "SUBJECT", entityId: subject.id, after: { name } });
    return ok({ subject: { id: subject.id } }, { status: 201 });
  }

  if (body.type === "teacher") {
    const loginCode = await generateTeacherCode(user.centerId);
    const teacher = await db.teacher.create({
      data: { centerId: user.centerId, name, phone: cleanRaw(String(body.phone ?? "")) || null, loginCode },
    });
    await logAudit({ user, action: AUDIT.TEACHER_CREATED, entity: "TEACHER", entityId: teacher.id, after: { name, loginCode } });
    return ok({ teacher: { id: teacher.id, loginCode } }, { status: 201 });
  }

  if (body.type === "group") {
    const grade = await db.grade.findFirst({ where: { id: String(body.gradeId), centerId: user.centerId } });
    if (!grade) throw new ApiError("اختار المرحلة.");
    const subject = await db.subject.findFirst({ where: { id: String(body.subjectId), centerId: user.centerId } });
    if (!subject) throw new ApiError("اختار المادة.");
    const teacher = body.teacherId
      ? await db.teacher.findFirst({ where: { id: String(body.teacherId), centerId: user.centerId } })
      : null;
    if (body.teacherId && !teacher) throw new ApiError("المدرس ده مش موجود.");

    const price = toPiastres(Number(body.price ?? 0));
    if (price <= 0) throw new ApiError("سعر الحصة لازم يكون أكبر من صفر.");
    if (price > toPiastres(2000)) throw new ApiError("سعر الحصة كبير بشكل غير منطقي — راجعه.");

    const pct = Number(body.teacherPercent ?? 50);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new ApiError("نسبة المدرس لازم تكون رقم صحيح من 0 لـ 100.");

    const group = await db.group.create({
      data: {
        centerId: user.centerId, name,
        gradeId: grade.id, subjectId: subject.id, teacherId: teacher?.id ?? null,
        sessionPrice: price, teacherPercent: pct, room: body.room?.trim() || null,
      },
    });
    await logAudit({
      user, action: AUDIT.GROUP_CREATED, entity: "GROUP", entityId: group.id,
      after: { name, subject: subject.name, grade: grade.name, price, teacherPercent: pct },
    });
    return ok({ group: { id: group.id } }, { status: 201 });
  }

  throw new ApiError("نوع العنصر مش معروف.");
});

type UpdateBody = CreateBody & { id?: string };

/** PATCH /api/academics — update (manager) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<UpdateBody>(req);
  const id = String(body.id ?? "");
  if (!id) throw new ApiError("العنصر مش موجود.");

  if (body.type === "group") {
    const group = await db.group.findFirst({ where: { id, centerId: user.centerId } });
    if (!group) throw new ApiError("المجموعة مش موجودة.", 404);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined && body.name.trim()) data.name = body.name.trim();
    if (body.gradeId !== undefined) {
      const grade = await db.grade.findFirst({ where: { id: String(body.gradeId), centerId: user.centerId } });
      if (!grade) throw new ApiError("المرحلة مش موجودة.");
      data.gradeId = grade.id;
    }
    if (body.subjectId !== undefined) {
      const subject = await db.subject.findFirst({ where: { id: String(body.subjectId), centerId: user.centerId } });
      if (!subject) throw new ApiError("المادة مش موجودة.");
      data.subjectId = subject.id;
    }
    if (body.teacherId !== undefined) {
      const teacher = body.teacherId ? await db.teacher.findFirst({ where: { id: String(body.teacherId), centerId: user.centerId } }) : null;
      if (body.teacherId && !teacher) throw new ApiError("المدرس مش موجود.");
      data.teacherId = teacher?.id ?? null;
    }
    if (body.price !== undefined && body.price !== null && body.price !== ("" as unknown)) {
      const price = toPiastres(Number(body.price));
      if (price <= 0) throw new ApiError("سعر الحصة لازم يكون أكبر من صفر.");
      data.sessionPrice = price;
    }
    if (body.teacherPercent !== undefined && body.teacherPercent !== null) {
      const pct = Number(body.teacherPercent);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new ApiError("نسبة المدرس لازم تكون رقم صحيح من 0 لـ 100.");
      data.teacherPercent = pct;
    }
    if (body.room !== undefined) data.room = body.room?.trim() || null;

    await db.group.update({ where: { id }, data: data as never });
    await logAudit({
      user, action: AUDIT.GROUP_UPDATED, entity: "GROUP", entityId: id,
      before: { name: group.name, sessionPrice: group.sessionPrice, teacherPercent: group.teacherPercent },
      after: data,
    });
    return ok({ ok: true });
  }

  if (body.type === "teacher") {
    const teacher = await db.teacher.findFirst({ where: { id, centerId: user.centerId } });
    if (!teacher) throw new ApiError("المدرس مش موجود.", 404);
    const data: Record<string, unknown> = {};
    if (body.name?.trim()) data.name = body.name.trim();
    if (body.phone !== undefined) data.phone = cleanRaw(String(body.phone)) || null;
    // كود جديد لبورتال المدرس (بطلب صريح من الإدارة)
    if (body.regenCode) {
      data.loginCode = await generateTeacherCode(user.centerId);
    }
    await db.teacher.update({ where: { id }, data: data as never });
    await logAudit({ user, action: AUDIT.GROUP_UPDATED, entity: "TEACHER", entityId: id, before: { name: teacher.name, loginCode: teacher.loginCode }, after: data });
    return ok({ ok: true, loginCode: (data.loginCode as string) ?? teacher.loginCode });
  }

  if (body.type === "subject" || body.type === "grade") {
    if (body.name?.trim()) {
      if (body.type === "subject") {
        const s = await db.subject.findFirst({ where: { id, centerId: user.centerId } });
        if (!s) throw new ApiError("المادة مش موجودة.", 404);
        await db.subject.update({ where: { id }, data: { name: body.name.trim() } });
      } else {
        const g = await db.grade.findFirst({ where: { id, centerId: user.centerId } });
        if (!g) throw new ApiError("المرحلة مش موجودة.", 404);
        await db.grade.update({ where: { id }, data: { name: body.name.trim() } });
      }
      await logAudit({ user, action: body.type === "subject" ? AUDIT.SUBJECT_CREATED : AUDIT.GRADE_CREATED, entity: body.type.toUpperCase(), entityId: id, after: { name: body.name.trim() } });
      return ok({ ok: true });
    }
  }

  throw new ApiError("نوع العنصر مش معروف.");
});

/** DELETE /api/academics?type=&id= — deactivate (manager; safe: keeps history) */
export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";

  if (type === "group") {
    const group = await db.group.findFirst({ where: { id, centerId: user.centerId }, include: { _count: { select: { students: true } } } });
    if (!group) throw new ApiError("المجموعة مش موجودة.", 404);
    if (group._count.students > 0) throw new ApiError("المجموعة دي فيها طلاب مسجلين — مينفعش تتمسح. انقل الطلاب الأول.");
    await db.group.update({ where: { id }, data: { isActive: false } });
    await logAudit({ user, action: AUDIT.GROUP_UPDATED, entity: "GROUP", entityId: id, after: { isActive: false } });
    return ok({ ok: true });
  }
  if (type === "teacher") {
    const teacher = await db.teacher.findFirst({ where: { id, centerId: user.centerId }, include: { _count: { select: { groups: true } } } });
    if (!teacher) throw new ApiError("المدرس مش موجود.", 404);
    if (teacher._count.groups > 0) throw new ApiError("المدرس ده مربوط بمجموعات — انقله من المجموعات الأول.");
    await db.teacher.update({ where: { id }, data: { isActive: false } });
    return ok({ ok: true });
  }
  throw new ApiError("النوع ده مينفعش يتمسح.");
});
