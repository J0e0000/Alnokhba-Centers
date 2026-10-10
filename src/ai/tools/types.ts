import "server-only";
import type { z } from "zod";
import type { SessionUser } from "@/lib/auth";

/* ============================================================
   TOOL SYSTEM TYPES — عقد الأدوات (spec §3/§4/§5/§6)
   كل أداة: اسم + وصف + schema مدخلات/مخرجات + صلاحية + خطورة +
   سياسة تأكيد + handler + بيانات تدقيق. الأداة هي الطريقة الوحيدة
   اللي الوكيل (أو الـ LLM) بيلمس بيها النظام — مفيش SQL حر.
============================================================ */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** سياسة التأكيد لكل خطورة — قابلة للتعديل من مكان واحد (spec §5/§33) */
export const CONFIRM_POLICY: Record<RiskLevel, "AUTO" | "CONFIRM"> = {
  LOW: "AUTO", // قراءة/بحث/تقارير — تنفيذ فوري
  MEDIUM: "CONFIRM", // إنشاء/تعديل بيانات/تسجيل — تأكيد
  HIGH: "CONFIRM", // رسائل خارجية/حذف/إعدادات/جملية — تأكيد عالي
};

export type CardType =
  | "student" | "students" | "report" | "insight" | "result"
  | "error" | "confirmation" | "task" | "text";

/** كارت غني للمستخدم — الـ UI بيرسمه بدل جدران نصوص (spec §18) */
export type AgentCard = {
  type: CardType;
  title?: string;
  subtitle?: string;
  /** إجراءات على الكارت — {action:"navigate", view, studentId?} أو {action:"agent", text} */
  actions?: { label: string; action: "navigate" | "agent"; view?: string; studentId?: string; text?: string }[];
  rows?: { label: string; value: string; tone?: "good" | "warn" | "bad" | "info" }[];
  items?: { id: string; title: string; sub?: string; actions?: AgentCard["actions"] }[];
  severity?: "INFO" | "WARNING" | "CRITICAL";
};

export type ToolContext = {
  user: SessionUser & { centerId: string };
  centerId: string;
  /** سياق الصفحة الحالي من العميل (view/طالب مفتوح) — بعد التحقق السيرفري */
  page?: { view?: string; studentId?: string };
  /** معرف مهمة الوكيل — للتدقيق */
  taskId?: string;
};

export type ToolOutput = {
  /** ملخص آمن قصير بيظهر للمستخدم وبيتقري من الـ LLM */
  summary: string;
  /** بيانات منظمة — بتتقري من الـ LLM عشان يكمل تفكيره */
  data?: Record<string, unknown>;
  /** كروت جاهزة للعرض — بتوصل للـ UI زي ما هي (الـ LLM مش بيبعث كروت) */
  cards?: AgentCard[];
  /** نص التأكيد لو الأداة محتاجة تأكيد — "هسجل أحمد محمد في Group B" */
  confirmSummary?: string;
};

export type ToolDef<TArgs = Record<string, unknown>> = {
  name: string; // "student.search" — namespace.action
  group: "students" | "attendance" | "groups" | "reports" | "dashboard" | string;
  description: string; // بالعربي — بتتقري من الـ LLM عشان يختار الصح
  /** متى تستخدم — مثال usage بيتقري من الـ LLM */
  usageHint?: string;
  input: z.ZodType<TArgs>;
  risk: RiskLevel;
  /** الصلاحية المطلوبة من نظام صلاحيات النخبة — الفحص سيرفري دايمًا (spec §6) */
  requiredPermission?: import("@/lib/permissions").PermissionId;
  /** وصف للصلاحية في رفض التشغيل */
  permissionLabel?: string;
  /** مفتاح قدرة سنتر مطلوب (لو مفيش → الأداة مقفولة للسنتر ده) */
  requiredCapability?: { key: string; config?: string; label: string };
  /** قسم منتج مطلوب (Master Prompt §5) — الاستحقاق من الخطة/الاشتراك/إعدادات السنتر */
  requiredModule?: import("@/lib/modules").ModuleKey;
  handler: (args: TArgs, ctx: ToolContext) => Promise<ToolOutput>;
  /** معاينة التأكيد — بدون أي side effects (ممنوع تلمس الداتابيز كتابة هنا).
   *  بتبني نص «هعمل إيه بالظبط» + تفاصيل المتأثرين عشان كارت التأكيد. */
  preview?: (args: TArgs, ctx: ToolContext) => Promise<{ summary: string; details?: Record<string, unknown> }>;
  /** تحقق ما بعد التنفيذ للكتابة — بيرجع يتأكد من الداتابيز نفسها (spec §34) */
  verify?: (args: TArgs, output: ToolOutput, ctx: ToolContext) => Promise<string | null>; // null = سليم، غير كده رسالة مشكلة
};

/** أخطاء منظمة بتفهمها الـ orchestrator */
export class ToolError extends Error {
  code: "VALIDATION" | "PERMISSION" | "CAPABILITY" | "ENTITLEMENT" | "NOT_FOUND" | "STATE" | "FAILED";
  constructor(code: ToolError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
