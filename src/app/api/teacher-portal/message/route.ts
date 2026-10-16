import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { getPortalTeacher } from "@/lib/teacher-auth";
import { notifyStaff } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

// ============================= POST — رسالة من المدرس للإدارة =============================
// المدرس بيبعت رسالة نصية → بتوصل فورًا كإشعار للمدير والاستقبال (جرس الإشعارات).
// خصوصية: أرقام أولياء الأمور مش بتظهر للمدرس — الرسالة للإدارة بس.

type Body = { text?: string };

export const POST = handler(async (req: Request) => {
  const teacher = await getPortalTeacher();
  if (!teacher) throw new ApiError("غير مسجل دخول.", 401);

  const body = await readJson<Body>(req);
  const text = String(body.text ?? "").trim().slice(0, 1000);
  if (text.length < 3) throw new ApiError("اكتب الرسالة الأول (3 حروف على الأقل).", 400);

  // rate-limit: 10 رسائل / 10 دقايق لكل مدرس
  rateLimit(`teacher-msg:${teacher.id}`, 10, 600_000);

  const delivered = await notifyStaff(
    teacher.centerId,
    {
      type: "SYSTEM",
      title: `رسالة من المدرس ${teacher.name}`,
      body: text,
      link: "/app",
      refId: teacher.id,
    },
    { roles: ["MANAGER", "RECEPTIONIST"] },
  );

  return ok({ ok: true, delivered });
});
