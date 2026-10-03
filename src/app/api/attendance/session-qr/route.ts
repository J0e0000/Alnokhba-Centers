import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { issueSessionQr } from "@/lib/session-qr";
import { logAudit, AUDIT } from "@/lib/audit";
import { requireCapability } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/session-qr — توليد/تجديد كود QR لحصة مفتوحة (الطريقة الثالثة للحضور).
 * كل استدعاء بيلغي الأكواد النشطة القديمة لنفس الحصة (rotate).
 * التدوير السريع (spec §9): rotateSeconds افتراضي 12ث — الكود يعيش التدوير + هامش شبكة،
 * فالكود المصوّر/المشترك بيموت في ثواني. Body: { sessionId, rotateSeconds? }
 * → { token, path, expiresAt, rotated, rotateSeconds }
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  // بوابة قدرة المركز: QR الحصة المتغير = dynamic_qr
  await requireCapability(user.centerId, "dynamic_qr");
  const body = await readJson<{ sessionId?: string; rotateSeconds?: number }>(req);
  const sessionId = String(body.sessionId ?? "");
  const rotateSeconds = Math.max(8, Math.min(60, Math.round(Number(body.rotateSeconds) || 12)));

  const session = await db.sessionInstance.findFirst({
    where: { id: sessionId, centerId: user.centerId },
    include: { group: { include: { subject: true, grade: true } } },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status === "CLOSED") throw new ApiError("الحصة دي مقفولة — مينفعش تولّد كود حضور.", 400);
  if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغاة.", 400);

  const issued = await issueSessionQr({
    scope: "CENTERS",
    sessionId,
    centerId: user.centerId,
    createdById: user.id,
    createdByName: user.name,
    ttlMs: (rotateSeconds + 8) * 1000,
  });

  await logAudit({
    user,
    action: AUDIT.QR_ISSUED,
    entity: "SESSION_QR",
    entityId: sessionId,
    reason: `توليد كود QR حضور — ${session.group.subject.name} (تدوير ${rotateSeconds}ث)`,
    after: { tokenTail: issued.token.slice(-6), expiresAt: issued.expiresAt },
  });

  return ok({
    token: issued.token,
    path: `/s/${issued.token}`,
    expiresAt: issued.expiresAt,
    rotated: issued.rotated,
    rotateSeconds,
    sessionLabel: `${session.group.subject.name} — ${session.group.grade.name} ${session.group.name}`,
  });
});
