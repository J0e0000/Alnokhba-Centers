/* ============================================================
   LLM PROVIDER INTERFACE — طبقة الموديل المجردة (spec §1 / §24)
   ------------------------------------------------------------
   الوكيل (الـ orchestrator والأدوات) ملك لـ AlNokhba — والموديل قابل
   للاستبدال. أي provider بيدعم نفس العقد البسيط ده:
   - generate(): رد نصي واحد (بنستخدم JSON protocol فوقه)
   - stream(): مستقبلاً للرد الحي (V2) — Interface جاهز
   ممنوع أي استيراد للمزودات جوه orchestrator/tools — كل الاتصال
   بيمر على العقد ده بس.
============================================================ */

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  /** المحتوى نصي دايمًا — الأدوات بتمر كـ observations نصية JSON منظم */
  content: string;
};

export type LLMGenerateOptions = {
  temperature?: number;
  /** أقصى طول متوقع للرد — providers ممكن تحوله لـ max_tokens */
  maxTokens?: number;
  /** مهلة بالمللي ثانية — الافتراضي من الـ provider */
  timeoutMs?: number;
  /** اطلب JSON صارم من الموديل (response_format) — المزود اللي مش بيدعمه بيتجاهله */
  json?: boolean;
};

export type LLMGenerateResult = {
  text: string;
  provider: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

/** عقد المزود — أي موديل (self-hosted / OpenAI-compatible / محلي) ينفذه */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** هل المزود جاهز للعمل؟ (متوفر + مُعد) */
  isAvailable(): Promise<boolean>;
  generate(messages: LLMMessage[], opts?: LLMGenerateOptions): Promise<LLMGenerateResult>;
  /** streaming اختياري في V1 — الافتراضي: يجمع generate ويقذف مرة واحدة */
  stream?(messages: LLMMessage[], opts?: LLMGenerateOptions): AsyncIterable<{ delta: string }>;
}

/** استخراج JSON من رد الموديل (بيتحمل code fences وحش قبل/بعد) */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no-json-in-response");
  return JSON.parse(cleaned.slice(start, end + 1));
}
