import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { cleanRaw } from "@/lib/normalize";

export const dynamic = "force-dynamic";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** GET /api/settings — branding + WhatsApp alert config (manager view) */
export const GET = handler(async () => {
  const user = await requireManager();
  const center = await db.center.findUnique({ where: { id: user.centerId } });
  return ok({
    branding: center
      ? {
          name: center.name, logo: center.logo, primaryColor: center.primaryColor,
          secondaryColor: center.secondaryColor, accentColor: center.accentColor,
          phone: center.phone, whatsapp: center.whatsapp, address: center.address,
          slogan: center.slogan, signature: center.signature, social: center.social ? JSON.parse(center.social) : {},
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
  });
});

type BrandBody = {
  name?: string; logo?: string | null; primaryColor?: string; secondaryColor?: string;
  accentColor?: string | null; phone?: string; whatsapp?: string; address?: string;
  slogan?: string; signature?: string; social?: Record<string, string>;
  // تنبيهات الواتساب (opt-in)
  waPaymentsEnabled?: boolean; waLowBalanceEnabled?: boolean;
  waLowBalanceThreshold?: number; waConsentNote?: string | null;
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
    if (!HEX.test(body.primaryColor)) throw new Error("اللون الأساسي مش مكتوب صح (مثال: #0E9F6E).");
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
    // data URL, limit ~400KB
    if (body.logo === null || body.logo === "") data.logo = null;
    else {
      if (typeof body.logo !== "string" || !body.logo.startsWith("data:image/")) {
        throw new Error("اللوجو لازم يكون صورة.");
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
