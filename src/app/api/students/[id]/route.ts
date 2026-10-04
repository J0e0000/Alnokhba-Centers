import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { normalizeDigits, validateOptionalPhone } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/students/[id] — full profile (tenant-scoped) */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;

  const student = await db.student.findFirst({
    where: { id, centerId: user.centerId },
    include: {
      grade: true,
      registrations: {
        include: {
          group: {
            include: {
              subject: true, grade: true, teacher: true,
              schedules: { where: { isActive: true } },
              _count: { select: { students: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!student) throw new ApiError("الطالب ده مش موجود في السنتر ده.", 404);

  const [balance, attendance, txns, paymentsAgg] = await Promise.all([
    studentBalance(student.id),
    db.attendance.findMany({
      where: { studentId: student.id },
      orderBy: { session: { date: "desc" } },
      take: 50,
      include: { session: { include: { group: { include: { subject: true } } } } },
    }),
    db.studentTransaction.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.studentTransaction.aggregate({ _sum: { amount: true }, where: { studentId: student.id, type: "PAYMENT" } }),
  ]);

  // Per-subject attendance counts
  const subjectStats = student.registrations.map((r) => ({
    groupId: r.group.id,
    subject: r.group.subject.name,
    groupName: r.group.name,
    teacher: r.group.teacher?.name ?? "—",
    price: r.priceOverride ?? r.group.sessionPrice,
    isOverride: r.priceOverride !== null,
    status: r.status,
    attended: attendance.filter((a) => a.session.groupId === r.groupId).length,
    weeklyTimes: r.group.schedules.map((s) => ({ day: s.dayOfWeek, start: s.startTime, end: s.endTime, room: s.room })),
    classmates: r.group._count.students,
  }));

  // staff names — who recorded each transaction (printed on receipts)
  const staffIds = [...new Set(txns.map((t) => t.createdBy).filter(Boolean))];
  const staffMap = new Map<string, string>();
  if (staffIds.length) {
    const staffRows = await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } });
    for (const u of staffRows) staffMap.set(u.id, u.name);
  }

  return ok({
    student: {
      id: student.id, code: student.code, qrToken: student.qrToken, name: student.name,
      phone: student.phone, parentName: student.parentName, parentPhone: student.parentPhone,
      grade: student.grade?.name ?? null, school: student.school, status: student.status,
      notes: student.notes, createdAt: student.createdAt,
      gradeId: student.gradeId,
    },
    balance,
    totalPaid: paymentsAgg._sum.amount ?? 0,
    totalCharged: txns.filter((t) => t.type === "CHARGE").reduce((a, t) => a + Math.abs(t.amount), 0),
    subjectStats,
    attendance: attendance.map((a) => ({
      id: a.id, date: a.session.date, startTime: a.session.startTime, status: a.status,
      subject: a.session.group?.subject.name ?? a.session.name ?? "حصة", charged: a.charged,
    })),
    transactions: txns.map((t) => ({
      id: t.id, type: t.type, amount: t.amount, method: t.method, reason: t.reason,
      createdAt: t.createdAt, sessionId: t.sessionId,
      byName: staffMap.get(t.createdBy) ?? null,
      hasReceipt: t.type === "PAYMENT",
    })),
  });
});

type PatchBody = {
  name?: string; phone?: string; parentName?: string; parentPhone?: string;
  gradeId?: string; school?: string; status?: string; notes?: string;
  addGroupIds?: string[]; removeGroupIds?: string[];
};

/** PATCH /api/students/[id] — update profile / registrations */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;
  const body = await readJson<PatchBody>(req);

  const student = await db.student.findFirst({ where: { id, centerId: user.centerId } });
  if (!student) throw new ApiError("الطالب ده مش موجود في السنتر ده.", 404);

  const before = {
    name: student.name, phone: student.phone, parentName: student.parentName,
    parentPhone: student.parentPhone, status: student.status, school: student.school, notes: student.notes,
  };

  const data: Record<string, string | null> = {};
  if (body.name !== undefined) {
    const name = normalizeDigits(body.name).replace(/\s+/g, " ").trim();
    if (name.length < 5) throw new ApiError("اكتب اسم الطالب كامل (3 أسماء على الأقل).");
    data.name = name;
  }
  if (body.phone !== undefined) {
    if (!String(body.phone).trim()) data.phone = null;
    else {
      const c = validateOptionalPhone(String(body.phone), "رقم موبايل الطالب");
      if (!c.ok) throw new ApiError(c.error);
      data.phone = c.normalized || null;
    }
  }
  if (body.parentName !== undefined) {
    if (!String(body.parentName).trim()) throw new ApiError("اسم ولي الأمر مطلوب.");
    data.parentName = String(body.parentName).trim();
  }
  if (body.parentPhone !== undefined) {
    if (!String(body.parentPhone).trim()) throw new ApiError("رقم موبايل ولي الأمر مطلوب.");
    const c = validateOptionalPhone(String(body.parentPhone), "رقم موبايل ولي الأمر");
    if (!c.ok) throw new ApiError(c.error);
    data.parentPhone = c.normalized;
  }
  if (body.school !== undefined) data.school = body.school?.trim() || null;
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
  if (body.status !== undefined) {
    if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(body.status)) throw new ApiError("حالة الطالب مش معروفة.");
    if (body.status !== "ACTIVE" && user.role !== "MANAGER") {
      throw new ApiError("تغيير حالة الطالب للمدير بس.", 403);
    }
    data.status = body.status;
  }
  if (body.gradeId !== undefined) {
    const grade = await db.grade.findFirst({ where: { id: body.gradeId, centerId: user.centerId } });
    if (!grade) throw new ApiError("المرحلة دي مش موجودة.");
    data.gradeId = body.gradeId;
  }

  await db.$transaction(async (tx) => {
    if (Object.keys(data).length) {
      await tx.student.update({ where: { id: student.id }, data: data as never });
    }
    // Group registrations
    if (Array.isArray(body.addGroupIds) && body.addGroupIds.length) {
      const groups = await tx.group.findMany({ where: { id: { in: body.addGroupIds.map(String) }, centerId: user.centerId } });
      for (const g of groups) {
        await tx.studentGroup.upsert({
          where: { studentId_groupId: { studentId: student.id, groupId: g.id } },
          create: { studentId: student.id, groupId: g.id, registeredBy: user.id },
          update: { status: "ACTIVE" },
        });
      }
    }
    if (Array.isArray(body.removeGroupIds) && body.removeGroupIds.length) {
      if (user.role !== "MANAGER") throw new ApiError("إلغاء تسجيل طالب من مجموعة للمدير بس.", 403);
      await tx.studentGroup.updateMany({
        where: { studentId: student.id, groupId: { in: body.removeGroupIds.map(String) } },
        data: { status: "CANCELLED" },
      });
    }
  });

  await logAudit({
    user,
    action: AUDIT.STUDENT_UPDATED,
    entity: "STUDENT",
    entityId: student.id,
    before,
    after: data,
  });

  return ok({ ok: true });
});
