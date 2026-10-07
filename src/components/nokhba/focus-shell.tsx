"use client";

import { ReactNode, useEffect, useState } from "react";
import { X, CloudUpload, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyCenterBranding, type SessionUser } from "./lib";
import { AlNokhbaMark } from "./shared";
import { UndoRedoButtons } from "./undo-buttons";
import { HelpButton } from "./help";
import { readPending, syncPending } from "./pwa";
import { SuccessBarHost } from "./success-bar";

/* ============================================================
   وضع التركيز (Focus Mode) — مساحة الحصة الواحدة
   - مفيش تنقل عام خالص: لا سايدبار ولا شريط سفلي
   - شريط علوي مصغّر: خروج آمن + حالة الحفظ + تراجع/إعادة
   - العنوان وسياق الحصة (مدرس/مجموعة/قاعة/وقت) بيظهرهم
     مساحة العمل نفسها جوّه — دايمًا قدام عين المستخدم
   - الخروج: بيزامن أي حضور أوفلاين الأول (مبيضيعش شغل)،
     والحصة نفسها بتفضل مفتوحة على السيرفر زي ما كانت
============================================================ */

export function FocusShell({ user, children, onExit }: {
  user: SessionUser;
  children: ReactNode;
  onExit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unsynced, setUnsynced] = useState(0);

  useEffect(() => {
    applyCenterBranding(user.center);
  }, [user.center]);

  // متابعة طابور الأوفلاين — لو فيه حضور مش متزامن ننبّه قبل الخروج
  useEffect(() => {
    const check = () => setUnsynced(readPending().filter((p) => p.status !== "SYNCED").length);
    check();
    const t = setInterval(check, 4000);
    window.addEventListener("nk-pending-changed", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("nk-pending-changed", check);
    };
  }, []);

  async function requestExit() {
    if (unsynced > 0) {
      setConfirmOpen(true);
      return;
    }
    await doExit();
  }

  async function doExit() {
    setBusy(true);
    try {
      // حفظ كل حاجة معلّقة قبل الخروج — مفيش شغل بيترمى
      if (readPending().some((p) => p.status !== "SYNCED")) {
        await syncPending();
      }
    } catch { /* الخروج مستمر — الطابور بيتزامن بعدين تلقائيًا */ }
    setBusy(false);
    onExit();
  }

  return (
    <div className="min-h-screen flex flex-col bg-background nk-focus-mode">
      {/* ===== الشريط العلوي المصغّر — كل حاجة في سطر واحد ===== */}
      <header className="nk-glass-bar sticky top-0 z-40 print:hidden nk-safe-top">
        <div className="mx-auto max-w-5xl px-3 md:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-card border border-border grid place-items-center shrink-0 overflow-hidden" aria-hidden>
              {user.center?.logo
                ? <img src={user.center.logo} alt="" className="w-full h-full object-cover" />
                : <img src="/logo.png?v=2" alt="" className="w-full h-full object-contain p-[6%]" />}
            </span>
            <span className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              الحفظ تلقائي
            </span>
            {unsynced > 0 && (
              <span className="hidden sm:flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 px-2.5 py-1 text-[11px] font-extrabold text-amber-700 dark:text-amber-300">
                <CloudUpload className="w-3.5 h-3.5" />
                {unsynced} حضور محفوظ على الجهاز — هيتبعت تلقائيًا
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <UndoRedoButtons />
            <button
              onClick={requestExit}
              disabled={busy}
              className={cn(
                "rounded-xl font-extrabold text-sm px-4 py-2.5 flex items-center gap-1.5 transition active:scale-95 shadow",
                "bg-card border-2 border-border hover:border-rose-300 hover:text-rose-600 disabled:opacity-60",
              )}
              aria-label="خروج من الحصة"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4.5 h-4.5" />}
              خروج من الحصة
            </button>
          </div>
        </div>
        <div className="nk-brand-hairline" aria-hidden />
      </header>

      {/* شريط النجاح الدائم — جاهز في وضع التركيز كمان */}
      <div className="mx-auto max-w-5xl w-full px-3 md:px-6 pt-2">
        <SuccessBarHost />
      </div>

      {/* ===== مساحة الحصة — مفيش أي حاجة تانية ===== */}
      <main className="flex-1 min-w-0 pb-16">{children}</main>

      <ExitConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={doExit} />

      {/* المساعدة المدركة للدور والسياق — شاشة الحصة الحية */}
      <HelpButton view="session-live" viewLabel="الحصة الحية" role={user.role} />
    </div>
  );
}

/** حوار تأكيد الخروج لما فيه حضور أوفلاين مش متزامن */
export function ExitConfirmDialog({ open, onOpenChange, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 print:hidden" role="dialog" aria-modal="true">
      <div className="nk-card rounded-3xl p-6 w-full max-w-sm space-y-4 text-center">
        <AlNokhbaMark size={36} showText={false} />
        <h3 className="font-extrabold text-lg">فيه حضور لسه على الجهاز</h3>
        <p className="text-sm font-bold text-muted-foreground leading-relaxed">
          عندك تسجيلات حضور محفوظة على الجهاز مش متزامنة مع السيرفر.
          لو خرجت دلوقتي هتتحاول المزامنة تلقائيًا — مفيش حاجة هتضيع.
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-xl border-2 border-border bg-card font-extrabold text-sm py-3 hover:bg-muted transition"
          >
            فضل في الحصة
          </button>
          <button
            onClick={() => { onOpenChange(false); onConfirm(); }}
            className="rounded-xl nk-brand-grad text-white font-extrabold text-sm py-3 shadow transition active:scale-95"
          >
            زامن واخرج
          </button>
        </div>
      </div>
    </div>
  );
}
