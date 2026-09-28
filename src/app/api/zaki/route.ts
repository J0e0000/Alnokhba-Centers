import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { runZakiRules, answerZaki, ZAKI_QUESTIONS } from "@/lib/zaki";

export const dynamic = "force-dynamic";

/**
 * GET /api/zaki — ملخص زكي (أهم الملاحظات الحتمية لسنترك)
 * POST /api/zaki { q } — سؤال جاهز → إجابة حتمية (مش AI — قواعد على الداتا)
 */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  rateLimit(`zaki:${user.id}`, 30, 60_000);
  const result = await runZakiRules(user.centerId);
  return ok({ ...result, questions: ZAKI_QUESTIONS });
});

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  rateLimit(`zaki-q:${user.id}`, 60, 60_000);
  const body = await readJson<{ q?: string }>(req);
  const answer = await answerZaki(user.centerId, String(body.q ?? ""));
  return ok(answer);
});
