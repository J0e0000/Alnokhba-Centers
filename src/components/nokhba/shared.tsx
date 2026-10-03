"use client";

import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt } from "./lib";

/* ============================= تبديل الوضع (فاتح/داكن) =============================
   لتجربة السنتر التشغيلية بس — الحالة بتتحفظ في nk-theme وبتفضل بعد الريفريش.
   البوابات التانية (طالب/مدرس/هبوط/دخول/أدمن) مقفولة على الفاتح. */
function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

export function ThemeToggle({ className }: { className?: string }) {
  // قراءة حالة الوضع من الـ DOM نفسه (المصدر: سكربت ما قبل الترطيب أو التوجل)
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    try { localStorage.setItem("nk-theme", next ? "dark" : "light"); } catch { /* ignore */ }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "الوضع الداكن شغال — اضغط للفاتح" : "الوضع الفاتح شغال — اضغط للداكن"}
      aria-label={dark ? "تبديل للوضع الفاتح" : "تبديل للوضع الداكن"}
      className={cn(
        "w-9 h-9 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 grid place-items-center transition active:scale-95 shrink-0",
        className,
      )}
    >
      {dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4 md:mb-5">
      <div>
        <h1 data-tour="view-header" className="text-xl md:text-2xl font-extrabold tracking-tight nk-brand-text">{title}</h1>
        {/* فاصل بوابة النخبة — صدى هندسة اللوجو */}
        <span className="block nk-portal-divider mt-1.5 mb-1" aria-hidden />
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label, value, hint, tone = "default", icon, large,
}: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "brand" | "success" | "warning" | "danger" | "muted"; icon?: ReactNode; large?: boolean;
}) {
  const tones: Record<string, string> = {
    default: "nk-card",
    brand: "nk-brand-grad nk-portal-card text-white border-transparent shadow-md",
    success: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900",
    warning: "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900",
    danger: "bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900",
    muted: "bg-muted/60 border-border",
  };
  return (
    <div className={cn("rounded-2xl border p-4 flex flex-col gap-1", tones[tone])}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-xs md:text-[13px] font-semibold", tone === "brand" ? "text-white" : "text-muted-foreground")}>{label}</span>
        {icon && <span className={cn(tone === "brand" ? "text-white/95" : "text-muted-foreground/70")}>{icon}</span>}
      </div>
      <span className={cn("nk-num font-extrabold", large ? "text-2xl md:text-3xl" : "text-lg md:text-xl", tone === "brand" && "text-white")}>{value}</span>
      {hint && <span className={cn("text-[11px] md:text-xs", tone === "brand" ? "text-white/95" : "text-muted-foreground")}>{hint}</span>}
    </div>
  );
}

export function MoneyStat(props: { label: string; piastres: number | null | undefined; hint?: ReactNode; tone?: "default" | "brand" | "success" | "warning" | "danger" | "muted"; icon?: ReactNode }) {
  return <Stat {...props} value={<>{fmt(props.piastres)} <span className="text-xs font-bold opacity-70">جنيه</span></>} />;
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", className ?? "bg-muted border-border text-muted-foreground")}>
      {children}
    </span>
  );
}

export function BalanceChip({ balance }: { balance: number }) {
  if (balance < 0) return <Chip className="bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300">عليه {fmt(-balance)} ج</Chip>;
  if (balance > 0) return <Chip className="bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">له رصيد {fmt(balance)} ج</Chip>;
  return <Chip className="bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">سدّد</Chip>;
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-12 px-4">
      {icon && (
        <div className="relative w-16 h-16 rounded-2xl nk-brand-bg-soft nk-brand-text grid place-items-center">
          {icon}
          {/* عتبة البوابة الذهبية — صدى مدخل اللوجو */}
          <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-5 h-1.5 nk-portal-mark" aria-hidden />
        </div>
      )}
      <h3 className="font-bold text-base mt-1">{title}</h3>
      {hint && <p className="text-sm text-muted-foreground max-w-sm">{hint}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "جاري التحميل..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
      <span className="w-6 h-6 rounded-full border-[3px] border-[var(--c-primary)] border-t-transparent animate-spin" />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

/* ===== Skeletons — إحساس فوري بالسرعة بدل الفراغ الفاضي ===== */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("rounded-xl bg-muted animate-pulse", className)} aria-hidden />;
}

export function ChipsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-2 overflow-hidden py-1">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-16 min-w-[150px] shrink-0" />
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="nk-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function SectionCard({ title, icon, action, children, className }: { title?: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("nk-card rounded-2xl overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b nk-brand-bg-soft">
          <h2 className="font-bold text-sm md:text-base flex items-center gap-2">{icon}{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A key-value info row used across student profiles */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
      <span className="text-xs text-muted-foreground font-semibold">{label}</span>
      <span className="text-sm font-bold text-end">{value}</span>
    </div>
  );
}

/** Brand-mark: AlNokhba logo (official emblem) + wordmark
 *  اللوجو الرسمي — بيظهر في الدخول والبورتال والهيدر والأدمن */
export function AlNokhbaMark({ size = 36, showText = true, light = false, full = false }: { size?: number; showText?: boolean; light?: boolean; full?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <span
        className={cn("relative shrink-0 grid place-items-center rounded-xl bg-card border border-border/60 overflow-hidden", light && "border-white/40")}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={full ? "/logo-full.png" : "/logo.png"}
          alt=""
          className="w-full h-full object-contain p-[8%]"
          draggable={false}
        />
      </span>
      {showText && (
        <span className="leading-tight">
          <span className={cn("block font-extrabold text-[15px]", light ? "text-white" : "text-[var(--navy)]")}>Alnokhba Managment</span>
          <span className={cn("block text-[10px] font-bold tracking-normal", light ? "text-white/70" : "text-[var(--gold-deep)]")}>إدارة السنترات التعليمية</span>
        </span>
      )}
    </span>
  );
}
