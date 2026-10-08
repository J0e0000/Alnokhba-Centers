import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { cleanRaw } from "@/lib/normalize";
import { normalizeCenterBranding } from "@/lib/branding";
import { resetLLMCache } from "@/ai/providers";

export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** GET /api/settings — branding + WhatsApp alert config (manager view) */
export const GET = handler(async () => {
  const user = await requireManager();
  const center = await db.center.findUnique({ where: { id: user.centerId } });
  // القيم الافتراضية القديمة بتتقرا كهوية اللوجو الرسمية — والفورم بيتخزن بالنظيفة فقاعدة الداتا بتتشفى مع أول حفظ
  const b = normalizeCenterBranding(center);
  return ok({
    branding: b
      ? {
          name: b.name, logo: b.logo, primaryColor: b.primaryColor,
          secondaryColor: b.secondaryColor, accentColor: b.accentColor,
          phone: b.phone, whatsapp: b.whatsapp, address: b.address,
          slogan: b.slogan, signature: b.signature, social: b.social ? JSON.parse(b.social) : {},
        }
      : null,
    // تنبيهات الواتساب — opt-in من المدير + سجل الموافقة (شيفا)
    whatsappAlerts: center
      ? {
          waPaymentsEnabled: center.waPaymentsEnabled,
          waLowBalanceEnabled: center.waLowBalanceEnabled,
          waLowBalanceThreshold: center.waLowBalanceThreshold,
          waConsentNote: center.waConsentNote,
        }
      : null,
    // زكي — العقل الذكي: إعدادات الموديل. المفتاح مش بيرجع للعميل أبدًا (الذيل بس للعرض)
    agentLlm: {
      baseUrl: center?.agentLlmBaseUrl ?? "",
      model: center?.agentLlmModel ?? "",
      hasKey: !!center?.agentLlmApiKey,
      keyTail: center?.agentLlmApiKey ? center.agentLlmApiKey.slice(-4) : "",
      envConfigured: !!(process.env.AGENT_LLM_BASE_URL?.trim() && process.env.AGENT_LLM_MODEL?.trim()),
    },
  });
});

type BrandBody = {
  name?: string; logo?: string | null; primaryColor?: string; secondaryColor?: string;
  accentColor?: string | null; phone?: string; whatsapp?: string; address?: string;
  slogan?: string; signature?: string; social?: Record<string, string>;
  // تنبيهات الواتساب (opt-in)
  waPaymentsEnabled?: boolean; waLowBalanceEnabled?: boolean;
  waLowBalanceThreshold?: number; waConsentNote?: string | null;
  // زكي — العقل الذكي (OpenAI-compatible) — المفتاح سيرفري بس ومش بيرجع للعرض
  agentLlmBaseUrl?: string; agentLlmModel?: string; agentLlmApiKey?: string; agentLlmClearKey?: boolean;
};

/** PATCH /api/settings — update center branding (manager) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<BrandBody>(req);
  const center = await db.center.findUnique({ where: { id: user.centerId } });
  if (!center) throw new Error("center missing");

  const data: Record<string, string | null> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 3) throw new Error("اسم السنتر قصير جداً — اكتب 3 حروف على الأقل.");
    data.name = name;
  }
  if (body.primaryColor !== undefined) {
    if (!HEX.test(body.primaryColor)) throw new Error("اللون الأساسي مش مكتوب صح (مثال: #0B1B4F).");
    data.primaryColor = body.primaryColor;
  }
  if (body.secondaryColor !== undefined) {
    if (!HEX.test(body.secondaryColor)) throw new Error("اللون الثانوي مش مكتوب صح.");
    data.secondaryColor = body.secondaryColor;
  }
  if (body.accentColor !== undefined) {
    if (body.accentColor === null || body.accentColor === "") data.accentColor = null;
    else {
      if (!HEX.test(body.accentColor)) throw new Error("لون التمييز مش مكتوب صح.");
      data.accentColor = body.accentColor;
    }
  }
  if (body.logo !== undefined) {
    // data URL, limit ~400KB — MIME allowlist صريح (png/jpeg/webp بس)
    if (body.logo === null || body.logo === "") data.logo = null;
    else {
      if (typeof body.logo !== "string" || !/^data:image\/(png|jpe?g|webp);/i.test(body.logo)) {
        throw new Error("اللوجو لازم يكون صورة (PNG أو JPG أو WEBP).");
      }
      if (body.logo.length > 550_000) throw new Error("اللوجو كبير جداً — ارفع صورة أصغر (أقل من 400KB).");
      data.logo = body.logo;
    }
  }
  if (body.phone !== undefined) data.phone = cleanRaw(String(body.phone)) || null;
  if (body.whatsapp !== undefined) data.whatsapp = cleanRaw(String(body.whatsapp)) || null;
  if (body.address !== undefined) data.address = String(body.address).trim() || null;
  if (body.slogan !== undefined) data.slogan = String(body.slogan).trim() || null;
  if (body.signature !== undefined) data.signature = String(body.signature).trim() || null;
  if (body.social !== undefined) data.social = body.social && Object.keys(body.social).length ? JSON.stringify(body.social) : null;

  // تنبيهات الواتساب — تحديث منفصل لأنه boolean/number مش string|null
  const waData: Record<string, boolean | number | string | null> = {};
  if (body.waPaymentsEnabled !== undefined) waData.waPaymentsEnabled = !!body.waPaymentsEnabled;
  if (body.waLowBalanceEnabled !== undefined) waData.waLowBalanceEnabled = !!body.waLowBalanceEnabled;
  if (body.waLowBalanceThreshold !== undefined) {
    const t = Math.trunc(Number(body.waLowBalanceThreshold));
    if (!Number.isFinite(t) || t < 0 || t > 1_000_000) throw new Error("حد الرصيد لازم يكون رقم منطقي (بالقروش).");
    waData.waLowBalanceThreshold = t;
  }
  if (body.waConsentNote !== undefined) waData.waConsentNote = String(body.waConsentNote).trim() || null;
  if (Object.keys(waData).length) {
    await db.center.update({ where: { id: center.id }, data: waData as never });
    await logAudit({
      user, action: AUDIT.BRANDING_UPDATED, entity: "CENTER", entityId: center.id,
      before: {
        waPaymentsEnabled: center.waPaymentsEnabled, waLowBalanceEnabled: center.waLowBalanceEnabled,
        waLowBalanceThreshold: center.waLowBalanceThreshold,
      },
      after: waData, reason: "إعدادات تنبيهات الواتساب",
    });
  }

  // زكي — العقل الذكي: رابط/موديل/مفتاح (OpenAI-compatible). المفتاح بيتخزن ومش بيرجع للعرض
  const agentData: Record<string, string | null> = {};
  if (body.agentLlmBaseUrl !== undefined) {
    const u = String(body.agentLlmBaseUrl).trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) throw new Error("رابط الموديل لازم يبدأ بـ http:// أو https://");
    if (u && !u.includes("://")) throw new Error("رابط الموديل مش مكتوب صح.");
    agentData.agentLlmBaseUrl = u || null;
  }
  if (body.agentLlmModel !== undefined) {
    const m = String(body.agentLlmModel).trim();
    if (m.length > 120) throw new Error("اسم الموديل طويل جدًا.");
    agentData.agentLlmModel = m || null;
  }
  if (body.agentLlmApiKey !== undefined && String(body.agentLlmApiKey).trim() !== "") {
    const k = String(body.agentLlmApiKey).trim();
    if (k.length > 400) throw new Error("المفتاح طويل جدًا.");
    agentData.agentLlmApiKey = k;
  }
  if (body.agentLlmClearKey === true) agentData.agentLlmApiKey = null;
  if (Object.keys(agentData).length) {
    await db.center.update({ where: { id: center.id }, data: agentData as never });
    resetLLMCache(); // التغيير يبقى شغال فورًا من غير ما نستنى التخزين المؤقت
    await logAudit({
      user, action: AUDIT.BRANDING_UPDATED, entity: "CENTER", entityId: center.id,
      after: {
        agentLlmBaseUrl: agentData.agentLlmBaseUrl ?? undefined,
        agentLlmModel: agentData.agentLlmModel ?? undefined,
        agentLlmApiKey: agentData.agentLlmApiKey ? "***" : undefined,
        agentLlmClearKey: body.agentLlmClearKey === true ? true : undefined,
      },
      reason: "إعدادات العقل الذكي لزكي",
    });
  }

  await db.center.update({ where: { id: center.id }, data: data as never });

  const before: Record<string, unknown> = {};
  for (const k of Object.keys(data)) before[k] = (center as unknown as Record<string, unknown>)[k];

  await logAudit({ user, action: AUDIT.BRANDING_UPDATED, entity: "CENTER", entityId: center.id, before, after: data });

  const updated = await db.center.findUnique({ where: { id: center.id } });
  return ok({
    branding: {
      name: updated!.name, logo: updated!.logo, primaryColor: updated!.primaryColor,
      secondaryColor: updated!.secondaryColor, accentColor: updated!.accentColor,
      phone: updated!.phone, whatsapp: updated!.whatsapp, address: updated!.address,
      slogan: updated!.slogan, signature: updated!.signature,
      social: updated!.social ? JSON.parse(updated!.social) : {},
    },
  });
});
