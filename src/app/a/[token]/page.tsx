"use client";

import { use, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, QrCode, Clock3, ShieldCheck, RefreshCw } from "lucide-react";
import { AlNokhbaMark } from "@/components/nokhba/shared";
import { getOrCreateAttendanceDeviceId } from "@/lib/device-id";

/* ============================================================
   /a/<token> — صفحة الحضور العامة بقفل الجهاز (من غير أي تسجيل دخول)
   ------------------------------------------------------------
   الطالب يمسح كود QR شاشة الحصة بكاميرا موبايله → الصفحة تفتح على طول
   → يكتب كود الطالب → حضور في ثواني. أول جهاز يسجّل بيه حضور في الحصة
   هو اللي بياخدها (جهاز واحد = حضور واحد لكل حصة) — والقاعدة محفوظة
   في الداتابيز نفسها مش في الصفحة.

   - مفيش دخول ولا باسورد ولا OTP — كود الطالب بس (spec §31)
   - زرار التسجيل بيتقفل فورًا بعد أول ضغطة — وإعادة المحاولة آمنة
     (idempotent — السيرفر هو اللي بيمنع التكرار، مش الصفحة — spec §18)
   - الرد العام مفيهوش أرصدة ولا بيانات مالية (خصوصية)
============================================================ */

type CheckResult = {
  ok?: boolean;
  reason?: string;
  message?: string;
  alreadyAttended?: boolean;
  studentName?: string;
  studentCode?: string;
  sessionLabel?: string;
  status?: string;
};

type Peek = {
  valid?: boolean; reason?: string; sessionLabel?: string; pv?: string | null;
  studentSource?: string; expectedCodeLength?: number | null;
};

const STATUS_LABEL: Record<string, string> = { PRESENT: "حاضر", LATE: "متأخر", EXCUSED: "بعذر" };

const INVALID_MSG: Record<string, string> = {
  EXPIRED: "الكود انتهت صلاحيته — امسح الكود الجديد من شاشة الحصة.",
  REPLAYED: "الكود ده قديم — الكود بيتجدد أوتوماتيك على شاشة الحصة، امسح الكود الجديد.",
  INVALID: "رابط الحضور مش صالح — امسح الكود من شاشة الحصة تاني.",
  CLOSED: "الحصة اتقفلت — الحضور بيتسجل قبل القفل بس.",
  CANCELLED: "الحصة دي ملغاة — راجع إعلانات السنتر.",
  CAPABILITY_OFF: "خدمة الحضور بكود الحصة مش متاحة في السنتر ده حاليًا — كلّم الاستقبال.",
};

export default function PublicCheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [phase, setPhase] = useState<"peek" | "ready" | "done" | "invalid">("peek");
  const [invalidReason, setInvalidReason] = useState<string>("INVALID");
  const [sessionLabel, setSessionLabel] = useState("");
  // وضع الحضور (spec §1): OPEN = اسم + كود بطول محدد من إعدادات الحصة · ROSTER = كود الطالب (+ اسم فحص ناعم)
  const [isOpenMode, setIsOpenMode] = useState(false);
  const [codeLen, setCodeLen] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const pvRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  // 1) peek — الحصة إيه؟ الكود حي؟ (وبصمة sighting لو حي)
  useEffect(() => {
    let alive = true;
    const deviceId = getOrCreateAttendanceDeviceId();
    (async () => {
      try {
        const r = await fetch(
          `/api/attendance/public/peek?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`,
          { cache: "no-store" },
        );
        const d = (await r.json()) as Peek;
        if (!alive) return;
        if (d.valid && d.pv) {
          // احفظ إثبات الـ sighting في الجلسة — عشان الريفرش/إعادة المحاولة يفضلوا شغالين
          try { sessionStorage.setItem(`nk_pv_${token}`, d.pv); } catch { /* خصوصية صارمة */ }
        }
        if (!alive) return;
        if (d.valid) {
          pvRef.current = d.pv ?? ((): string | null => {
            try { return sessionStorage.getItem(`nk_pv_${token}`); } catch { return null; }
          })();
          setSessionLabel(d.sessionLabel ?? "");
          setIsOpenMode(d.studentSource === "OPEN");
          setCodeLen(d.expectedCodeLength ?? null);
          setPhase("ready");
        } else {
          setInvalidReason(d.reason ?? "INVALID");
          setPhase("invalid");
        }
      } catch {
        if (alive) { setNetError("مفيش اتصال بالسيرفر — بص على النت وجرب تاني."); setPhase("ready"); }
      }
    })();
    return () => { alive = false; };
  }, [token]);

  // 2) التسجيل — زرار بيتقفل فورًا + إعادة محاولة آمنة (السيرفر idempotent)
  async function checkIn() {
    if (busyRef.current) return; // double-tap guard (UX بس — السيرفر هو الحاكم)
    if (name.trim().length < 2 || code.trim().length < 3) return;
    busyRef.current = true;
    setBusy(true);
    setNetError(null);
    try {
      const deviceId = getOrCreateAttendanceDeviceId();
      let pv = pvRef.current;
      if (!pv) {
        try { pv = sessionStorage.getItem(`nk_pv_${token}`); } catch { /* تجاهل */ }
      }
      const res = await fetch("/api/attendance/public/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim(), name: name.trim(), deviceId, pv: pv ?? undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as CheckResult;
      if (!res.ok) {
        setNetError((data as { error?: string }).error ?? "حصل خطأ — جرب تاني.");
        return;
      }
      setResult(data);
      setPhase("done");
    } catch {
      // شبكة ضعيفة — الطالب يقدر يعيد من غير خوف (السيرفر مش هيسجل مرتين)
      setNetError("الاتصال ضعيف — بص على النت ودوس \"جرب تاني\".");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa] dark:bg-[#0b1220] flex items-center justify-center p-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md nk-card rounded-3xl p-6 shadow-xl space-y-5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl nk-brand-bg grid place-items-center shrink-0">
              <QrCode className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-black leading-tight">تسجيل الحضور</h1>
              <p className="text-xs text-muted-foreground font-bold truncate">{sessionLabel || "امسح كود الحصة"}</p>
            </div>
          </div>
          <AlNokhbaMark size={36} showText={false} />
        </div>

        {/* ============================= جاري القراءة ============================= */}
        {phase === "peek" && (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground font-bold">
            <Loader2 className="w-5 h-5 animate-spin" /> جاري قراءة الكود…
          </div>
        )}

        {/* ============================= كود غير صالح/انتهى/الحصة مقفولة ============================= */}
        {phase === "invalid" && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-5 text-center space-y-3">
            <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
            <p className="font-black">{INVALID_MSG[invalidReason] ?? INVALID_MSG.INVALID}</p>
            <p className="text-xs font-bold text-muted-foreground">
              الكود بيتجدد أوتوماتيك كل شوية على شاشة الحصة — وجّه الكاميرا على الكود الجديد.
            </p>
          </div>
        )}

        {/* ============================= نموذج التسجيل (اسم + كود الطالب) ============================= */}
        {phase === "ready" && !result && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2 && code.trim().length >= 3) void checkIn(); }}
            className="space-y-4"
          >
            <div className="rounded-2xl border border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/30 p-3.5 flex gap-2.5">
              <ShieldCheck className="w-5 h-5 text-sky-600 shrink-0" />
              <p className="text-xs font-bold text-sky-800 dark:text-sky-300 leading-relaxed">
                {isOpenMode
                  ? <>مش محتاج تسجيل دخول — اكتب اسمك وكودك وسجّل. كل جهاز (موبايل) بيسجّل حضور <b>مرة واحدة</b> في الحصة.</>
                  : <>مش محتاج تسجيل دخول — اكتب اسمك وكود الطالب وسجّل. كل جهاز (موبايل) بيسجّل حضور <b>مرة واحدة</b> في الحصة.</>}
              </p>
            </div>
            <div>
              <label htmlFor="nk-checkin-name" className="text-xs font-bold block mb-1">اسم الطالب</label>
              <input
                id="nk-checkin-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 80))}
                autoComplete="name"
                autoFocus
                placeholder="اكتب اسمك الكامل"
                className="w-full h-12 rounded-2xl border-2 border-input bg-card px-4 text-lg font-extrabold"
              />
            </div>
            <div>
              <label htmlFor="nk-checkin-code" className="text-xs font-bold block mb-1">
                كود الطالب{codeLen ? <span className="text-muted-foreground"> — {codeLen} أرقام</span> : ""}
              </label>
              <input
                id="nk-checkin-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, codeLen ?? 10))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={codeLen ? "–".repeat(codeLen) : "–––––"}
                dir="ltr"
                className="w-full h-14 rounded-2xl border-2 border-input bg-card text-center text-2xl font-black tracking-[0.4em] nk-num"
              />
            </div>
            {netError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-3.5 flex items-center gap-2.5">
                <XCircle className="w-4.5 h-4.5 text-rose-600 shrink-0" />
                <p className="text-xs font-bold text-rose-700 dark:text-rose-300">{netError}</p>
              </div>
            )}
            <button
              type="submit"
              disabled={name.trim().length < 2 || code.trim().length < 3 || busy}
              className="w-full h-12 rounded-2xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> جاري تسجيل الحضور…</> : <CheckCircle2 className="w-5 h-5" />}
              {busy ? "جاري تسجيل الحضور…" : "تسجيل الحضور"}
            </button>
            {netError && (
              <button
                type="button"
                onClick={() => void checkIn()}
                className="w-full h-10 rounded-2xl border border-border bg-card font-bold text-sm flex items-center justify-center gap-2 hover:bg-muted/60"
              >
                <RefreshCw className="w-4 h-4" /> جرب تاني
              </button>
            )}
          </form>
        )}

        {/* ============================= النتيجة ============================= */}
        {phase === "done" && result && (
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
                    {result.alreadyAttended ? "حضورك متسجل بالفعل ✅" : "✅ تم تسجيل حضرك بنجاح"}
                  </p>
                  <p className="text-sm font-bold text-muted-foreground">{result.studentName}</p>
                  {result.studentCode && (
                    <p className="text-xs font-bold text-muted-foreground">كود الطالب: <span className="nk-num" dir="ltr">{result.studentCode}</span></p>
                  )}
                  {result.sessionLabel && <p className="text-xs font-bold text-muted-foreground">{result.sessionLabel}</p>}
                  {result.status && !result.alreadyAttended && (
                    <p className="text-xs font-bold nk-brand-text">{STATUS_LABEL[result.status] ?? ""}</p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground font-bold text-center">
                  خليك في مكانك — لو الحضور فيه مشكلة كلّم الاستقبال والتعديل بيتعمل من شاشة الحصة.
                </p>
              </>
            ) : result.reason === "DEVICE_LOCKED" ? (
              /* ⛔ القاعدة الأساسية — من غير تفاصيل أمنية زيادة (spec §2) */
              <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-5 text-center space-y-3">
                <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
                <p className="font-black">الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل</p>
                <p className="text-xs font-bold text-muted-foreground leading-relaxed">
                  كل طالب بيسجّل من موبايله بنفسه. لو ده موبايلك وانت مكانك في الحصة، كلّم الاستقبال وهيساعدوك فورًا.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-5 text-center space-y-2">
                <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
                <p className="font-black">{result.message ?? "مينفعش نسجّل الحضور دلوقتي."}</p>
                {(result.reason === "EXPIRED_TOKEN" || result.reason === "REPLAYED_TOKEN") && (
                  <button
                    onClick={() => { setResult(null); setPhase("peek"); setTimeout(() => window.location.reload(), 300); }}
                    className="text-xs font-bold nk-brand-text underline underline-offset-4"
                  >
                    امسح الكود الجديد وابدأ من الأول
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground font-bold border-t border-border/60 pt-3">
          <Clock3 className="w-3.5 h-3.5" />
          الكود بيتجدد أوتوماتيك على شاشة الحصة — الصورة أو السكرين شوت مش هتنفع
        </div>
      </motion.div>
    </div>
  );
}
