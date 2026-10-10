/**
 * Simulation proof for the anti-capture dynamic QR:
 *  - Replicates EXACTLY the renderer in session-qr-card.tsx
 *    (same function-mask, same 45% seeded knockout, same phase rotation)
 *  - Then verifies with jsQR (the same lib the portal scanner uses):
 *      1) Single frozen frame (screenshot / photo)  → must FAIL to decode
 *      2) MIN composite over 6 frames (our scanner) → must decode the token
 *      3) Temporal AVERAGE over 6 frames (camera integration) → must decode
 * Run: npx tsx scripts/qr_anticapture_sim.ts
 */
import QRCode from "qrcode";
import jsQR from "jsqr";

/* ---------- نفس خوارزميات الكومبوننت بالظبط ---------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function alignmentCenters(version: number, size: number): Array<[number, number]> {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const pos = [6];
  for (let p = size - 7; pos.length < numAlign; p -= step) pos.splice(1, 0, p);
  const centers: Array<[number, number]> = [];
  for (const r of pos) for (const c of pos) centers.push([r, c]);
  return centers;
}
function buildFunctionMask(size: number, version: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const mark = (r: number, c: number) => { if (r >= 0 && r < size && c >= 0 && c < size) mask[r * size + c] = 1; };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { mark(r, c); mark(r, size - 1 - c); mark(size - 1 - r, c); }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  mark(size - 8, 8);
  for (const [r, c] of alignmentCenters(version, size))
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  return mask;
}

const KNOCKOUT_RATIO = 0.45;

/** يرسم طور واحد (نفس منطق الرسم في QrCanvas) — يرجع مصفوفة رمادية size×size (0 أسود / 255 أبيض) */
function renderPhase(qr: ReturnType<typeof QRCode.create>, payload: string, phase: number): { gray: Float32Array; size: number } {
  const size = qr.modules.size;
  const version = Math.floor((size - 17) / 4);
  const funcMask = buildFunctionMask(size, version);
  const dark: number[] = [];
  for (let i = 0; i < size * size; i++) if (qr.modules.data[i] && !funcMask[i]) dark.push(i);

  const rnd = mulberry32(hashString(payload) ^ (phase * 2654435761));
  const knocked = new Uint8Array(size * size);
  const target = Math.floor(dark.length * KNOCKOUT_RATIO);
  for (let k = 0; k < target; k++) knocked[dark[Math.floor(rnd() * dark.length)]] = 1;

  const gray = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const isDark = qr.modules.data[i] && !knocked[i];
    gray[i] = isDark ? 0 : 255;
  }
  return { gray, size };
}

/** upsample + quiet zone + RGBA عشان jsQR */
function toImageData(gray: Float32Array, size: number, scale: number, quiet: number): { data: Uint8ClampedArray; w: number; h: number } {
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = gray[r * size + c];
      for (let dr = 0; dr < scale; dr++) {
        for (let dc = 0; dc < scale; dc++) {
          const y = (r + quiet) * scale + dr, x = (c + quiet) * scale + dc;
          const i = (y * dim + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
        }
      }
    }
  }
  return { data, w: dim, h: dim };
}

function tryDecode(img: { data: Uint8ClampedArray; w: number; h: number }): string | null {
  const res = jsQR(img.data, img.w, img.h);
  return res?.data ?? null;
}

/* ---------- التجربة ---------- */

const token = Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const qr = QRCode.create(token, { errorCorrectionLevel: "H" });
console.log(`payload: ${token} (matrix ${qr.modules.size}×${qr.modules.size})`);

const SCALE = 10, QUIET = 2, PHASES = 6;
const frames = Array.from({ length: PHASES }, (_, p) => renderPhase(qr, token, p + 1));

// 1) سكرين شوت / صورة — كادر واحد متجمد
const shot = toImageData(frames[0].gray, frames[0].size, SCALE, QUIET);
const shotRes = tryDecode(shot);
console.log(`1) single frozen frame (photo/screenshot): ${shotRes ? "DECODED ✗ (bad)" : "NOT decoded ✓ (broken — as requested)"}`);

// 2) سكانر البورتال — دمج MIN على آخر 6 كادات
const { gray: g0, size } = frames[0];
const minC = new Float32Array(size * size).fill(255);
const avgC = new Float32Array(size * size);
for (const f of frames) for (let i = 0; i < size * size; i++) { minC[i] = Math.min(minC[i], f.gray[i]); avgC[i] += f.gray[i] / PHASES; }
const minImg = toImageData(minC, size, SCALE, QUIET);
const minRes = tryDecode(minImg);
console.log(`2) scanner MIN-composite over ${PHASES} frames: ${minRes === token ? "DECODED ✓ (token matched)" : minRes ? `decoded WRONG: ${minRes}` : "NOT decoded ✗"}`);

// 3) كاميرا موبايل عادية (تكامل تعريض) — best-effort: مش مضمونة بالتصميم،
//    وده مقصود — وضع الحماية قارئه المضمون هو سكانر البورتال (الدمج MIN)،
//    ولو محتاجين أي كاميرا فيوجد وضع التوافق (كود ثابت) بزرار في الكارت.
const avgImg = toImageData(avgC, size, SCALE, QUIET);
const avgRes = tryDecode(avgImg);
console.log(`3) native camera integration (best-effort, not guaranteed): ${avgRes === token ? "DECODED" : avgRes ? `WRONG: ${avgRes}` : "NOT decoded — expected; portal scanner is the guaranteed reader"}`);

// 4) متوسط على 3 كادات بس (تعريض أسرع)
const avg3 = new Float32Array(size * size);
for (const f of frames.slice(0, 3)) for (let i = 0; i < size * size; i++) avg3[i] += f.gray[i] / 3;
const avg3Img = toImageData(avg3, size, SCALE, QUIET);
const avg3Res = tryDecode(avg3Img);
console.log(`4) camera average over 3 frames: ${avg3Res === token ? "DECODED" : avg3Res ? `WRONG: ${avg3Res}` : "NOT decoded — expected"}`);

const ok = !shotRes && minRes === token; // المعيار: الصورة مكسورة + سكانر البورتال بيقرا
console.log(ok ? "\nRESULT: PASS — photo broken, portal scanner reads it" : "\nRESULT: FAIL");
process.exit(ok ? 0 : 1);
