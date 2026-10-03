import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError, rateLimit } from "@/lib/auth";
import { issueSessionQrSlot, QR_SLOT_SECONDS } from "@/lib/session-qr";
import { getCenterCapabilities, capabilityNumber } from "@/lib/center-capabilities";
import { logAudit, AUDIT } from "@/lib/audit";
import { requireCapability } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/session-qr/slot — توليد كود QR الحصة الحالي (موديل Slot QR).
 *
 * الموديل (الحل النهائي — طلب المستخدم): كود واحد على الشاشة 10 ثواني
 * (قابل للضبط 5..30)، الكود سليم 100% يقراه أي سكانر عادي أو كاميرا موبايل
 * من غير لمعة ولا تشويه — الحماية من التصوير هنا هي العمر القصير: الكود
 * بيكمل شغال 4ث بعد ما يتنزل عن الشاشة (هامش الـ claims اللي في الطريق)
 * وبعده بيموت نهائيًا، فالصورة/السكرين شوت بيمسك كود ميت خلال ثواني.
 * الشاشة بتجيب الكود الجاي قبل نهاية الثانية العاشرة فمفيش فراغ.
 *
 * Body: { sessionId, slotSeconds? }
 * → { token, expiresAt, slotSeconds, sessionLabel }
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  // بوابة قدرة المركز: QR الحصة المتغير = dynamic_qr
  await requireCapability(user.centerId, "dynamic_qr");
  const body = await readJson<{ sessionId?: string; slotSeconds?: number }>(req);
  const sessionId = String(body.sessionId ?? "");
  // قابل للضبط 5..60 ثانية (spec §3 — ممنوع hardcode): الأول من قدرة المركز dynamic_qr.config.slotSeconds،
  // والطلب بيقدر يحدد قيمة داخل الحدود (للعرض بحجم شاشة مختلف مثلًا)
  const caps = await getCenterCapabilities(user.centerId);
  const configured = capabilityNumber(
    (caps.dynamic_qr?.config ?? {}) as Record<string, unknown>,
    "slotSeconds", QR_SLOT_SECONDS, 5, 60,
  );
  const slotSeconds = Math.max(5, Math.min(60, Math.round(Number(body.slotSeconds) || configured)));

  rateLimit(`qr-slot:${user.centerId}:${user.id}`, 30, 60_000);

  const session = await db.sessionInstance.findFirst({
    where: { id: sessionId, centerId: user.centerId },
    include: { group: { include: { subject: true, grade: true } } },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status === "CLOSED") throw new ApiError("الحصة دي مقفولة — مينفعش تولّد كود حضور.", 400);
  if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغاة.", 400);

  const slot = await issueSessionQrSlot({
    scope: "CENTERS",
    sessionId,
    centerId: user.centerId,
    createdById: user.id,
    createdByName: user.name,
    slotSeconds,
  });

  await logAudit({
    user,
    action: AUDIT.QR_ISSUED,
    entity: "SESSION_QR",
    entityId: sessionId,
    reason: `كود QR حضور (سلوت ${slotSeconds}ث) — ${session.group.subject.name} (ينتهي ${slot.expiresAt})`,
    after: { tokenTail: slot.token.slice(-6), expiresAt: slot.expiresAt, slotSeconds },
  });

  return ok({
    token: slot.token,
    expiresAt: slot.expiresAt,
    slotSeconds: slot.slotSeconds,
    sessionLabel: `${session.group.subject.name} — ${session.group.grade.name} ${session.group.name}`,
  });
});
