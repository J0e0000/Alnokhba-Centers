import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError } from "@/lib/auth";
import { getPortalStudent } from "@/lib/portal-auth";
import { getVapidKeys } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/portal/push — المفتاح العام للـ VAPID (اشتراك Push اختياري) */
export const GET = handler(async () => {
  const student = await getPortalStudent();
  if (!student) return ok({ student: null, publicKey: null });
  const keys = await getVapidKeys(student.centerId);
  return ok({ publicKey: keys.publicKey });
});

type SubBody = { action?: string; endpoint?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };

/** POST /api/portal/push — تسجيل اشتراك Push للطالب */
export const POST = handler(async (req: Request) => {
  const student = await getPortalStudent();
  if (!student) throw new ApiError("لازم تسجل دخول الأول.", 401);
  const body = await readJson<SubBody>(req);

  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new ApiError("بيانات الاشتراك ناقصة.", 400);
  }

  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      centerId: student.centerId, studentId: student.id,
      endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    },
    // الجهاز بيتربط بطالب/سنتر الجلسة الحالية دايمًا — لو الاشتراك كان لطالب تاني
    // (نفس الجهاز اتسلم) بنعيد ربطه بالكامل، مش بس studentId
    update: { studentId: student.id, centerId: student.centerId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });

  return ok({ ok: true });
});

/** DELETE /api/portal/push?endpoint= — إلغاء الاشتراك */
export const DELETE = handler(async (req: Request) => {
  const student = await getPortalStudent();
  if (!student) throw new ApiError("لازم تسجل دخول الأول.", 401);
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) throw new ApiError("الاشتراك مش محدد.", 400);
  await db.pushSubscription.deleteMany({ where: { endpoint, centerId: student.centerId } });
  return ok({ ok: true });
});
