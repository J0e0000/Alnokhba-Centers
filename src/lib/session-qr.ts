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
// الدفعة المتحركة (Dynamic Batch QR):
// نداء واحد للسيرفر بيولّد 10 أكواد بيتقلوا بينهم على الشاشة،
// وكلهم بيموتوا مع بعض في نهاية الدفعة — الصورة/السكرين شوت بيمسك
// كود واحد من العشرة وده بيتقفل مع الدفعة الجديدة. قبل نهاية الدفعة
// الشاشة بتجيب دفعة جديدة في الخلفية فمفيش فراغ بين الأكواد أبدًا.
// الإيقاع الحالي: كل كود 5 ثواني على الشاشة (طلب المستخدم — الكاميرا
// بتلحق تركز وتقراه براحتها؛ أسرع من كده بيضايق الطلبة في المسح).
// ============================================================
export const QR_BATCH_DEFAULT_COUNT = 10;
export const QR_BATCH_SLOT_SECONDS = 5.0; // كل كود بيعيش 5 ثواني على الشاشة (الكاميرا تلحق تقراه)
export const QR_BATCH_TTL_MS = 55_000; // 10 أكواد × 5ث + هامش — الدفعة تغطي دورة كاملة
/** هامش صغير للـ claims اللي في الطريق لما الدفعة الجديدة تتبعت — بعده التوكن القديم بيموت نهائيًا */
export const QR_BATCH_ROTATION_GRACE_MS = 8_000;

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

/** توليد دفعة أكواد متحركة (الموديل الجديد) — 10 أكواد بيولّدهم نداء واحد،
 *  كلهم بنفس وقت الانتهاء، والدفعات الأقدم بتتقفل بهامش صغير يكفي الـ claims
 *  اللي لسه في الطريق (الطالب مسح الكود والطلب جاي للسيرفر حالًا).
 *  أكتر من دفعة نشطة في نفس اللحظة = عادي: كلها لنفس الحصة ونفس نافذة الأمان. */
export async function issueSessionQrBatch(opts: {
  scope: SessionQrScope;
  sessionId: string;
  centerId: string | null;
  createdById: string;
  createdByName: string;
  count?: number;
  ttlMs?: number;
}): Promise<{ codes: { token: string; expiresAt: string }[]; batchExpiresAt: string; rotated: number }> {
  const count = Math.max(4, Math.min(14, Math.round(opts.count ?? QR_BATCH_DEFAULT_COUNT)));
  const ttl = Math.max(15_000, Math.min(90_000, opts.ttlMs ?? QR_BATCH_TTL_MS));

  // الدفعات الأقدم: خليها تعيش هامش الدوران بس (مش أكتر من انتهائها الأصلي)
  const old = await db.sessionQRToken.findMany({
    where: { sessionId: opts.sessionId, scope: opts.scope, isActive: true },
    select: { id: true, expiresAt: true },
  });
  let rotated = 0;
  if (old.length) {
    const graceCutoff = new Date(Date.now() + QR_BATCH_ROTATION_GRACE_MS);
    for (const o of old) {
      await db.sessionQRToken.update({
        where: { id: o.id },
        data: { expiresAt: o.expiresAt < graceCutoff ? o.expiresAt : graceCutoff },
      }).catch(() => {});
    }
    rotated = old.length;
  }

  const expiresAt = new Date(Date.now() + ttl);
  const tokens = Array.from({ length: count }, () => randomBytes(20).toString("hex"));
  await db.sessionQRToken.createMany({
    data: tokens.map((token) => ({
      scope: opts.scope,
      sessionId: opts.sessionId,
      centerId: opts.centerId,
      token,
      isActive: true,
      expiresAt,
      createdById: opts.createdById,
      createdByName: opts.createdByName,
    })),
  });
  return {
    codes: tokens.map((token) => ({ token, expiresAt: expiresAt.toISOString() })),
    batchExpiresAt: expiresAt.toISOString(),
    rotated,
  };
}

/** التحقق من التوكن (من غير استهلاك) — بيعيد معلومات الحصة للعرض.
 *  الأخطاء بتحمل code: EXPIRED (قديم منتهي) | INACTIVE (توكن اتدوّر = replay) | INVALID (شكل غلط) */
export async function resolveSessionQr(token: string): Promise<{
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
  if (qr.expiresAt < new Date()) {
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
    sessionLabel: `${s.group.subject.name} — ${s.group.grade.name} ${s.group.name} — ${s.date} ${s.startTime}`,
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
