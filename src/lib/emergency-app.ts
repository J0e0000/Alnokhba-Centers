import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { EmergencyLicense } from "@/lib/emergency-license";
import { APP_CSS } from "@/lib/emergency-app-css";
import { APP_JS_1 } from "@/lib/emergency-app-js";
import { APP_JS_2 } from "@/lib/emergency-app-js2";
import { APP_JS_3 } from "@/lib/emergency-app-js3";
import { APP_EXCEL_JS } from "@/lib/emergency-excel-js";

// ============================================================
// تجميعة حزمة الطوارئ: ملف HTML واحد مكتفٍ بذاته.
// كل حاجة مدمجة جوّاه: Cairo (woff2 base64) + اللوجو + jsQR + التطبيق.
// صفر طلبات خارجية — يشتغل من غير نت نهائيًا.
// ============================================================

let jsqrCache: string | null = null;
function readJsqr(): string {
  if (jsqrCache) return jsqrCache;
  const p = path.join(process.cwd(), "node_modules", "jsqr", "dist", "jsQR.js");
  jsqrCache = fs.readFileSync(p, "utf8").replace(/<\/script/gi, "<\\/script");
  return jsqrCache;
}

let logoCache: string | null = null;
function readLogo(): string {
  if (logoCache) return logoCache;
  const p = path.join(process.cwd(), "public", "logo.png");
  logoCache = "data:image/png;base64," + fs.readFileSync(p).toString("base64");
  return logoCache;
}

function readFontB64(file: string): string {
  const p = path.join(process.cwd(), "public", "fonts", file);
  return fs.readFileSync(p).toString("base64");
}

/** تخطي النص جوّه <script type="application/json"> — <\/ صالحة JSON وتمنع كسر الوسم */
function jsonForScript(raw: string): string {
  return raw.replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
}

function fontFace(weight: number, b64: string): string {
  return `@font-face{font-family:'Cairo';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}

export function buildEmergencyHtml(opts: {
  licenseRaw: string;
  signature: string;
  publicKeySpkiB64: string;
  snapshotRaw: string;
  centerPrimary: string;
  centerSecondary: string;
  license: EmergencyLicense;
}): string {
  const { licenseRaw, signature, publicKeySpkiB64, snapshotRaw, license } = opts;
  const jsqr = readJsqr();
  const logo = readLogo();
  const fontAr = readFontB64("cairo-arabic.woff2");
  const fontLa = readFontB64("cairo-latin.woff2");

  const cssFonts = [400, 700, 800]
    .map((w) => fontFace(w, fontAr))
    .join("\n");

  // هوية السنتر: لو عنده ألوان مخصصة (زي سنتر الأمل) بتغطلم على الكحلي الافتراضي
  const isHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
  const primary = isHex(opts.centerPrimary) ? opts.centerPrimary : "#143159";
  const secondary = isHex(opts.centerSecondary) ? opts.centerSecondary : "#1D4477";
  const brandOverride = `
:root{ --navy:${primary}; --navy-2:${secondary}; --navy-soft:color-mix(in srgb,${primary} 9%,#ffffff); --navy-50:#F5F7FA; }
.nk-brand-grad{ background:linear-gradient(135deg,${primary},${secondary}); }
`;

  const meta = { signature, publicKey: publicKeySpkiB64, logo, appVersion: license.appVersion };
  const title = `نظام الطوارئ — ${license.centerName}`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#143159">
<title>${title}</title>
<link rel="icon" href="${logo}">
<style>
${cssFonts}
${APP_CSS}
${brandOverride}
</style>
</head>
<body>
<div class="nk-boot" id="nk-boot">
  <div class="nk-boot-card">
    <img class="nk-boot-logo" src="${logo}" alt="Alnokhba Managment">
    <h2 style="margin:0;color:var(--navy);font-size:19px">ALNOKHBA MANAGMENT</h2>
    <p style="margin:2px 0 0;font-weight:800;color:var(--gold-deep);font-size:12px">وضع الطوارئ — ${license.centerName}</p>
    <div class="nk-spin"></div>
    <p class="nk-hint">جاري التحقق من رخصة الطوارئ الموقّعة…</p>
  </div>
</div>
<script type="application/json" id="nk-license-raw">${jsonForScript(licenseRaw)}</script>
<script type="application/json" id="nk-snapshot-raw">${jsonForScript(snapshotRaw)}</script>
<script type="application/json" id="nk-meta">${jsonForScript(JSON.stringify(meta))}</script>
<script>${jsqr}</script>
<script>${APP_EXCEL_JS}</script>
<script>${APP_JS_1}</script>
<script>${APP_JS_2}</script>
<script>${APP_JS_3}</script>
</body>
</html>`;
}
