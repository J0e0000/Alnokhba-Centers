"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Loader2, RotateCw, Maximize2, X, ShieldCheck, ShieldOff, Timer, Camera, ScanLine } from "lucide-react";
import { api } from "./lib";
import { cn } from "@/lib/utils";

/* ============================================================
   QR الحصة المتحرك — الجيل الجديد (Dynamic Batch QR)
   - نداء واحد للسيرفر بيولّد دفعة 10 أكواد، والشاشة بتفل بينهم
     كل كود 5 ثواني (راحة للكاميرا تركز وتقراه) — صورة/سكرين شوت
     بيمسك كود واحد منهم وبيموت مع نهاية الدفعة (~55ث).
   - وضع الحماية من التصوير (افتراضي): الكود مرسوم بطريقة temporal
     interlace — الشاشة بتبدّل بين طورين كل ~66ms، كل طور ناقصه
     ~45% من بيانات الكود (أكتر من قدرة تصحيح أخطاء QR) فأي كادر
     متجمد (صورة/سكرين شوت/كاميرا تانية) شكله مبوّظ ومش بيتقري،
     لكن كاميرا الفيديو بدمج كذا كادر بتقراه عادي — وسكانر البورتال
     بيقراه بمحرك الدمج المتعدد.
   - وضع التوافق: كود ثابت برابط مطلق يفتح من أي كاميرا موبايل.
   - قبل نهاية الدفعة الشاشة بتجيب دفعة جديدة في الخلفية — مفيش فراغ.
============================================================ */

const FLIP_MS = 66; // تبديل الطور ~15 مرة في الثانية (حماية من التصوير — مش الإيقاع)
const KNOCKOUT_RATIO = 0.45; // نسبة البيانات المحذوفة من كل كادر (QR-H يصحح 30% بس)
const CANVAS_PX = 660;
const PREFETCH_BEFORE_MS = 8000; // تجيب دفعة جديدة قبل نهاية الحالية بـ 8 ثواني
const DEFAULT_SLOT_MS = 5000; // كل كود 5 ثواني على الشاشة — الكاميرا تلحق تقراه

type BatchCode = { token: string; expiresAt: string };
type BatchRes = { codes: BatchCode[]; batchExpiresAt: string; slotSeconds: number; sessionLabel?: string };

/* ---------------- PRNG + تصنيف وحدات الكود ---------------- */

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

/** مواقع أنماط المحاذاة (خوارزمية المواصفة القياسية) */
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

/** وحدات الوظائف (فايندر + فاصل + تايمينج + محاذاة + الموديول الأسود) — بتترسم دايمًا سليمة */
function buildFunctionMask(size: number, version: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const mark = (r: number, c: number) => { if (r >= 0 && r < size && c >= 0 && c < size) mask[r * size + c] = 1; };
  // الفايندرات الثلاثة + الفواصل (8×8 في كل ركن من الأركان الثلاثة)
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { mark(r, c); mark(r, size - 1 - c); mark(size - 1 - r, c); }
  // التايمينج
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // الموديول الأسود الثابت
  mark(size - 8, 8);
  // أنماط المحاذاة 5×5
  for (const [r, c] of alignmentCenters(version, size))
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  return mask;
}

/* ---------------- كانفس الرسم (قلب الحماية من التصوير) ---------------- */

function QrCanvas({ payload, antiCapture, className }: { payload: string; antiCapture: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const qr = useMemo(() => {
    if (!payload) return null;
    try { return QRCode.create(payload, { errorCorrectionLevel: "H" }); } catch { return null; }
  }, [payload]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !qr) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const size = qr.modules.size;
    const version = Math.floor((size - 17) / 4);
    const funcMask = buildFunctionMask(size, version);
    const dark: number[] = [];
    for (let i = 0; i < size * size; i++) if (qr.modules.data[i] && !funcMask[i]) dark.push(i);

    const cell = Math.max(4, Math.floor(CANVAS_PX / (size + 4)));
    const total = (size + 4) * cell;
    const off = Math.floor((CANVAS_PX - total) / 2);

    let raf = 0;
    let phase = 0;
    let lastFlip = 0;
    let knocked: Uint8Array | null = null;

    const draw = (t: number) => {
      if (antiCapture) {
        if (t - lastFlip >= FLIP_MS) {
          lastFlip = t;
          phase++;
          // كل طور بيحذف مجموعة عشوائية مختلفة (seeded) من وحدات البيانات
          const rnd = mulberry32(hashString(payload) ^ (phase * 2654435761));
          knocked = new Uint8Array(size * size);
          const target = Math.floor(dark.length * KNOCKOUT_RATIO);
          for (let k = 0; k < target; k++) knocked[dark[Math.floor(rnd() * dark.length)]] = 1;
        }
      } else {
        knocked = null;
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
      ctx.fillStyle = "#111827";
      const m = qr.modules;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const i = r * size + c;
          if (!m.data[i] || knocked?.[i]) continue;
          ctx.fillRect(off + (c + 2) * cell, off + (r + 2) * cell, cell + 0.5, cell + 0.5);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [qr, antiCapture, payload]);

  if (!qr) {
    return (
      <div className={cn("grid place-items-center bg-white rounded-xl", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }
  return <canvas ref={canvasRef} width={CANVAS_PX} height={CANVAS_PX} className={cn("block w-full h-full", className)} aria-label="كود حضور الحصة المتحرك" />;
}

/* ---------------- الكارت الرئيسي ---------------- */

export function SessionQrCard({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const [codes, setCodes] = useState<BatchCode[]>([]);
  const [batchExpiresAt, setBatchExpiresAt] = useState<number | null>(null);
  const [slotMs, setSlotMs] = useState(DEFAULT_SLOT_MS);
  const [idx, setIdx] = useState(0);
  const [slotLeft, setSlotLeft] = useState(0); // عدّاد الكود الحالي (للعرض)
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0); // بعد الماونت بس — مفيش hydration mismatch
  const [anti, setAnti] = useState(true);
  const [full, setFull] = useState(false);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);
  const batchExpiryRef = useRef<number | null>(null);
  const slotEndRef = useRef(0); // وقت انتهاء الكود الحالي على الشاشة
  const lastFetchAtRef = useRef(0);

  // إعداد وضع الحماية (محفوظ لكل جهاز)
  useEffect(() => {
    const v = localStorage.getItem("nk-qr-anti");
    if (v !== null) setAnti(v === "1");
    setNow(Date.now());
  }, []);

  const fetchBatch = useCallback(async (force = false) => {
    if (fetchingRef.current) return;
    // منع النداءات المتلاحية — غير اليدوي (force) لازم يستنى ثانيتين ونص
    if (!force && Date.now() - lastFetchAtRef.current < 2500) return;
    fetchingRef.current = true;
    setBusy(true);
    try {
      const res = await api<BatchRes>("/api/attendance/session-qr/batch", {
        method: "POST",
        body: { sessionId },
      });
      if (!mountedRef.current) return;
      lastFetchAtRef.current = Date.now();
      batchExpiryRef.current = new Date(res.batchExpiresAt).getTime();
      setCodes(res.codes);
      setBatchExpiresAt(batchExpiryRef.current);
      const ms = Math.round((res.slotSeconds ?? 5) * 1000);
      setSlotMs(ms);
      slotEndRef.current = Date.now() + ms;
      setSlotLeft(Math.ceil(ms / 1000));
      setIdx(0);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      // تراجع بعد فشل — المحاولة التالية التلقائية تستنى 8ث (مفيش Hammering على 429)
      lastFetchAtRef.current = Date.now() + 8000;
      setError(e instanceof Error ? e.message : "تعذر توليد الأكواد");
    } finally {
      fetchingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [sessionId]);

  // الجلب الأولي — مرة واحدة (fetchBatch ثابتة على sessionId)
  useEffect(() => {
    mountedRef.current = true;
    fetchBatch();
    return () => { mountedRef.current = false; };
  }, [fetchBatch]);

  // نبض العدّاد + الـ prefetch — بالـ refs مش بالستيت فمفيش إعادة تشغيل عند كل نجاح
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const exp = batchExpiryRef.current;
      if (exp && t > exp - PREFETCH_BEFORE_MS) fetchBatch(); // قبل النهاية بـ 8ث: دفعة جديدة في الخلفية
      if (slotEndRef.current) setSlotLeft(Math.max(0, Math.ceil((slotEndRef.current - t) / 1000)));
    }, 500);
    return () => clearInterval(iv);
  }, [fetchBatch]);

  // تدوير الأكواد — كل كود بيفضل على الشاشة slotMs (5 ثواني افتراضيًا)
  useEffect(() => {
    if (codes.length < 2) return;
    if (!slotEndRef.current) slotEndRef.current = Date.now() + slotMs;
    const iv = setInterval(() => {
      slotEndRef.current = Date.now() + slotMs;
      setIdx((i) => (i + 1) % codes.length);
    }, slotMs);
    return () => clearInterval(iv);
  }, [codes.length, slotMs]);

  const toggleAnti = () =>
    setAnti((v) => {
      localStorage.setItem("nk-qr-anti", v ? "0" : "1");
      return !v;
    });

  const secondsLeft = batchExpiresAt ? Math.max(0, Math.ceil((batchExpiresAt - now) / 1000)) : 0;
  const low = secondsLeft > 0 && secondsLeft <= 10;
  const active = codes[idx] ?? null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const payload = active ? (anti ? active.token : `${origin}/s/${active.token}`) : "";

  const qrBox = (size: string) => (
    <div className={cn("relative rounded-2xl bg-white p-2.5 grid place-items-center shadow-inner", size)}>
      {active ? (
        <QrCanvas payload={payload} antiCapture={anti} />
      ) : (
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      )}
      <div className={cn("absolute inset-0 rounded-2xl transition-opacity pointer-events-none",
        busy && !codes.length ? "opacity-40 bg-white/60" : "opacity-0")} />
    </div>
  );

  const dots = (
    <div className="flex items-center gap-1" aria-hidden>
      {codes.map((_, i) => (
        <span key={i} className={cn("rounded-full transition-all duration-150",
          i === idx ? "w-2.5 h-2.5 nk-brand-bg" : "w-1.5 h-1.5 bg-border")} />
      ))}
    </div>
  );

  const modeHint = anti
    ? "الكود بيتقل بين 10 أكواد كل 5 ثواني ومرسوم بطريقة تبوّظ أي صورة أو سكرين شوت — سكانر البورتال هو اللي بيقراه (بيدمج كذا كادر)."
    : "وضع التوافق: كود ثابت يفتح من أي كاميرا موبايل — استخدمه لو سكانر البورتال مش شغال عند حد.";

  return (
    <>
      <div className={cn("nk-card rounded-2xl p-4 space-y-3", compact && "p-3")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0">
              <QrCode className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm leading-tight">QR الحصة المتحرك — حضور ذاتي</h3>
              <p className="text-[11px] font-bold text-muted-foreground">
                10 أكواد بيتقلوا كل 5 ثواني — الكاميرا بتلحق والصورة بتبوّظ
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-black inline-flex items-center gap-1 nk-num",
              low ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
              <Timer className="w-3 h-3" /> {String(secondsLeft).padStart(2, "0")}ث
            </span>
            <button
              onClick={toggleAnti}
              title={anti ? "التحول لوضع التوافق (أي كاميرا تقدر تقراه)" : "التحول لوضع الحماية من التصوير"}
              aria-label={anti ? "التحول لوضع التوافق" : "التحول لوضع الحماية"}
              className={cn("rounded-lg border p-2 hover:bg-muted/60",
                anti ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10" : "border-border bg-card")}
            >
              {anti ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <ShieldOff className="w-4 h-4 text-muted-foreground" />}
            </button>
            <button
              onClick={() => fetchBatch(true)}
              title="دفعة أكواد جديدة الآن"
              aria-label="تجديد الدفعة"
              className="rounded-lg border border-border bg-card p-2 hover:bg-muted/60"
            >
              <RotateCw className={cn("w-4 h-4", busy && "animate-spin")} />
            </button>
            <button
              onClick={() => setFull(true)}
              title="عرض بحجم الشاشة"
              aria-label="عرض بحجم الشاشة"
              className="rounded-lg border border-border bg-card p-2 hover:bg-muted/60"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => fetchBatch(true)} className="underline underline-offset-2 shrink-0">جرب تاني</button>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            {qrBox("w-28 h-28 shrink-0")}
            <div className="min-w-0 space-y-1.5 text-xs font-bold text-muted-foreground">
              <p className="flex items-center gap-1.5 text-foreground/80">
                {anti
                  ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  : <ShieldOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                <span>{modeHint}</span>
              </p>
              <p>الطالب بيسجّل دخول البورتال مرة واحدة — وبعدها سكان الكود = حضور فوري.</p>
              <div className="flex items-center gap-2">
                {dots}
                <span className="nk-num text-[10px]">
                  {codes.length} أكواد في الدفعة{slotLeft > 0 ? ` — الكود الجاي بعد ${slotLeft}ث` : ""}
                </span>
              </div>
              {active && (
                <p className="nk-num text-[10px] truncate text-muted-foreground/70" dir="ltr">
                  {anti ? active.token : `${origin}/s/${active.token}`}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* عرض ملء الشاشة — للتابلت/البروجيكتور عند باب القاعة */}
      {full && (
        <div className="fixed inset-0 z-[90] bg-white dark:bg-[#0b1220] grid place-items-center p-6" onClick={() => setFull(false)}>
          <button
            onClick={() => setFull(false)}
            aria-label="إغلاق"
            className="absolute top-4 end-4 rounded-full border border-border bg-card p-3 hover:bg-muted/60"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex flex-col items-center gap-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="w-full max-w-sm aspect-square bg-white rounded-3xl p-4 shadow-xl border border-border">
              {active ? <QrCanvas payload={payload} antiCapture={anti} /> : <Loader2 className="w-10 h-10 animate-spin text-slate-400" />}
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-black">امسح الكود وسجّل حضورك</p>
              <p className={cn("text-sm font-bold flex items-center justify-center gap-1.5",
                anti ? "nk-brand-text" : "text-muted-foreground")}>
                {anti ? <ScanLine className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                {anti ? "من سكانر البورتال — زرار QR العائم" : "بأي كاميرا موبايل — بتفتح رابط الحضور"}
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-black nk-num",
                  low ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
                  <Timer className="w-4 h-4" /> الدفعة تتجدد بعد {secondsLeft}ث
                </span>
                {dots}
                {slotLeft > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-black text-muted-foreground nk-num">
                    كود جديد بعد {slotLeft}ث
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
