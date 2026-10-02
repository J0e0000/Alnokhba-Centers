"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Loader2, RotateCw, Maximize2, X, Timer, Camera, ScanLine } from "lucide-react";
import { api } from "./lib";
import { cn } from "@/lib/utils";

/* ============================================================
   QR الحصة — موديل Slot QR (الحل النهائي)
   - كود واحد ثابت وسليم 100% على الشاشة لمدة 10 ثواني — أي سكانر
     عادي أو كاميرا موبايل بتقراه في ثانية من غير أي لمعة أو تشويه.
   - الحماية من التصوير = العمر القصير: كل كود بيتولد جديد، واللي
     قبله بيموت (بيكمل 4ث بس للـ claims اللي في الطريق وبعدها ميّت
     نهائيًا) — فالصورة/السكرين شوت بيمسك كود ميت خلال ثواني.
   - قبل نهاية الثانية العاشرة الشاشة بتجيب الكود الجاي في الخلفية
     وتبدّله فورًا — مفيش فراغ أبدًا.
============================================================ */

const CANVAS_PX = 660;
const DEFAULT_SLOT_MS = 10_000; // كل كود 10 ثواني على الشاشة
const PREFETCH_BEFORE_MS = 1500; // نجيب الكود الجاي قبل نهاية الحالي بثانية ونص (السيرفر بيبعت كود جديد فورًا)
const FETCH_GAP_MS = 2500; // منع النداءات المتلاحية
const FETCH_BACKOFF_MS = 8000; // تراجع بعد فشل (مفيش Hammering على 429)

type SlotRes = { token: string; expiresAt: string; slotSeconds: number; sessionLabel?: string };

/* ---------------- كانفس الكود الثابت (يُرسم مرة واحدة لكل كود) ---------------- */

function QrCanvas({ payload, className }: { payload: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    QRCode.toCanvas(canvas, payload, {
      width: CANVAS_PX,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#111827", light: "#ffffff" },
    }).catch(() => {});
  }, [payload]);

  if (!payload) {
    return (
      <div className={cn("grid place-items-center bg-white rounded-xl", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }
  return <canvas ref={canvasRef} width={CANVAS_PX} height={CANVAS_PX} className={cn("block w-full h-full", className)} aria-label="كود حضور الحصة" />;
}

/* ---------------- الكارت الرئيسي ---------------- */

export function SessionQrCard({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const [token, setToken] = useState("");
  const [slotEnd, setSlotEnd] = useState<number | null>(null);
  const [slotMs, setSlotMs] = useState(DEFAULT_SLOT_MS);
  const [slotLeft, setSlotLeft] = useState(0); // عدّاد الكود الحالي
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [now, setNow] = useState(0); // بعد الماونت بس — مفيش hydration mismatch

  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);
  const slotEndRef = useRef<number | null>(null);
  const lastFetchAtRef = useRef(0);
  const nextSlotRef = useRef<SlotRes | null>(null); // الكود الجاي المتجهّز (بيتبدّل عند نهاية السلوت)
  const tokenRef = useRef("");

  const fetchSlot = useCallback(async (): Promise<SlotRes | null> => {
    if (fetchingRef.current) return null;
    if (Date.now() - lastFetchAtRef.current < FETCH_GAP_MS) return null;
    fetchingRef.current = true;
    setBusy(true);
    try {
      const res = await api<SlotRes>("/api/attendance/session-qr/slot", {
        method: "POST",
        body: { sessionId },
      });
      if (!mountedRef.current) return null;
      lastFetchAtRef.current = Date.now();
      setError(null);
      return res;
    } catch (e) {
      if (!mountedRef.current) return null;
      // تراجع بعد فشل — المحاولة التالية التلقائية تستنى 8ث (مفيش Hammering على 429)
      lastFetchAtRef.current = Date.now() + FETCH_BACKOFF_MS;
      setError(e instanceof Error ? e.message : "تعذر توليد الكود");
      return null;
    } finally {
      fetchingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [sessionId]);

  // تبديل الكود المعروض بكود جاهز (أو جيبه دلوقتي لو مفيش متجهّز)
  const swapToNext = useCallback(async () => {
    let next = nextSlotRef.current;
    nextSlotRef.current = null;
    if (!next) next = await fetchSlot();
    if (!mountedRef.current || !next) return;
    const ms = Math.round((next.slotSeconds ?? 10) * 1000);
    tokenRef.current = next.token;
    setToken(next.token);
    setSlotMs(ms);
    slotEndRef.current = Date.now() + ms;
    setSlotEnd(slotEndRef.current);
    setSlotLeft(Math.ceil(ms / 1000));
  }, [fetchSlot]);

  // الجلب الأولي — مرة واحدة
  useEffect(() => {
    mountedRef.current = true;
    void swapToNext();
    return () => { mountedRef.current = false; };
  }, [swapToNext]);

  // نبض العدّاد + التجهيز المسبق + التبديل في نهاية السلوت
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const end = slotEndRef.current;
      if (!end) return;
      const left = end - t;
      setSlotLeft(Math.max(0, Math.ceil(left / 1000)));
      // قبل النهاية بثانية ونص: جهّز الكود الجاي في الخلفية (السيرفر بيولّده فورًا)
      if (left <= PREFETCH_BEFORE_MS && left > 0 && !nextSlotRef.current && !fetchingRef.current) {
        void fetchSlot().then((res) => { if (res) nextSlotRef.current = res; });
      }
      // الكود خلص على الشاشة — بدّل للمتجهّز (أو اجيب واحد حالًا)
      if (left <= 0) void swapToNext();
    }, 250);
    return () => clearInterval(iv);
  }, [fetchSlot, swapToNext]);

  const secondsLeft = slotEnd ? Math.max(0, Math.ceil((slotEnd - now) / 1000)) : 0;
  const low = secondsLeft > 0 && secondsLeft <= 3;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const payload = token ? `${origin}/s/${token}` : "";
  const progress = slotEnd && slotMs ? Math.max(0, Math.min(1, (slotEnd - now) / slotMs)) : 0;

  const qrBox = (size: string) => (
    <div className={cn("relative rounded-2xl bg-white p-2.5 grid place-items-center shadow-inner", size)}>
      {payload ? (
        <QrCanvas payload={payload} />
      ) : (
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      )}
      <div className={cn("absolute inset-0 rounded-2xl transition-opacity pointer-events-none",
        busy && !token ? "opacity-40 bg-white/60" : "opacity-0")} />
    </div>
  );

  return (
    <>
      <div className={cn("nk-card rounded-2xl p-4 space-y-3", compact && "p-3")}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0">
              <QrCode className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-extrabold text-sm leading-tight">QR الحصة — حضور ذاتي</h3>
              <p className="text-[11px] font-bold text-muted-foreground">
                كود جديد كل 10 ثواني والقديم بيتلغي — الصورة بتبقى عديمة الفايدة
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-black inline-flex items-center gap-1 nk-num",
              low ? "bg-amber-500 text-white" : "bg-emerald-600 text-white")}>
              <Timer className="w-3 h-3" /> {String(Math.max(secondsLeft, slotLeft)).padStart(2, "0")}ث
            </span>
            <button
              onClick={() => { nextSlotRef.current = null; void swapToNext(); }}
              title="كود جديد الآن"
              aria-label="تجديد الكود"
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
            <button onClick={() => { lastFetchAtRef.current = 0; nextSlotRef.current = null; void swapToNext(); }} className="underline underline-offset-2 shrink-0">جرب تاني</button>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            {qrBox("w-28 h-28 shrink-0")}
            <div className="min-w-0 space-y-1.5 text-xs font-bold text-muted-foreground">
              <p className="flex items-center gap-1.5 text-foreground/80">
                <Camera className="w-3.5 h-3.5 nk-brand-text shrink-0" />
                <span>الكود ثابت 10 ثواني وسليم — يُقرأ بأي كاميرا موبايل أو من سكانر البورتال، وبيتغير أوتوماتيك والقديم بيموت فورًا.</span>
              </p>
              <p>الطالب بيسجّل دخول البورتال مرة واحدة — وبعدها سكان الكود = حضور فوري.</p>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden min-w-16">
                  <div className={cn("h-full rounded-full transition-[width] duration-300 ease-linear", low ? "bg-amber-500" : "nk-brand-bg")}
                    style={{ width: `${progress * 100}%` }} />
                </div>
                <span className="nk-num text-[10px] shrink-0">كود جديد بعد {slotLeft}ث</span>
              </div>
              {token && (
                <p className="nk-num text-[10px] truncate text-muted-foreground/70" dir="ltr">{payload}</p>
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
              {payload ? <QrCanvas payload={payload} /> : <Loader2 className="w-10 h-10 animate-spin text-slate-400" />}
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-black">امسح الكود وسجّل حضورك</p>
              <p className={cn("text-sm font-bold flex items-center justify-center gap-1.5 nk-brand-text")}>
                <ScanLine className="w-4 h-4" />
                بأي كاميرا موبايل — أو من زرار QR العائم في البورتال
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-black nk-num",
                  low ? "bg-amber-500 text-white" : "bg-emerald-600 text-white")}>
                  <Timer className="w-4 h-4" /> كود جديد بعد {Math.max(secondsLeft, slotLeft)}ث
                </span>
              </div>
              <div className="h-2 w-64 max-w-full mx-auto rounded-full bg-border overflow-hidden">
                <div className={cn("h-full rounded-full transition-[width] duration-300 ease-linear", low ? "bg-amber-500" : "nk-brand-bg")}
                  style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="text-[11px] font-bold text-muted-foreground">الكود بيتغير كل 10 ثواني — الصورة أو السكرين شوت بيموت مع الكود الجاي</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
