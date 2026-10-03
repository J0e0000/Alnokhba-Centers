import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import {
  createSession, destroySession, getSessionUser, verifyPassword, rateLimit, ApiError,
  hashPassword, endSupportSession,
} from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { normalizeDigits } from "@/lib/normalize";
import { notifyAdmins } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

type AuthBody = {
  username?: string;
  password?: string;
  action?: "update-prefs" | "support-exit" | "signup";
  // prefs
  autoPrintReceipt?: boolean;
  receiptFormat?: string;
  // signup
  name?: string;
  phone?: string;
};

/** POST /api/auth — login (password) + prefs */
export const POST = handler(async (req: Request) => {
  const body = await readJson<AuthBody>(req);
  const action = body.action;

  // ---------- خروج من جلسة الدعم الفني → رجوع حساب الأدمن الأصلي ----------
  if (action === "support-exit") {
    const current = await getSessionUser();
    const exited = await endSupportSession();
    if (!exited) throw new ApiError("مفيش جلسة دعم مفتوحة حاليًا.", 400);
    await logAudit({
      user: current ?? { id: "system", name: "النظام", centerId: null },
      action: AUDIT.SUPPORT_ACCESS_ENDED,
      entity: "SUPPORT_SESSION",
      reason: "خروج يدوي من جلسة الدعم",
    });
    const restored = await getSessionUser();
    return ok({ ok: true, user: restored });
  }

  // ---------- تحديث إعدادات الطباعة الشخصية (أي مستخدم مسجل) ----------
  if (action === "update-prefs") {
    const user = await getSessionUser();
    if (!user) throw new ApiError("لازم تسجل دخول الأول.", 401);
    const data: { autoPrintReceipt?: boolean; receiptFormat?: string } = {};
    if (body.autoPrintReceipt !== undefined) data.autoPrintReceipt = !!body.autoPrintReceipt;
    if (body.receiptFormat !== undefined) {
      if (body.receiptFormat !== "THERMAL" && body.receiptFormat !== "A4") {
        throw new ApiError("صيغة الإيصال لازم تكون THERMAL أو A4.");
      }
      data.receiptFormat = body.receiptFormat;
    }
    if (Object.keys(data).length) {
      await db.user.update({ where: { id: user.id }, data });
    }
    const fresh = await getSessionUser();
    return ok({ user: fresh });
  }

  // ---------- تسجيل حساب جديد (طلب انضمام) — بيمشي للأدمن موافقة ----------
  if (action === "signup") {
    const name = String(body.name ?? "").trim();
    const username = normalizeDigits(String(body.username ?? "")).trim().toLowerCase();
    const password = String(body.password ?? "");
    const phone = normalizeDigits(String(body.phone ?? "")).trim();

    if (name.length < 3) throw new ApiError("اكتب اسمك الكامل (3 حروف على الأقل).");
    if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
      throw new ApiError("اسم المستخدم لازم يكون حروف إنجليزية أو أرقام (3-20 حرف) من غير مسافات.");
    }
    if (password.length < 6) throw new ApiError("كلمة السر لازم 6 حروف على الأقل.");
    if (!/^\d{10,13}$/.test(phone)) {
      throw new ApiError("اكتب رقم موبايل صحيح (11 رقم) — عشان نكلّمك لو احتجنا حاجة.");
    }

    // rate-limit: 5 طلبات تسجيل في الساعة لكل IP
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    rateLimit(`signup:${ip}`, 5, 3_600_000);

    const exists = await db.user.findUnique({ where: { username } });
    if (exists) {
      if (exists.role === "PENDING") throw new ApiError("طلب انضمام بنفس الاسم ده مستني الموافقة خلاص — استنى رد الإدارة.");
      throw new ApiError(`اسم المستخدم "${username}" مستخدم خلاص — اختار واحد تاني.`);
    }

    const user = await db.user.create({
      data: {
        username,
        name,
        phone,
        passwordHash: hashPassword(password),
        role: "PENDING",
        isActive: false, // مفعّل بس بعد ما الأدمن يوافق ويعيّنه لسنتر
        canAddStudents: true,
      },
    });

    // إشعار فوري لكل أدمن المنصة: في حد جديد سجّل
    await notifyAdmins({
      type: "SIGNUP_REQUEST",
      title: "طلب انضمام جديد",
      body: `${name} (${username}) سجّل حساب جديد ومستني التعيين لسنتر — رقم التواصل ${phone}.`,
      link: "requests",
      refId: user.id,
    });

    await logAudit({
      user: { id: "anonymous", name: name, centerId: null },
      action: "طلب انضمام جديد",
      entity: "USER",
      entityId: user.id,
      after: { name, username, phone },
    });

    return ok({
      ok: true,
      message: "تم استلام طلبك — إدارة Alnokhba Managment هتراجعه وتعينك لسنتر. هتقدر تسجل دخول فور الموافقة.",
    }, { status: 201 });
  }

  // ---------- login بكلمة السر ----------
  const username = normalizeDigits(String(body.username ?? "")).trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!username || !password) throw new ApiError("اكتب اسم المستخدم وكلمة السر.", 400);
  rateLimit(`login:${username}`, 8, 60_000);

  const user = await db.user.findUnique({
    where: { username },
    include: { center: { select: { status: true, name: true } } },
  });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await logAudit({
      user: { id: "anonymous", name: username, centerId: null },
      action: AUDIT.LOGIN_FAILED,
      reason: `محاولة دخول باسم المستخدم: ${username}`,
    });
    throw new ApiError("اسم المستخدم أو كلمة السر غلط.", 401);
  }
  if (user.role === "PENDING") {
    throw new ApiError("طلب انضمامك مستني موافقة إدارة Alnokhba Managment — هتقدر تدخل فور الموافقة والتعيين لسنتر.", 403);
  }
  if (user.role === "REJECTED") {
    throw new ApiError("طلب الانضمام ده اترفض من الإدارة — لو ده غلطة كلم إدارة Alnokhba Managment.", 403);
  }
  if (!user.isActive) throw new ApiError("الحساب ده موقوف — كلم المدير.", 403);
  if (user.center && user.center.status !== "ACTIVE") {
    throw new ApiError("اشتراك السنتر متوقف حالياً — كلم إدارة Alnokhba Managment.", 403);
  }

  await createSession(user.id);
  await logAudit({
    user: { id: user.id, name: user.name, centerId: user.centerId },
    action: AUDIT.LOGIN,
  });

  const full = await getSessionUser();
  return ok({ user: full });
});

/** DELETE /api/auth — logout (بيقّف جلسة الدعم كمان لو مفتوحة) */
export const DELETE = handler(async () => {
  const current = await getSessionUser();
  if (current?.support) {
    await endSupportSession();
    await logAudit({
      user: current,
      action: AUDIT.SUPPORT_ACCESS_ENDED,
      entity: "SUPPORT_SESSION",
      reason: "تسجيل خروج وقت جلسة الدعم",
    });
  }
  await destroySession();
  return ok({ ok: true });
});

/** GET /api/auth — current session */
export const GET = handler(async () => {
  const user = await getSessionUser();
  return ok({ user });
});
