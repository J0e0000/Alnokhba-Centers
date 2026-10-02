"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, Loader2, CheckCircle2, AlertTriangle, XCircle, Keyboard, ShieldCheck, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { papi } from "./portal-api";
import { CombiningQrScanner } from "../qr-scanner-combining";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/* ============================================================
   سكان الحضور جوّه البورتال — الطالب مسجّل دخول بالفعل،
   فمفيش تفعيل ولا أكواد: يفتح السكانر → يمسح كود الحصة المتنقل
   → حضوره بيتسجل على طول بنفس جلسة البورتال الموثوقة.
   بديل آمن لو الكاميرا مش متاحة: كتابة كود الطالب (5 أرقام)
   against الحصة المفتوحة عبر /api/attendance/scan؟ لأ — السكانر
   هنا بياخد توكن QR بس؛ الكتابة اليدوية بتاعت الأكواد شاشة
   الاستقبال. فالبديل الوحيد: لصق رابط الحصة /s/<token>.
============================================================ */

type ClaimResult = {
  ok?: boolean;
  reason?: string;
  message?: string;
  alreadyAttended?: boolean;
  studentName?: string;
  sessionLabel?: string;
  status?: string;
  charged?: number;
  balance?: number;
  amountDue?: number;
};

const STATUS_LABEL: Record<string, string> = { PRESENT: "حاضر", LATE: "متأخر", EXCUSED: "بعذر" };

/** استخراج توكن الحصة من أي نص متصوّر: رابط كامل /s/<token> أو التوكن نفسه */
export function extractSessionToken(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/\/s\/([0-9a-fA-F]{16,64})/);
  if (m) return m[1].toLowerCase();
  if (/^[0-9a-fA-F]{16,64}$/.test(t)) return t.toLowerCase();
  return null;
}

export function PortalScanSheet({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void; // بعد حضور ناجح — البورتال يحدّث الرصيد والإشعارات
}) {
  const [scanning, setScanning] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");
  const [scanNonce, setScanNonce] = useState(0); // إعادة تشغيل الكاميرا بعد رجوع للسكان
  const lastTokenRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });

  // فتح الشيت = وضع سكان من الأول؛ مقفول = تصفير
  useEffect(() => {
    if (open) {
      setScanning(true);
      setResult(null);
      setFatal(null);
      setPasteMode(false);
      setPasted("");
      setScanNonce((n) => n + 1);
    }
  }, [open]);

  async function claim(token: string) {
    // منع التكرار: نفس التوكن خلال 4 ثواني (الكاميرا بتقرا الكود أكتر من مرة)
    const now = Date.now();
    if (lastTokenRef.current.token === token && now - lastTokenRef.current.at < 4000) return;
    lastTokenRef.current = { token, at: now };

    setBusy(true);
    setFatal(null);
    try {
      const r = await papi<ClaimResult>("/api/attendance/session-qr/claim", {
        method: "POST",
        body: { token },
        silent: true,
      });
      if (r.reason === "NEED_ACTIVATE") {
        // جوّه البورتال الجلسة موجودة — الحالة دي نظريًا مستحيلة؛ نعرض رسالة واضحة برضه
        setScanning(false);
        setFatal("جهازك محتاج تفعيل لمرة واحدة — افتح رابط الكود من كاميرا الموبايل مباشرة مرة واحدة، وبعدها السكانر هنا هيشتغل عادي.");
        return;
      }
      setResult(r);
      setScanning(false);
      if (r.ok && !r.alreadyAttended) onDone?.();
    } catch (e) {
      setScanning(false);
      setFatal(e instanceof Error ? e.message : "حصل خطأ — جرب تاني.");
    } finally {
      setBusy(false);
    }
  }

  function onScan(text: string) {
    if (busy || (result && result.ok)) return;
    const token = extractSessionToken(text);
    if (!token) {
      // كود غريب (مش كود حضور) — رسالة هادية ومستمرين سكان
      setScanning(false);
      setFatal("الكود ده مش كود حضور حصة — امسح كود الـ QR اللي على شاشة المشرف في الحصة.");
      return;
    }
    void claim(token);
  }

  function backToScan() {
    setResult(null);
    setFatal(null);
    setScanning(true);
    setScanNonce((n) => n + 1);
  }

  async function submitPaste() {
    const token = extractSessionToken(pasted);
    if (!token) {
      setFatal("الرابط ده مش شكله رابط حضور — لازم يكون /s/… أو توكن الحصة.");
      return;
    }
    await claim(token);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0">
              <QrCode className="w-5 h-5 text-white" />
            </span>
            تسجيل الحضور — امسح كود الحصة
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* ============================= الكاميرا ============================= */}
          {scanning && (
            <>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed">
                وجّه كاميرا موبايلك على كود <b>QR الحصة</b> اللي ظاهر على شاشة المشرف — حضورك بيتسجل فورًا لأنك مسجّل دخول بالفعل.
                الكود ثابت 10 ثواني وبعدها بيتغير والقديم بيموت (عشان الصور) — وجّه الكاميرا وهيتقري في ثانية.
                لو الكود طالع صغير في الكاميرا، استخدم أزرار <b>الزوم (+)</b> لتقريبه.
              </p>
              <CombiningQrScanner key={scanNonce} active={scanning && !busy} onScan={onScan} />
              {busy && (
                <div className="flex items-center justify-center gap-2 py-3 text-sm font-bold text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> جاري تسجيل حضورك…
                </div>
              )}
              <button
                onClick={() => setPasteMode(true)}
                className="w-full text-[11px] font-extrabold text-muted-foreground hover:nk-brand-text flex items-center justify-center gap-1.5 py-1"
              >
                <Keyboard className="w-3.5 h-3.5" /> الكاميرا مش شغالة؟ الصق رابط الحصة
              </button>
            </>
          )}

          {/* ============================= لصق الرابط ============================= */}
          {scanning && pasteMode && (
            <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-3">
              <label className="text-xs font-bold block">الصق رابط الحصة (/s/…)</label>
              <input
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                dir="ltr"
                placeholder="https://…/s/xxxxxxxx…"
                className="w-full h-10 rounded-xl border border-input bg-card px-3 text-xs font-bold nk-num"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitPaste}
                  disabled={busy || !pasted.trim()}
                  className="flex-1 h-10 rounded-xl nk-brand-bg text-white font-extrabold text-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} سجّل حضوري
                </button>
                <button onClick={() => { setPasteMode(false); setFatal(null); }} className="h-10 px-3 rounded-xl border border-border bg-card font-extrabold text-xs">
                  رجوع
                </button>
              </div>
            </div>
          )}

          {/* ============================= النتيجة ============================= */}
          {!scanning && (result || fatal) && (
            <div className="space-y-3">
              {fatal && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-4 flex gap-3">
                  <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{fatal}</p>
                </div>
              )}
              {result && (
                <>
                  {result.ok ? (
                    <div className={cn(
                      "rounded-2xl p-5 text-center space-y-2",
                      result.alreadyAttended
                        ? "border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30"
                        : "border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30",
                    )}>
                      {result.alreadyAttended
                        ? <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
                        : <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />}
                      <p className="text-lg font-black">
                        {result.alreadyAttended ? "حضورك متسجل بالفعل" : "تم تسجيل حضورك ✅"}
                      </p>
                      {result.sessionLabel && <p className="text-xs font-bold text-muted-foreground">{result.sessionLabel}</p>}
                      {result.status && !result.alreadyAttended && (
                        <p className="text-xs font-bold nk-brand-text">{STATUS_LABEL[result.status] ?? ""}</p>
                      )}
                      {!result.alreadyAttended && typeof result.amountDue === "number" && result.amountDue > 0 && (
                        <p className="text-xs font-bold text-muted-foreground">
                          المطلوب سداده: <span className="nk-num" dir="ltr">{(result.amountDue / 100).toLocaleString("en-EG")}</span> ج
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-4 flex gap-3">
                      <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                      <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{result.message ?? "مش قادرين نسجل الحضور — جرب تاني."}</p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-border bg-muted/30 p-3 flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 nk-brand-text shrink-0" />
                    <p className="text-[11px] font-bold text-muted-foreground">
                      الكود بيتجدد أوتوماتيك على شاشة المشرف — لو انتهى امسح الكود الجديد.
                    </p>
                  </div>
                </>
              )}
              <button
                onClick={backToScan}
                className="w-full h-11 rounded-xl border-2 border-border bg-card font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" /> امسح كود تاني
              </button>
            </div>
          )}

          {/* حالة busy فوق النتيجة (لصق) */}
          {!scanning && busy && !result && !fatal && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm font-bold text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> جاري التحقق…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** زرار السكان العائم (FAB) — ظاهر في كل شاشات البورتال */
export function PortalScanFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="تسجيل الحضور — امسح كود الحصة"
      className="fixed z-40 bottom-24 lg:bottom-6 end-4 w-14 h-14 rounded-full nk-brand-grad text-white grid place-items-center shadow-xl border-2 border-white/60 active:scale-95 transition hover:brightness-110 print:hidden nk-anim-tab"
    >
      <QrCode className="w-6 h-6" />
    </button>
  );
}
