import QRCode from "qrcode";
import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser, ApiError, type SessionUser } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { requireExportAdmin, centerParam } from "@/lib/export-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/students/[id]/card — printable card payload.
 * The QR encodes ONLY the secure opaque token (no PII).
 * POST variant accepts { ids: string[] } for bulk cards.
 */
async function cardsFor(centerId: string, ids: string[]) {
  const students = await db.student.findMany({
    where: { id: { in: ids }, centerId },
    include: { grade: true, registrations: { where: { status: "ACTIVE" }, include: { group: true } } },
  });
  const center = await db.center.findUnique({ where: { id: centerId } });
  if (!center) throw new ApiError("السنتر مش موجود.", 404);

  return Promise.all(
    students.map(async (s) => ({
      name: s.name,
      code: s.code,
      grade: s.grade?.name ?? "",
      group: s.registrations[0]?.group.name ?? "",
      qrDataUrl: await QRCode.toDataURL(s.qrToken, {
        margin: 1, width: 320, errorCorrectionLevel: "M",
        color: { dark: "#111827", light: "#FFFFFF" },
      }),
    }))
  );
}

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;
  const cards = await cardsFor(user.centerId, [id]);
  if (cards.length === 0) throw new ApiError("الطالب ده مش موجود في السنتر ده.", 404);
  // كارت طالب واحد = استخدام فردي مسموح لطاقم السنتر — بس بيتسجل (spec المرحلة 1)
  await logAudit({ user, action: AUDIT.CARD_PRINTED, entity: "STUDENT", entityId: id, reason: "عرض/طباعة كارت طالب واحد" }).catch(() => {});
  return ok({
    center: {
      name: user.center!.name, logo: user.center!.logo, primaryColor: user.center!.primaryColor,
      secondaryColor: user.center!.secondaryColor, slogan: user.center!.slogan,
    },
    cards,
  });
});

export const POST = handler(async (req: Request) => {
  // الكروت بالجملة (حتى 200 كارت) = تصدير بالجملة — أدمن المنصة بس (spec المرحلة 1)
  const url = new URL(req.url);
  const grant = await requireExportAdmin({ what: "student-cards-bulk", centerId: centerParam(url) });
  if (!grant.centerId) throw new ApiError("حدد السنتر (?centerId=) لطباعة الكروت بالجملة.", 400);
  const user: SessionUser & { centerId: string } = { ...grant.user, centerId: grant.centerId };
  const body = await req.json().catch(() => ({})) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
  if (!ids.length) throw new ApiError("اختار الطلاب الأول.", 400);
  const cards = await cardsFor(user.centerId, ids);
  await logAudit({ user, action: AUDIT.CARD_PRINTED, entity: "STUDENT", reason: `طباعة كروت بالجملة (${cards.length} كارت)` }).catch(() => {});
  // أدمن المنصة مالوش center محمّل في الجلسة — بنجيبه من الداتابيز بالنطاق المحدد
  const centerRow = user.center ?? await db.center.findUnique({ where: { id: user.centerId } });
  return ok({
    center: {
      name: centerRow?.name ?? "", logo: centerRow?.logo, primaryColor: centerRow?.primaryColor,
      secondaryColor: centerRow?.secondaryColor, slogan: centerRow?.slogan,
    },
    cards,
  });
});
