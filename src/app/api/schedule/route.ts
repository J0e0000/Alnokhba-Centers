import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toPiastres, dayNameAR, formatTime12 } from "@/lib/normalize";
import { notifyGroupStudents } from "@/lib/notify";

export const dynamic = "force-dynamic";

const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday-first Egyptian week

/** GET /api/schedule — weekly schedule grouped by day */
export const GET = handler(async () => {
  const user = await requireCenterUser();

  const [slots, groups, rooms] = await Promise.all([
    db.scheduleSlot.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: {
        group: {
          include: {
            subject: true, grade: true, teacher: true,
            _count: { select: { students: true } },
          },
        },
      },
      orderBy: { startTime: "asc" },
    }),
    db.group.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: { subject: true, grade: true, teacher: true },
      orderBy: { createdAt: "asc" },
    }),
    db.room.findMany({
      where: { centerId: user.centerId, isActive: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const days = DAY_ORDER.map((dow) => ({
    dayOfWeek: dow,
    slots: slots
      .filter((s) => s.dayOfWeek === dow)
      .map((s) => ({
        id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, room: s.room,
        groupId: s.groupId, groupName: s.group.name,
        subject: s.group.subject.name, grade: s.group.grade.name,
        teacher: s.group.teacher?.name ?? "—", teacherId: s.group.teacherId,
        price: s.group.sessionPrice, teacherPercent: s.group.teacherPercent,
        students: s.group._count.students,
      })),
  }));

  return ok({
    days, rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
    groups: groups.map((g) => ({
    id: g.id, name: g.name, subject: g.subject.name, subjectId: g.subjectId,
    grade: g.grade.name, gradeId: g.gradeId,
    teacher: g.teacher?.name ?? null, teacherId: g.teacherId,
    price: g.sessionPrice, teacherPercent: g.teacherPercent, room: g.room,
  })) });
});

type SlotBody = {
  id?: string;
  dayOfWeek?: number; startTime?: string; endTime?: string;
  groupId?: string; room?: string;
};

/** POST /api/schedule — add a slot (manager) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<SlotBody>(req);

  const day = Number(body.dayOfWeek);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new ApiError("اختار اليوم.");
  if (!/^\d{2}:\d{2}$/.test(body.startTime ?? "") || !/^\d{2}:\d{2}$/.test(body.endTime ?? "")) {
    throw new ApiError("اكتب وقت البداية والنهاية بشكل صحيح (مثلاً 05:00 م).");
  }
  if (body.endTime! <= body.startTime!) throw new ApiError("وقت النهاية لازم بعد البداية.");

  const group = await db.group.findFirst({ where: { id: String(body.groupId), centerId: user.centerId }, include: { teacher: true, subject: true } });
  if (!group) throw new ApiError("اختار المجموعة.");

  // كشف التعارض في نفس اليوم: نفس القاعة أو نفس المدرس بتداخل وقتي
  const sameDay = await db.scheduleSlot.findMany({
    where: { centerId: user.centerId, dayOfWeek: day, isActive: true },
    include: { group: { include: { subject: { select: { name: true } }, teacher: true } } },
  });
  for (const s of sameDay) {
    const overlaps = s.startTime < body.endTime! && s.endTime > body.startTime!;
    if (!overlaps) continue;
    if (body.room && s.room && s.room === body.room) {
      throw new ApiError(`القاعة محجوزة في نفس الوقت — عندها حصة ${s.group.subject.name} من ${s.startTime} لـ ${s.endTime}.`);
    }
    if (group.teacherId && s.group.teacherId === group.teacherId) {
      throw new ApiError(`المدرس محجوز في حصة تانية في نفس الوقت (${s.group.subject.name} من ${s.startTime} لـ ${s.endTime}) — اختار وقت تاني.`);
    }
  }

  const slot = await db.scheduleSlot.create({
    data: { centerId: user.centerId, dayOfWeek: day, startTime: body.startTime!, endTime: body.endTime!, groupId: group.id, room: body.room ?? null },
  });
  await logAudit({ user, action: AUDIT.SCHEDULE_ADDED, entity: "SCHEDULE", entityId: slot.id, after: { day, startTime: body.startTime, group: group.name } });

  // إشعار تلقائي: "تم تحديث جدولك" — مفيش رسائل تقنية للطلاب
  await notifyGroupStudents(
    user.centerId, group.id, "SCHEDULE_CHANGE",
    "📅 اتضاف حصة لجدولك",
    `حصة ${group.subject.name} — يوم ${dayNameAR(day)} الساعة ${formatTime12(body.startTime!)}${body.room ? ` في ${body.room}` : ""}.`,
  );

  return ok({ slot: { id: slot.id } }, { status: 201 });
});

/** PATCH /api/schedule — update a slot (manager) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<SlotBody>(req);
  const slot = await db.scheduleSlot.findFirst({ where: { id: String(body.id), centerId: user.centerId } });
  if (!slot) throw new ApiError("الحصة دي مش موجودة في الجدول.", 404);

  const data: Record<string, unknown> = {};
  if (body.dayOfWeek !== undefined) {
    const day = Number(body.dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new ApiError("اليوم مش صحيح.");
    data.dayOfWeek = day;
  }
  if (body.startTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(body.startTime)) throw new ApiError("وقت البداية مش صحيح.");
    data.startTime = body.startTime;
  }
  if (body.endTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(body.endTime)) throw new ApiError("وقت النهاية مش صحيح.");
    data.endTime = body.endTime;
  }
  if (data.startTime && data.endTime && data.endTime <= data.startTime) throw new ApiError("وقت النهاية لازم بعد البداية.");
  if (body.room !== undefined) data.room = body.room || null;
  if (body.groupId !== undefined) {
    const group = await db.group.findFirst({ where: { id: String(body.groupId), centerId: user.centerId }, include: { teacher: true, subject: true } });
    if (!group) throw new ApiError("المجموعة مش موجودة.");
    data.groupId = group.id;
  }

  // كشف التعارض بعد التعديل: نجيب السلوة محدّثة (المجموعة الجديدة/القاعة الجديدة)
  // ونتحقق من التداخل مع باقي حصص نفس اليوم (باستثناء السلوة نفسها)
  const finalDay = data.dayOfWeek !== undefined ? Number(data.dayOfWeek) : slot.dayOfWeek;
  const finalStart = (data.startTime as string) ?? slot.startTime;
  const finalEnd = (data.endTime as string) ?? slot.endTime;
  const finalRoom = body.room !== undefined ? (body.room || null) : slot.room;
  if (finalEnd <= finalStart) throw new ApiError("وقت النهاية لازم بعد البداية.");

  const effectiveGroupId = (data.groupId as string) ?? slot.groupId;
  const effectiveGroup = await db.group.findUnique({ where: { id: effectiveGroupId }, include: { teacher: true, subject: true } });

  const sameDay = await db.scheduleSlot.findMany({
    where: { centerId: user.centerId, dayOfWeek: finalDay, isActive: true, id: { not: slot.id } },
    include: { group: { include: { subject: { select: { name: true } }, teacher: true } } },
  });
  for (const s of sameDay) {
    const overlaps = s.startTime < finalEnd && s.endTime > finalStart;
    if (!overlaps) continue;
    if (finalRoom && s.room && s.room === finalRoom) {
      throw new ApiError(`القاعة محجوزة في نفس الوقت — عندها حصة ${s.group.subject.name} من ${s.startTime} لـ ${s.endTime}.`);
    }
    if (effectiveGroup?.teacherId && s.group.teacherId === effectiveGroup.teacherId) {
      throw new ApiError(`المدرس محجوز في حصة تانية في نفس الوقت (${s.group.subject.name} من ${s.startTime} لـ ${s.endTime}) — اختار وقت تاني.`);
    }
  }

  await db.scheduleSlot.update({ where: { id: slot.id }, data: data as never });
  await logAudit({ user, action: AUDIT.SCHEDULE_UPDATED, entity: "SCHEDULE", entityId: slot.id, before: { day: slot.dayOfWeek, startTime: slot.startTime }, after: data });

  // إشعار تلقائي لطلاب المجموعة — نوع الإشعار حسب اللي اتغير فعلاً
  const changedGroup = await db.group.findUnique({
    where: { id: effectiveGroupId },
    include: { subject: { select: { name: true } } },
  });
  if (changedGroup) {
    const subjectName = changedGroup.subject.name;
    const timeChanged = data.startTime !== undefined || data.endTime !== undefined || data.dayOfWeek !== undefined;
    const roomChanged = body.room !== undefined && (body.room || null) !== slot.room;
    if (timeChanged) {
      await notifyGroupStudents(
        user.centerId, changedGroup.id, "TIME_CHANGE",
        "⏰ تغيير ميعاد حصة",
        `حصة ${subjectName} اتنقلت من ${dayNameAR(slot.dayOfWeek)} ${formatTime12(slot.startTime)} إلى ${dayNameAR(finalDay)} ${formatTime12(finalStart)}.`,
      );
    } else if (roomChanged) {
      await notifyGroupStudents(
        user.centerId, changedGroup.id, "LOCATION_CHANGE",
        "📍 تغيير مكان حصة",
        `حصة ${subjectName} يوم ${dayNameAR(finalDay)} هتبقى في ${finalRoom || "القاعة الرئيسية"} بدل ${slot.room || "القاعة الرئيسية"}.`,
      );
    }
  }

  return ok({ ok: true });
});

/** DELETE /api/schedule?id= — remove a slot (manager) */
export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const slot = await db.scheduleSlot.findFirst({ where: { id, centerId: user.centerId }, include: { group: { include: { subject: true } } } });
  if (!slot) throw new ApiError("الحصة دي مش موجودة في الجدول.", 404);

  await db.scheduleSlot.update({ where: { id }, data: { isActive: false } });
  await logAudit({ user, action: AUDIT.SCHEDULE_DELETED, entity: "SCHEDULE", entityId: id, after: { day: slot.dayOfWeek, time: slot.startTime, group: slot.group.subject.name } });

  // إشعار تلقائي: الحصة اتشالت من جدولهم
  await notifyGroupStudents(
    user.centerId, slot.groupId, "SCHEDULE_CHANGE",
    "📅 اتلغت حصة من جدولك",
    `حصة ${slot.group.subject.name} يوم ${dayNameAR(slot.dayOfWeek)} الساعة ${formatTime12(slot.startTime)} اتشالت من الجدول — راجع جدولك المحدّث.`,
  );

  return ok({ ok: true });
});

/** PUT /api/schedule — quick price update from schedule editor (manager) */
export const PUT = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<{ groupId?: string; price?: number; teacherPercent?: number }>(req);
  const group = await db.group.findFirst({ where: { id: String(body.groupId), centerId: user.centerId } });
  if (!group) throw new ApiError("المجموعة مش موجودة.", 404);

  const data: Record<string, number> = {};
  if (body.price !== undefined && body.price !== null && body.price !== ("" as unknown)) {
    const p = toPiastres(Number(body.price));
    if (p <= 0) throw new ApiError("سعر الحصة لازم يكون أكبر من صفر.");
    if (p > toPiastres(2000)) throw new ApiError("سعر الحصة كبير بشكل غير منطقي — راجعه.");
    data.sessionPrice = p;
  }
  if (body.teacherPercent !== undefined && body.teacherPercent !== null) {
    const pct = Number(body.teacherPercent);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new ApiError("نسبة المدرس لازم تكون من 0 لـ 100.");
    data.teacherPercent = pct;
  }

  await db.group.update({ where: { id: group.id }, data: data as never });
  await logAudit({
    user, action: data.sessionPrice !== undefined ? AUDIT.PRICE_CHANGED : AUDIT.PERCENT_CHANGED,
    entity: "GROUP", entityId: group.id,
    before: { sessionPrice: group.sessionPrice, teacherPercent: group.teacherPercent }, after: data,
  });
  return ok({ ok: true });
});
