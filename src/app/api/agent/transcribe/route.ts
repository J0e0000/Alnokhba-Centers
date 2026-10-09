import { handler, readJson, ok, fail } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { transcribeAudio } from "@/ai/providers/stt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ============================================================
   POST /api/agent/transcribe — تحويل الصوت لنص (سيرفري)
   body: { audio: string(base64), mime?: string }
   بياخد تسجيل المايك من المتصفح (WAV) ويرجّع النص.
   المزودين بالأولوية: Groq whisper (مفتاح سيرفري بس، موديل قابل
   للتهيئة من الإعدادات) ← ZAI المدمج. بنستخدم endpoint
   التسجيل (transcription) مش الترجمة — عشان كلام المستخدم يفضل بلغته.
   raw audio مش بيتخزن في أي حاجة — بيتبعث للتعرف وبيتم إتمامه.
============================================================ */

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB ≈ 8 دقايق WAV 16kHz مونو

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
  // فحص المدة من حجم WAV (16kHz × 2 bytes) — طلب أطول من حد التسجيل = حاجة غلط
  const approxSeconds = approxBytes / 32_000;
  if (approxSeconds > 90) {
    return fail("التسجيل أطول من الحد المسموح (90 ثانية) — قسّمه لطلبات أقصر.", 413);
  }

  const mime = String(body.mime ?? "audio/wav").slice(0, 60);
  if (mime && !/^audio\//i.test(mime)) {
    return fail("صيغة الملف مش صوت — سجل من المايك تاني.", 415);
  }

  try {
    const r = await transcribeAudio(base64, mime, user.centerId);
    return ok({ text: r.text, provider: r.provider, model: r.model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent:transcribe] failed:", msg.slice(0, 200));
    // أخطاء المزود الخارجي — رسالة عربية مفهومة من غير تفاصيل تقنية ولا مفاتيح
    if (/rate.?limit|429/i.test(msg)) {
      return fail("خدمة التعرف على الصوت مشغولة دلوقتي (تجاوزنا حد الطلبات) — استنى دقيقة وجرب تاني.", 429);
    }
    if (/stt-all-providers-failed/.test(msg)) {
      // رمز تشخيص آمن (كود HTTP أو نوع الشبكة بس — من غير أي مفتاح أو جسم الرد) عشان الدعم يعرف مين اللي وقع
      const code = msg.match(/groq-stt-(\d{3})/)?.[1] ?? (/groq: (TypeError|AbortError|FetchError)/.test(msg) ? "NET" : undefined);
      return fail(`خدمة التعرف على الصوت مش متاحة دلوقتي — جرب تاني بعد لحظات أو اكتب طلبك.${code ? ` (رمز: STT-${code})` : ""}`, 502);
    }
    return fail("مقدرتش أحوّل التسجيل لنص — جرب تسجل تاني، ولو فضلت المشكلة اكتب طلبك.", 502);
  }
});
