"use client";

import { use, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Copy, AlertTriangle, XCircle, Loader2, QrCode, Clock3, RefreshCw } from "lucide-react";

/* صفحة تسجيل الحضور الذاتي — الطالب يمسح كود QR الحصة المتنقل بيفتح الرابط ده.
   عامة (من غير تسجيل دخول موظفين) — الهوية بالكود أو جلسة البورتال. */

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
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  async function claim(withCode?: string) {
    setBusy(true);
    setFatal(null);
    try {
      const res = await fetch("/api/attendance/session-qr/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: withCode ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFatal((data as { error?: string }).error ?? "حصل خطأ — جرب تاني.");
        return;
      }
      const r = data as ClaimResult;
      if (r.reason === "NEED_CODE") {
        setNeedCode(true);
        setResult(null);
        return;
      }
      setResult(r);
      setNeedCode(false);
    } catch {
      setFatal("مفيش اتصال بالسيرفر — بص على النت وجرب تاني.");
    } finally {
      setBusy(false);
    }
  }

  // محاولة أولى — لو في جلسة بورتال هيتسجل على طول، غير هيطلب الكود
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
            <p className="text-xs text-muted-foreground font-bold">QR الحصة المتنقل</p>
          </div>
        </div>

        {busy && !result && (
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

        {needCode && !result && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (code.trim().length === 5) claim(code.trim()); }}
            className="space-y-3"
          >
            <p className="text-sm font-bold text-muted-foreground">اكتب كود الطالب (5 أرقام) لتسجيل حضورك في الحصة.</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="–––––"
              dir="ltr"
              className="w-full h-14 rounded-2xl border-2 border-input bg-card text-center text-2xl font-black tracking-[0.4em] nk-num"
            />
            <button
              type="submit"
              disabled={code.length !== 5 || busy}
              className="w-full h-12 rounded-2xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              سجّل حضوري
            </button>
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
                    {result.alreadyAttended ? "حضورك متسجل من قبل" : `تم تسجيل حضورك — ${STATUS_LABEL[result.status ?? ""] ?? ""}`}
                  </p>
                  <p className="text-sm font-bold text-muted-foreground">{result.studentName}</p>
                  {result.sessionLabel && <p className="text-xs font-bold text-muted-foreground">{result.sessionLabel}</p>}
                </div>
                {!result.alreadyAttended && typeof result.amountDue === "number" && result.amountDue > 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-muted-foreground">المطلوب سداده</span>
                    <span className="nk-num font-black text-lg" dir="ltr">{(result.amountDue / 100).toLocaleString("en-EG")} ج</span>
                  </div>
                )}
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
          الكود قصير العمر وبيتحدّث تلقائيًا — لو انتهى اطلب من المشرف يحدّثه
          <RefreshCw className="w-3 h-3" />
        </div>
      </motion.div>
    </div>
  );
}
