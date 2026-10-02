import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError, rateLimit } from "@/lib/auth";
import { issueSessionQrBatch, QR_BATCH_DEFAULT_COUNT, QR_BATCH_SLOT_SECONDS } from "@/lib/session-qr";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/session-qr/batch — توليد دفعة أكواد QR متحركة لحصة مفتوحة.
 *
 * الموديل الجديد (طلب المستخدم): نداء واحد بيولّد 10 أكواد، الشاشة بتفل بينهم
 * بسرعة (كل كود ~ثانية)، وكلهم بينتهوا مع بعض في نهاية الدفعة (~22ث) —
 * فأي صورة أو سكرين شوت بيمسك كود واحد من العشرة وبيموت في ثواني مع الدفعة الجاية.
 * الدفعات الأقدم بتتقفل بهامش 8ث يكفي الـ claims اللي في الطريق.
 *
 * Body: { sessionId, count?, ttlMs?, slotSeconds? }
 * → { codes: [{ token, expiresAt }], batchExpiresAt, slotSeconds, sessionLabel }
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<{ sessionId?: string; count?: number; ttlMs?: number; slotSeconds?: number }>(req);
  const sessionId = String(body.sessionId ?? "");
  const slotSeconds = Math.max(0.6, Math.min(3, Number(body.slotSeconds) || QR_BATCH_SLOT_SECONDS));

  rateLimit(`qr-batch:${user.centerId}:${user.id}`, 30, 60_000);

  const session = await db.sessionInstance.findFirst({
    where: { id: sessionId, centerId: user.centerId },
    include: { group: { include: { subject: true, grade: true } } },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status === "CLOSED") throw new ApiError("الحصة دي مقفولة — مينفعش تولّد كود حضور.", 400);
  if (session.status === "CANCELLED") throw new ApiError("الحصة دي ملغاة.", 400);

  const batch = await issueSessionQrBatch({
    scope: "CENTERS",
    sessionId,
    centerId: user.centerId,
    createdById: user.id,
    createdByName: user.name,
    count: Number(body.count) || QR_BATCH_DEFAULT_COUNT,
    ttlMs: Number(body.ttlMs) || undefined,
  });

  await logAudit({
    user,
    action: AUDIT.QR_ISSUED,
    entity: "SESSION_QR",
    entityId: sessionId,
    reason: `دفعة أكواد QR متحركة — ${session.group.subject.name} (${batch.codes.length} أكواد، تنتهي ${batch.batchExpiresAt})`,
    after: { batchTail: batch.codes.map((c) => c.token.slice(-4)), batchExpiresAt: batch.batchExpiresAt },
  });

  return ok({
    codes: batch.codes,
    batchExpiresAt: batch.batchExpiresAt,
    slotSeconds,
    sessionLabel: `${session.group.subject.name} — ${session.group.grade.name} ${session.group.name}`,
  });
});
