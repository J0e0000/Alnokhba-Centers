"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Loader2, RotateCw, Maximize2, X, ShieldCheck, Timer } from "lucide-react";
import { api } from "./lib";
import { cn } from "@/lib/utils";

/* ============================================================
   QR الحصة المتنقل — الطريقة الثالثة للحضور (spec §3)
   كود قصير العمر (دقيقتين) بيتجدد أوتوماتيك على الشاشة، مرتبط
   بالحصة والسنتر، ومش صالح خارجها. الطالب يمسحه بموبايله فيسجل
   حضوره بنفسه (بنفس قواعد وخصم الحضور العادي).
============================================================ */

const ROTATE_MS = 60_000; // تجديد كل دقيقة (التوكن يعيش دقيقتين)

export function SessionQrCard({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const issue = useCallback(async () => {
    try {
      const res = await api<{ token: string; path: string; expiresAt: string }>(
        "/api/attendance/session-qr",
        { method: "POST", body: { sessionId } },
      );
      const url = await QRCode.toDataURL(res.path, { width: 512, margin: 1, errorCorrectionLevel: "M" });
      setQrDataUrl(url);
      setPath(res.path);
      setExpiresAt(new Date(res.expiresAt).getTime());
      setSecondsLeft(Math.max(0, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 1000)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر توليد الكود");
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => {
    issue();
    const rot = setInterval(issue, ROTATE_MS);
    timerRef.current = setInterval(() => {
      if (expiresAt) setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => { clearInterval(rot); if (timerRef.current) clearInterval(timerRef.current); };
  }, [issue, expiresAt]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const low = secondsLeft <= 20;

  const qrBox = (size: string) => (
    <div className={cn("relative rounded-2xl bg-white p-2.5 grid place-items-center shadow-inner", size)}>
      {qrDataUrl ? (
        <img src={qrDataUrl} alt="كود حضور الحصة" className="w-full h-full object-contain rounded-lg" />
      ) : (
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      )}
      {/* طبقة تحديث خفيفة لحظة التجديد */}
      <div className={cn("absolute inset-0 rounded-2xl transition-opacity pointer-events-none",
        busy ? "opacity-40 bg-white/60" : "opacity-0")} />
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
                الطالب يمسح الكود بموبايله فيتسجل حضوره (الطريقة الثالثة)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-black inline-flex items-center gap-1 nk-num",
              low ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
              <Timer className="w-3 h-3" /> {mm}:{ss}
            </span>
            <button
              onClick={() => { setBusy(true); issue(); }}
              title="تجديد الكود الآن"
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
          <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            {qrBox("w-28 h-28 shrink-0")}
            <div className="min-w-0 space-y-1.5 text-xs font-bold text-muted-foreground">
              <p className="flex items-center gap-1.5 text-foreground/80">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                مرتبط بالحصة دي بس — مش صالح في حصة تانية أو بعد القفل
              </p>
              <p>بيتحدّث تلقائيًا كل دقيقة — مينفعش يتتصور ويستخدم بعدين.</p>
              <p>التكرار مستحيل: الطالب بيتسجل مرة واحدة بس في الحصة.</p>
              {path && (
                <p className="nk-num text-[10px] truncate text-muted-foreground/70" dir="ltr">{path}</p>
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
          <div className="flex flex-col items-center gap-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            {qrBox("w-full max-w-sm aspect-square")}
            <div className="text-center space-y-1.5">
              <p className="text-xl font-black">امسح الكود وسجّل حضورك</p>
              <p className="text-sm font-bold text-muted-foreground">من كاميرا الموبايل — من غير تطبيقات</p>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-black nk-num",
                low ? "bg-rose-600 text-white" : "bg-emerald-600 text-white")}>
                <Timer className="w-4 h-4" /> يتجدد بعد {mm}:{ss}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
