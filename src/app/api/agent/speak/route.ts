import "server-only";
import crypto from "crypto";
import { handler, readJson, fail } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { prepareSpeechText } from "@/lib/speech-text";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ============================================================
   POST /api/agent/speak — رد صوتي عربي سيرفري (spec §11)
   body: { text: string } → audio/wav binary
   المحرك الأول: Groq PlayAI TTS بصوت عربي أصلي (Fahad-PlayAI)
   — نطق عربي طبيعي للأرقام والكلمات بعد تحضير speech-text.
   فول باك: ZAI (صوت tongtong) → وآخر حاجة صوت المتصفح في العميل.
   النص بيتحضّر قبل أي محرك: أرقام/سعات/تواريخ/فلوس بالحروف العربي.
   كاش LRU عشان الردود المتكررة متتولدش تاني (الصوت غالي — الكاش رخيص).
============================================================ */

const MAX_TEXT = 900; // حد الـ API 1024 حرف — بنسيب هامش أمان
const CACHE_MAX = 24;

type CacheEntry = { audio: Buffer; at: number };
const cache = new Map<string, CacheEntry>();

/** فترة تهدئة لمحرك Groq بعد 429 — بنحاول ZAI فورًا بدل ما نضغط الخدمة */
let groqCooldownUntil = 0;

/** تنظيف الكاش لو عدى حجم معقول (WAV تقيل — بنحتفظ بحد أقصى) */
function cachePut(key: string, audio: Buffer) {
  if (cache.size >= CACHE_MAX) {
    // أقدم مدخل
    let oldestKey = "";
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { audio, at: Date.now() });
}

/** قص نصي آمن عند آخر جملة مكتملة — الصوت الطبيعي مبيقطعش وسط كلمة */
function clampForSpeech(text: string): string {
  let t = text
    .replace(/[*_#`>•]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > MAX_TEXT) {
    const cut = t.slice(0, MAX_TEXT);
    const lastStop = Math.max(cut.lastIndexOf("۔"), cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"), cut.lastIndexOf("؟"), cut.lastIndexOf("،"), cut.lastIndexOf("\n"));
    t = lastStop > 120 ? cut.slice(0, lastStop + 1) : `${cut.trim()}…`;
  }
  return t;
}

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  await requireModule(user.centerId, "ai_agent", user);
  rateLimit(`agent-tts:${user.id}`, 40, 60_000);

  const body = await readJson<{ text?: string }>(req);
  const raw = clampForSpeech(String(body.text ?? ""));
  if (!raw) return fail("مفيش نص للنطق.", 400);
  // تحضير النطق (أرقام/سعات/تواريخ بالحروف العربي) ثم قص نهائي بعد التحويل
  const clean = clampForSpeech(prepareSpeechText(raw));

  const key = crypto.createHash("sha1").update(clean).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    cached.at = Date.now();
    return new Response(new Uint8Array(cached.audio), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Speak-Cache": "hit" },
    });
  }

  // ==== المحرك ١: Groq PlayAI TTS — صوت عربي أصلي (لو فيه مفتاح) ====
  const ttsKey = process.env.AGENT_TTS_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim() || "";
  // بعد 429 من Groq بنستنى دقيقة قبل ما نرجع له — الزيارة الجاية بتروح ZAI على طول
  let groqBlocked = false;
  if (ttsKey && Date.now() >= groqCooldownUntil) {
    groqBlocked = true;
    try {
      const base = process.env.AGENT_TTS_BASE_URL?.trim() || "https://api.groq.com/openai/v1";
      const model = process.env.AGENT_TTS_MODEL?.trim() || "playai-tts";
      const voice = process.env.AGENT_TTS_VOICE?.trim() || "Fahad-PlayAI";
      const r = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ttsKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice, input: clean, response_format: "wav" }),
      });
      if (!r.ok) throw new Error(`groq-tts-${r.status}`);
      const ab = await r.arrayBuffer();
      const audio = Buffer.from(new Uint8Array(ab));
      if (audio.length < 100) throw new Error("tts-empty-audio");
      cachePut(key, audio);
      return new Response(new Uint8Array(audio), {
        headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Speak-Cache": "miss", "X-TTS-Engine": "groq" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[agent:speak] groq tts failed:", msg.slice(0, 200));
      if (/\b429\b|rate limit/i.test(msg)) groqCooldownUntil = Date.now() + 60_000;
      // مش بنفشل الطلب — بننزل للمحرك التاني
    }
  }
  void groqBlocked;

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const response = await zai.audio.tts.create({
      input: clean,
      voice: "tongtong",
      speed: 1.0,
      response_format: "wav",
      stream: false,
    });
    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(new Uint8Array(arrayBuffer));
    if (audio.length < 100) throw new Error("tts-empty-audio");
    cachePut(key, audio);
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Speak-Cache": "miss", "X-TTS-Engine": "zai" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent:speak] failed:", msg.slice(0, 200));
    // 429 من خدمة الصوت = ضغط مؤقت — نرجّع 429 + Retry-After عشان العميل يرجع لصوت المتصفح بهدوء ويجرب بعدين
    if (/\b429\b|too many requests/i.test(msg)) {
      return Response.json(
        { error: "خدمة الصوت مشغولة دلوقتي — هنعيد المحاولة تلقائيًا." },
        { status: 429, headers: { "Retry-After": "30" } },
      );
    }
    return fail("خدمة الصوت مش متاحة دلوقتي — هعرض الرد كتابة بس.", 502);
  }
});
