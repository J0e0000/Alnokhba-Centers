import "server-only";
import type { ToolDef, ToolContext } from "./types";
import { z } from "zod";
import { hasPermission } from "@/lib/permissions";
import { ToolError } from "./types";

/* ============================================================
   TOOL REGISTRY — سجل الأدوات (spec §3)
   الأدوات وحدات مستقلة بتتسجل هنا. إضافة أداة جديدة = ملف جديد
   + register() — الـ orchestrator والـ prompts بيتحدثوا لوحدهم.
   ممنوع تسجيل أداة من غير schema — الـ validation أول بوابة أمان.
============================================================ */

const registry = new Map<string, ToolDef>();

export function register<T>(tool: ToolDef<T>): void {
  // overwrite (مش throw): الـ dev HMR بيعيد تقييم الموديولات — إعادة تسجيل نفس
  // الأداة طبيعي، والتطبيق الوحيد للتسجيل هو تعريف الأداة نفسها.
  registry.set(tool.name, tool as unknown as ToolDef);
}

export function getTool(name: string): ToolDef | null {
  return registry.get(name) ?? null;
}

export function allTools(): ToolDef[] {
  return [...registry.values()];
}

/** كتالوج مختصر للأدوات — ده اللي الـ LLM بيشوفه في الـ system prompt */
export function toolCatalogForPrompt(tools: ToolDef[] = allTools()): string {
  return tools
    .map((t) => {
      const args = argsSummary(t.input);
      const perm = t.requiredPermission ? ` | صلاحية: ${t.permissionLabel ?? t.requiredPermission}` : "";
      const cap = t.requiredCapability ? ` | قدرة سنتر: ${t.requiredCapability.label}` : "";
      const mod = t.requiredModule ? ` | قسم: ${t.requiredModule}` : "";
      const risk = t.risk === "LOW" ? "قراءة" : t.risk === "MEDIUM" ? "تعديل (محتاج تأكيد)" : "حساس (تأكيد إلزامي)";
      return `- ${t.name} — ${t.description}${t.usageHint ? `\n  امتى تستخدمها: ${t.usageHint}` : ""}\n  خطورة: ${risk}${perm}${cap}${mod}\n  المدخلات (JSON Schema): ${args}`;
    })
    .join("\n");
}

/** الأدوات اللي المستخدم ده فعلًا يقدر ينفذها (استحقاق القسم + صلاحية + قدرة سنتر) —
 *  الموديل بيشوف دول بس، فمبيقترحش أدوات هتتحجب. التفويض الحقيقي لسه في authorizeAndValidate. */
export async function availableToolsFor(ctx: ToolContext): Promise<ToolDef[]> {
  let caps: Awaited<ReturnType<typeof import("@/lib/center-capabilities")["getCenterCapabilities"]>> | null = null;
  let mods: Awaited<ReturnType<typeof import("@/lib/entitlements")["getEffectiveModules"]>> | null = null;
  const out: ToolDef[] = [];
  for (const t of allTools()) {
    if (t.requiredModule) {
      try {
        const m = await import("@/lib/entitlements");
        mods ??= await m.getEffectiveModules(ctx.centerId);
        if (!mods.modules[t.requiredModule]?.enabled) continue;
      } catch { continue; } // فشل تقييم الاستحقاق → الأداة مقفولة (fail-safe)
    }
    if (t.requiredPermission && !hasPermission(ctx.user, t.requiredPermission)) continue;
    if (t.requiredCapability) {
      try {
        const m = await import("@/lib/center-capabilities");
        caps ??= await m.getCenterCapabilities(ctx.centerId);
        const state = caps[t.requiredCapability.key as keyof typeof caps];
        const ok = t.requiredCapability.config
          ? m.capabilityBool(state?.config ?? {}, t.requiredCapability.config, false)
          : (state?.enabled ?? false);
        if (!ok) continue;
      } catch { continue; }
    }
    out.push(t);
  }
  return out;
}

/** ملخص مدخلات من الـ zod schema — JSON Schema رسمي (zod v4) */
function argsSummary(schema: z.ZodType): string {
  try {
    const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    // نسخة مضغوطة: properties + required + القيم المسموحة (enum) — من غيرها الموديل بيخمّن القيم ويغلط
    const props = (json.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((json.required ?? []) as string[]);
    const parts = Object.entries(props).map(([k, v]) => {
      let type = Array.isArray(v.type) ? v.type.join("|") : (v.type as string) ?? (v.anyOf ? "multi" : "any");
      if (Array.isArray(v.enum) && v.enum.length) type += ` — لازم واحدة من: ${v.enum.map((x) => `"${String(x)}"`).join(" | ")}`;
      if (v.format) type += ` (${String(v.format)})`;
      return `${k}${required.has(k) ? "" : "?"}: ${type}${v.description ? ` (${v.description})` : ""}`;
    });
    return `{ ${parts.join(", ")} }`;
  } catch {
    return "{}";
  }
}

/** بوابة التحقق الموحدة قبل تنفيذ أي أداة (spec §6/§32):
 *  1) schema validation  2) صلاحية الحساب  3) قدرة السنتر
 *  ملاحظة: حجب الصلاحية بيحصل هنا على السيرفر — الـ LLM ملهوش أي دور في التفويض. */
export async function authorizeAndValidate(
  tool: ToolDef,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<{ args: unknown }> {
  // 1) schema validation — رسالة الخطأ بتوصل للموديل في محاولة التصحيح، فلازم تكون بتفهمه بالظبط
  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? ` (${first.path.join(".")})` : "";
    const detail = first?.message ? `: ${first.message}` : "";
    throw new ToolError("VALIDATION", `مدخلات الأداة ${tool.name} مش مظبوطة${path}${detail} — راجع شكل المدخلات المطلوب في الكتالوج وصلّحها.`);
  }
  // 2) استحقاق القسم (خطة الاشتراك/حالة السنتر/إعدادات السنتر) — قبل الصلاحية
  //    لأن القسم المقفول معناه إن الصلاحية نفسها مش هتفيد (Master Prompt §5 precedence)
  if (tool.requiredModule) {
    const { requireModule } = await import("@/lib/entitlements");
    try {
      await requireModule(ctx.centerId, tool.requiredModule);
    } catch (e) {
      throw new ToolError("ENTITLEMENT", e instanceof Error ? e.message : "القسم مقفول للاشتراك الحالي.");
    }
  }
  // 3) صلاحية الحساب (نظام الصلاحيات الرسمي للنخبة)
  if (tool.requiredPermission && !hasPermission(ctx.user, tool.requiredPermission)) {
    throw new ToolError(
      "PERMISSION",
      `ممعكش صلاحية «${tool.permissionLabel ?? tool.requiredPermission}» — العملية دي محتاجة صلاحية من الإدارة.`,
    );
  }
  // 4) قدرة السنتر (لو القدرة مقفولة للسنتر → الأداة مقفولة)
  if (tool.requiredCapability) {
    const { getCenterCapabilities, capabilityBool } = await import("@/lib/center-capabilities");
    const caps = await getCenterCapabilities(ctx.centerId);
    const capDef = tool.requiredCapability;
    const state = caps[capDef.key as keyof typeof caps];
    const ok = capDef.config
      ? capabilityBool(state?.config ?? {}, capDef.config, false)
      : (state?.enabled ?? false);
    if (!ok) {
      throw new ToolError("CAPABILITY", `ميزة «${capDef.label}» مقفولة من إعدادات السنتر.`);
    }
  }
  return { args: parsed.data };
}
