import { handler, ok } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { availableToolsFor } from "@/ai/tools";
import { CONFIRM_POLICY } from "@/ai/tools/types";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/agent/capabilities — اكتشاف القدرات (spec Phase 9)
   كتالوج الأدوات اللي المستخدم ده فعلًا ينفذها في سنترك دلوقتي
   (صلاحية + قدرة سنتر) — نفس الفلترة اللي بيشوفها الموديل سيرفري.
   الواجهة والتكاملات المستقبلية بيبنيوا على ده بدل كتالوج ثابت.
============================================================ */

export const GET = handler(async () => {
  const user = await requireCenterUser();
  rateLimit(`agent-caps:${user.id}`, 30, 60_000);

  const tools = await availableToolsFor({ user, centerId: user.centerId });
  return ok({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      usageHint: t.usageHint ?? null,
      risk: t.risk,
      requiresConfirmation: CONFIRM_POLICY[t.risk] === "CONFIRM",
      permission: t.requiredPermission ?? null,
      permissionLabel: t.permissionLabel ?? null,
    })),
  });
});
