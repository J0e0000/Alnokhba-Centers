"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2, QrCode, ScanLine, XCircle } from "lucide-react";
import { AlNokhbaMark } from "@/components/nokhba/shared";

/* ============================================================
   /c/<token> — حضور الموظف بمسح كود شاشة المركز بكاميرا الموبايل
   - الرابط من الكود نفسه (توكن opaque — مفيش IDs حساسة)
   - peek عام: اسم المركز + صلاحية الكود فقط
   - التسجيل محتاج جلسة موظف → من غيرها بنحوّلك /login?next=…
   - كل التحقق (انتهاء/تكرار/مركز تاني) على السيرفر
============================================================ */

type Peek = { valid: boolean; reason?: string; centerName?: string };

export default function StaffCheckinPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? "");
  const [phase, setPhase] = useState<"peek" | "ready" | "claiming" | "done" | "invalid" | "error">("peek");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [result, setResult] = useState<{ ok: boolean; title: string; detail?: string } | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/attendance/staff-qr/peek?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const d = (await r.json()) as Peek;
        if (!alive) return;
        setPeek(d);
        setPhase(d.valid ? "ready" : "invalid");
      } catch {
        if (alive) setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function claim() {
    setPhase("claiming");
    setNeedsLogin(false);
    try {
      const r = await fetch("/api/attendance/staff-qr/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      if (r.status === 401) {
        // موظف مش مسجل دخول — الدخول بيرجعه لنفس الصفحة
        setNeedsLogin(true);
        setPhase("ready");
        return;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResult({ ok: false, title: d.error ?? "مش قادرين نسجل حضورك — جرب تاني." });
        setPhase("done");
        return;
      }
      setResult({
        ok: true,
        title: d.alreadyCheckedIn ? "حضورك متسجل بالفعل النهاردة" : "تم تسجيل حضورك ✅",
        detail: d.message,
      });
      setPhase("done");
    } catch {
      setResult({ ok: false, title: "الشبكة مش متاحة — جرب تاني." });
      setPhase("done");
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-sm nk-card rounded-3xl p-7 space-y-5 text-center">
        <AlNokhbaMark size={40} />

        {phase === "peek" && (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm font-bold">جاري التحقق من الكود…</p>
          </div>
        )}

        {phase === "invalid" && (
          <>
            <span className="mx-auto w-16 h-16 rounded-3xl bg-rose-50 dark:bg-rose-950/50 grid place-items-center"><XCircle className="w-8 h-8 text-rose-600" /></span>
            <h1 className="text-lg font-extrabold">الكود ده مش شغال</h1>
            <p className="text-sm font-bold text-muted-foreground leading-relaxed">
              {peek?.reason === "EXPIRED" || peek?.reason === "INACTIVE"
                ? "الكود بيتغير على شاشة المركز كل ثواني — امسح أحدث كود من الشاشة."
                : "الكود مش شكل كود حضور — اتأكد إنك بتمسح كود شاشة المركز."}
            </p>
          </>
        )}

        {phase === "error" && (
          <>
            <span className="mx-auto w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/50 grid place-items-center"><AlertTriangle className="w-8 h-8 text-amber-600" /></span>
            <h1 className="text-lg font-extrabold">الشبكة مش متاحة</h1>
            <button onClick={() => { setPhase("peek"); void (async () => { try { const r = await fetch(`/api/attendance/staff-qr/peek?token=${encodeURIComponent(token)}`, { cache: "no-store" }); const d = (await r.json()) as Peek; setPeek(d); setPhase(d.valid ? "ready" : "invalid"); } catch { setPhase("error"); } })(); }} className="w-full h-11 rounded-xl nk-brand-grad text-white font-extrabold text-sm shadow active:scale-95">
              جرب تاني
            </button>
          </>
        )}

        {phase === "ready" && peek?.valid && (
          <>
            <span className="mx-auto w-16 h-16 rounded-3xl nk-brand-bg-soft nk-brand-text grid place-items-center"><ScanLine className="w-8 h-8" /></span>
            <div>
              <h1 className="text-lg font-extrabold">تسجيل حضور — {peek.centerName}</h1>
              <p className="text-xs font-bold text-muted-foreground mt-1.5 leading-relaxed">
                دوس التسجيل — لازم تكون مسجل دخول بحساب الموظف بتاعك. لو الجهاز مش مسجل، هيتحولك لصفحة الدخول وترجع هنا.
              </p>
            </div>
            <button
              onClick={claim}
              className="w-full h-13 py-3.5 rounded-2xl nk-brand-grad text-white font-extrabold text-base shadow-lg active:scale-95 transition flex items-center justify-center gap-2"
            >
              <QrCode className="w-5 h-5" /> سجّل حضوري
            </button>
            {needsLogin && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 p-3 space-y-2.5">
                <p className="text-xs font-extrabold text-amber-700 dark:text-amber-300">لازم تسجل دخول الأول بحساب الموظف.</p>
                <a
                  href={`/login?next=${encodeURIComponent(`/c/${token}`)}`}
                  className="block w-full h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-extrabold text-sm leading-10 transition"
                >
                  دخول وارجاع هنا
                </a>
              </div>
            )}
          </>
        )}

        {phase === "claiming" && (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm font-bold">جاري تسجيل حضورك…</p>
          </div>
        )}

        {phase === "done" && result && (
          <>
            <span className={`mx-auto w-16 h-16 rounded-3xl grid place-items-center ${result.ok ? "bg-emerald-50 dark:bg-emerald-950/50" : "bg-rose-50 dark:bg-rose-950/50"}`}>
              {result.ok ? <CheckCircle2 className="w-8 h-8 text-emerald-600" /> : <XCircle className="w-8 h-8 text-rose-600" />}
            </span>
            <div>
              <h1 className="text-lg font-extrabold">{result.title}</h1>
              {result.detail && <p className="text-xs font-bold text-muted-foreground mt-1.5">{result.detail}</p>}
            </div>
            <p className="text-[11px] font-bold text-muted-foreground">
              حضور الموظفين بيتسجل مرة واحدة في اليوم — السجل موحد مع باقي طرق الحضور.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
