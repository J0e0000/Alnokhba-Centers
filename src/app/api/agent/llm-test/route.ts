import { handler, readJson, ok } from "@/lib/api";
import { requireManager, rateLimit } from "@/lib/auth";
import { OpenAICompatibleProvider } from "@/ai/providers/openai-compatible";
import { resetLLMCache } from "@/ai/providers";
import { db } from "@/lib/db";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   POST /api/agent/llm-test — اختبار اتصال العقل الذكي (manager)
   body: { baseUrl?, model?, apiKey? } — الفاضي بياخد المخزن.
   بيبعت رسالة صغيرة واحدة وبيقيس زمن الرد. مفيش أي تخزين هنا.
============================================================ */

export const POST = handler(async (req: Request) => {
  try {
  const user = await requireManager();
  rateLimit(`agent-llm-test:${user.id}`, 6, 60_000);
  const body = await readJson<{ baseUrl?: string; model?: string; apiKey?: string }>(req);

  let baseUrl = String(body.baseUrl ?? "").trim().replace(/\/+$/, "");
  let model = String(body.model ?? "").trim();
  let apiKey = String(body.apiKey ?? "").trim();

  // لو الاختبار من غير مدخلات → استخدم إعداد السنتر المخزن
  if (!baseUrl || !model) {
    const center = await db.center.findUnique({
      where: { id: user.centerId },
      select: { agentLlmBaseUrl: true, agentLlmModel: true, agentLlmApiKey: true },
    });
    baseUrl = baseUrl || center?.agentLlmBaseUrl?.trim() || "";
    model = model || center?.agentLlmModel?.trim() || "";
    apiKey = apiKey || center?.agentLlmApiKey?.trim() || "";
  }
  if (!baseUrl || !model) {
    return ok({ ok: false, error: "اكتب الرابط والموديل الأول — أو احفظ الإعداد وجرب." });
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return ok({ ok: false, error: "الرابط لازم يبدأ بـ http:// أو https://" });
  }

  const provider = new OpenAICompatibleProvider(baseUrl, model, apiKey);
  const started = Date.now();
  try {
    // maxTokens 512: موديلات الـ reasoning (زي gpt-oss على Groq) بتحرق توكنز تفكير داخلي
    // قبل ما تكتب الحرف الأول — 20 توكن كانت بترجّع محتوى فاضي (llm-empty-response) مع أنها شغالة.
    const res = await provider.generate(
      [
        { role: "system", content: "أنت اختبار اتصال. رُد بكلمة واحدة فقط: تمام" },
        { role: "user", content: "قل: تمام" },
      ],
      { temperature: 0, maxTokens: 512, timeoutMs: 25_000 },
    );
    resetLLMCache();
    await logAudit({
      user, action: AUDIT.BRANDING_UPDATED, entity: "CENTER", entityId: user.centerId,
      after: { llmTest: { baseUrl, model, ok: true, latencyMs: Date.now() - started } },
      reason: "اختبار اتصال العقل الذكي لزكي",
    });
    return ok({
      ok: true,
      latencyMs: Date.now() - started,
      model,
      sample: res.text.trim().slice(0, 60),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير معروف";
    const friendly = /abort|timeout/i.test(msg)
      ? "الموديل رد متأخر أو مفيش رد (مهلة 25 ثانية) — تأكد من الرابط وأن الموديل شغال."
      : /llm-http-(401|403)/.test(msg)
        ? "المفتاح مرفوض (401/403) — راجع مفتاح الـ API."
        : /llm-http-404/.test(msg)
          ? "الرابط أو الموديل مش موجود (404) — راجع المسار لازم ينتهي بـ /v1 غالبًا."
          : /llm-http-(429)/.test(msg)
            ? "المزود رافض مؤقتًا (429) — الحساب وصل حد الاستخدام."
            : /llm-empty-response/.test(msg)
              ? "الموديل رد فاضي — غالبًا موديل تفكير (reasoning) مستهلك التوكنز قبل الكتابة. استخدم موديل غير تفكيري أو زوّد الحد."
              : /fetch|network/i.test(msg)
                ? "مقدرتش أوصل للرابط — تأكد من عنوان الموديل وإن النت شغال من السيرفر."
                : "فشل الاتصال بالموديل — راجع الرابط والمفتاح واسم الموديل.";
    return ok({ ok: false, error: friendly, raw: msg.slice(0, 120) });
  }
  } catch (e) {
    console.error("[llm-test] failed:", e instanceof Error ? e.stack : e);
    throw e;
  }
});
