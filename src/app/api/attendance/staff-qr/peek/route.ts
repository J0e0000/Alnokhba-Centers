import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { rateLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance/staff-qr/peek?token=… — صفحة /c/<token> بتسأل بيها
 * قبل ما الموظف يسجل دخول: مين المركز؟ وهل الكود لسه حي؟
 * أقل معلومة ممكنة: اسم المركز + صلاحية الكود فقط — مفيش IDs ولا بيانات حساسة.
 */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim().toLowerCase();

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  rateLimit(`staff-peek:${ip}:${token.slice(-8)}`, 60, 60_000);

  if (!/^[0-9a-f]{16,64}$/.test(token)) {
    return ok({ valid: false, reason: "INVALID" });
  }
  const qr = await db.staffQrToken.findUnique({
    where: { token },
    include: { center: { select: { name: true, status: true } } },
  });
  if (!qr || !qr.isActive || qr.expiresAt.getTime() < Date.now() || !qr.center || qr.center.status !== "ACTIVE") {
    return ok({ valid: false, reason: !qr || !qr.isActive ? "INACTIVE" : "EXPIRED" });
  }
  return ok({ valid: true, centerName: qr.center.name, expiresAt: qr.expiresAt.toISOString() });
});
