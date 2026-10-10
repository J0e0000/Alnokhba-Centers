import "server-only";
import crypto from "crypto";
import { handler, readJson, fail } from "@/lib/api";
import { requireModule } from "@/lib/entitlements";
import { requireCenterUser, rateLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ============================================================
   POST /api/agent/speak — رد صوتي عربي سيرفري (spec §11)
   body: { text: string } → audio/wav binary
   المتصفحات كتير مفيهاش صوت عربي جاهز (speechSynthesis) —
   فبنولّد الصوت سيرفري بصوت طبيعي، مع كاش LRU عشان الردود
   المتكررة متتولدش تاني (الصوت غالي — الكاش رخيص).
============================================================ */

const MAX_TEXT = 900; // حد الـ API 1024 حرف — بنسيب هامش أمان
const CACHE_MAX = 24;

type CacheEntry = { audio: Buffer; at: number };
const cache = new Map<string, CacheEntry>();

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
  await requireModule(user.centerId, "ai_agent");
  rateLimit(`agent-tts:${user.id}`, 40, 60_000);

  const body = await readJson<{ text?: string }>(req);
  const clean = clampForSpeech(String(body.text ?? ""));
  if (!clean) return fail("مفيش نص للنطق.", 400);

  const key = crypto.createHash("sha1").update(clean).digest("hex");
  const cached = cache.get(key);
  if (cached) {
    cached.at = Date.now();
    return new Response(new Uint8Array(cached.audio), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Speak-Cache": "hit" },
    });
  }

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
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store", "X-Speak-Cache": "miss" },
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
