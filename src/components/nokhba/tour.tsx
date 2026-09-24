"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronLeft, X } from "lucide-react";
import type { TourStep } from "./help-content";

/* ============================================================
   محرك الجولة التعليمية — Spotlight Tour
   - بيتنقل بين الشاشات (عبر onNavigate) وبيبرز عنصر حقيقي
   - الإبراز: صندوق شفاف + ظل غامق حواليه (تقنية box-shadow)
   - tooltip بيتظبط فوق/تحت العنصر حسب المساحة المتاحة
   - Esc = تخطي · بيحترم prefers-reduced-motion
============================================================ */

const SPOT_PAD = 10;

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({
  steps,
  open,
  onClose,
  onFinish,
  onNavigate,
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void; // تخطي
  onFinish: () => void; // خلص كل الخطوات
  onNavigate?: (view: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tipAbove, setTipAbove] = useState(false);
  const rafRef = useRef<number>(0);
  const step = steps[idx];

  const measure = useCallback(() => {
    if (!open || !step || step.noSpot) { setRect(null); return; }
    // لو الخطوة بتشير لشاشة — navigation حصل قبلها من goTo
    const el = document.querySelector<HTMLElement>(step.selector ?? '[data-tour="view-header"]');
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    // القياس بعد scrollIntoView — frame واحد تأكيد
    rafRef.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top - SPOT_PAD, left: r.left - SPOT_PAD, width: r.width + SPOT_PAD * 2, height: r.height + SPOT_PAD * 2 });
      const tipH = 210;
      setTipAbove(r.top + r.height + tipH > window.innerHeight && r.top > tipH + 20);
    });
  }, [open, step]);

  // التنقل + القياس لما الخطوة تتغير
  useEffect(() => {
    if (!open || !step) return;
    if (step.view && onNavigate) onNavigate(step.view);
    const t = setTimeout(measure, 420);
    return () => clearTimeout(t);
    // measure/onNavigate بيتغيروا مع الخطوة نفسها — الاعتماد على [idx, open] كفاية ومستقر
  }, [idx, open]);

  // إعادة قياس مع resize/scroll
  useEffect(() => {
    if (!open) return;
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, measure]);

  // Esc = تخطي
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // reset الفهرس لما الجولة تتفتح من جديد — تعديل أثناء الرندر (نمط React الرسمي)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setIdx(0);
  }

  if (!open || !step) return null;

  const next = () => (idx === steps.length - 1 ? onFinish() : setIdx(idx + 1));
  const prev = () => setIdx(Math.max(0, idx - 1));

  /* مكان الـ tooltip: تحت/فوق العنصر — أو في النص لخطوات noSpot */
  const tipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: tipAbove ? undefined : rect.top + rect.height + 14,
        bottom: tipAbove ? window.innerHeight - rect.top + 14 : undefined,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 352 - 12)),
        width: Math.min(340, window.innerWidth - 24),
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: Math.min(360, window.innerWidth - 24),
      };

  return (
    <div role="dialog" aria-modal="true" aria-label="الجولة التعليمية" className="fixed inset-0 z-[95]">
      {/* الخلفية + الإبراز (ظل حوالين صندوق شفاف) */}
      {rect ? (
        <div
          aria-hidden
          className="absolute rounded-2xl nk-tour-spot"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[#0f172a]/70 backdrop-blur-[2px]" />
      )}

      {/* الكارت */}
      <div style={tipStyle} className="nk-card rounded-2xl shadow-2xl border-2 nk-brand-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[11px] font-extrabold text-muted-foreground nk-num">
            خطوة {idx + 1} من {steps.length}
          </span>
          <button onClick={onClose} aria-label="تخطي الجولة"
            className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="font-extrabold text-base nk-brand-text leading-snug">{step.title}</h3>
        <span className="block nk-portal-divider my-2" aria-hidden />
        <p className="text-[13px] leading-relaxed text-foreground/90">{step.body}</p>

        {/* نقاط التقدم */}
        <div className="flex items-center gap-1.5 mt-4 mb-3" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 nk-brand-bg" : i < idx ? "w-1.5 bg-[var(--c-primary)]/40" : "w-1.5 bg-border"}`} />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={next}
            className="nk-btn-brand flex-1 h-11 rounded-xl font-extrabold text-sm flex items-center justify-center gap-1.5">
            {idx === steps.length - 1 ? "خلصنا 🎉" : "التالي"}
            {idx !== steps.length - 1 && <ChevronLeft className="w-4 h-4" />}
          </button>
          {idx > 0 && (
            <button onClick={prev} aria-label="الخطوة السابقة"
              className="h-11 w-11 rounded-xl border border-border bg-card grid place-items-center hover:bg-muted/60 transition">
              <ChevronRight className="w-4.5 h-4.5" />
            </button>
          )}
        </div>
        <button onClick={onClose} className="w-full mt-2 text-xs font-bold text-muted-foreground hover:text-foreground transition py-1">
          تخطي الجولة — هأعرف لوحدي (ترجعلها من زرار المساعدة ❓)
        </button>
      </div>
    </div>
  );
}
