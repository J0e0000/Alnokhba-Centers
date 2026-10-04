import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { sessionEconomics } from "@/lib/finance";
import { hasPermission, canRequest } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/sessions/[id] — session detail: attendance list + economics (pre-close summary) */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;

  const session = await db.sessionInstance.findFirst({
    where: { id, centerId: user.centerId },
    include: {
      group: { include: { subject: true, grade: true, teacher: true } },
      attendance: {
        include: { student: { select: { id: true, name: true, code: true, status: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);

  const open = session.studentSource === "OPEN"; // حضور مفتوح — مفيش كشف ولا غياب (spec §15)
  const econ = await sessionEconomics(session.id);

  // Registered students not yet attended (للكشف بس — الغياب مُشتق من المجموعة، مش بيتخزن ولا ليه زرار)
  let absent: { studentId: string; name: string; code: string }[] = [];
  if (!open && session.groupId) {
    const registered = await db.studentGroup.findMany({
      where: { groupId: session.groupId, status: "ACTIVE", student: { status: "ACTIVE" } },
      include: { student: { select: { id: true, name: true, code: true } } },
    });
    const attendedIds = new Set(session.attendance.map((a) => a.studentId).filter(Boolean) as string[]);
    absent = registered.filter((r) => !attendedIds.has(r.studentId)).map((r) => ({
      studentId: r.student.id, name: r.student.name, code: r.student.code,
    }));
  }

  return ok({
    session: {
      id: session.id, date: session.date, startTime: session.startTime, endTime: session.endTime,
      room: session.room, status: session.status,
      subject: session.group?.subject.name ?? session.name ?? "حصة",
      grade: session.group?.grade.name ?? "—",
      groupName: session.group?.name ?? "—", teacher: session.group?.teacher?.name ?? "—",
      price: session.price, teacherPercent: session.teacherPercent,
      studentSource: session.studentSource, studentCodeLength: session.studentCodeLength,
      allowUnregistered: session.allowUnregistered,
      // وقت البداية الفعلي = لحظة فتح الحصة
      openedAt: session.status !== "CANCELLED" ? session.createdAt.toISOString() : null,
      closedAt: session.closedAt,
    },
    economics: econ,
    attendance: session.attendance.map((a) => ({
      id: a.id, studentId: a.studentId,
      // الحضور المفتوح/غير المسجلين: الاسم/الكود الخام من الـ snapshot — الطلاب الحقيقيين زي ما هم
      name: a.student?.name ?? a.studentName ?? "طالب", code: a.student?.code ?? a.studentCode ?? "—",
      unregistered: a.studentId === null,
      status: a.status, charged: a.charged, at: a.createdAt,
      method: a.method,
      riskScore: a.riskScore,
      riskFlags: a.riskFlags ? ((): string[] => { try { return JSON.parse(a.riskFlags) as string[]; } catch { return []; } })() : [],
    })),
    absent,
  });
});

/** POST /api/sessions/[id] — actions: close | cancel | reopen (manager) */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ action?: string; reason?: string }>(req);

  if (body.action === "close") {
    // Close can be done by manager OR receptionist (spec: "authorized user presses قفل الحصة")
    const user = await requireCenterUser();
    const session = await db.sessionInstance.findFirst({
      where: { id, centerId: user.centerId },
      include: { group: { include: { subject: true, teacher: true } } },
    });
    if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
    if (session.status !== "OPEN") throw new ApiError("الحصة دي مش مفتوحة أصلاً.");

    const open = session.studentSource === "OPEN";
    const econ = await sessionEconomics(session.id);

    await db.$transaction(async (tx) => {
      await tx.sessionInstance.update({
        where: { id },
        data: {
          status: "CLOSED", closedBy: user.id, closedAt: new Date(),
          presentCount: open
            ? (await tx.attendance.count({ where: { sessionId: id } })) // الحضور المفتوح = عدد الصفوف المسجلة
            : econ.presentCount,
          totalRevenue: econ.totalRevenue,
          teacherShare: econ.teacherShare,
          centerShare: econ.centerShare,
        },
      });
      // الحضور المفتوح: مفيش حسابات (سعر 0 → مفيش مستحقات/إيراد) — بنسجل القفل في التدقيق بس
      if (!open) {
        if (session.group?.teacherId && econ.teacherShare > 0) {
          await tx.teacherSettlement.create({
            data: {
              centerId: user.centerId, teacherId: session.group.teacherId, sessionId: session.id,
              type: "EARNED", amount: econ.teacherShare, date: session.date,
              note: `حصة ${session.group.subject.name} ${session.date}`, createdBy: user.id,
            },
          });
        }
        await tx.centerTransaction.createMany({
          data: [
            { centerId: user.centerId, type: "SESSION_REVENUE", amount: econ.totalRevenue, date: session.date, note: `إيراد حصة ${session.group?.subject.name ?? ""}`, refType: "SESSION", refId: session.id, createdBy: user.id },
            { centerId: user.centerId, type: "TEACHER_SHARE", amount: -econ.teacherShare, date: session.date, note: `نصيب المدرس ${session.group?.teacher?.name ?? ""}`, refType: "SESSION", refId: session.id, createdBy: user.id },
          ],
        });
      }
    });

    await logAudit({
      user,
      action: AUDIT.SESSION_CLOSED,
      entity: "SESSION",
      entityId: session.id,
      after: open
        ? { mode: "OPEN", recorded: econ.presentCount }
        : { ...econ },
    });

    return ok({ closed: true, economics: econ, mode: open ? "OPEN" : "ROSTER" });
  }

  if (body.action === "cancel") {
    // صلاحية مباشرة (CANCEL_SESSION) — المدير دايمًا معاه. اللي معندهوش يقدّم طلب موافقة.
    const user = await requireCenterUser();
    if (!hasPermission(user, "CANCEL_SESSION")) {
      throw new ApiError(
        canRequest(user, "SESSION_CANCEL")
          ? "ممعك صلاحية إلغاء الحصة مباشرة — قدّم طلب موافقة للمدير من شاشة الحصة."
          : "إلغاء الحصة للمدير بس.",
        403,
      );
    }
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 3) {
      throw new ApiError("لازم تكتب سبب إلغاء الحصة (بيتحفظ في سجل العمليات).");
    }
    const session = await db.sessionInstance.findFirst({ where: { id, centerId: user.centerId } });
    if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
    if (session.status === "CLOSED") throw new ApiError("الحصة مقفولة ومعاها حسابات — مينفعش تتلغي.");
    if (session.status === "CANCELLED") throw new ApiError("الحصة دي متلغاة خلاص.", 409);
    await db.sessionInstance.update({ where: { id }, data: { status: "CANCELLED" } });
    await logAudit({ user, action: AUDIT.SESSION_CANCELLED, entity: "SESSION", entityId: id, reason });
    return ok({ cancelled: true });
  }

  if (body.action === "reopen") {
    // Manager-only reversal: voids the settlement via a reversing entry (never delete)
    const user = await requireManager();
    const session = await db.sessionInstance.findFirst({
      where: { id, centerId: user.centerId },
      include: { group: { include: { subject: true, teacher: true } } },
    });
    if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
    if (session.status !== "CLOSED") throw new ApiError("الحصة دي مش مقفولة.");

    const reason = String(body.reason ?? "").trim();
    if (reason.length < 3) throw new ApiError("لازم تكتب سبب إعادة فتح الحصة (بيتحفظ في السجل).");

    await db.$transaction(async (tx) => {
      await tx.sessionInstance.update({
        where: { id },
        data: { status: "OPEN", closedBy: null, closedAt: null, presentCount: null, totalRevenue: null, teacherShare: null, centerShare: null },
      });
      const settlement = await tx.teacherSettlement.findFirst({ where: { sessionId: session.id, type: "EARNED" } });
      if (settlement) {
        await tx.teacherSettlement.create({
          data: {
            centerId: user.centerId, teacherId: settlement.teacherId, sessionId: session.id,
            type: "EARNED", amount: -settlement.amount, date: session.date,
            note: `عكس مستحقات (إعادة فتح الحصة) — ${reason}`, createdBy: user.id,
          },
        });
      }
      await tx.centerTransaction.createMany({
        data: [
          { centerId: user.centerId, type: "ADJUSTMENT", amount: -(session.totalRevenue ?? 0), date: session.date, note: `عكس إيراد (إعادة فتح الحصة) — ${reason}`, refType: "SESSION", refId: session.id, createdBy: user.id },
          { centerId: user.centerId, type: "ADJUSTMENT", amount: (session.teacherShare ?? 0), date: session.date, note: `عكس نصيب مدرس (إعادة فتح) — ${reason}`, refType: "SESSION", refId: session.id, createdBy: user.id },
        ],
      });
    });

    await logAudit({
      user, action: AUDIT.SESSION_REOPENED, entity: "SESSION", entityId: id,
      before: { status: "CLOSED" }, after: { status: "OPEN" }, reason,
    });
    return ok({ reopened: true });
  }

  throw new ApiError("العملية دي مش معروفة.");
});
