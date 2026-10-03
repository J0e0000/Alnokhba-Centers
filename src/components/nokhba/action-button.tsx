"use client";

import { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/* ============================================================
   مكونات الـ UX المشتركة:
   - ActionSquare: زرار مربّع مضغوط (أيقونة + تسمية) — بدل مستطيلات
     الأزرار المتناثرة — مع تلميح hover/tap.
   - ActionPill: زرار صغير مضغوط للصفوف (أيقونة + كلمة).
   - InfoIcon: علامة "!" — الشرح الإضافي وراها، مش في وسط الشاشة.
   - Tooltips RTL-aware وبتشتغل فاتح/داكن.
============================================================ */

export type ActionVariant = "primary" | "success" | "danger" | "secondary" | "ghost";

const VARIANTS: Record<ActionVariant, string> = {
  primary: "nk-brand-grad text-white border-transparent shadow-md hover:brightness-110",
  success: "bg-emerald-600 text-white border-transparent shadow-md hover:bg-emerald-500",
  danger: "bg-rose-600 text-white border-transparent shadow-md hover:bg-rose-500",
  secondary: "bg-card text-foreground border-2 border-border hover:bg-muted/60",
  ghost: "bg-transparent text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground",
};

/** زرار مربّع مضغوط — الأكشن الأساسي الواضح (أيقونة كبيرة + تسمية صغيرة) */
export function ActionSquare({
  icon,
  label,
  onClick,
  variant = "secondary",
  tooltip,
  disabled,
  loading,
  className,
  size = "md",
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  variant?: ActionVariant;
  tooltip?: string;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "lg" ? "min-w-[84px] px-4 py-3 gap-1.5" : size === "sm" ? "min-w-[60px] px-2.5 py-2 gap-1" : "min-w-[72px] px-3 py-2.5 gap-1";
  const iconDims = size === "lg" ? "w-11 h-11 rounded-2xl" : size === "sm" ? "w-8 h-8 rounded-xl" : "w-9 h-9 rounded-xl";
  const btn = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={tooltip ?? label}
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border font-extrabold transition active:scale-95 disabled:opacity-45 disabled:pointer-events-none",
        dims,
        VARIANTS[variant],
        className,
      )}
    >
      <span className={cn("grid place-items-center", iconDims)}>
        {loading ? (
          <span className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : (
          icon
        )}
      </span>
      <span className="text-[10.5px] leading-none">{label}</span>
    </button>
  );
  if (!tooltip) return btn;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-bold">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** زرار صغير مضغوط (أيقونة + كلمة) للأكشنات الثانوية داخل الصفوف */
export function ActionPill({
  icon,
  label,
  onClick,
  variant = "secondary",
  tooltip,
  disabled,
  className,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  variant?: ActionVariant;
  tooltip?: string;
  disabled?: boolean;
  className?: string;
}) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tooltip ?? label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-extrabold transition active:scale-95 disabled:opacity-45 disabled:pointer-events-none",
        VARIANTS[variant],
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  if (!tooltip) return btn;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-bold">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** علامة "!" — الشرح الإضافي بيبان عند اللمس/الهوفر من غير ما يزحم الشاشة */
export function InfoIcon({ text, label = "معلومات إضافية", className }: { text: string; label?: string; className?: string }) {
  return (
    <Popover>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                className={cn(
                  "w-[18px] h-[18px] rounded-full border border-border bg-muted/60 text-muted-foreground grid place-items-center shrink-0 hover:nk-brand-text hover:border-[var(--c-primary)] transition",
                  className,
                )}
              >
                <Info className="w-3 h-3" />
              </button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent side="top" className="text-[11px] font-bold">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="center" className="w-64 text-xs font-bold leading-relaxed p-3">
        {text}
      </PopoverContent>
    </Popover>
  );
}
