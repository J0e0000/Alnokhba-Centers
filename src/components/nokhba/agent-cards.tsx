"use client";

import { AlertTriangle, CheckCircle2, XCircle, Info, User as UserIcon, Users, BarChart3, Lightbulb, CheckCheck, MapPin, Wrench, ShieldAlert, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/* ============================================================
   AGENT CARDS — كروت ردود الوكيل الغنية (spec §18)
   StudentCard / StudentsCard / ReportCard / InsightCard /
   ResultCard / ErrorCard / ConfirmationCard / PlanCard
   كل الكروت بتستخدم هوية النخبة (nk-brand-*) وبتشتغل RTL.
============================================================ */

export type AgentCard = {
  type: string;
  title?: string;
  subtitle?: string;
  actions?: { label: string; action: "navigate" | "agent"; view?: string; studentId?: string; text?: string }[];
  rows?: { label: string; value: string; tone?: "good" | "warn" | "bad" | "info" }[];
  items?: { id: string; title: string; sub?: string; actions?: AgentCard["actions"] }[];
  severity?: "INFO" | "WARNING" | "CRITICAL";
};

export type CardActionHandler = (a: NonNullable<AgentCard["actions"]>[number]) => void;

const TONE: Record<string, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  info: "text-muted-foreground",
};

function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-3.5 space-y-2.5 shadow-sm", className)}>{children}</div>;
}

function CardActions({ actions, onAction }: { actions?: AgentCard["actions"]; onAction?: CardActionHandler }) {
  if (!actions?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); onAction?.(a); }}
          className="rounded-full border nk-brand-border nk-brand-bg-soft px-3 py-1.5 text-[11px] font-extrabold nk-brand-text transition active:scale-[0.97]"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

export function AgentCardView({ card, onAction }: { card: AgentCard; onAction?: CardActionHandler }) {
  if (card.type === "student") {
    return (
      <CardShell className="nk-brand-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl nk-brand-bg text-white grid place-items-center shrink-0">
            <UserIcon className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <p className="font-black text-sm truncate">{card.title}</p>
            {card.subtitle && <p className="text-[11px] font-bold text-muted-foreground truncate">{card.subtitle}</p>}
          </div>
        </div>
        {card.rows && <Rows rows={card.rows} />}
        <CardActions actions={card.actions} onAction={onAction} />
      </CardShell>
    );
  }

  if (card.type === "students") {
    return (
      <CardShell>
        <p className="font-black text-sm flex items-center gap-1.5">
          <Users className="w-4 h-4 nk-brand-text" /> {card.title}
        </p>
        <div className="space-y-1.5">
          {(card.items ?? []).map((it) => (
            <div key={it.id} className="rounded-xl bg-muted/50 border border-border px-3 py-2">
              <button
                onClick={() => onAction?.({ label: it.title, action: "navigate", view: "students", studentId: it.id })}
                className="w-full text-start"
              >
                <span className="text-xs font-extrabold block truncate">{it.title}</span>
                {it.sub && <span className="text-[10px] font-bold text-muted-foreground">{it.sub}</span>}
              </button>
              {it.actions && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {it.actions.map((a, i) => (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); onAction?.(a); }}
                      className="rounded-full bg-card border border-border px-2.5 py-1 text-[10px] font-extrabold text-muted-foreground hover:bg-muted/60"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <CardActions actions={card.actions} onAction={onAction} />
      </CardShell>
    );
  }

  if (card.type === "report" || card.type === "result") {
    return (
      <CardShell>
        <p className="font-black text-sm flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 nk-brand-text" /> {card.title}
        </p>
        {card.subtitle && <p className="text-[11px] font-bold text-muted-foreground">{card.subtitle}</p>}
        {card.rows && <Rows rows={card.rows} />}
        <CardActions actions={card.actions} onAction={onAction} />
      </CardShell>
    );
  }

  if (card.type === "insight") {
    const sev = card.severity ?? "INFO";
    const chip = sev === "CRITICAL" ? "bg-rose-600 text-white" : sev === "WARNING" ? "bg-amber-500 text-white" : "nk-brand-bg text-white";
    return (
      <CardShell className={cn(sev === "CRITICAL" && "border-rose-300 dark:border-rose-800")}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black inline-flex items-center gap-1", chip)}>
            <Lightbulb className="w-3 h-3" /> {sev === "CRITICAL" ? "حرج" : sev === "WARNING" ? "يحتاج انتباه" : "ملاحظة"}
          </span>
        </div>
        <p className="font-extrabold text-sm leading-snug">{card.title}</p>
        {card.subtitle && (
          <p className="text-[11px] font-bold flex items-start gap-1.5 text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" /> <span>{card.subtitle}</span>
          </p>
        )}
        {card.rows && <Rows rows={card.rows} labels={{ why: "ليه", action: "اعمل إيه" }} />}
        <CardActions actions={card.actions} onAction={onAction} />
      </CardShell>
    );
  }

  // fallback: كارت نصي عام
  return (
    <CardShell>
      {card.title && <p className="font-extrabold text-sm">{card.title}</p>}
      {card.rows && <Rows rows={card.rows} />}
      <CardActions actions={card.actions} onAction={onAction} />
    </CardShell>
  );
}

function Rows({ rows, labels }: { rows: NonNullable<AgentCard["rows"]>; labels?: { why?: string; action?: string } }) {
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start justify-between gap-3 text-[11.5px] font-bold">
          <span className="text-muted-foreground shrink-0">{labels && r.label === "ليه" ? labels.why ?? r.label : labels && r.label === "اقتراح" ? labels.action ?? r.label : r.label}:</span>
          <span className={cn("text-end leading-relaxed", r.tone ? TONE[r.tone] : "text-foreground")}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- كارت التأكيد (spec §5) ---------- */
export function ConfirmationCard({
  summary,
  risk,
  onDecide,
  busy,
}: {
  summary: string;
  risk: string;
  onDecide: (d: "confirm" | "cancel") => void;
  busy?: boolean;
}) {
  const high = risk === "HIGH";
  return (
    <div className={cn("rounded-2xl border-2 p-3.5 space-y-3", high ? "border-rose-400 dark:border-rose-700 bg-rose-50/60 dark:bg-rose-950/20" : "nk-brand-border nk-brand-bg-soft")}>
      <div className="flex items-center gap-2">
        <span className={cn("w-8 h-8 rounded-xl grid place-items-center text-white", high ? "bg-rose-600" : "nk-brand-bg")}>
          <ShieldAlert className="w-4 h-4" />
        </span>
        <div>
          <p className="font-black text-sm">محتاج تأكيدك{high ? " — عملية حساسة" : ""}</p>
          <p className="text-[10px] font-bold text-muted-foreground">{high ? "حساس" : "بتعدّل بيانات"} · {risk}</p>
        </div>
      </div>
      <p className="text-sm font-extrabold leading-relaxed bg-card rounded-xl border border-border px-3 py-2.5">{summary}</p>
      <div className="flex gap-2">
        <button
          disabled={busy}
          onClick={() => onDecide("confirm")}
          className="flex-1 rounded-xl nk-brand-bg text-white py-2.5 text-sm font-black disabled:opacity-50 active:scale-[0.98] transition"
        >
          تأكيد وتنفيذ
        </button>
        <button
          disabled={busy}
          onClick={() => onDecide("cancel")}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-extrabold text-muted-foreground disabled:opacity-50 active:scale-[0.98] transition"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

/* ---------- كارت الخطة (spec §15/§39) ---------- */
export function PlanCard({ plan }: { plan: string[] }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3 space-y-1.5">
      <p className="text-[11px] font-black text-muted-foreground">هعمل الآتي:</p>
      <ol className="space-y-1">
        {plan.map((s, i) => (
          <li key={i} className="text-xs font-extrabold flex items-start gap-2">
            <span className="nk-num w-5 h-5 rounded-full nk-brand-bg text-white grid place-items-center text-[10px] shrink-0 mt-0.5">{i + 1}</span>
            <span className="leading-relaxed">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- شريط الخطوات الحية ---------- */
export type StepItem = { index: number; tool: string; label: string; status: "ok" | "failed" | "blocked" | "waiting" | "running"; summary?: string; error?: string };

export function StepChip({ step }: { step: StepItem }) {
  const icon =
    step.status === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
    : step.status === "failed" || step.status === "blocked" ? <XCircle className="w-3.5 h-3.5 text-rose-500" />
    : step.status === "waiting" ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
    : <CheckCheck className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-black truncate">{step.label}</p>
        {step.summary && <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">{step.summary}</p>}
        {step.error && <p className="text-[10px] font-extrabold text-rose-600 dark:text-rose-400 leading-relaxed">{step.error}</p>}
      </div>
    </div>
  );
}

/* ---------- كارت خطأ مع إجراءات (spec §16) ---------- */
export function ErrorCard({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/20 p-3.5 space-y-2">
      <div className="flex items-start gap-2">
        <XCircle className="w-4.5 h-4.5 text-rose-500 shrink-0 mt-0.5" />
        <p className="text-xs font-extrabold leading-relaxed flex-1">{text}</p>
      </div>
      {onRetry && (
        <div className="flex gap-2">
          <button onClick={onRetry} className="rounded-xl nk-brand-bg text-white px-4 py-2 text-xs font-black active:scale-[0.98] transition">
            إعادة المحاولة
          </button>
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} /> تفاصيل
      </button>
      {open && (
        <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">
          لو المشكلة اتكررت: شوف اتصالك بالنت، أو جرب تطلب نفس الحاجة بصيغة تانية. العمليات اللي اتنفذت بنجاح قبل الخطأ دي فضلت محفوظة.
        </p>
      )}
    </div>
  );
}

/* ---------- كارت حالة نجاح نهائي ---------- */
export function SuccessCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/20 p-3.5 flex items-start gap-2">
      <Info className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
      <p className="text-xs font-extrabold leading-relaxed">{text}</p>
    </div>
  );
}
