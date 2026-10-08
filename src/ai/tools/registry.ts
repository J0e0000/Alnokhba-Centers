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
export function toolCatalogForPrompt(): string {
  return allTools()
    .map((t) => {
      const args = argsSummary(t.input);
      const perm = t.requiredPermission ? ` | صلاحية: ${t.permissionLabel ?? t.requiredPermission}` : "";
      const cap = t.requiredCapability ? ` | قدرة سنتر: ${t.requiredCapability.label}` : "";
      const risk = t.risk === "LOW" ? "قراءة" : t.risk === "MEDIUM" ? "تعديل (محتاج تأكيد)" : "حساس (تأكيد إلزامي)";
      return `- ${t.name} — ${t.description}${t.usageHint ? `\n  امتى تستخدمها: ${t.usageHint}` : ""}\n  خطورة: ${risk}${perm}${cap}\n  المدخلات (JSON Schema): ${args}`;
    })
    .join("\n");
}

/** ملخص مدخلات من الـ zod schema — JSON Schema رسمي (zod v4) */
function argsSummary(schema: z.ZodType): string {
  try {
    const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    // نسخة مضغوطة: properties + required بس
    const props = (json.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((json.required ?? []) as string[]);
    const parts = Object.entries(props).map(([k, v]) => {
      const type = Array.isArray(v.type) ? v.type.join("|") : (v.type as string) ?? (v.anyOf ? "multi" : "any");
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
  // 1) schema validation
  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ToolError("VALIDATION", `مدخلات الأداة ${tool.name} مش مظبوطة${first?.path?.length ? ` (${first.path.join(".")})` : ""}.`);
  }
  // 2) صلاحية الحساب (نظام الصلاحيات الرسمي للنخبة)
  if (tool.requiredPermission && !hasPermission(ctx.user, tool.requiredPermission)) {
    throw new ToolError(
      "PERMISSION",
      `ممعكش صلاحية «${tool.permissionLabel ?? tool.requiredPermission}» — العملية دي محتاجة صلاحية من الإدارة.`,
    );
  }
  // 3) قدرة السنتر (لو القدرة مقفولة للسنتر → الأداة مقفولة)
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
