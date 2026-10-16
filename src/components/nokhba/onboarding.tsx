"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UserPlus, Users, CalendarDays, ScanLine, Wallet, MessageCircle,
  CheckCircle2, Circle, Play, RotateCcw, Gamepad2, PartyPopper, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, type SessionUser } from "./lib";
import type { ViewId } from "./shell";
import { Progress } from "@/components/ui/progress";

/* ============================================================
   رحلة البداية (Onboarding Quest) — «كأنك في لعبة»
   ------------------------------------------------------------
   • بتظهر للسنتر الجديد (البيانات الفعلية هي اللي بتحدد التقدم — مفيش شياكة زبالة).
   • كل مهمة ليها زرار يوصّلك لمكان التنفيذ على طول — الخطوة الجاية بس هي ليها CTA.
   • تخطي بيخفي الكارت ويسيب بيل صغير ترجع بيه في أي وقت (بيتخزن لكل مستخدم).
   • لما تخلّص كل المهام وأنت مركز → احتفال مرة واحدة (👑 أسطورة النخبة).
   • السنترات القديمة (كل المهام خلصت من قبل) مبتتشافش خالص — صفر إزعاج.
============================================================ */

type QuestStep = {
  id: string;
  title: string;
  desc: string;
  view: ViewId;
  icon: string;
  done: boolean;
};

type QuestData = {
  enabled: boolean;
  skipped: boolean;
  progress: number;
  total: number;
  allDone: boolean;
  level: { label: string; emoji: string };
  steps: QuestStep[];
};

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  UserPlus, Users, CalendarDays, ScanLine, Wallet, MessageCircle,
};

const CHEER: Record<string, string> = {
  "0": "أول خطوة بتفضل في الذاكرة — يلا نبدأ!",
  "1": "بداية قوية 💪 كمّل الباقي",
  "2": "السنتر بقى له هيكل — نص الطريق!",
  "3": "🔥 نص الطريق خلص — الاستمرار هو السر",
  "4": "قربت خلاص — خطوتين بس!",
  "5": "مهمة واحدة بس ونكمل الاحتفال 🎉",
};

export function OnboardingQuest({ user, setView }: {
  user: SessionUser;
  setView: (v: ViewId) => void;
}) {
  const [data, setData] = useState<QuestData | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const doneKey = `nk-quest-done-${user.id}`;

  const load = useCallback(async () => {
    try {
      const d = await api<QuestData>("/api/onboarding", { silent: true });
      // احتفال مرة واحدة بالظبط: العلم بيتخزن محليًا — «0» = كان في نص الطريق،
      // فلو خلّص وأنت بعيد (أي شاشة) ورجعت للرئيسية → الاحتفال بيستنى وأنت راجع.
      // السنترات القديمة (أول تحميل وهم خلصين) مبتشوفش احتفال — صفر إزعاج.
      try {
        const seen = localStorage.getItem(doneKey);
        if (d.allDone) {
          if (seen === "0") {
            setCelebrate(true);
            toast.success("👑 أسطورة النخبة! خلصت كل مهام البداية — سنترك بقى شغال بالكامل");
          }
          if (seen !== "1") localStorage.setItem(doneKey, "1");
        } else {
          localStorage.setItem(doneKey, "0");
        }
      } catch { /* localStorage ممنوع — نعيش من غير احتفال */ }
      setData(d);
    } catch {
      // صامت — الكارت ده تحسين مش أساس
    }
  }, [doneKey]);

  useEffect(() => {
    if (user.role === "TEACHER") return;
    void load();
    const onChange = () => void load();
    window.addEventListener("nk-sessions-changed", onChange);
    window.addEventListener("nk-data-changed", onChange);
    return () => {
      window.removeEventListener("nk-sessions-changed", onChange);
      window.removeEventListener("nk-data-changed", onChange);
    };
  }, [user.role, load]);

  async function act(action: "skip" | "restore") {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/onboarding", { method: "POST", body: { action } });
      if (action === "skip") toast("تمام! خبيّنا القائمة — تلاقيها تحت في أي وقت لو حبيت ترجع لها 🎮");
      else toast.success("ربنا معاك — يلا نكمل الرحلة! ⚡");
      await load();
    } catch {
      toast.error("حصلت مشكلة — حاول تاني");
    } finally {
      setBusy(false);
    }
  }

  if (user.role === "TEACHER") return null;
  if (!data || !data.enabled || data.total === 0) return null;

  // كل المهام خلصت من قبل (سنتر قديم) → صفر إزعاج — مفيش كارت خالص
  const finishedBefore = data.allDone && !celebrate;

  if (data.skipped && !data.allDone) {
    // بيل صغير للرجوع — مش بيتخفي خالص عشان يلاقيه المستخدم
    return (
      <div className="nk-card rounded-2xl px-4 py-2.5 flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-muted-foreground flex items-center gap-2">
          <Gamepad2 className="w-4 h-4 shrink-0" aria-hidden />
          رحلة البداية مخفية — {data.progress}/{data.total} مهام خلصت
        </span>
        <button
          onClick={() => void act("restore")}
          disabled={busy}
          className="text-xs font-extrabold nk-brand-text inline-flex items-center gap-1.5 hover:underline underline-offset-4 disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
          رجّعها
        </button>
      </div>
    );
  }

  if (finishedBefore) return null;

  // ===== احتفال الإتمام (مرة واحدة في الجلسة أول ما تخلص) =====
  if (data.allDone && celebrate) {
    return (
      <div className="nk-card rounded-2xl p-5 text-center relative overflow-hidden nk-anim-stagger" role="status">
        <PartyPopper className="w-10 h-10 mx-auto nk-brand-text" aria-hidden />
        <h2 className="text-lg font-black mt-2 mb-1">أسطورة النخبة 👑</h2>
        <p className="text-xs font-bold text-muted-foreground m-0">
          خلصت الـ{data.total} مهام كلها — عندك دلوقتي طلاب ومجموعات وحصص وحضور وتحصيل ومتابعة.
          <br />النظام كله قدامك دلوقتي — ولو احتجت مساعدة، زكي جنبك في أي وقت.
        </p>
        <button
          onClick={() => setCelebrate(false)}
          className="mt-3 text-[11px] font-bold text-muted-foreground hover:underline underline-offset-4"
          aria-label="إغلاق الاحتفال"
        >
          يلا نبدأ الشغل الحقيقي ←
        </button>
      </div>
    );
  }

  const nextIdx = data.steps.findIndex((s) => !s.done);
  const pct = data.total ? Math.round((data.progress / data.total) * 100) : 0;
  const cheer = CHEER[String(data.progress)] ?? CHEER["0"];

  return (
    <section className="nk-card rounded-2xl p-4 sm:p-5 nk-anim-stagger" aria-label="رحلة البداية">
      {/* ===== الهيدر ===== */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-2xl nk-brand-bg text-white grid place-items-center shrink-0 shadow" aria-hidden>
            <Gamepad2 className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black m-0 leading-tight">رحلة البداية في النخبة</h2>
            <p className="text-[11px] font-bold text-muted-foreground m-0">
              كمّل المهام وسنترك هيشتغل لوحده — زي اللعبة، مهمة ورا مهمة
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[11px] font-black rounded-full px-2.5 py-1 bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
            title="مستواك الحالي"
          >
            {data.level.emoji} {data.level.label}
          </span>
          <button
            onClick={() => void act("skip")}
            disabled={busy}
            className="w-7 h-7 rounded-full grid place-items-center text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground transition disabled:opacity-50"
            aria-label="تخطي رحلة البداية — تقدر ترجع لها في أي وقت"
            title="تخطي — تقدر ترجّعها في أي وقت"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ===== شريط التقدم ===== */}
      <div className="mt-3.5 flex items-center gap-3">
        <Progress value={pct} className="h-2.5 flex-1" aria-label={`تقدم ${pct} بالمئة`} />
        <span className="text-[11px] font-black nk-num shrink-0" dir="ltr">
          {data.progress}/{data.total}
        </span>
      </div>
      <p className="text-[11px] font-bold text-muted-foreground mt-1.5 m-0">{cheer}</p>

      {/* ===== الخطوات ===== */}
      <ol className="mt-3 grid gap-1.5" role="list">
        {data.steps.map((s, i) => {
          const Icon = STEP_ICONS[s.icon] ?? Circle;
          const isNext = i === nextIdx;
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 transition",
                s.done && "opacity-55",
                isNext && "bg-muted/60 border border-dashed border-amber-300/70 dark:border-amber-700/60",
              )}
            >
              {s.done ? (
                <CheckCircle2 className="w-5.5 h-5.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="خلصت" />
              ) : (
                <span
                  className={cn(
                    "w-5.5 h-5.5 rounded-full grid place-items-center shrink-0 text-[10px] font-black",
                    isNext
                      ? "nk-brand-bg text-white shadow ring-4 ring-amber-200/60 dark:ring-amber-800/40"
                      : "border-2 border-muted-foreground/30 text-muted-foreground/60",
                  )}
                  aria-hidden
                >
                  {i + 1}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13px] font-extrabold leading-tight", s.done && "line-through decoration-1")}>
                  {s.title}
                </span>
                <span className="block text-[11px] font-bold text-muted-foreground leading-snug truncate">{s.desc}</span>
              </span>

              {isNext ? (
                <button
                  onClick={() => setView(s.view)}
                  className="shrink-0 rounded-xl nk-brand-bg text-white px-3.5 py-2 text-[12px] font-extrabold shadow active:scale-[0.97] transition inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden />
                  يلا بينا
                </button>
              ) : (
                <Icon className={cn("w-4.5 h-4.5 shrink-0", s.done ? "text-emerald-600/70 dark:text-emerald-400/70" : "text-muted-foreground/40")} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-[10.5px] font-bold text-muted-foreground/80 mt-2.5 m-0 flex items-center justify-between gap-2">
        <span>التقدم بيتحدث لوحده أول ما تنجز كل خطوة في أي شاشة</span>
        <span className="inline-flex items-center gap-1 shrink-0">
          <Gamepad2 className="w-3 h-3" aria-hidden />
          مستوى {data.level.emoji} {data.level.label}
        </span>
      </p>
    </section>
  );
}
