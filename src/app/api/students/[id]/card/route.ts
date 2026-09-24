import QRCode from "qrcode";
import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";

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
  return ok({
    center: {
      name: user.center!.name, logo: user.center!.logo, primaryColor: user.center!.primaryColor,
      secondaryColor: user.center!.secondaryColor, slogan: user.center!.slogan,
    },
    cards,
  });
});

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await req.json().catch(() => ({})) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
  if (!ids.length) throw new ApiError("اختار الطلاب الأول.", 400);
  const cards = await cardsFor(user.centerId, ids);
  return ok({
    center: {
      name: user.center!.name, logo: user.center!.logo, primaryColor: user.center!.primaryColor,
      secondaryColor: user.center!.secondaryColor, slogan: user.center!.slogan,
    },
    cards,
  });
});
