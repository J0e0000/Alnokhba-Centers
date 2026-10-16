import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toPiastres, dayNameAR, formatTime12, todayStr } from "@/lib/normalize";
import { recordUndo } from "@/lib/undo";
import { notifyGroupStudents } from "@/lib/notify";

export const dynamic = "force-dynamic";

const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday-first Egyptian week

// ============================================================
// جدول v2 — تفاعلي بالقاعات والبلوكات:
// - التعارض (نفس المدرس/نفس القاعة بتداخل وقتي حقيقي) = تحذير غير حاجز:
//   السيرفر بيرجع 409 مع تفاصيل التعارض، والعميل بيعيد الإرسال بـ confirmConflict + سبب.
//   التجاوز بيتسجل في سجل التدقيق (الممثل + الوقت + الحصص المتأثرة + السبب).
// - الأخطاء الحاجزة بس: بيانات ناقصة/غير صحيحة، وقت معكوس، أو عملية غير مصرّح بها.
// - قفل التزامن: PATCH لازم يبعت updatedAt اللي شافه — لو اتغير قبله → 409 stale.
// ============================================================

type SlotConflict = {
  type: "TEACHER" | "ROOM" | "DUPLICATE";
  label: string;
  detail: string;
  withSlotId?: string;
};

/** تداخل فترات حقيقي (مش مجرد مطابقة أوقات البداية) — a.start < b.end && b.start < a.end */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

type DaySlotRow = {
  id: string;
  startTime: string;
  endTime: string;
  room: string | null;
  groupId: string;
  teacherId: string | null;
  subject: string;
  groupName: string;
  teacherName: string | null;
};

/** بيجيب حصص يوم معين (مع كل اللي محتاجينه لكشف التعارض) */
async function loadDaySlots(centerId: string, dayOfWeek: number, excludeId?: string): Promise<DaySlotRow[]> {
  const rows = await db.scheduleSlot.findMany({
    where: { centerId, dayOfWeek, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { group: { include: { subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
    orderBy: { startTime: "asc" },
  });
  return rows.map((s) => ({
    id: s.id, startTime: s.startTime, endTime: s.endTime, room: s.room,
    groupId: s.groupId, teacherId: s.group.teacherId,
    subject: s.group.subject.name, groupName: s.group.name, teacherName: s.group.teacher?.name ?? null,
  }));
}

/**
 * كشف تعارض سلوت واحد ضد حصص يومه — تداخل فتري حقيقي.
 * - TEACHER / ROOM: تعارض موارد (غير حاجز بتأكيد) — بيتفحص كل البلوكات المشغولة،
 *   فحصة 4 ساعات بتتعارض مع أي حصة بتلامس أي بلوك منها.
 * - DUPLICATE: تلميح غير حاجز لمجموعة نفسها متكررة في نفس الوقت (مش بيمنع الحفظ أبدًا).
 * - مطابقة الصف/القسم/المادة لوحدها مش تعارض أبدًا — الحصص المتوازية للمجموعات المختلفة حرة.
 */
function conflictsForSlot(candidate: {
  startTime: string; endTime: string; room: string | null; groupId: string; teacherId: string | null;
}, daySlots: DaySlotRow[]): SlotConflict[] {
  const out: SlotConflict[] = [];
  for (const s of daySlots) {
    if (!overlaps(candidate.startTime, candidate.endTime, s.startTime, s.endTime)) continue;
    if (candidate.teacherId && s.teacherId === candidate.teacherId) {
      out.push({
        type: "TEACHER",
        label: `تعارض مدرس — ${s.teacherName ?? "—"}`,
        detail: `${s.subject} (${s.groupName}) من ${formatTime12(s.startTime)} لـ ${formatTime12(s.endTime)} لنفس المدرس`,
        withSlotId: s.id,
      });
    }
    if (candidate.room && s.room && candidate.room === s.room) {
      out.push({
        type: "ROOM",
        label: `تعارض قاعة — ${candidate.room}`,
        detail: `${s.subject} (${s.groupName}) محجوزة في القاعة دي من ${formatTime12(s.startTime)} لـ ${formatTime12(s.endTime)}`,
        withSlotId: s.id,
      });
    }
    if (candidate.groupId === s.groupId) {
      out.push({
        type: "DUPLICATE",
        label: `تكرار محتمل — ${s.subject} (${s.groupName})`,
        detail: `نفس المجموعة ليها حصة متقاطعة من ${formatTime12(s.startTime)} لـ ${formatTime12(s.endTime)} — لو مقصودة كمّل عادي`,
        withSlotId: s.id,
      });
    }
  }
  return out;
}

function splitBlocking(all: SlotConflict[]): { blocking: SlotConflict[]; hints: SlotConflict[] } {
  return {
    blocking: all.filter((c) => c.type === "TEACHER" || c.type === "ROOM"),
    hints: all.filter((c) => c.type === "DUPLICATE"),
  };
}

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
        // للعرض الشبكي + قفل التزامن
        updatedAt: s.updatedAt.toISOString(),
        lastOverrideAt: s.lastOverrideAt ? s.lastOverrideAt.toISOString() : null,
      })),
  }));

  // ===== تنبيهات الجدول الذكية (spec §12) — كشف مشكلة قبل ما تحصل =====
  const conflicts: { type: string; label: string; detail: string }[] = [];
  // 1) تعارض مدرس/قاعة داخل نفس اليوم (من تعديلات قديمة أو سلوتات متعدلة)
  for (const dow of DAY_ORDER) {
    const daySlots = slots.filter((s) => s.dayOfWeek === dow);
    for (let i = 0; i < daySlots.length; i++) {
      for (let j = i + 1; j < daySlots.length; j++) {
        const a = daySlots[i], b = daySlots[j];
        if (!overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
        if (a.group.teacherId && a.group.teacherId === b.group.teacherId) {
          conflicts.push({
            type: "TEACHER",
            label: `تعارض مدرس — ${a.group.teacher?.name ?? "—"}`,
            detail: `يوم ${dayNameAR(dow)}: ${a.group.subject.name} (${a.startTime}) متقاطعة مع ${b.group.subject.name} (${b.startTime})`,
          });
        }
        if (a.room && a.room === b.room) {
          conflicts.push({
            type: "ROOM",
            label: `تعارض قاعة — ${a.room}`,
            detail: `يوم ${dayNameAR(dow)}: ${a.group.subject.name} (${a.startTime}) مع ${b.group.subject.name} (${b.startTime})`,
          });
        }
      }
    }
  }
  // 2) مجموعة جدولها شغال ومفيش حصة اتولدت ليها آخر 10 أيام
  // PERF: كانت N+1 (count لكل مجموعة — حتى 40 استعلام متسلسل = ثواني) →
  // استعلام groupBy واحد بفهرس (groupId, date) — جولة DB واحدة بدل 40.
  const today = todayStr();
  const since10 = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const activeGroupIds = [...new Set(slots.map((s) => s.groupId))].slice(0, 40);
  const sessionCounts = activeGroupIds.length
    ? await db.sessionInstance.groupBy({
        by: ["groupId"],
        _count: { _all: true },
        where: { centerId: user.centerId, groupId: { in: activeGroupIds }, date: { gte: since10 } },
      })
    : [];
  const counted = new Map(sessionCounts.map((g) => [g.groupId, g._count._all]));
  for (const gid of activeGroupIds) {
    const g = groups.find((x) => x.id === gid);
    if (!g) continue;
    if ((counted.get(gid) ?? 0) === 0) {
      conflicts.push({
        type: "GAP",
        label: `مجموعة ${g.subject.name} — ${g.name} واقفة`,
        detail: "عليها جدول ومفيش أي حصة اتولدت آخر 10 أيام — راجع المواعيد أو فعّل توليد الحصص",
      });
      if (conflicts.length >= 8) break;
    }
  }
  // 3) حصص مفتوحة متسابة من أيام فاتت
  const openOld = await db.sessionInstance.count({ where: { centerId: user.centerId, status: "OPEN", date: { lt: today } } });
  if (openOld > 0) {
    conflicts.push({
      type: "UNCLOSED",
      label: `${openOld} حصة فاتت ومتقفلتش`,
      detail: "اقفلها بعد مراجعة الحضور — الحسابات بتتثبت بالقفل",
    });
  }

  return ok({
    days, conflicts, rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
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
  // جدول v2: تجاوز التعارض بعد التأكيد الصريح + سبب مكتوب
  confirmConflict?: boolean;
  conflictReason?: string;
  // قفل التزامن: ISO updatedAt اللي العميل شافه — لو اتغيّر قبله → 409
  updatedAt?: string;
};

async function resolveGroup(centerId: string, groupId?: string) {
  if (!groupId) throw new ApiError("اختار المجموعة.");
  const group = await db.group.findFirst({
    where: { id: String(groupId), centerId },
    include: { teacher: true, subject: true },
  });
  if (!group) throw new ApiError("المجموعة مش موجودة.");
  return group;
}

function validateTimes(startTime?: string, endTime?: string): { start: string; end: string } {
  if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new ApiError("اكتب وقت البداية والنهاية بشكل صحيح (مثلاً 05:00 م).");
  }
  if (endTime <= startTime) throw new ApiError("وقت النهاية لازم بعد البداية.");
  return { start: startTime, end: endTime };
}

/** POST /api/schedule — add a slot (manager) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<SlotBody>(req);

  const day = Number(body.dayOfWeek);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new ApiError("اختار اليوم.");
  const { start, end } = validateTimes(body.startTime, body.endTime);
  const group = await resolveGroup(user.centerId, body.groupId);
  const room = body.room ? String(body.room) : null;

  // كشف التعارض بتداخل فتري حقيقي — كل البلوكات المشغولة
  const daySlots = await loadDaySlots(user.centerId, day);
  const all = conflictsForSlot(
    { startTime: start, endTime: end, room, groupId: group.id, teacherId: group.teacherId },
    daySlots,
  );
  const { blocking, hints } = splitBlocking(all);

  // تعارض موارد من غير تأكيد صريح → 409 بالتفاصيل (العميل بيعرضها ويعيد الإرسال بتأكيد)
  if (blocking.length > 0 && body.confirmConflict !== true) {
    return ok({ needsConfirm: true, conflicts: blocking, hints }, { status: 409 });
  }
  if (blocking.length > 0 && !String(body.conflictReason ?? "").trim()) {
    throw new ApiError("لو هتحفظ رغم التعارض، اكتب السبب في خانة التأكيد.");
  }

  const slot = await db.scheduleSlot.create({
    data: {
      centerId: user.centerId, dayOfWeek: day, startTime: start, endTime: end,
      groupId: group.id, room,
    },
  });

  await logAudit({
    user, action: AUDIT.SCHEDULE_ADDED, entity: "SCHEDULE", entityId: slot.id,
    after: { day, startTime: start, group: group.name },
  });
  if (blocking.length > 0) {
    // سجل تدقيق مخصص للتجاوز: الممثل + الوقت + الحصص المتأثرة + السبب (append-only)
    await logAudit({
      user, action: "تجاوز تعارض جدول", entity: "SCHEDULE", entityId: slot.id,
      after: {
        newSlot: { day: dayNameAR(day), startTime: start, endTime: end, room, group: group.name },
        affected: blocking.map((c) => ({ slotId: c.withSlotId, type: c.type, detail: c.detail })),
      },
      reason: String(body.conflictReason).trim(),
    });
    await db.scheduleSlot.update({ where: { id: slot.id }, data: { lastOverrideAt: new Date() } });
  }
  // قابل للتراجع (spec §13) — التراجع بيعطّل السلوت (مش مسح)
  await recordUndo({
    user, entity: "SCHEDULE_SLOT", entityId: slot.id, action: "CREATE",
    label: `إضافة حصة ${group.name} — ${dayNameAR(day)} ${start}`,
    forward: { id: slot.id, centerId: user.centerId, dayOfWeek: day, startTime: start, endTime: end, groupId: group.id, room },
    inverse: { isActive: false },
  });

  // إشعار تلقائي: "تم تحديث جدولك" — مفيش رسائل تقنية للطلاب
  await notifyGroupStudents(
    user.centerId, group.id, "SCHEDULE_CHANGE",
    "📅 اتضاف حصة لجدولك",
    `حصة ${group.subject.name} — يوم ${dayNameAR(day)} الساعة ${formatTime12(start)}${room ? ` في ${room}` : ""}.`,
  );

  return ok({
    slot: { id: slot.id, updatedAt: slot.updatedAt.toISOString() },
    hints, overrides: blocking.length > 0,
  }, { status: 201 });
});

/** PATCH /api/schedule — update a slot (manager) with optimistic concurrency */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<SlotBody>(req);
  const slot = await db.scheduleSlot.findFirst({
    where: { id: String(body.id), centerId: user.centerId },
    include: { group: { include: { teacher: true, subject: true } } },
  });
  if (!slot) throw new ApiError("الحصة دي مش موجودة في الجدول.", 404);

  // قفل التزامن: العميل بيبعت updatedAt اللي شافه — لو حد تاني سبقه → 409 stale
  if (body.updatedAt) {
    const seen = new Date(body.updatedAt);
    if (isNaN(seen.getTime())) throw new ApiError("بيانات التزامن مش صحيحة — حدّث الصفحة.");
    if (seen.getTime() !== slot.updatedAt.getTime()) {
      return ok({ stale: true, error: "حد تاني عدّل الحصة دي قبلك — هات نسخة fresh وقيد تاني." }, { status: 409 });
    }
  }

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
  if (body.room !== undefined) data.room = body.room || null;
  if (body.groupId !== undefined) {
    const group = await resolveGroup(user.centerId, body.groupId);
    data.groupId = group.id;
  }

  const finalDay = data.dayOfWeek !== undefined ? Number(data.dayOfWeek) : slot.dayOfWeek;
  const finalStart = (data.startTime as string) ?? slot.startTime;
  const finalEnd = (data.endTime as string) ?? slot.endTime;
  const finalRoom = body.room !== undefined ? (body.room || null) : slot.room;
  if (finalEnd <= finalStart) throw new ApiError("وقت النهاية لازم بعد البداية.");

  const effectiveGroupId = (data.groupId as string) ?? slot.groupId;
  const effectiveGroup = await db.group.findUnique({ where: { id: effectiveGroupId }, include: { teacher: true, subject: true } });

  // كشف التعارض بعد التعديل (باستثناء السلوت نفسه — مفيش self-conflict)
  const daySlots = await loadDaySlots(user.centerId, finalDay, slot.id);
  const all = conflictsForSlot(
    { startTime: finalStart, endTime: finalEnd, room: finalRoom, groupId: effectiveGroupId, teacherId: effectiveGroup?.teacherId ?? null },
    daySlots,
  );
  const { blocking, hints } = splitBlocking(all);

  if (blocking.length > 0 && body.confirmConflict !== true) {
    return ok({ needsConfirm: true, conflicts: blocking, hints }, { status: 409 });
  }
  if (blocking.length > 0 && !String(body.conflictReason ?? "").trim()) {
    throw new ApiError("لو هتحفظ رغم التعارض، اكتب السبب في خانة التأكيد.");
  }

  // التحديث الذري: بنفس شرط updatedAt — لو حد تاني عدّل في اللحظة دي بيتفشل بدل ما يكتب فوقه
  const res = await db.scheduleSlot.updateMany({
    where: {
      id: slot.id, centerId: user.centerId,
      ...(body.updatedAt ? { updatedAt: new Date(body.updatedAt) } : {}),
    },
    data: {
      ...data,
      ...(blocking.length > 0 ? { lastOverrideAt: new Date() } : {}),
    } as never,
  });
  if (res.count === 0) {
    return ok({ stale: true, error: "حد تاني عدّل الحصة دي قبلك — هات نسخة fresh وقيد تاني." }, { status: 409 });
  }

  await logAudit({
    user, action: AUDIT.SCHEDULE_UPDATED, entity: "SCHEDULE", entityId: slot.id,
    before: { day: slot.dayOfWeek, startTime: slot.startTime }, after: data,
  });
  if (blocking.length > 0) {
    await logAudit({
      user, action: "تجاوز تعارض جدول", entity: "SCHEDULE", entityId: slot.id,
      after: {
        slot: { day: dayNameAR(finalDay), startTime: finalStart, endTime: finalEnd, room: finalRoom },
        affected: blocking.map((c) => ({ slotId: c.withSlotId, type: c.type, detail: c.detail })),
      },
      reason: String(body.conflictReason).trim(),
    });
  }

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

  const fresh = await db.scheduleSlot.findUnique({ where: { id: slot.id }, select: { updatedAt: true } });
  return ok({ ok: true, hints, overrides: blocking.length > 0, slot: { id: slot.id, updatedAt: fresh?.updatedAt.toISOString() } });
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
