"use client";

import { use, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, QrCode, Clock3, ShieldCheck, Smartphone } from "lucide-react";

/* صفحة تسجيل الحضور الذاتي — الطالب يمسح كود QR الحصة المتنقل بيفتح الرابط ده.
   عامة (من غير تسجيل دخول موظفين) — الهوية بجهاز موثوق (جلسة بورتال):
   - الجهاز مفعلّ قبل كده → حضور فوري SCAN → VERIFY → SUCCESS
   - الجهاز مش مفعل → تفعيل لمرة واحدة (كود + موبايل) وبعدها الجهاز بقى موثوق.
   مفيش تسجيل دخول متكرر، ومفيش حضور مجهول — السيرفر عارف مين بيحضر دايمًا. */

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

export default function SessionQrClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activatingBusy, setActivatingBusy] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);

  async function claim() {
    setBusy(true);
    setFatal(null);
    try {
      const res = await fetch("/api/attendance/session-qr/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFatal((data as { error?: string }).error ?? "حصل خطأ — جرب تاني.");
        return;
      }
      const r = data as ClaimResult;
      if (r.reason === "NEED_ACTIVATE") {
        setActivating(true);
        setResult(null);
        return;
      }
      setResult(r);
      setActivating(false);
    } catch {
      setFatal("مفيش اتصال بالسيرفر — بص على النت وجرب تاني.");
    } finally {
      setBusy(false);
    }
  }

  /** تفعيل لمرة واحدة: نفس دخول البورتال (كود + موبايل) → الجهاز يبقى موثوق */
  async function activate() {
    setActivatingBusy(true);
    setFatal(null);
    try {
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", code, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFatal((data as { error?: string }).error ?? "الكود أو رقم الموبايل مش مظبوط.");
        return;
      }
      setActivated(true);
      await claim(); // الجهاز بقى موثوق — أكمل الحضور أوتوماتيك
    } catch {
      setFatal("مفيش اتصال بالسيرفر — بص على النت وجرب تاني.");
    } finally {
      setActivatingBusy(false);
    }
  }

  // محاولة أولى — لو الجهاز موثوق هيتسجل على طول من غير أي شاشة
  useEffect(() => { claim(); /* mount-once */ }, [token]);

  return (
    <div className="min-h-screen bg-[#f5f7fa] dark:bg-[#0b1220] flex items-center justify-center p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md nk-card rounded-3xl p-6 shadow-xl space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl nk-brand-bg grid place-items-center shrink-0">
            <QrCode className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black leading-tight">تسجيل الحضور</h1>
            <p className="text-xs text-muted-foreground font-bold">QR الحصة المتنقل — من غير تسجيل دخول</p>
          </div>
        </div>

        {busy && !result && !activating && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground font-bold">
            <Loader2 className="w-5 h-5 animate-spin" /> جاري التحقق…
          </div>
        )}

        {fatal && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-4 flex gap-3">
            <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{fatal}</p>
          </div>
        )}

        {/* ============================= تفعيل لمرة واحدة ============================= */}
        {activating && !result && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (code.trim().length === 5 && phone.trim().length >= 10) activate(); }}
            className="space-y-3"
          >
            {activated ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-4 flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-emerald-600 animate-spin shrink-0" />
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">الجهاز اتفعّل — جاري تسجيل حضورك…</p>
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/30 p-3.5 flex gap-2.5">
                  <Smartphone className="w-5 h-5 text-sky-600 shrink-0" />
                  <p className="text-xs font-bold text-sky-800 dark:text-sky-300 leading-relaxed">
                    فعّل جهازك <b>مرة واحدة بس</b> بكودك ورقم موبايلك (زي دخول البورتال بالظبط) — بعد النهارده حضورك على الجهاز ده هيبقى بضغطة واحدة من غير أي أكواد.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">كود الطالب (5 أرقام)</label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="–––––"
                    dir="ltr"
                    className="w-full h-14 rounded-2xl border-2 border-input bg-card text-center text-2xl font-black tracking-[0.4em] nk-num"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1">رقم الموبايل (بتاعك أو ولي الأمر)</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, "").slice(0, 14))}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="01xxxxxxxxx"
                    dir="ltr"
                    className="w-full h-14 rounded-2xl border-2 border-input bg-card text-center text-xl font-black tracking-wider nk-num"
                  />
                </div>
                <button
                  type="submit"
                  disabled={code.length !== 5 || phone.trim().length < 10 || activatingBusy}
                  className="w-full h-12 rounded-2xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {activatingBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  فعّل جهازي وسجّل حضوري
                </button>
              </>
            )}
          </form>
        )}

        {result && (
          <div className="space-y-4">
            {result.ok ? (
              <>
                <div className={result.alreadyAttended
                  ? "rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-5 text-center space-y-2"
                  : "rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-5 text-center space-y-2"}>
                  {result.alreadyAttended
                    ? <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
                    : <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />}
                  <p className="text-lg font-black">
                    {result.alreadyAttended ? "تم تسجيل حضورك بالفعل" : "✅ تم تسجيل حضورك"}
                  </p>
                  <p className="text-sm font-bold text-muted-foreground">{result.studentName}</p>
                  {result.sessionLabel && <p className="text-xs font-bold text-muted-foreground">{result.sessionLabel}</p>}
                  {result.status && !result.alreadyAttended && (
                    <p className="text-xs font-bold nk-brand-text">{STATUS_LABEL[result.status] ?? ""}</p>
                  )}
                </div>
                {!result.alreadyAttended && typeof result.amountDue === "number" && result.amountDue > 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-muted-foreground">المطلوب سداده</span>
                    <span className="nk-num font-black text-lg" dir="ltr">{(result.amountDue / 100).toLocaleString("en-EG")} ج</span>
                  </div>
                )}
                <div className="rounded-2xl border border-border bg-muted/30 p-3 flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 nk-brand-text shrink-0" />
                  <p className="text-[11px] font-bold text-muted-foreground">
                    الجهاز ده بقى موثوق — المرة الجاية امسح الكود بس، ومحتاج تكتب أي حاجة.
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground font-bold text-center">
                  لو الحضور فيه مشكلة كلّم الاستقبال — التعديل بيتعمل من شاشة الحصة.
                </p>
              </>
            ) : (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-5 text-center space-y-2">
                <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
                <p className="font-black">{result.message}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground font-bold border-t border-border/60 pt-3">
          <Clock3 className="w-3.5 h-3.5" />
          الكود بيتجدد كل ثواني على شاشة المشرف — لو انتهى امسح الكود الجديد
        </div>
      </motion.div>
    </div>
  );
}
