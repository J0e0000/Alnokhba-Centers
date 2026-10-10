import "server-only";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";

/* ============================================================
   DYNAMIC SESSION QR (QR الحصة المتنقل) — spec §3
   الطريقة الثالثة للحضور جنب (مسح كارت الطالب + الاختيار اليدوي).
   - التوكن مرتبط بحصة واحدة + سنتر واحد
   - قصير العمر (TTL دقيقتين) وبيتعمل rotate (القديم يتقفل)
   - الاستخدام بيتسجل: من (صاحب التوكن) / إمتى / كام مرة
   - منع التكرار: unique(sessionId, studentId) زي أي طريقة تانية
   - كل قواعد التحقق الحالية محترمة (حصة مفتوحة + طالب مسجل + مش مؤرشف)
============================================================ */

export const SESSION_QR_TTL_MS = 120_000; // دقيقتين صلاحية افتراضية للتوكن الواحد
// التدوير السريع (spec §9): كل استدعاء rotate بيلغي القديم — التوصكن يعيش مدة التدوير + هامش شبكة
export const QR_ROTATE_GRACE_MS = 8_000;

// ============================================================
// موديل Slot QR (الحل النهائي بعد تجربة الدفعة المتحركة):
// كود واحد على الشاشة لمدة 10 ثواني (الحد الأدنى الكاميرا بتلحق تقراه
// براحتها تامة — أي سكانر عادي بيقراه لأن الكود ثابت وسليم من غير لمعة)،
// وكل كود جديد بيتولد والكود اللي قبله بيموت لوحده بعد هامش شبكة صغير —
// يعني الصورة/السكرين شوت بيمسك كود عمره 10 ثواني كحد أقصى وبيموت فورًا.
// الحماية من التصوير هنا = العمر القصير جدًا (مش التشويه البصري اللي
// كان بيكسّر السكانر العادي). قبل نهاية كل ثانية العاشرة الشاشة بتجيب
// الكود الجاي في الخلفية فمفيش فراغ.
// ============================================================
export const QR_SLOT_SECONDS = 10; // كل كود بيعيش 10 ثواني على الشاشة
export const QR_SLOT_GRACE_MS = 4_000; // الكود بيكمل شغال 4ث بعد ما يتنزل عن الشاشة (الـ claims اللي في الطريق)
export const QR_ACTIVATION_GRACE_MS = 90_000; // تفعيل أول مرة (كود+موبايل) بياخد وقت — الطالب اللي فتح الرابط وهو حاضر مكانه محفوظ لمدة دقيقة ونص

export type SessionQrScope = "CENTERS" | "ACADEMIA";

/** توليد توكن جديد (أو rotate) لحصة مفتوحة — يُستدعى من شاشة الحصة/المدرس فقط */
export async function issueSessionQr(opts: {
  scope: SessionQrScope;
  sessionId: string;
  centerId: string | null;
  createdById: string;
  createdByName: string;
  ttlMs?: number; // للتدوير السريع: rotateSeconds + هامش
}): Promise<{ token: string; expiresAt: string; rotated: boolean }> {
  // rotate: قفل أي توكن نشط قديم لنفس الحصة
  const old = await db.sessionQRToken.findMany({
    where: { sessionId: opts.sessionId, scope: opts.scope, isActive: true },
    select: { id: true },
  });
  if (old.length) {
    await db.sessionQRToken.updateMany({
      where: { id: { in: old.map((o) => o.id) } },
      data: { isActive: false, expiresAt: new Date() },
    });
  }
  const token = randomBytes(20).toString("hex");
  const ttl = Math.max(QR_ROTATE_GRACE_MS + 5_000, opts.ttlMs ?? SESSION_QR_TTL_MS);
  const row = await db.sessionQRToken.create({
    data: {
      scope: opts.scope,
      sessionId: opts.sessionId,
      centerId: opts.centerId,
      token,
      isActive: true,
      expiresAt: new Date(Date.now() + ttl),
      createdById: opts.createdById,
      createdByName: opts.createdByName,
    },
  });
  return { token: row.token, expiresAt: row.expiresAt.toISOString(), rotated: old.length > 0 };
}

/** إعدادات الدفعات (batch) — توليد أكواد متعددة تموت مع بعض في نهاية الدفعة */
export const QR_BATCH_DEFAULT_COUNT = 10;
export const QR_BATCH_SLOT_SECONDS = 5;

/** توليد دفعة أكواد QR متحركة: N كود كلهم نشطين بتنتهي مع بعض في نهاية الدفعة —
 *  الشاشة بتفل بينهم كل slotSeconds، فأي سكرين شوت بيمسك كود واحد بيموت مع الدفعة.
 *  كل دفعة جديدة بتقفل اللي قبلها بهامش QR_ROTATE_GRACE_MS (نفس عقد التدوير). */
export async function issueSessionQrBatch(opts: {
  scope: SessionQrScope;
  sessionId: string;
  centerId: string | null;
  createdById: string;
  createdByName: string;
  count: number;
  ttlMs?: number;
}): Promise<{ codes: { token: string; expiresAt: string }[]; batchExpiresAt: string; deactivated: number }> {
  const count = Math.max(2, Math.min(20, Math.round(opts.count)));
  const ttl = Math.max(
    10_000,
    Math.min(10 * 60_000, opts.ttlMs ?? count * QR_BATCH_SLOT_SECONDS * 1000 + 5_000),
  );
  // قفل أي توكن نشط قديم لنفس الحصة (نفس عقد issueSessionQr)
  const old = await db.sessionQRToken.findMany({
    where: { sessionId: opts.sessionId, scope: opts.scope, isActive: true },
    select: { id: true },
  });
  if (old.length) {
    await db.sessionQRToken.updateMany({
      where: { id: { in: old.map((o) => o.id) } },
      data: { isActive: false, expiresAt: new Date() },
    });
  }
  const expiresAt = new Date(Date.now() + ttl);
  const codes: { token: string; expiresAt: string }[] = [];
  for (let i = 0; i < count; i++) {
    const token = randomBytes(20).toString("hex");
    const row = await db.sessionQRToken.create({
      data: {
        scope: opts.scope,
        sessionId: opts.sessionId,
        centerId: opts.centerId,
        token,
        isActive: true,
        expiresAt,
        createdById: opts.createdById,
        createdByName: opts.createdByName,
      },
    });
    codes.push({ token: row.token, expiresAt: row.expiresAt.toISOString() });
  }
  return { codes, batchExpiresAt: expiresAt.toISOString(), deactivated: old.length };
}

/** توليد كود السلوت الحالي (الموديل الجديد) — كود واحد لكل نداء، بيكمل شغال
 *  مدة السلوت + هامش شبكة صغير وبعده بيموت لوحده (اللي قبله بيموت قبله).
 *  أكتر من شاشة عرض في نفس اللحظة = عادي: كل كود بيعيش عمره القصير بنفسه. */
export async function issueSessionQrSlot(opts: {
  scope: SessionQrScope;
  sessionId: string;
  centerId: string | null;
  createdById: string;
  createdByName: string;
  slotSeconds?: number;
}): Promise<{ token: string; expiresAt: string; slotSeconds: number }> {
  // قابل للضبط 5..60 ثانية (spec §3 — ممنوع hardcode 10) — الافتراضي 10
  const slotSeconds = Math.max(5, Math.min(60, Math.round(opts.slotSeconds ?? QR_SLOT_SECONDS)));
  const token = randomBytes(20).toString("hex");
  const ttl = slotSeconds * 1000 + QR_SLOT_GRACE_MS;
  const row = await db.sessionQRToken.create({
    data: {
      scope: opts.scope,
      sessionId: opts.sessionId,
      centerId: opts.centerId,
      token,
      isActive: true,
      expiresAt: new Date(Date.now() + ttl),
      createdById: opts.createdById,
      createdByName: opts.createdByName,
    },
  });
  return { token: row.token, expiresAt: row.expiresAt.toISOString(), slotSeconds };
}

/** التحقق من التوكن (من غير استهلاك) — بيعيد معلومات الحصة للعرض.
 *  graceMs: سماحية إضافية بعد انتهاء الصلاحية (بتستخدم بس في claim بعد
 *  تفعيل أول مرة — الطالب اللي فتح الرابط وهو حاضر وبيكتب كوده وموبايله
 *  بياخد وقت أطول من عمر الكود، فمكانه محفوظ لمدة قصيرة محسوبة).
 *  الأخطاء بتحمل code: EXPIRED (قديم منتهي) | INACTIVE (توكن اتدوّر = replay) | INVALID (شكل غلط) */
export async function resolveSessionQr(token: string, opts?: { graceMs?: number }): Promise<{
  qrId: string;
  scope: SessionQrScope;
  centerId: string | null;
  sessionId: string;
  sessionLabel: string;
  expiresAt: Date;
}> {
  const t = token.trim().toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(t)) {
    const e = new ApiError("رابط الحضور مش صالح.", 400);
    (e as ApiError & { code?: string }).code = "INVALID";
    throw e;
  }
  const qr = await db.sessionQRToken.findUnique({ where: { token: t } });
  if (!qr || !qr.isActive) {
    // توكن مش نشط = غالبًا اتدوّر (كود قديم متصوّر/مشارك) — replay
    const e = new ApiError("كود الحضور ده مش شغال — الكود بيتجدد أوتوماتيك على شاشة الحصة، امسح الكود الجديد.", 410);
    (e as ApiError & { code?: string }).code = "INACTIVE";
    throw e;
  }
  const graceMs = Math.max(0, Math.min(120_000, opts?.graceMs ?? 0));
  if (qr.expiresAt.getTime() < Date.now() - graceMs) {
    const e = new ApiError("الكود انتهت صلاحيته — الكود بيتجدد أوتوماتيك على شاشة الحصة، حاول تاني.", 410);
    (e as ApiError & { code?: string }).code = "EXPIRED";
    throw e;
  }
  if (qr.scope === "ACADEMIA") {
    const s = await db.acaSession.findUnique({
      where: { id: qr.sessionId },
      include: { group: { include: { subject: true } } },
    });
    if (!s) throw new ApiError("الحصة دي مش موجودة.", 404);
    return {
      qrId: qr.id,
      scope: "ACADEMIA",
      centerId: null,
      sessionId: s.id,
      sessionLabel: `${s.group.subject.name} — ${s.date} ${s.startTime}`,
      expiresAt: qr.expiresAt,
    };
  }
  const s = await db.sessionInstance.findUnique({
    where: { id: qr.sessionId },
    include: { group: { include: { subject: true, grade: true } } },
  });
  if (!s) throw new ApiError("الحصة دي مش موجودة.", 404);
  return {
    qrId: qr.id,
    scope: "CENTERS",
    centerId: s.centerId,
    sessionId: s.id,
    // حصص الحضور المفتوح مالهاش مجموعة — الاسم هو البطاقة
    sessionLabel: s.group
      ? `${s.group.subject.name} — ${s.group.grade.name} ${s.group.name} — ${s.date} ${s.startTime}`
      : `${s.name ?? "حصة"} — ${s.date} ${s.startTime}`,
    expiresAt: qr.expiresAt,
  };
}

/** تسجيل استخدام التوكن (بعد نجاح الحضور) — عدّاد + آخر استخدام */
export async function touchSessionQr(qrId: string): Promise<void> {
  await db.sessionQRToken.update({
    where: { id: qrId },
    data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
  }).catch(() => {});
}
