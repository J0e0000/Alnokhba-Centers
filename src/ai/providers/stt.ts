import "server-only";
import { db } from "@/lib/db";

/* ============================================================
   STT — تحويل الصوت لنص (spec Phase 8B)
   سلسلة مزودين بترتيب أولوية — المفتاح سيرفري دايمًا:
   1) Groq / OpenAI-compatible (whisper) — لو فيه مفتاح:
      env AGENT_STT_API_KEY ← مفتاح السنتر agentLlmApiKey (نفس حساب Groq)
      endpoint: env AGENT_STT_BASE_URL ← baseUrl السنتر ← api.groq.com
      model:    env AGENT_STT_MODEL ← agentSttModel للسنتر ← whisper-large-v3-turbo
   2) ZAI المدمج (ASR) — شبكة أمان دايمًا متاحة في بيئة النشر دي
   الموديل قابل للتهيئة من مكان واحد — مفيش أسماء موديلات مبعثرة.
   بنستخدم endpoint الترجمة النصية (transcription) مش الترجمة (translation)
   — عشان كلام المستخدم يفضل بلغته (عربي مصري/فصحى/إنجليزي/خليط).
============================================================ */

export type SttResult = { text: string; provider: string; model: string };

/** موديل افتراضي — whisper turbo: أسرع بكتير وكفاية دقة للكلام اليومي */
export const DEFAULT_STT_MODEL = "whisper-large-v3-turbo";
const DEFAULT_GROQ_BASE = "https://api.groq.com/openai/v1";
const STT_TIMEOUT_MS = 25_000;

/** تلميح مصطلحات النظام — بيرفع دقة التعرف على كلمات التطبيق والأسماء
 *  (Groq بيدعم prompt ≤ 224 tokens — بنسيبه قصير) */
export function sttPrompt(): string {
  return (
    process.env.AGENT_STT_PROMPT?.trim() ||
    "Zaki, El No5ba, النخبة، زكي، حضور، غياب، غايب، حاضر، متأخر، حصة، مجموعات، تحصيل، دفعة، فلوس، فودافون، انستاباي، كاش، تقرير، طالب، مدرس، سجل، اقفل، افتح. Egyptian Arabic speech with common English tech words like QR, Groq."
  );
}

type GroqConfig = { baseUrl: string; apiKey: string; model: string; source: "env" | "center" };

async function groqConfig(centerId?: string): Promise<GroqConfig | null> {
  const envKey = process.env.AGENT_STT_API_KEY?.trim() ?? "";
  const envBase = process.env.AGENT_STT_BASE_URL?.trim() ?? "";
  const envModel = process.env.AGENT_STT_MODEL?.trim() ?? "";
  if (envKey) {
    return {
      baseUrl: envBase || DEFAULT_GROQ_BASE,
      apiKey: envKey,
      model: envModel || DEFAULT_STT_MODEL,
      source: "env",
    };
  }
  if (centerId) {
    try {
      // الأعمدة القديمة (موجودة في كل قواعد البيانات) في استعلام مستقل —
      // وagentSttModel في استعلام لوحده: لو العمود لسه متزامنش على الإنتاج
      // (db push بيتعطل أحيانًا على pgbouncer) الاستعلام بيفشل بسالم
      // والافتراضي whisper بيتستخدم — بدل ما Groq كله يتخطى.
      const center = await db.center.findUnique({
        where: { id: centerId },
        select: { agentLlmBaseUrl: true, agentLlmApiKey: true },
      });
      if (center?.agentLlmApiKey?.trim()) {
        let sttModel: string | null = null;
        try {
          const c2 = await db.center.findUnique({
            where: { id: centerId },
            select: { agentSttModel: true },
          });
          sttModel = c2?.agentSttModel ?? null;
        } catch {
          // العمود مش متزامن بعد — الموديل الافتراضي بيتستخدم
        }
        return {
          baseUrl: envBase || center.agentLlmBaseUrl?.trim() || DEFAULT_GROQ_BASE,
          apiKey: center.agentLlmApiKey.trim(),
          model: envModel || sttModel?.trim() || DEFAULT_STT_MODEL,
          source: "center",
        };
      }
    } catch {
      // جدول/عمود ناقص — نكمل لـ ZAI بدل ما نكسر الصوت
    }
  }
  return null;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const clean = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const buf = Buffer.from(clean, "base64");
  // Blob من Buffer — Node 18+ على Vercel متاح
  return new Blob([new Uint8Array(buf)], { type: mime || "audio/wav" });
}

/** Groq / OpenAI-compatible — multipart /audio/transcriptions (مش translation) */
async function transcribeGroq(cfg: GroqConfig, base64: string, mime: string): Promise<SttResult> {
  const form = new FormData();
  form.append("file", base64ToBlob(base64, mime), "audio.wav");
  form.append("model", cfg.model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("prompt", sttPrompt());

  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // رسائل تشخيصية سيرفري — من غير مفاتيح ولا تفاصيل حساسة في رسالة المستخدم
    const err = new Error(`groq-stt-${res.status}: ${body.slice(0, 180)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const data = (await res.json()) as { text?: string };
  const text = String(data.text ?? "").trim();
  if (!text) throw new Error("groq-stt-empty");
  return { text, provider: "groq", model: cfg.model };
}

/** ZAI المدمج — شبكة الأمان (شغال حتى لو مفيش أي مفاتيح خارجية) */
async function transcribeZai(base64: string): Promise<SttResult> {
  const ZAI = (await import("z-ai-web-dev-sdk")).default;
  const zai = await ZAI.create();
  const result = await zai.audio.asr.create({ file_base64: base64 });
  const text = String(result?.text ?? "").trim();
  if (!text) throw new Error("zai-asr-empty");
  return { text, provider: "zai", model: "builtin-asr" };
}

/**
 * التحويل الكامل — بيجرّب Groq الأول (لو فيه مفتاح) وبعده ZAI.
 * لو Groq فشل (شبكة/ريجون/رصيد) بنسجل السبب سيرفري ونكمل لـ ZAI —
 * الصوت مبيفشل أبدًا طالما فيه مزود شغال.
 */
export async function transcribeAudio(
  base64: string,
  mime: string,
  centerId?: string,
): Promise<SttResult> {
  const attempts: string[] = [];

  if (process.env.AGENT_STT_PROVIDER?.trim().toLowerCase() !== "zai") {
    const cfg = await groqConfig(centerId);
    if (cfg) {
      try {
        return await transcribeGroq(cfg, base64, mime);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        attempts.push(`groq: ${msg.slice(0, 140)}`);
        console.error(`[agent:stt] groq failed → falling back to zai (${msg.slice(0, 120)})`);
      }
    }
  }

  try {
    return await transcribeZai(base64);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    attempts.push(`zai: ${msg.slice(0, 140)}`);
    console.error(`[agent:stt] zai failed (${msg.slice(0, 120)})`);
  }

  throw new Error(`stt-all-providers-failed: ${attempts.join(" | ")}`);
}
