import { handler, ok } from "@/lib/api";
import { dbMode } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/system/db-status — فحص عام (من غير تسجيل) لوضع قاعدة البيانات.
 * مفيش أي معلومات حساسة — بس الوضع:
 * - postgres: قاعدة حقيقية مرتبطة ✓
 * - demo: Vercel من غير DATABASE_URL — SQLite مؤقت لكل نسخة lambda،
 *   الجلسات والبيانات مش بتتحفظ (ده سبب «دخول وخروج فوري») — لازم ربط Postgres.
 * - local: تطوير محلي بـ SQLite (مقصود).
 * صفحة الدخول بتعرض تحذير واضح في وضع demo بدل فشل غامض.
 */
export const GET = handler(async () => {
  return ok({ mode: dbMode() });
});
