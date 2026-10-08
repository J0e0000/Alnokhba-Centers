import "server-only";
import "./students";
import "./groups";
import "./attendance";
import "./reports";
import "./dashboard";
import { allTools } from "./registry";

/* ============================================================
   TOOLS INDEX — تسجيل كل الأدوات مرة واحدة (import side-effect)
   إضافة أدوات جديدة: اعمل ملف جديد وسجله هنا — الـ registry والـ
   prompts بيتحدثوا لوحدهم (spec §3/§22)
============================================================ */

export { allTools, getTool, toolCatalogForPrompt, authorizeAndValidate } from "./registry";
export type { ToolDef, ToolOutput, ToolContext, AgentCard, RiskLevel } from "./types";
export { ToolError, CONFIRM_POLICY } from "./types";

// التأكد إن التسجيل حصل (tree-shaking protection)
void allTools();
