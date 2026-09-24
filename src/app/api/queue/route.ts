import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { toEGP, cleanRaw } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import { buildCampaignMessage, waUrl } from "@/lib/messages";

export const dynamic = "force-dynamic";

/* ============================================================
   طابور الرسائل الدائم (Message Queue) — تسليم يدوي عبر wa.me:
   - إنشاء دفعة (رصيد منخفض / مجموعة / حملة عامة)
   - فلترة الأرقام المشوهة قبل الإنشاء
   - dedupe: مركز + طالب + قالب + شهر (الرسالة المتبعتة متتكررش)
   - رسالة واحدة كل مرة، بضغطة صريحة من الموظف لكل تسليم
   - الحالة صادقة: QUEUED → SENDING (اتفتح واتساب) → SENT (الموظف أكّد)
     | FAILED | SKIPPED | CANCELLED
   - التقدّم محفوظ في الداتابيز — refresh بيكمل من أول رسالة QUEUED
============================================================ */

/** GET /api/queue — الطابور الحالي + إحصائياته + آخر دفعة */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");

  // آخر دفعة لسه فيها شغل، وإلا آخر دفعة خالص
  let batch: { batchId: string; batchLabel: string } | null = null;
  if (batchId) {
    const item = await db.messageQueueItem.findFirst({ where: { centerId: user.centerId, batchId } });
    batch = item ? { batchId: item.batchId, batchLabel: item.batchLabel } : null;
  } else {
    const active = await db.messageQueueItem.findFirst({
      where: { centerId: user.centerId, status: { in: ["QUEUED", "SENDING"] } },
      orderBy: { createdAt: "desc" },
      select: { batchId: true, batchLabel: true },
    });
    if (active) {
      batch = { batchId: active.batchId, batchLabel: active.batchLabel };
    } else {
      const latest = await db.messageQueueItem.findFirst({
        where: { centerId: user.centerId },
        orderBy: { createdAt: "desc" },
        select: { batchId: true, batchLabel: true },
      });
      batch = latest ? { batchId: latest.batchId, batchLabel: latest.batchLabel } : null;
    }
  }

  if (!batch) {
    return ok({ batch: null, stats: null, current: null, items: [], waUrl: null });
  }

  const items = await db.messageQueueItem.findMany({
    where: { centerId: user.centerId, batchId: batch.batchId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const stats = {
    total: items.length,
    queued: items.filter((i) => i.status === "QUEUED").length,
    sending: items.filter((i) => i.status === "SENDING").length, // تم فتح واتساب
    sent: items.filter((i) => i.status === "SENT").length,
    failed: items.filter((i) => i.status === "FAILED").length,
    skipped: items.filter((i) => i.status === "SKIPPED").length,
    cancelled: items.filter((i) => i.status === "CANCELLED").length,
  };

  // الرسالة الحالية = أول QUEUED (اللي لسه) — لو مفيش، آخر SENDING للتأكيد
  const currentItem =
    items.find((i) => i.status === "QUEUED") ??
    [...items].reverse().find((i) => i.status === "SENDING") ??
    null;

  return ok({
    batch,
    stats,
    current: currentItem
      ? {
          id: currentItem.id,
          recipientName: currentItem.recipientName,
          recipientPhone: currentItem.recipientPhone,
          templateKey: currentItem.templateKey,
          messageText: currentItem.messageText,
          status: currentItem.status,
          handoffCount: currentItem.handoffCount,
          waUrl: waUrl(currentItem.recipientPhone, currentItem.messageText),
        }
      : null,
    items: items.slice(0, 200).map((i) => ({
      id: i.id,
      recipientName: i.recipientName,
      recipientPhone: i.recipientPhone,
      status: i.status,
      attempts: i.attempts,
      handoffCount: i.handoffCount,
      lastError: i.lastError,
      messageText: i.messageText,
      createdAt: i.createdAt,
    })),
  });
});

type CreateBody = {
  source?: "low_balance" | "group" | "all";
  groupId?: string;
  templateKey?: string;
  customTitle?: string;
};

/** POST /api/queue — إنشاء دفعة رسائل (مدير أو استقبال) */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const center = user.center!;
  const body = await readJson<CreateBody>(req);
  const source = body.source === "group" ? "group" : body.source === "all" ? "all" : "low_balance";

  // اختيار الطلاب حسب المصدر
  let students = await db.student.findMany({
    where: { centerId: user.centerId, status: { not: "ARCHIVED" } },
    include: { grade: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  if (source === "group" && body.groupId) {
    const regs = await db.studentGroup.findMany({
      where: { groupId: String(body.groupId), status: "ACTIVE" },
      select: { studentId: true },
    });
    const ids = new Set(regs.map((r) => r.studentId));
    students = students.filter((s) => ids.has(s.id));
  }

  // low_balance: رصيد سالب بس + لازم التنبيه مفعّل من الإعدادات
  if (source === "low_balance") {
    if (!center.waLowBalanceEnabled) {
      throw new ApiError("تنبيهات الرصيد مقفولة — شغّلها الأول من الإعدادات ← تنبيهات الواتساب.", 403);
    }
    const withBalance = await Promise.all(
      students.map(async (s) => ({ s, balance: await studentBalance(s.id) })),
    );
    students = withBalance.filter((x) => x.balance < 0).map((x) => x.s);
  }

  if (students.length === 0) {
    throw new ApiError("مفيش طلاب في الفلتر ده — غيّر المصدر وجرّب تاني.");
  }

  // فلترة الأرقام المشوهة/الناقصة قبل الإنشاء
  const valid = students.filter((s) => /^01[0125]\d{8}$/.test(cleanRaw(s.parentPhone ?? "")));
  const invalidCount = students.length - valid.length;
  if (valid.length === 0) {
    throw new ApiError("كل الأرقام ناقصة أو مش صحيحة — راجع أرقام أولياء الأمور في ملفات الطلاب.");
  }

  // dedupe: نفس الطالب + القالب + الشهر = مفيش تكرار
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const batchId = `B${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const templateKey = source === "low_balance" ? "low_balance" : "campaign";
  const batchLabel =
    body.customTitle?.trim() ||
    (source === "low_balance"
      ? `تنبيه رصيد — ${new Date().toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}`
      : source === "group"
        ? `رسالة مجموعة — ${new Date().toLocaleDateString("ar-EG", { day: "numeric", month: "long" })}`
        : `حملة عامة — ${new Date().toLocaleDateString("ar-EG", { day: "numeric", month: "long" })}`);

  // الرسائل مبنية من قالب السنتر (fallback الافتراضي في messages.ts)
  const withMessages = await Promise.all(
    valid.map(async (s) => ({
      student: s,
      message: await buildCampaignMessage({ center, student: s, templateKey }),
    })),
  );

  const existing = await db.messageQueueItem.findMany({
    where: {
      centerId: user.centerId,
      templateKey,
      createdAt: { gte: new Date(`${period}-01T00:00:00.000Z`) },
    },
    select: { dedupeKey: true },
  });
  const doneKeys = new Set(existing.map((e) => e.dedupeKey));

  let created = 0;
  let deduped = 0;

  for (const { student: s, message } of withMessages) {
    const dedupeKey = `${user.centerId}:${s.id}:${templateKey}:${period}`;
    if (doneKeys.has(dedupeKey)) { deduped++; continue; }

    try {
      await db.messageQueueItem.create({
        data: {
          centerId: user.centerId,
          batchId,
          batchLabel,
          studentId: s.id,
          recipientPhone: cleanRaw(s.parentPhone!),
          recipientName: s.parentName || s.name,
          channel: "WA_HANDOFF",
          templateKey,
          messageText: message,
          dedupeKey,
          status: "QUEUED",
          createdBy: user.id,
        },
      });
      created++;
    } catch {
      // unique constraint — اتبعت قبل كده
      deduped++;
    }
  }

  await logAudit({
    user,
    action: AUDIT.QUEUE_CREATED,
    entity: "MESSAGE_QUEUE",
    entityId: batchId,
    after: { batchLabel, created, deduped, invalidCount, source },
  });

  return ok({ batchId, batchLabel, created, deduped, invalidCount, total: created }, { status: 201 });
});

type ActionBody = {
  action?: "open" | "skip" | "confirm-sent" | "fail" | "retry-failed" | "stop" | "retry-item";
  itemId?: string;
  error?: string;
};

/** PATCH /api/queue — أفعال الطابور (واحدة لكل رسالة أو أفعال جماعية) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<ActionBody>(req);
  const action = body.action;

  // ---- أفعال على عنصر واحد ----
  if (action === "open" || action === "skip" || action === "confirm-sent" || action === "fail" || action === "retry-item") {
    const item = await db.messageQueueItem.findFirst({
      where: { id: String(body.itemId ?? ""), centerId: user.centerId },
    });
    if (!item) throw new ApiError("الرسالة دي مش موجودة في الطابور.", 404);

    if (action === "open") {
      // الموظف داس «فتح واتساب» — الحالة الصادقة: SENDING (اتفتحت المحادثة)
      await db.messageQueueItem.update({
        where: { id: item.id },
        data: {
          status: "SENDING",
          attempts: { increment: 1 },
          handoffCount: { increment: 1 },
          lockedAt: new Date(),
          lastError: null,
        },
      });
      return ok({ ok: true, status: "SENDING" });
    }
    if (action === "skip") {
      await db.messageQueueItem.update({ where: { id: item.id }, data: { status: "SKIPPED" } });
      return ok({ ok: true, status: "SKIPPED" });
    }
    if (action === "confirm-sent") {
      // تأكيد صريح من الموظف إن الرسالة اتبعتت فعلًا — دي الحالة الوحيدة لـ SENT
      await db.messageQueueItem.update({
        where: { id: item.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      await logAudit({ user, action: AUDIT.QUEUE_SENT, entity: "MESSAGE_QUEUE", entityId: item.id, after: { recipient: item.recipientName } });
      return ok({ ok: true, status: "SENT" });
    }
    if (action === "fail") {
      await db.messageQueueItem.update({
        where: { id: item.id },
        data: { status: "FAILED", lastError: (body.error ?? "فشل التسليم اليدوي").slice(0, 200) },
      });
      return ok({ ok: true, status: "FAILED" });
    }
    // retry-item
    if (item.status === "SENT") throw new ApiError("الرسالة دي متأكدة كمرسلة — مش محتاجة إعادة.");
    await db.messageQueueItem.update({
      where: { id: item.id },
      data: { status: "QUEUED", lastError: null },
    });
    return ok({ ok: true, status: "QUEUED" });
  }

  // ---- أفعال جماعية ----
  if (action === "retry-failed") {
    const r = await db.messageQueueItem.updateMany({
      where: { centerId: user.centerId, status: "FAILED" },
      data: { status: "QUEUED", lastError: null },
    });
    return ok({ ok: true, reset: r.count });
  }

  if (action === "stop") {
    // إيقاف الطابور: كل اللي لسه QUEUED/SENDING يتعلم CANCELLED
    const r = await db.messageQueueItem.updateMany({
      where: { centerId: user.centerId, status: { in: ["QUEUED", "SENDING"] } },
      data: { status: "CANCELLED" },
    });
    await logAudit({
      user,
      action: AUDIT.QUEUE_STOPPED,
      entity: "MESSAGE_QUEUE",
      after: { cancelled: r.count },
    });
    return ok({ ok: true, cancelled: r.count });
  }

  throw new ApiError("العملية دي مش معروفة.");
});
