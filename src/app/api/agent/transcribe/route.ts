import { handler, readJson, ok, fail } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
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
  await requireModule(user.centerId, "ai_agent");
  rateLimit(`agent-asr:${user.id}`, 30, 60_000);

  const body = await readJson<{ audio?: string; mime?: string; lang?: string }>(req);
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

  // تلميح اللغة (اختياري): كود ISO قصير بس — بيرفع دقة whisper مع الكلام المصري
  // (بدونه الكشف التلقائي بيغلط في التسجيلات القصيرة). أي حاجة تانية = auto (بدون تلميح).
  const langRaw = String(body.lang ?? "").trim().toLowerCase();
  const lang = /^[a-z]{2}$/.test(langRaw) ? langRaw : null;

  try {
    const r = await transcribeAudio(base64, mime, user.centerId, lang);
    return ok({ text: r.text, provider: r.provider, model: r.model });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent:transcribe] failed:", msg.slice(0, 200));
    // أخطاء المزود الخارجي — رسالة عربية مفهومة من غير تفاصيل تقنية ولا مفاتيح
    if (/rate.?limit|429/i.test(msg)) {
      return fail("خدمة التعرف على الصوت مشغولة دلوقتي (تجاوزنا حد الطلبات) — استنى دقيقة وجرب تاني.", 429);
    }
    if (/stt-all-providers-failed/.test(msg)) {
      // سبب تشخيصي آمن: أكواد HTTP وأجسام أخطاء المزودين العامة — والمفاتيح بتنضف قبل العرض
      const reason = msg
        .replace(/gsk_[A-Za-z0-9_-]+/g, "***")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "***")
        .replace(/\s+/g, " ")
        .replace(/^stt-all-providers-failed:\s*/, "")
        .slice(0, 220);
      return fail(`خدمة التعرف على الصوت مش متاحة دلوقتي — جرب تاني بعد لحظات أو اكتب طلبك. (${reason})`, 502);
    }
    return fail("مقدرتش أحوّل التسجيل لنص — جرب تسجل تاني، ولو فضلت المشكلة اكتب طلبك.", 502);
  }
});
