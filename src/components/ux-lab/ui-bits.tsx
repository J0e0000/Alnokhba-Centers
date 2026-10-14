"use client";
/* عناصر عرض مشتركة داخل المختبر — كلها عرض فقط، بلا شبكة. */

import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, AttStatus, OptionState, SaveState } from "./types";
import { egp, pricePiastres, STUDENTS } from "./scenario";
import { Check, Loader2, CloudOff, CircleCheck } from "lucide-react";

/* شارة حالة الحفظ */
export function SaveChip({ save, offline }: { save: SaveState; offline: boolean }) {
  if (offline && save === "queued")
    return <span className="nk-badge o"><CloudOff className="w-3 h-3" /> في الطابور — هتتسجل لما الشبكة ترجع</span>;
  if (save === "saving")
    return <span className="nk-badge n"><Loader2 className="w-3 h-3 animate-spin" /> بيتسجل…</span>;
  if (save === "saved")
    return <span className="nk-badge g"><CircleCheck className="w-3 h-3" /> اتحفظ ✓</span>;
  return <span className="nk-badge n"><Check className="w-3 h-3" /> الحفظ تلقائي</span>;
}

/* أزرار حالة الحضور — تكست صغير + حجم لمس مريح */
const ATT_ORDER: AttStatus[] = ["PRESENT", "LATE", "EXCUSED"];
const ATT_STYLE: Record<AttStatus, string> = {
  PRESENT: "bg-emerald-600 text-white border-emerald-600",
  LATE: "bg-amber-500 text-white border-amber-500",
  EXCUSED: "bg-sky-600 text-white border-sky-600",
};

export function AttButtons({
  current, onPick, onClear, size = "md", disabled,
}: {
  current?: AttStatus;
  onPick: (s: AttStatus) => void;
  onClear?: () => void;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const btn = size === "sm"
    ? "h-8 px-2.5 text-[11px] rounded-lg"
    : "h-9 px-3 text-xs rounded-xl";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="حالة الحضور">
      {ATT_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          aria-pressed={current === s}
          onClick={() => onPick(s)}
          className={cn(
            "border font-bold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
            btn,
            current === s
              ? ATT_STYLE[s]
              : "bg-card text-muted-foreground border-border hover:bg-muted/60",
          )}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
      {onClear && current && (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          title="إلغاء التسجيل (يرجع لغير محضور)"
          className={cn(
            "border border-border bg-card text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 rounded-xl font-bold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50",
            size === "sm" ? "h-8 px-2 text-[11px] rounded-lg" : "h-9 px-3 text-xs",
          )}
        >
          مسح
        </button>
      )}
    </div>
  );
}

/* صف طالب موحد — بيوصل مستوى الصف حسب الحالة */
export function StudentRow({
  name, code, mark, weakCount, usualLate, expanded, onToggleExpand, actions, extra,
}: {
  name: string;
  code: string;
  mark?: { status: AttStatus; method: "MANUAL" | "QR" };
  weakCount?: number;
  usualLate?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  actions?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border transition-colors",
        mark?.status === "PRESENT" && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20",
        mark?.status === "LATE" && "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20",
        mark?.status === "EXCUSED" && "border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20",
        !mark && "border-border bg-card",
        expanded && "ring-2 ring-ring/30",
      )}
    >
      <div className="flex items-center gap-2.5 p-2.5">
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={!onToggleExpand}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default"
          aria-expanded={expanded}
        >
          <span
            className={cn(
              "w-9 h-9 rounded-xl grid place-items-center text-[11px] font-extrabold shrink-0 nk-num",
              mark ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground",
            )}
            dir="ltr"
          >
            {code}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold truncate">{name}</span>
            <span className="block text-[11px] text-muted-foreground">
              {mark ? (
                <>
                  {STATUS_LABEL[mark.status]}
                  {mark.method === "QR" && " · سجّل ذاتيًا QR"}
                </>
              ) : (
                <>غير محضور {usualLate && "· عادةً بيتأخر"}</>
              )}
              {!!weakCount && weakCount > 0 && <span className="text-rose-600 dark:text-rose-400"> · {weakCount} ملاحظة</span>}
            </span>
          </span>
        </button>
        {actions}
      </div>
      {expanded && extra && <div className="px-2.5 pb-2.5">{extra}</div>}
    </div>
  );
}

/* ملخص أرقام صغير */
export function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" | "info" | "muted" }) {
  return (
    <div className={cn(
      "rounded-2xl border p-2.5 text-center",
      tone === "ok" && "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20",
      tone === "warn" && "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20",
      tone === "info" && "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20",
      (!tone || tone === "muted") && "border-border bg-muted/40",
    )}>
      <div className="text-lg font-extrabold nk-num" dir="ltr">{value}</div>
      <div className="text-[11px] text-muted-foreground font-semibold">{label}</div>
    </div>
  );
}

/* حسابات ملخص الحضور */
export function attendanceSummary(state: OptionState) {
  const marks = Object.values(state.marks);
  const present = marks.filter((m) => m.status === "PRESENT").length;
  const late = marks.filter((m) => m.status === "LATE").length;
  const excused = marks.filter((m) => m.status === "EXCUSED").length;
  const absent = STUDENTS.length - marks.length;
  const collected = present * pricePiastres + late * pricePiastres; // المتأخر بيتحاسب في الإنتاج — محاكاة مبسطة
  const weaknesses = Object.values(state.weaknesses).reduce((a, w) => a + w.length, 0);
  return { present, late, excused, absent, marked: marks.length, total: STUDENTS.length, collected, weaknesses, collectedText: egp(collected) };
}

/* قفل الحصة — تأكيد */
export function CloseConfirm({
  open, onOpenChange, summary, onConfirm, requireAttendanceDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  summary: ReturnType<typeof attendanceSummary>;
  onConfirm: () => void;
  requireAttendanceDone?: boolean;
}) {
  const blocked = requireAttendanceDone && !summary.marked;
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      title="قفل الحصة؟"
      description="القفل بيثبت الأرقام ويحسب مصروفات المدرس. بعد القفل ممكن تفتحها تاني بـ«تراجع» لو غلط."
      confirmLabel="تأكيد القفل وإثبات الحساب"
      onConfirm={onConfirm}
      blocked={blocked}
      blockedReason="مفيش أي حضور مسجل — سجّل حضور الأول"
    >
      <div className="grid grid-cols-4 gap-2 mb-1">
        <MiniStat label="حاضر" value={summary.present} tone="ok" />
        <MiniStat label="متأخر" value={summary.late} tone="warn" />
        <MiniStat label="بعذر" value={summary.excused} tone="info" />
        <MiniStat label="غايب" value={summary.absent} />
      </div>
      <p className="text-sm text-muted-foreground text-center">
        التحصيل المتوقع: <b className="text-foreground nk-num" dir="ltr">{summary.collectedText}</b>
      </p>
    </ConfirmSheet>
  );
}

/* ورقة تأكيد عامة */
export function ConfirmSheet({
  open, onOpenChange, title, description, confirmLabel, onConfirm, blocked, blockedReason, children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  blocked?: boolean;
  blockedReason?: string;
  children?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-5 shadow-2xl nk-anim-in">
        <h3 className="text-lg font-extrabold mb-1">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mb-3">{description}</p>}
        {children}
        {blocked && blockedReason && (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 p-3 text-sm font-bold text-rose-700 dark:text-rose-300">
            {blockedReason}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1 h-11 rounded-2xl" onClick={() => onOpenChange(false)}>
            رجوع
          </Button>
          <Button
            className={cn("flex-1 h-11 rounded-2xl nk-btn-brand", blocked && "opacity-50 pointer-events-none")}
            onClick={() => { onConfirm(); onOpenChange(false); }}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* شريط بيانات الحصة */
export function SessionInfoBar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="nk-card rounded-3xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="font-extrabold nk-brand-text">فيزياء — ثانوية عامة</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          أ. كريم منصور · قاعة A · <span dir="ltr" className="nk-num">5:00–6:30</span> م · <span className="nk-num" dir="ltr">75</span> ج/حصة
        </div>
      </div>
      {right}
    </div>
  );
}

export function WeaknessInput({ onSave, onCancel, placeholder }: { onSave: (t: string) => void; onCancel: () => void; placeholder?: string }) {
  const [v, setV] = React.useState("");
  return (
    <div className="flex gap-2 items-center">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onSave(v); setV(""); } if (e.key === "Escape") onCancel(); }}
        placeholder={placeholder || "اكتب نقطة الضعف… (Enter يحفظ)"}
        aria-label="نقطة ضعف جديدة"
        className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      <Button size="sm" className="h-10 rounded-xl nk-btn-brand" onClick={() => { if (v.trim()) onSave(v); setV(""); }}>حفظ</Button>
      <Button size="sm" variant="ghost" className="h-10 rounded-xl" onClick={onCancel}>إلغاء</Button>
    </div>
  );
}

export function WeaknessList({ items, onRemove }: { items: string[]; onRemove?: (t: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((w, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900 px-2.5 py-1 text-[11px] font-bold">
          {w}
          {onRemove && (
            <button type="button" onClick={() => onRemove(w)} className="hover:opacity-70" aria-label={`حذف ${w}`}>✕</button>
          )}
        </span>
      ))}
    </div>
  );
}
