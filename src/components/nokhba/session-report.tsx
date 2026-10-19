"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2, ChevronRight, Copy, Loader2, MessageCircle, Send, SkipForward, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { buildWaUrl, openWhatsAppHandoff } from "./wa";

/* ============================================================
   تقارير أولياء الأمور (WhatsApp) — حضور وغياب فقط:
   • مُنشئ الرسالة: رسالة الحاضر تختلف عن رسالة الغائب — بدون أي بيانات أكاديمية.
   • اختيار المستلمين: غائبون / حاضرون / الكل / تحديد يدوي — مفيش حاجة
     بتتبعت تلقائيًا؛ الإرسال يدوي واحد واحد عبر wa.me (iOS-safe).
============================================================ */

export type ReportStudent = {
  studentId: string | null;
  name: string;
  code: string;
  statusType: "present" | "absent" | "unmarked";
  statusLabel: string;
  phone: string | null;   // موبايل الطالب أو ولي الأمر (مُختار مسبقًا)
};

export type ReportContext = {
  centerName: string;
  subject: string;
  groupName: string;
  grade: string;
  date: string; // YYYY-MM-DD
};

function arDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" });
  } catch { return iso; }
}

/** رسالة التقرير — حضور فقط: رسالة الحاضر تختلف عن رسالة الغائب */
export function buildReportMessage(s: ReportStudent, ctx: ReportContext): string {
  const groupLabel = [ctx.grade, ctx.groupName].filter((x) => x && x !== "—").join(" ");
  const isPresent = s.statusType === "present";

  if (isPresent) {
    return [
      `أهلًا حضرتك 🌟`,
      `${s.name} حضر حصة ${ctx.subject}${groupLabel ? ` (${groupLabel})` : ""} النهارده ✅`,
      `شكرًا لمتابعتكم — ${ctx.centerName}.`,
    ].filter(Boolean).join("\n");
  }

  const lines = [
    `ولي أمر الطالب ${s.name}،`,
    `تم تسجيله غياب في حصة ${ctx.subject}${groupLabel ? ` (${groupLabel})` : ""} بتاريخ ${arDate(ctx.date)}.`,
    `للاستفسار عن مواعيد وأماكن التعويض برجاء التواصل معنا — ${ctx.centerName}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function recipientPhone(s: { phone: string | null; parentPhone?: string | null }): string | null {
  return s.phone?.trim() || s.parentPhone?.trim() || null;
}

/* ─────────────────────────── اختيار المستلمين ─────────────────────────── */

/** بوابة للـ body — عشان الحوار يفلت من أي سياق transform في الأسلاف (fixed بيتحبس جواه) */
function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- نمط portal القياسي: نرندر بعد التحميل فقط
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function RecipientPickerModal({ candidates, title, subtitle, preselect, onClose, onStart }: {
  candidates: ReportStudent[];
  title: string;
  subtitle: string;
  preselect: "absent" | "present" | "all" | "manual";
  onClose: () => void;
  onStart: (items: ReportStudent[]) => void;
}) {
  const initial = useMemo(() => {
    const set = new Map<string, boolean>();
    for (const c of candidates) {
      const on = preselect === "all" ? true : preselect === "manual" ? false : c.statusType === preselect;
      set.set(c.studentId ?? c.name, on);
    }
    return set;
  }, [candidates, preselect]);
  const [picked, setPicked] = useState<Map<string, boolean>>(initial);
  const [search, setSearch] = useState("");

  const visible = candidates.filter((c) => !search || c.name.includes(search) || c.code.includes(search));
  const pickedCount = candidates.filter((c) => picked.get(c.studentId ?? c.name)).length;
  const validPicked = candidates.filter((c) => picked.get(c.studentId ?? c.name) && recipientPhone(c));

  const toggle = (c: ReportStudent) => {
    const k = c.studentId ?? c.name;
    setPicked((m) => new Map(m).set(k, !m.get(k)));
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div className="relative w-full sm:max-w-lg bg-card rounded-t-3xl sm:rounded-3xl border border-border shadow-2xl max-h-[88vh] flex flex-col">
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-extrabold text-base truncate">{title}</h3>
              <p className="text-[11px] font-bold text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-muted grid place-items-center shrink-0" aria-label="إغلاق">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 ابحث بالاسم أو الكود..."
            className="mt-3 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm font-semibold"
          />
          <div className="flex gap-1.5 mt-2">
            <button className="nk-wf-ghost" onClick={() => setPicked(new Map(candidates.map((c) => [c.studentId ?? c.name, true])))}>تحديد الكل</button>
            <button className="nk-wf-ghost" onClick={() => setPicked(new Map(candidates.map((c) => [c.studentId ?? c.name, false])))}>إلغاء الكل</button>
            <span className="nk-wf-ghost pointer-events-none ms-auto">{pickedCount} محدد</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto nk-scroll p-3 grid gap-1.5">
          {visible.map((c) => {
            const on = picked.get(c.studentId ?? c.name) ?? false;
            const phone = recipientPhone(c);
            return (
              <button
                key={c.studentId ?? c.name}
                onClick={() => toggle(c)}
                aria-pressed={on}
                className={cn(
                  "w-full text-start rounded-xl border-2 px-3.5 py-2.5 flex items-center gap-3 transition active:scale-[0.99]",
                  on ? "border-[color-mix(in_srgb,var(--c-primary)_45%,white)] bg-[color-mix(in_srgb,var(--c-primary)_6%,var(--card))]" : "border-border bg-card opacity-80",
                  !phone && "opacity-50",
                )}
              >
                <span className={cn(
                  "w-5 h-5 rounded-md border-2 grid place-items-center shrink-0",
                  on ? "nk-brand-bg border-transparent text-white" : "border-border",
                )}>{on && <CheckCircle2 className="w-3.5 h-3.5" />}</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-sm truncate">{c.name}</b>
                  <small className="text-[11px] font-bold text-muted-foreground">
                    <span className="nk-num" dir="ltr">{c.code}</span> · {c.statusLabel}
                  </small>
                </span>
                <span className={cn("text-[10px] font-extrabold rounded-full px-2 py-1 shrink-0",
                  c.statusType === "present" ? "nk-pill-live" : c.statusType === "absent" ? "nk-pill-danger" : "nk-pill-neutral")}>
                  {phone ? "واتساب ✓" : "مفيش رقم"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-border">
          <button
            disabled={validPicked.length === 0}
            onClick={() => onStart(validPicked)}
            className="w-full nk-brand-grad text-white font-extrabold rounded-xl py-3.5 shadow flex items-center justify-center gap-2 disabled:opacity-50"
          >
            متابعة — تجهيز {validPicked.length} رسالة <ChevronRight className="w-4.5 h-4.5" />
          </button>
          <p className="text-[11px] font-bold text-muted-foreground text-center mt-2">
            مفيش حاجة بتتبعت تلقائيًا — كل رسالة بتفتح واتساب بإيدك.
          </p>
        </div>
      </div>
    </div>
    </Portal>
  );
}
/* ─────────────────────────── طابور الإرسال ─────────────────────────── */

type QueueItemState = "PENDING" | "SENT" | "SKIPPED";

export function SendQueueModal({ items, ctx, customMessage, onClose }: {
  items: ReportStudent[];
  ctx?: ReportContext;
  /** رسالة مخصصة (رسالة جماعية للطلاب) — بتتخصص لكل طالب */
  customMessage?: (s: ReportStudent) => string;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [states, setStates] = useState<Record<string, QueueItemState>>({});
  const [copied, setCopied] = useState(false);

  const current = items[idx];
  const message = current
    ? (customMessage ? customMessage(current) : ctx ? buildReportMessage(current, ctx) : "")
    : "";
  const waUrl = current ? buildWaUrl(recipientPhone(current) ?? "", message) : "";
  const sent = Object.values(states).filter((s) => s === "SENT").length;
  const done = idx >= items.length;

  const mark = (state: QueueItemState) => {
    if (!current) return;
    setStates((m) => ({ ...m, [current.studentId ?? current.name]: state }));
    setCopied(false);
    setIdx((i) => i + 1);
  };

  const copyCurrent = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success("الرسالة اتنسخت — الصقها في واتساب.");
    } catch { toast.error("مش قادر أنسخ — انسخ الرسالة بإيدك."); }
  };

  // iOS-safe handoff (نفس قاعدة المنصة الأساسية — لينك حقيقي قبل المحاولة التلقائية)
  const openWa = () => {
    if (!current) return;
    const url = buildWaUrl(recipientPhone(current) ?? "", message);
    if (!recipientPhone(current)) { toast.error("الطالب ده مالوش رقم صالح."); return; }
    openWhatsAppHandoff(url);
    mark("SENT");
  };

  // لو مفيش أصلاً — اقفل
  useEffect(() => { if (!items.length) onClose(); }, [items.length, onClose]);

  const sentItems = items.filter((it) => states[it.studentId ?? it.name] === "SENT");

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="إرسال التقارير">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div className="relative w-full sm:max-w-lg bg-card rounded-t-3xl sm:rounded-3xl border border-border shadow-2xl max-h-[88vh] flex flex-col">
        {done ? (
          <div className="p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 grid place-items-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="font-extrabold text-lg mt-3">خلصت القائمة 🎉</h3>
            <p className="text-sm font-bold text-muted-foreground mt-1">
              بعت {sent} من {items.length} · تخطيت {Object.values(states).filter((s) => s === "SKIPPED").length}
            </p>
            <div className="grid gap-2 mt-4">
              {sentItems.length > 0 && (
                <button
                  onClick={() => {
                    const text = sentItems.map((s) => `— ${s.name} —\n${customMessage ? customMessage(s) : ctx ? buildReportMessage(s, ctx) : ""}`).join("\n\n");
                    navigator.clipboard.writeText(text).then(() => toast.success("كل الرسائل المتبعت اتنسخت")).catch(() => {});
                  }}
                  className="nk-wf-ghost"
                >
                  نسخ كل الرسائل المتبعت ({sent})
                </button>
              )}
              <button onClick={onClose} className="w-full nk-brand-grad text-white font-extrabold rounded-xl py-3.5 shadow">تمام</button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 pb-3 border-b border-border">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold text-base">إرسال التقرير — <span className="nk-num">{idx + 1}/{items.length}</span></h3>
                <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-muted grid place-items-center" aria-label="إغلاق">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="nk-bar w-full mt-2.5"><span style={{ width: `${Math.round((idx / items.length) * 100)}%` }} /></div>
            </div>

            <div className="flex-1 overflow-y-auto nk-scroll p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-sm">{current.name}</b>
                <span className="nk-num text-xs font-bold text-muted-foreground" dir="ltr">{recipientPhone(current)}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold",
                  current.statusType === "present" ? "nk-pill-live" : "nk-pill-danger")}>
                  {current.statusLabel}
                </span>
              </div>
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 p-3.5 whitespace-pre-wrap text-[13px] leading-relaxed font-semibold" dir="rtl">
                {message}
              </div>
            </div>

            <div className="p-4 border-t border-border grid gap-2">
              <button onClick={openWa} className="w-full bg-[#25D366] text-white font-extrabold rounded-xl py-3.5 shadow flex items-center justify-center gap-2 active:scale-[0.99]">
                <MessageCircle className="w-5 h-5" /> فتح واتساب وإرسالها
              </button>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={copyCurrent} className="nk-wf-ghost flex items-center justify-center gap-1.5">
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} نسخ
                </button>
                <button onClick={() => mark("SKIPPED")} className="nk-wf-ghost flex items-center justify-center gap-1.5">
                  <SkipForward className="w-4 h-4" /> تخطي
                </button>
                <button onClick={() => mark("SKIPPED")} className="nk-wf-ghost flex items-center justify-center gap-1.5 text-rose-600 dark:text-rose-300">
                  <X className="w-4 h-4" /> مش هيوصل
                </button>
              </div>
              <p className="text-[10.5px] font-bold text-muted-foreground text-center">
                كل ضغطة «فتح واتساب» بتفتح المحادثة والرسالة جاهزة — الإرسال النهائي بإيدك جوه واتساب.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
    </Portal>
  );
}

void Send;
void Loader2;
