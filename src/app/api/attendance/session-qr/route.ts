import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { issueSessionQr } from "@/lib/session-qr";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/session-qr — توليد/تجديد كود QR لحصة مفتوحة (الطريقة الثالثة للحضور).
 * كل استدعاء بيلغي الأكواد النشطة القديمة لنفس الحصة (rotate) — الكود قصير العمر (دقيقتين).
 * Body: { sessionId }
 * → { token, path, expiresAt, rotated }
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<{ sessionId?: string }>(req);
  const sessionId = String(body.sessionId ?? "");

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
  });

  await logAudit({
    user,
    action: AUDIT.ATTENDANCE_RECORDED,
    entity: "SESSION_QR",
    entityId: sessionId,
    reason: `توليد كود QR حضور — ${session.group.subject.name}`,
    after: { tokenTail: issued.token.slice(-6), expiresAt: issued.expiresAt },
  });

  return ok({
    token: issued.token,
    path: `/s/${issued.token}`,
    expiresAt: issued.expiresAt,
    rotated: issued.rotated,
    sessionLabel: `${session.group.subject.name} — ${session.group.grade.name} ${session.group.name}`,
  });
});
