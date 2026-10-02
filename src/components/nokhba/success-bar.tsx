"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Printer, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ============================================================
   شريط النجاح الدائم (spec: Success Action Bar)
   - بيظهر لما عملية/حصة تخلص بنجاح
   - مبيختفيش لوحده أبداً — بيفضل ظاهر لحد ما المستخدم يقفله
     أو تبدأ عملية نجاح تانية (بتستبدله)
   - فيه زرار [طباعة] + [تراجع] جاهزين فورًا
============================================================ */

export type SuccessPayload = {
  message: string;
  sub?: string;
  printLabel?: string;
  onPrint?: () => void;
  undoLabel?: string;
  onUndo?: () => void;
};

const EVT = "nk-success-bar";

export function showSuccess(p: SuccessPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SuccessPayload | null>(EVT, { detail: p }));
}

export function clearSuccess(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SuccessPayload | null>(EVT, { detail: null }));
}

export function SuccessBarHost({ floating }: { floating?: boolean }) {
  const [payload, setPayload] = useState<SuccessPayload | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  useEffect(() => {
    const onEvt = (e: Event) => {
      const detail = (e as CustomEvent<SuccessPayload | null>).detail ?? null;
      setUndoBusy(false);
      setPayload(detail ?? null);
    };
    window.addEventListener(EVT, onEvt);
    return () => window.removeEventListener(EVT, onEvt);
  }, []);

  if (!payload) return null;

  async function handleUndo() {
    if (!payload?.onUndo) return;
    setUndoBusy(true);
    try {
      await payload.onUndo();
    } finally {
      setUndoBusy(false);
      setPayload(null);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "z-[60] print:hidden",
        floating
          ? "fixed top-2 inset-x-2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[min(720px,94vw)]"
          : "sticky top-2 mx-auto w-[min(720px,94vw)]",
      )}
    >
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 dark:border-emerald-700 shadow-lg px-4 py-3 flex items-center gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-emerald-600 text-white shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-sm text-emerald-800 dark:text-emerald-200 truncate">{payload.message}</p>
          {payload.sub && <p className="text-[11px] font-bold text-emerald-700/80 dark:text-emerald-300/80 truncate">{payload.sub}</p>}
        </div>
        {payload.onPrint && (
          <button
            onClick={payload.onPrint}
            className="shrink-0 rounded-xl bg-emerald-700 text-white font-extrabold text-xs px-3.5 py-2.5 flex items-center gap-1.5 hover:bg-emerald-800 active:scale-95 transition shadow"
          >
            <Printer className="w-4 h-4" />
            {payload.printLabel ?? "طباعة"}
          </button>
        )}
        {payload.onUndo && (
          <button
            onClick={handleUndo}
            disabled={undoBusy}
            className="shrink-0 rounded-xl border-2 border-emerald-300 dark:border-emerald-600 bg-card font-extrabold text-xs px-3.5 py-2.5 flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 active:scale-95 transition disabled:opacity-50"
          >
            <Undo2 className="w-4 h-4" />
            {undoBusy ? "بيتراجع..." : payload.undoLabel ?? "تراجع"}
          </button>
        )}
        <button
          onClick={() => setPayload(null)}
          aria-label="إغلاق شريط النجاح"
          className="shrink-0 rounded-lg p-1.5 text-emerald-700/70 hover:text-emerald-900 hover:bg-emerald-100 dark:text-emerald-300/70 dark:hover:bg-emerald-900/50 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
