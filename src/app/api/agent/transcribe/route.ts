import { handler, readJson, ok, fail } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ============================================================
   POST /api/agent/transcribe — تحويل الصوت لنص (سيرفري)
   body: { audio: string(base64), mime?: string }
   بياخد تسجيل المايك من المتصفح (WAV/WebM) ويرجّع النص.
   الفرق عن Web Speech API بتاع المتصفح: ده شغال على كل المتصفحات
   (حتى اللي بتاعها بيفشل أو مفيش دعم عربي) لأن التعرف بيحصل سيرفري.
============================================================ */

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB ≈ 4 دقايق تسجيل مضغوط

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  rateLimit(`agent-asr:${user.id}`, 30, 60_000);

  const body = await readJson<{ audio?: string; mime?: string }>(req);
  const audio = String(body.audio ?? "").trim();
  if (!audio) return fail("مفيش صوت مبعت — سجل تاني.", 400);

  // بيقبل base64 خام أو data URI
  const base64 = audio.includes(",") ? audio.slice(audio.indexOf(",") + 1) : audio;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_AUDIO_BYTES) {
    return fail("التسجيل طويل أوي — جرب طلب أقصر.", 413);
  }
  if (approxBytes < 800) {
    return fail("الميكروفون مدكوش صوت — قرب من المايك وجرب تاني.", 400);
  }

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const result = await zai.audio.asr.create({ file_base64: base64 });
    const text = String(result?.text ?? "").trim();
    if (!text) {
      return fail("مقدرتش أسمع كلام واضح — قرب من المايك واتكلم بوضوح وجرب تاني.", 422);
    }
    return ok({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent:transcribe] failed:", msg.slice(0, 200));
    return fail("خدمة التعرف على الصوت مش متاحة دلوقتي — جرب تاني بعد لحظات أو اكتب طلبك.", 502);
  }
});
