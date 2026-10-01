import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, canRegisterStudents, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { studentBalance, effectivePrice } from "@/lib/finance";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type MarkBody = {
  studentId?: string;
  sessionId?: string;
  status?: "PRESENT" | "LATE" | "EXCUSED";
  registerGroup?: boolean; // orange-flow: also register the student into the session group
  idemKey?: string; // مفتاح idempotency (مزامنة أوفلاين) — نفس المفتاح = نفس الحضور
  bulk?: boolean; // التحضير المعكوس: علّم كل المسجلين اللي لسه محضروش
  studentIds?: string[]; // (bulk) قائمة اختيارية — لو مش موجودة: كل المسجلين النشطين
  // طريقة التسجيل للحوكمة (spec §3): MANUAL افتراضي — شاشة المسح تبعت QR_SCAN
  method?: "MANUAL" | "QR_SCAN" | "SESSION_QR";
};

/**
 * POST /api/attendance/mark — record attendance + charge inside one DB transaction.
 * Idempotent per (session, student) AND per idemKey; race-safe via unique constraints.
 *
 * bulk=true → التحضير المعكوس: علّم كل المسجلين في المجموعة اللي لسه محضروش
 * دفعة واحدة (المعلم بيشطب الغايبين بس بدل ما يمسح 30 طالب واحد واحد).
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<MarkBody>(req);

  const sessionId = String(body.sessionId ?? "");
  const attMethod = ["MANUAL", "QR_SCAN", "SESSION_QR"].includes(body.method ?? "") ? body.method! : "MANUAL";

  // ============================= BULK =============================
  if (body.bulk) {
    const session = await db.sessionInstance.findFirst({
      where: { id: sessionId, centerId: user.centerId },
      include: { group: { include: { subject: true } } },
    });
    if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
    if (session.status === "CLOSED") throw new ApiError("الحصة دي مقفولة — مينفعش تعلّم حضور فيها.", 400);
    if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغاة.", 400);

    // المسجلين النشطين في المجموعة
    const regs = await db.studentGroup.findMany({
      where: { groupId: session.groupId, status: "ACTIVE" },
      include: { student: { select: { id: true, name: true, code: true, status: true, grade: { select: { name: true } } } } },
    });

    // فلترة: مش مؤرشف + (كلهم أو القائمة المطلوبة) + لسه محضروش
    const wanted = new Set(Array.isArray(body.studentIds) ? body.studentIds.map(String) : null);
    const existing = await db.attendance.findMany({
      where: { sessionId, studentId: { in: regs.map((r) => r.student.id) } },
      select: { studentId: true },
    });
    const attendedSet = new Set(existing.map((e) => e.studentId));

    const toMark = regs.filter((r) =>
      r.student.status !== "ARCHIVED" &&
      (wanted.size === 0 || wanted.has(r.student.id)) &&
      !attendedSet.has(r.student.id),
    );

    if (toMark.length === 0) {
      return ok({ marked: 0, alreadyAttended: attendedSet.size, skipped: 0, totalCharge: 0, students: [] });
    }

    const totalCharge = await db.$transaction(async (tx) => {
      let sum = 0;
      for (const r of toMark) {
        const price = effectivePrice(r.priceOverride, null, session.price);
        const charge = price; // PRESENT — الخصم بسعر الحصة
        await tx.attendance.create({
          data: {
            centerId: user.centerId, sessionId, studentId: r.student.id,
            status: "PRESENT", charged: charge, recordedBy: user.id, method: attMethod,
          },
        });
        if (charge > 0) {
          await tx.studentTransaction.create({
            data: {
              centerId: user.centerId, studentId: r.student.id, sessionId,
              type: "CHARGE", amount: -charge,
              reason: `حصة ${session.group.subject.name} (تحضير جماعي)`,
              createdBy: user.id,
            },
          });
        }
        sum += charge;
      }
      return sum;
    });

    await logAudit({
      user,
      action: AUDIT.ATTENDANCE_RECORDED,
      entity: "SESSION",
      entityId: sessionId,
      after: {
        bulk: true,
        marked: toMark.length,
        totalCharge,
        students: toMark.map((r) => r.student.name),
      },
      reason: `تحضير جماعي — ${session.group.subject.name}`,
    });

    return ok({
      marked: toMark.length,
      alreadyAttended: attendedSet.size,
      totalCharge,
      students: toMark.map((r) => ({ id: r.student.id, name: r.student.name, code: r.student.code })),
    });
  }

  // ============================= SINGLE =============================
  const studentId = String(body.studentId ?? "");
  const status = ["PRESENT", "LATE", "EXCUSED"].includes(body.status ?? "") ? body.status! : "PRESENT";

  const session = await db.sessionInstance.findFirst({
    where: { id: sessionId, centerId: user.centerId },
    include: { group: { include: { subject: true } } },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status === "CLOSED") throw new ApiError("الحصة دي مقفولة — مينفعش تعدل فيها. المدير بس يقدر يفتحها تاني.");
  if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغاة.", 400);

  const student = await db.student.findFirst({
    where: { id: studentId, centerId: user.centerId },
    include: { registrations: { where: { status: "ACTIVE" } } },
  });
  if (!student) throw new ApiError("الطالب ده مش موجود في السنتر ده.", 404);
  if (student.status === "ARCHIVED") throw new ApiError("الطالب ده مؤرشف — مينفعش يسجل حضور.");

  let registration = student.registrations.find((r) => r.groupId === session.groupId) ?? null;

  // Orange flow: register on the fly (only authorized users)
  if (!registration && body.registerGroup) {
    if (!canRegisterStudents(user)) {
      throw new ApiError("تسجيل طالب في مجموعة جديدة — المدير أو موظف مصرح له بس.", 403);
    }
    registration = await db.studentGroup.create({
      data: { studentId: student.id, groupId: session.groupId, registeredBy: user.id },
    }).catch(() => {
      throw new ApiError("الطالب مسجل في المجموعة دي قبل كده.", 409);
    });
    await logAudit({
      user,
      action: AUDIT.STUDENT_REGISTERED,
      entity: "STUDENT",
      entityId: student.id,
      after: { group: session.group.name, subject: session.group.subject.name },
    });
  }

  if (!registration) {
    throw new ApiError("الطالب مش مسجل في المجموعة دي — سجله الأول.", 409);
  }

  const price = effectivePrice(registration.priceOverride, null, session.price);
  const charge = status === "EXCUSED" ? 0 : price; // excused attendance is not charged

  const result = await db.$transaction(async (tx) => {
    // idemKey (مزامنة أوفلاين): نفس المفتاح = نفس الحضور من غير خصم تاني
    if (body.idemKey) {
      const byKey = await tx.attendance.findUnique({ where: { idemKey: String(body.idemKey) } });
      if (byKey && byKey.centerId === user.centerId) {
        return { alreadyAttended: true, attendance: byKey, charged: byKey.charged ?? 0 };
      }
    }
    const existing = await tx.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });
    if (existing) {
      return { alreadyAttended: true, attendance: existing, charged: existing.charged ?? 0 };
    }
    const attendance = await tx.attendance.create({
      data: {
        centerId: user.centerId, sessionId, studentId, status, charged: charge, recordedBy: user.id,
        idemKey: body.idemKey?.trim() || null, method: attMethod,
      },
    });
    if (charge > 0) {
      await tx.studentTransaction.create({
        data: {
          centerId: user.centerId, studentId, sessionId, type: "CHARGE",
          amount: -charge, reason: `حصة ${session.group.subject.name}`, createdBy: user.id,
        },
      });
    }
    return { alreadyAttended: false, attendance, charged: charge };
  });

  if (!result.alreadyAttended) {
    await logAudit({
      user,
      action: AUDIT.ATTENDANCE_RECORDED,
      entity: "ATTENDANCE",
      entityId: result.attendance.id,
      after: { student: student.name, session: session.group.subject.name, status, charged: charge },
    });
  }

  const balance = await studentBalance(studentId);
  return ok({
    alreadyAttended: result.alreadyAttended,
    charged: result.charged,
    balance,
    amountDue: Math.max(-balance, 0),
    studentName: student.name,
    status: result.attendance.status,
  });
});

/** PATCH /api/attendance/mark — update attendance status (manager, or before session close) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireCenterUser();
  if (!hasPermission(user, "EDIT_ATTENDANCE")) {
    throw new ApiError("تعديل الحضور محتاج صلاحية «تعديل الحضور» — كلم مدير السنتر.", 403);
  }
  const body = await readJson<{ attendanceId?: string; status?: string }>(req);
  const id = String(body.attendanceId ?? "");
  const status = String(body.status ?? "");
  if (!["PRESENT", "LATE", "EXCUSED"].includes(status)) throw new ApiError("حالة الحضور دي مش معروفة.");

  const att = await db.attendance.findFirst({
    where: { id, centerId: user.centerId },
    include: { session: { include: { group: { include: { subject: true } } } }, student: true },
  });
  if (!att) throw new ApiError("سجل الحضور ده مش موجود.", 404);
  if (att.session.status === "CLOSED" && user.role !== "MANAGER") {
    throw new ApiError("الحصة مقفولة — التعديل للمدير بس.", 403);
  }

  // ===== عدالة الفلوس: تغيير الحالة بيلغي/يرجّع التحميل بنفس دقة تسجيل الحضور =====
  const wasCharged = att.charged ?? 0;
  let newCharged = wasCharged;
  let reversal: number | null = null;
  let recharge: number | null = null;

  if (status === "EXCUSED" && wasCharged > 0) {
    // كان متحمّل واتغيّر لاعتذار → إلغاء التحميل بقيد موجب في دفتر الحساب
    newCharged = 0;
    reversal = wasCharged;
  } else if (status !== "EXCUSED" && wasCharged === 0 && att.status === "EXCUSED") {
    // كان اعتذار (مجاني) واتغيّر لحاضر/متأخر → التحميل بيرجع بسعر الحصة الحالي
    const reg = await db.studentGroup.findFirst({
      where: { studentId: att.studentId, groupId: att.session.groupId, status: "ACTIVE" },
      select: { priceOverride: true },
    });
    const price = effectivePrice(reg?.priceOverride ?? null, null, att.session.price);
    if (price > 0) {
      newCharged = price;
      recharge = price;
    }
  }

  await db.$transaction(async (tx) => {
    await tx.attendance.update({ where: { id }, data: { status, charged: newCharged } });
    if (reversal && reversal > 0) {
      await tx.studentTransaction.create({
        data: {
          centerId: user.centerId, studentId: att.studentId, sessionId: att.sessionId,
          type: "CHARGE", amount: reversal,
          reason: `إلغاء تحميل حصة (${att.session.group.subject.name}) — اعتذار`,
          createdBy: user.id,
        },
      });
    }
    if (recharge && recharge > 0) {
      await tx.studentTransaction.create({
        data: {
          centerId: user.centerId, studentId: att.studentId, sessionId: att.sessionId,
          type: "CHARGE", amount: -recharge,
          reason: `حصة ${att.session.group.subject.name} (بعد تعديل الحضور)`,
          createdBy: user.id,
        },
      });
    }
  });

  await logAudit({
    user,
    action: AUDIT.ATTENDANCE_UPDATED,
    entity: "ATTENDANCE",
    entityId: id,
    before: { status: att.status, charged: wasCharged },
    after: { status, charged: newCharged },
    reason: `الطالب ${att.student.name}`,
  });
  return ok({ ok: true });
});
