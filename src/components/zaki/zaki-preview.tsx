"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { robotHeadShapes, robotHeadStates } from "robot-heads";
import { Sparkles, Pause, Play, MousePointerClick, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZakiRobot, ZAKI_BRAND_VARIANTS, type ZakiBrandVariant } from "./zaki-robot";
import { ZAKI_STATE_AR, type ZakiRobotState } from "./zaki-status";

/* ============================================================
   Zaki Visual Prototype — Demo Only
   بيئة اختبار الهوية البصرية لشخصية زكي:
   مفيش بيانات حقيقية، مفيش أي اتصال سيرفر، وكل الردود تجريبية ومكتوب عليها.
   الحالات اللي الإنتاج بيستخدمها فعليًا معلّمة — والباقي للمعاينة بس.
============================================================ */

/** الحالات المستخدمة فعلًا في إنتاج التطبيق (عبر mapZakiRobotState) */
const PRODUCTION_STATES = new Set<string>(["idle", "thinking", "listening", "speaking", "working", "happy", "error"]);

const SHAPE_AR: Record<string, string> = {
  square: "مربع",
  rectangle: "مستطيل",
  circle: "دائرة",
  hexagon: "سداسي",
};

const VARIANT_AR: Record<ZakiBrandVariant, string> = {
  navy: "كحلي — الأساس",
  blue: "أزرق — الحركة",
  teal: "تركواز — الإبراز",
};

type DemoPhase = "idle" | "busy";

export function ZakiPreview() {
  // ===== Section B/C: أداة المعاينة =====
  const [state, setState] = useState<ZakiRobotState>("idle");
  const [shape, setShape] = useState<(typeof robotHeadShapes)[number]>("square");
  const [variant, setVariant] = useState<ZakiBrandVariant>("navy");
  const [size, setSize] = useState(160);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [interactive, setInteractive] = useState(true);
  const [antenna, setAntenna] = useState(true);
  const [floorShadow, setFloorShadow] = useState(true);

  /* تقليل الحركة — external store حقيقي (useSyncExternalStore): بيتحدث لايف لو المستخدم غيّر إعداد النظام */
  const reducedMotion = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  // ===== Section D: الديمو — سيناريوهات مجدولة (بيانات تجريبية 100%) =====
  const [demoChat, setDemoChat] = useState<{ who: "user" | "zaki"; text: string }[]>([]);
  const [demoBusy, setDemoBusy] = useState<DemoPhase>("idle");
  const [demoState, setDemoState] = useState<ZakiRobotState>("idle");
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const runScenario = useCallback(
    (kind: "success" | "failure" | "voice") => {
      clearTimers();
      setDemoBusy("busy");
      const at = (ms: number, fn: () => void) => timersRef.current.push(window.setTimeout(fn, ms));

      if (kind === "voice") {
        setDemoChat([{ who: "user", text: "🎙️ (تجريبي) مين غايب النهارده؟" }]);
        at(300, () => setDemoState("listening"));
        at(1400, () => { setDemoState("thinking"); setDemoChat((c) => [...c, { who: "zaki", text: "بحوّل صوتك لنص… (بيانات تجريبية)" }]); });
        at(2600, () => setDemoState("working"));
        at(3800, () => setDemoState("speaking"));
        at(3800, () => setDemoChat((c) => [...c, { who: "zaki", text: "النهارده غايب اتنين — طالب تجريبي أ وطالب تجريبي ب. (رد تجريبي)" }]));
        at(5600, () => { setDemoState("happy"); setDemoBusy("idle"); });
        at(8000, () => setDemoState("idle"));
        return;
      }
      if (kind === "failure") {
        setDemoChat([{ who: "user", text: "(تجريبي) اعمل عملية مش مسموحة" }]);
        at(300, () => setDemoState("thinking"));
        at(1500, () => setDemoState("working"));
        at(3000, () => setDemoState("error"));
        at(3000, () => setDemoChat((c) => [...c, { who: "zaki", text: "العملية دي محتاجة صلاحية أعلى — راجع المدير. (رد تجريبي)" }]));
        at(5800, () => { setDemoState("idle"); setDemoBusy("idle"); });
        return;
      }
      setDemoChat([{ who: "user", text: "(تجريبي) هاتلي تقرير الطالب التجريبي" }]);
      at(300, () => setDemoState("thinking"));
      at(1500, () => setDemoState("working"));
      at(3200, () => setDemoState("speaking"));
      at(3200, () => setDemoChat((c) => [...c, { who: "zaki", text: "تقرير تجريبي: حضور 92% — مفيش مستحقات متأخرة. (رد تجريبي)" }]));
      at(5000, () => { setDemoState("happy"); setDemoBusy("idle"); });
      at(7400, () => setDemoState("idle"));
    },
    [clearTimers],
  );

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* ==== الترويسة — تعريف واضح إن دي معاينة ==== */}
        <header className="rounded-3xl border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-full bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300 px-3 py-1 text-[11px] font-black inline-flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5" /> Zaki Visual Prototype — Demo Only
            </span>
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-extrabold text-muted-foreground">عرض بصري تجريبي — للتجربة فقط</span>
          </div>
          <h1 className="text-xl font-black">زكي — شخصية المساعد الذكي في النخبة</h1>
          <p className="text-xs font-bold text-muted-foreground leading-relaxed">
            الصفحة دي بيئة اختبار الهوية البصرية بس: مفيش اتصال بأي سيرفر، مفيش بيانات حقيقية، وكل الردود في الديمو تجريبية ومكتوب عليها.
            زكي الحقيقي بيعيش جوه التطبيق مع الوكيل الفعلي — الحالات هنا هي نفس الحالات المدعومة من مكتبة الرسم.
            {reducedMotion && <b className="text-amber-600 dark:text-amber-400"> (وضع تقليل الحركة مفعّل عندك — الروبوت بيرسم وضعية ثابتة)</b>}
          </p>
        </header>

        {/* ==== A. المعاينة الرئيسية ==== */}
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="rounded-3xl nk-brand-grad p-8 grid place-items-center overflow-visible">
            <ZakiRobot
              state={state}
              size={size}
              shape={shape}
              variant={variant}
              speed={speed}
              paused={paused}
              interactive={interactive}
              antenna={antenna}
              floorShadow={floorShadow}
              ariaLabel={`معاينة زكي — ${ZAKI_STATE_AR[state]}`}
            />
          </div>
          <p className="text-center text-sm font-black mt-4">
            الحالة: <span className="nk-num">{state}</span> — {ZAKI_STATE_AR[state]}
          </p>
        </section>

        {/* ==== B. مبدّل الحالات ==== */}
        <section className="rounded-3xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-black text-sm">مبدّل الحالات — كل الحالات المدعومة من المكتبة</h2>
          <p className="text-[11px] font-bold text-muted-foreground leading-relaxed">
            الإنتاج بيستخدم حالات مبنية على أحداث حقيقية من الوكيل فقط. الحالات المعلّمة «معاينة فقط» مش بتظهر في التطبيق لأن مفيش حدث حقيقي بيولّدها — دي للتجربة البصرية بس.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {robotHeadStates.map((s) => {
              const inProd = PRODUCTION_STATES.has(s);
              return (
                <button
                  key={s}
                  onClick={() => setState(s as ZakiRobotState)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition active:scale-[0.97] inline-flex items-center gap-1.5",
                    state === s ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", inProd ? "bg-emerald-500" : "bg-zinc-400")} aria-hidden="true" />
                  <span className="nk-num">{s}</span> — {ZAKI_STATE_AR[s]}
                  {!inProd && <span className="text-[9px] font-black opacity-70">(معاينة فقط)</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ==== C. أدوات الشكل والهوية ==== */}
        <section className="rounded-3xl border border-border bg-card p-5 space-y-4">
          <h2 className="font-black text-sm">الشكل والألوان والحركة</h2>

          <div className="space-y-1.5">
            <p className="text-[11px] font-black text-muted-foreground">الشكل — المربع هو الاعتماد الرسمي لزكي</p>
            <div className="flex flex-wrap gap-1.5">
              {robotHeadShapes.map((sh) => (
                <button
                  key={sh}
                  onClick={() => setShape(sh)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition",
                    shape === sh ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {SHAPE_AR[sh] ?? sh} <span className="nk-num opacity-70">({sh})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-black text-muted-foreground">نسخة الألوان — من البراند شيت الرسمي</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(ZAKI_BRAND_VARIANTS) as ZakiBrandVariant[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition inline-flex items-center gap-1.5",
                    variant === v ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <span className="w-3 h-3 rounded-full border border-black/10" style={{ background: ZAKI_BRAND_VARIANTS[v].color }} aria-hidden="true" />
                  {VARIANT_AR[v]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-black text-muted-foreground">الحجم: <span className="nk-num">{size}</span>px</span>
              <input type="range" min={48} max={200} step={4} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[var(--c-primary)]" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-black text-muted-foreground">السرعة: <span className="nk-num">{speed}×</span></span>
              <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full accent-[var(--c-primary)]" />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { on: paused, set: () => setPaused((v) => !v), onIcon: <Play className="w-3.5 h-3.5" />, offIcon: <Pause className="w-3.5 h-3.5" />, label: paused ? "متجمّد (وضعية ثابتة)" : "متحرك" },
                { on: interactive, set: () => setInteractive((v) => !v), onIcon: <MousePointerClick className="w-3.5 h-3.5" />, offIcon: <MousePointerClick className="w-3.5 h-3.5" />, label: interactive ? "تفاعل مع المؤشر: مفعّل" : "تفاعل مع المؤشر: مقفول" },
                { on: antenna, set: () => setAntenna((v) => !v), onIcon: <Sparkles className="w-3.5 h-3.5" />, offIcon: <Sparkles className="w-3.5 h-3.5" />, label: antenna ? "الهوائي: ظاهر" : "الهوائي: مخفي" },
                { on: floorShadow, set: () => setFloorShadow((v) => !v), onIcon: <span className="nk-num">◉</span>, offIcon: <span className="nk-num">◎</span>, label: floorShadow ? "ظل الأرضية: ظاهر" : "ظل الأرضية: مخفي" },
              ] as const
            ).map((t, i) => (
              <button
                key={i}
                onClick={t.set}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition inline-flex items-center gap-1.5",
                  t.on ? "nk-brand-bg text-white border-transparent" : "bg-card border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {t.on ? t.onIcon : t.offIcon} {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* ==== D. محاكاة تفاعل الوكيل — بيانات تجريبية ==== */}
        <section className="rounded-3xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-black text-sm">محاكاة تفاعل الوكيل — إحساس الإنتاج</h2>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-black text-muted-foreground">بيانات تجريبية — مش متصل بأي سيرفر</span>
          </div>
          <p className="text-[11px] font-bold text-muted-foreground leading-relaxed">
            السيناريوهات دي بتشغّل نفس طبقة التحويل الحقيقية (أحداث متسلسلة: تفكير ← تنفيذ ← كلام ← نجاح/فشل) عشان تحس بإيقاع زكي جوه التطبيق — من غير أي عملية حقيقية.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => runScenario("success")} disabled={demoBusy === "busy"} className="rounded-full nk-brand-bg text-white px-3.5 py-1.5 text-[11px] font-extrabold disabled:opacity-50 active:scale-[0.97] transition">
              سيناريو: طلب ناجح
            </button>
            <button onClick={() => runScenario("failure")} disabled={demoBusy === "busy"} className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-extrabold text-muted-foreground disabled:opacity-50 active:scale-[0.97] transition">
              سيناريو: فشل وصلاحية ناقصة
            </button>
            <button onClick={() => runScenario("voice")} disabled={demoBusy === "busy"} className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-extrabold text-muted-foreground disabled:opacity-50 active:scale-[0.97] transition">
              سيناريو: أمر صوتي
            </button>
            <button onClick={() => { clearTimers(); setDemoChat([]); setDemoState("idle"); setDemoBusy("idle"); }} className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[11px] font-extrabold text-muted-foreground active:scale-[0.97] transition">
              تصفير
            </button>
          </div>

          <div className="grid sm:grid-cols-[auto_1fr] gap-4 items-start">
            {/* الروبوت بيستجيب لسيناريو الديمو بنفس طبقة التحويل الحقيقية */}
            <div className="mx-auto sm:mx-0 rounded-2xl bg-muted/50 border border-border p-3 grid place-items-center">
              <ZakiRobot state={demoState} size={104} ariaLabel={`ديمو زكي — ${ZAKI_STATE_AR[demoState]}`} />
            </div>

            <div className="rounded-2xl border border-dashed nk-brand-border nk-brand-bg-soft p-3.5 min-h-24 space-y-2">
              {demoChat.length === 0 && (
                <p className="text-[11px] font-bold text-muted-foreground text-center py-4">شغّل سيناريو من فوق — وشوف الروبوت بيستجيب للحدث فعليًا.</p>
              )}
              {demoChat.map((m, i) => (
                <div key={i} className={cn("flex", m.who === "user" ? "justify-start" : "justify-end")}>
                  <span
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-[11px] font-bold leading-relaxed",
                      m.who === "user" ? "bg-card border border-border" : "nk-brand-bg text-white",
                    )}
                  >
                    {m.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[10px] font-extrabold text-muted-foreground text-center">
            حالة الروبوت في الديمو: <span className="nk-num">{demoState}</span> — {ZAKI_STATE_AR[demoState]}
          </p>
        </section>

        <footer className="text-center text-[10px] font-bold text-muted-foreground pb-4">
          robot-heads v0.3.0 (MIT) — رسم 2D canvas بدون WebGL — الحركة بتوقفات لوحدها لما التاب يكون مخفي، ووضع تقليل الحركة بيرسم وضعية ثابتة.
        </footer>
      </div>
    </main>
  );
}
