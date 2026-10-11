import { handler, ok } from "@/lib/api";
import { requireUser, rateLimit, type SessionUser } from "@/lib/auth";
import { availableToolsFor } from "@/ai/tools";
import { CONFIRM_POLICY } from "@/ai/tools/types";
import { getEffectiveModules } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/agent/capabilities — اكتشاف القدرات (spec Phase 9)
   كتالوج الأدوات اللي المستخدم ده فعلًا ينفذها في سنترك دلوقتي
   (استحقاق القسم + صلاحية + قدرة سنتر) — نفس الفلترة اللي بيشوفها
   الموديل سيرفري. الواجهة والتكاملات المستقبلية بتبني على ده بدل
   كتالوج ثابت — القسم المقفول أدواته بتختفي من كتالوج زكي نفسه.
   أدمن المنصة (من غير جلسة دعم): قايمة فاضية + platform=true —
   مش 403، عشان الواجهة تعرف تتصرف بذكاء.
============================================================ */

export const GET = handler(async () => {
  const user = await requireUser();
  rateLimit(`agent-caps:${user.id}`, 30, 60_000);

  // أدمن من غير سنتر — مفيش أدوات سنتر تشتغل (الأدوات كلها محصورة بسنتر)
  if (!user.centerId) {
    return ok({ tools: [], modules: {}, subscription: null, platform: true });
  }

  const cu = user as SessionUser & { centerId: string };
  const tools = await availableToolsFor({ user: cu, centerId: cu.centerId });
  const ent = await getEffectiveModules(cu.centerId);
  return ok({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      usageHint: t.usageHint ?? null,
      risk: t.risk,
      requiresConfirmation: CONFIRM_POLICY[t.risk] === "CONFIRM",
      permission: t.requiredPermission ?? null,
      permissionLabel: t.permissionLabel ?? null,
      module: t.requiredModule ?? null,
    })),
    modules: ent.modules,
    subscription: ent.subscription,
    platform: false,
  });
});
