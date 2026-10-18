import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// ============================================================
// رخصة نظام الطوارئ — توقيع RSA-SHA256 من السيرفر.
// المفتاح الخاص عمره ما يغادر السيرفر (db/emergency-signing.pem).
// المفتاح العام (SPKI base64) يتشحن جوّه الحزمة الأوفلاين —
// التطبيق الأوفلاين يتحقق من التوقيع بـ WebCrypto قبل ما يقبل أي حاجة.
// ============================================================

const KEY_PATH = path.join(process.cwd(), "db", "emergency-signing.pem");
/** المفتاح بييجي من env في الإنتاج (بيتشرم على Vercel) — الملف للديف بس.
 *  بيقبل PEM خام أو base64 (عشان newlines مبتتكسش في لوحة الـ env). */
function envSigningPem(): string | null {
  const raw = process.env.EMERGENCY_SIGNING_KEY?.trim();
  if (!raw) return null;
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n") + "\n";
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) return decoded;
  } catch { /* مش base64 */ }
  return null;
}
export const EMERGENCY_LICENSE_DAYS = 7;
export const EMERGENCY_APP_VERSION = "1.0.0";
export const EMERGENCY_SCHEMA_VERSION = 1;

export type EmergencyLicense = {
  v: number; // license version
  typ: "ALNOKHBA_EMERGENCY_LICENSE";
  centerId: string;
  centerName: string;
  packageId: string;
  snapshotId: string;
  issuedAt: string; // ISO
  expiresAt: string; // ISO = issuedAt + 7 days
  days: number;
  keyFp: string; // sha256 fingerprint (hex, first 16 chars) للمفتاح الموقّع
  snapshotDigest: string; // sha256 hex للقطة (canonical snapshot JSON)
  appVersion: string;
};

/** تسلسل JSON قياسي (مفاتيح مرتبة، بلا مسافات) — نفس النص بيترسم على السيرفر وبيتحقق منه أوفلاين */
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        o[k] = sorted((v as Record<string, unknown>)[k]);
      }
      return o;
    }
    return v;
  };
  return JSON.stringify(sorted(value));
}

type KeyPair = {
  privatePem: string;
  publicPem: string;
  publicSpkiB64: string; // للشحن جوّه الحزمة
  fingerprint: string; // sha256(pubkey-der) hex[0..16]
};

let cached: KeyPair | null = null;

/** تحميل/توليد زوج المفاتيح مرة واحدة (RSA-2048)
 *  الترتيب: env (إنتاج) → ملف (ديف) → توليد جديد مع محاولة حفظ
 *  (على Vercel الكتابة بتفشل — FS للقراءة فقط → مفتاح مؤقت بالذاكرة + تحذير صريح) */
export function getSigningKeys(): KeyPair {
  if (cached) return cached;
  const fromEnv = envSigningPem();
  if (fromEnv) {
    cached = deriveFromPrivate(fromEnv);
    return cached;
  }
  if (fs.existsSync(KEY_PATH)) {
    const privatePem = fs.readFileSync(KEY_PATH, "utf8");
    cached = deriveFromPrivate(privatePem);
    return cached;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  try {
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    fs.writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });
  } catch {
    // FS للقراءة فقط (لامدا Vercel) — نكمل بمفتاح مؤقت في الذاكرة/‏tmp
    // ⚠️ الحزم الموقعة قبل كده مش هتتسترجع بعد كول ستارت جديد — ضيف EMERGENCY_SIGNING_KEY في الـ env
    console.warn("[emergency-license] مفيش مفتاح محفوظ — مفتاح مؤقت بالذاكرة. ضيف EMERGENCY_SIGNING_KEY في env الإنتاج.");
    try {
      const tmpKey = path.join(os.tmpdir(), "emergency-signing.pem");
      if (!fs.existsSync(tmpKey)) fs.writeFileSync(tmpKey, privateKey, { mode: 0o600 });
      cached = deriveFromPrivate(fs.readFileSync(tmpKey, "utf8"));
      return cached;
    } catch { /* حتى tmp مقفول — الذاكرة بس */ }
  }
  cached = {
    privatePem: privateKey,
    publicPem: publicKey,
    publicSpkiB64: Buffer.from(
      crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" }) as Buffer,
    ).toString("base64"),
    fingerprint: crypto
      .createHash("sha256")
      .update(crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" }) as Buffer)
      .digest("hex")
      .slice(0, 16),
  };
  return cached;
}

function deriveFromPrivate(privatePem: string): KeyPair {
  const priv = crypto.createPrivateKey(privatePem);
  const pub = crypto.createPublicKey(priv);
  const pubDer = pub.export({ type: "spki", format: "der" }) as Buffer;
  return {
    privatePem,
    publicPem: pub.export({ type: "spki", format: "pem" }).toString(),
    publicSpkiB64: pubDer.toString("base64"),
    fingerprint: crypto.createHash("sha256").update(pubDer).digest("hex").slice(0, 16),
  };
}

/** بناء الرخصة + توقيعها — بيرجّع النص الموقّع حرفيًا (canonical) + التوقيع */
export function issueLicense(opts: {
  centerId: string;
  centerName: string;
  packageId: string;
  snapshotId: string;
  snapshotDigest: string;
  issuedAt?: Date;
}): {
  license: EmergencyLicense;
  licenseRaw: string;
  signature: string;
  publicKeySpkiB64: string;
  keyFingerprint: string;
} {
  const keys = getSigningKeys();
  const issuedAt = opts.issuedAt ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + EMERGENCY_LICENSE_DAYS * 24 * 60 * 60 * 1000);
  const license: EmergencyLicense = {
    v: EMERGENCY_SCHEMA_VERSION,
    typ: "ALNOKHBA_EMERGENCY_LICENSE",
    centerId: opts.centerId,
    centerName: opts.centerName,
    packageId: opts.packageId,
    snapshotId: opts.snapshotId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    days: EMERGENCY_LICENSE_DAYS,
    keyFp: keys.fingerprint,
    snapshotDigest: opts.snapshotDigest,
    appVersion: EMERGENCY_APP_VERSION,
  };
  const licenseRaw = canonicalJson(license);
  const signature = crypto.sign("RSA-SHA256", Buffer.from(licenseRaw, "utf8"), keys.privatePem).toString("base64");
  return {
    license,
    licenseRaw,
    signature,
    publicKeySpkiB64: keys.publicSpkiB64,
    keyFingerprint: keys.fingerprint,
  };
}

/** تحقق السيرفر من رخصة مرفوعة (استيراد ملف الاسترداد) — RSA-SHA256 على النص الحرفي */
export function verifyLicenseRaw(licenseRaw: string, signatureB64: string): EmergencyLicense | null {
  try {
    const keys = getSigningKeys();
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 256) return null; // RSA-2048 → 256-byte signature
    const valid = crypto.verify("RSA-SHA256", Buffer.from(licenseRaw, "utf8"), keys.publicPem, sig);
    if (!valid) return null;
    let parsed: EmergencyLicense;
    try {
      parsed = JSON.parse(licenseRaw) as EmergencyLicense;
    } catch {
      return null;
    }
    if (parsed?.typ !== "ALNOKHBA_EMERGENCY_LICENSE") return null;
    // الرخصة القياسية: مفاتيح معروفة بس — أي حقل زيادة/نقص = ملف متلاعب بيه
    const expectedKeys = [
      "appVersion", "centerId", "centerName", "days", "expiresAt", "issuedAt",
      "keyFp", "packageId", "snapshotDigest", "snapshotId", "typ", "v",
    ];
    if (Object.keys(parsed).sort().join(",") !== expectedKeys.join(",")) return null;
    return parsed;
  } catch {
    return null;
  }
}
