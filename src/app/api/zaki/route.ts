import { ok, handler, readJson } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { runZakiRules, answerZaki, ZAKI_QUESTIONS, resolveZakiKey } from "@/lib/zaki";

export const dynamic = "force-dynamic";

/**
 * GET /api/zaki — ملخص زكي (أهم الملاحظات الحتمية لسنترك)
 * GET /api/zaki?questions=1 — الأسئلة الجاهزة بس (خفيف — من غير تشغيل القواعد) — للشات
 * POST /api/zaki { q } — سؤال جاهز أو أي صيغة قريبة → إجابة حتمية
 *   (resolveZakiKey بيخمّن الجملة بالتطبيع والمرادفات — «مين أكتر طالب غياب» → repeat_absentees)
 */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "ai_agent", user);
  const questionsOnly = new URL(req.url).searchParams.get("questions") === "1";
  if (questionsOnly) {
    rateLimit(`zaki-q-list:${user.id}`, 60, 60_000);
    return ok({ questions: ZAKI_QUESTIONS });
  }
  rateLimit(`zaki:${user.id}`, 30, 60_000);
  const result = await runZakiRules(user.centerId);
  return ok({ ...result, questions: ZAKI_QUESTIONS });
});

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "ai_agent", user);
  rateLimit(`zaki-q:${user.id}`, 60, 60_000);
  const body = await readJson<{ q?: string }>(req);
  const raw = String(body.q ?? "");
  const key = resolveZakiKey(raw) ?? raw;
  const answer = await answerZaki(user.centerId, key);
  return ok(answer);
});
