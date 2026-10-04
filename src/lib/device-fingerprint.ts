/* ============================================================
   بصمة المتصفح عالية الإنتروبيا (High-Entropy Device Fingerprint)
   ------------------------------------------------------------
   المشكلة اللي بتحلها: معرّف الجهاز الحالي (nk_did) = UUID عشوائي
   محفوظ في كوكي + LocalStorage — يعني نافذة خاصة (إنكوجنتو) أو
   «مسح بيانات الموقع» بيولّدوا هوية جديدة والجهاز نفسه يسجّل تاني.

   الحل: بصمة مشتقة من خصائص المتصفح/الجهاز نفسها اللي مش بتتخزن
   ولا بتنمسح:
   - الشاشة (أبعاد مرتبة — مقاومة لتدوير الموبايل) + عمق الألوان + dpr
   - هاردوير: أنوية المعالج + ذاكرة الجهاز + نقاط اللمس + المنصة
   - البيئة: المنطقة الزمنية + اللغات
   - رسم Canvas (نص + تدرّج + إيموجي) → نفس المحرك بيطلع نفس البكسلات
   - WebGL: كارت الرسوميات vendor/renderer
   - AudioContext: ناتج تشويش الصوت (بيتغير بين المتصفحات/الكروت)
   - قياس الخطوط: عرض نصوص بخطوط مختلفة (حسب الخطوط المثبتة)

   الخصائص المطلوبة بالظبط:
   1) ثابتة على نفس الجهاز: إنكوجنتو ✔ · مسح بيانات الموقع ✔ · تغيير حجم النافذة ✔
   2) بتتغير بين أجهزة مختلفة — عشان ما نحظرش طالب بريء غلط.
   ⚠️ الحد المعروف: جهازان من نفس الموديل + نفس نسخة النظام والمتصفح
      ممكن يتشابهوا — الحظر بيتم على مستوى الحصة بس، والطالب المرفوض
      غلط بيتعامل معاه زي أي قفل جهاز (الاستقبال تراجع وتسجّله يدويًا).

   الخصوصية: مفيش اسم/موبايل/معرّف هاردوير — SHA-256 بس، وبيتخزن
   مع الحصة من أجل منع التكرار (نفس فلسفة nk_did بالظبط).
   ============================================================ */

let cached: string | null = null;

/** تجزئة سريعة (FNV-1a 64-bit via two 32-bit lanes) — للنصوص الوسيطة */
function fnv1a(str: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + Math.imul(c + i, 0x85ebca6b)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function sortedDims(): [number, number] {
  // مرتبة تصاعديًا — تدوير الموبايل (portrait/landscape) مايغيّرش الناتج
  const w = window.screen?.width ?? 0;
  const h = window.screen?.height ?? 0;
  return w <= h ? [w, h] : [h, w];
}

/** بصمة Canvas: رسم مركّب (تدرّج + نص عربي/لاتيني + إيموجي + أشكال) وتجزئة البكسلات */
function canvasPart(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 240; c.height = 60;
    const ctx = c.getContext("2d");
    if (!ctx) return "nc";
    const grad = ctx.createLinearGradient(0, 0, 240, 60);
    grad.addColorStop(0, "#f60"); grad.addColorStop(0.5, "#0af"); grad.addColorStop(1, "#3c9");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 240, 60);
    ctx.fillStyle = "rgba(20,40,80,0.85)";
    ctx.font = "17px 'Segoe UI', 'Noto Sans SC', sans-serif";
    ctx.fillText("حضورAlnokhba✓ Attendance 123 —uga ", 4, 24);
    ctx.font = "13px 'Times New Roman', serif";
    ctx.fillText("بصمة الجهاز 0123456789 (·) test", 4, 46);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.arc(200, 30, 18, 0, Math.PI * 1.5);
    ctx.stroke();
    const url = c.toDataURL();
    return `cv:${fnv1a(url.slice(-512))}:${url.length}`;
  } catch {
    return "cv:x";
  }
}

/** بصمة WebGL: كارت الرسوميات الحقيقي + تجزئة رندر بسيط */
function webglPart(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "wg:0";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : "";
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    return `wg:${fnv1a(`${vendor}|${renderer}|${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`)}`;
  } catch {
    return "wg:x";
  }
}

/** بصمة الصوت: ناتج مذبذب + مضغوط (OfflineAudioContext — بيتحسب أسرع من التشغيل) */
function audioPart(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const Ctx = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!Ctx) return resolve("au:0");
      const ctx = new Ctx(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
      osc.connect(comp); comp.connect(ctx.destination);
      osc.start(0);
      const done = (sum: string) => { try { void (ctx as unknown as { close?: () => Promise<void> }).close?.(); } catch { /* */ } resolve(`au:${sum}`); };
      ctx.startRendering().then((buf) => {
        const d = buf.getChannelData(0);
        let s = 0;
        for (let i = 4500; i < 5000; i++) s += Math.abs(d[i]);
        done(fnv1a(String(s)));
      }).catch(() => done("x"));
      // أمان زمني — مايستناش أكتر من ثانية
      setTimeout(() => done("t"), 1000);
    } catch {
      resolve("au:x");
    }
  });
}

/** قياس الخطوط المتاحة: عرض نفس النص بخطوط مختلفة (بيختلف حسب اللي متسطب فعلًا) */
function fontsPart(): string {
  try {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return "ft:0";
    const base = "72px monospace";
    const test = "mmmmmmmmmmlliحضور0123";
    c.font = base;
    const baseW = c.measureText(test).width;
    const families = ["Arial", "Verdana", "Times New Roman", "Georgia", "Courier New", "Trebuchet MS", "Cairo", "Segoe UI", "Roboto", "Impact"];
    const widths = families.map((f) => {
      c.font = `72px '${f}', monospace`;
      return c.measureText(test).width === baseW ? "0" : "1";
    }).join("");
    return `ft:${widths}`;
  } catch {
    return "ft:x";
  }
}

/**
 * computeDeviceFingerprint() — بصمة ثابتة للجهاز (SHA-256، 64 hex).
 * النتيجة بتتخزّن في الذاكرة للصفحة (مش بيتخزن مكان في المتصفح —
 * عمدًا: لو المتصفح نفسه اتفتح من إنكوجنتو لازم تطلع نفس القيمة).
 * أي جزء بيفشل بيترمى بأمان — البصمة بتفضل شغالة بجودة أقل.
 */
export async function computeDeviceFingerprint(): Promise<string> {
  if (cached) return cached;
  if (typeof window === "undefined") return "";
  try {
    const [w, h] = sortedDims();
    const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
    const parts = [
      `scr:${w}x${h}`,
      `cd:${window.screen?.colorDepth ?? 0}`,
      `dpr:${Math.round((window.devicePixelRatio || 1) * 100)}`,
      `tp:${navigator.maxTouchPoints ?? 0}`,
      `hc:${navigator.hardwareConcurrency ?? 0}`,
      `dm:${nav.deviceMemory ?? 0}`,
      `lang:${(navigator.languages ?? [navigator.language]).join(",")}`,
      `tz:${Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""}`,
      `plat:${nav.userAgentData?.platform ?? navigator.platform ?? ""}`,
      canvasPart(),
      webglPart(),
      fontsPart(),
      await audioPart(),
    ];
    const joined = parts.join("|");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined));
    cached = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    return cached;
  } catch {
    return ""; // متصفح قديم جدًا — السيرفر يكمل بقفل الجهاز العادي (توافق رجعي)
  }
}
