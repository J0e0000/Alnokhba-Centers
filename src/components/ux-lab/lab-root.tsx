"use client";
/* جذر المختبر — غلاف معزول + قياس نقرات فعلي بـ capture listener + تنقل بين البدائل.
   القياس: أي لمسة على عنصر تفاعلي داخل نطاق البديل النشط بتتحسب (clicks) —
   وانتقالات الشاشات بتتحسب من عمليات التنقل نفسها في المخزن. */

import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LabProvider, useLab } from "./store";
import { OPTION_META, OptionId } from "./types";
import { SCENARIO, STUDENTS } from "./scenario";
import Compare from "./compare";
import ChoiceCard from "./choice";
import OptionQuick from "./option-quick";
import OptionQuickPlus from "./option-quick-plus";
import OptionGuided from "./option-guided";
import OptionCockpit from "./option-cockpit";
import { FlaskConical, ShieldCheck, Scale, Zap, QrCode, ListChecks, Gauge, Home as HomeIcon, RotateCcw, WifiOff, MousePointerClick, Route, Timer, BookOpenCheck, Trash2, BadgeCheck } from "lucide-react";

/* قرار المالك المسجّل من الجولة السابقة (15/10/2026 · 6:57 ص) — نسخة السريعة+ مبنيّة عليه حرفيًا.
   القرار قابل للتراجع في أي وقت من تبويب «اختياري» — ومش بيتطبق على الإنتاج غير بموافقة صريحة. */
const OWNER_DECISION = {
  at: "15/10/2026 · 6:57 ص",
  option: "السريعة (quick)",
  note: "عجبته جدًا لأنها بسيطة ومباشرة ومفيهاش أسئلة كتير — اللي بيستخدمها مش سوبر يوزر",
  asks: ["إضافة QR للحصة — يبقى بضغطة واحدة", "تبسيط الإشعارات الذكية لاتنيني: حاضر أو غايب بس"],
};

const OPTION_ICONS: Record<OptionId, React.ReactNode> = {
  quick: <Zap className="w-5 h-5" />,
  quickplus: <QrCode className="w-5 h-5" />,
  guided: <ListChecks className="w-5 h-5" />,
  cockpit: <Gauge className="w-5 h-5" />,
};

function elapsedText(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function LabInner() {
  const lab = useLab();
  const [, tick] = useState(0);
  const active = lab.active;

  /* نبض لتحديث عداد الوقت */
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* قياس النقرات: أي عنصر تفاعلي داخل نطاق البديل النشط */
  function trackClicks(e: React.PointerEvent) {
    if (active === "home" || active === "compare" || active === "choice") return;
    const el = e.target as HTMLElement | null;
    if (!el) return;
    const scope = el.closest("[data-lab-scope]");
    if (!scope) return;
    const interactive = el.closest('button, a, input, textarea, select, [role="button"], [role="tab"], [role="radio"], [role="option"]');
    if (!interactive) return;
    const id = active as OptionId;
    lab.bumpClicks(id);
  }

  const optMetrics = active === "quick" || active === "quickplus" || active === "guided" || active === "cockpit" ? lab.metrics(active) : null;

  const tabs: { key: typeof active; label: string; icon: React.ReactNode }[] = [
    { key: "home", label: "المختبر", icon: <HomeIcon className="w-4 h-4" /> },
    { key: "quickplus", label: "السريعة+", icon: <QrCode className="w-4 h-4" /> },
    { key: "quick", label: "السريعة", icon: <Zap className="w-4 h-4" /> },
    { key: "guided", label: "المُوجَّهة", icon: <ListChecks className="w-4 h-4" /> },
    { key: "cockpit", label: "القمرة", icon: <Gauge className="w-4 h-4" /> },
    { key: "compare", label: "المقارنة", icon: <Scale className="w-4 h-4" /> },
    { key: "choice", label: "اختياري", icon: <BookOpenCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground" onPointerDownCapture={trackClicks}>
      {/* لافتة العزلة */}
      <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 px-4 py-2 text-center text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center justify-center gap-1.5 flex-wrap">
        <ShieldCheck className="w-3.5 h-3.5" />
        مختبر معزول 100% — بيانات اصطناعية ({STUDENTS.length} طلاب وهميين) · صفر اتصال بالسيرفر · صفر كتابة على الإنتاج
        <span dir="ltr" className="opacity-60">/ux-lab</span>
      </div>

      {/* رأس المختبر */}
      <header className="sticky top-0 z-20 nk-glass-bar border-b border-border">
        <div className="max-w-5xl mx-auto px-3 py-2.5 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 font-extrabold shrink-0">
            <span className="w-8 h-8 rounded-xl nk-brand-grad grid place-items-center text-white"><FlaskConical className="w-4 h-4" /></span>
            <span className="hidden sm:block">مختبر تدفّق الحصة</span>
          </div>

          <nav className="flex items-center gap-1 overflow-x-auto min-w-0" aria-label="تبويب المختبر">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-current={active === t.key}
                onClick={() => lab.setActive(t.key)}
                className={cn(
                  "h-9 px-3 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 flex items-center gap-1.5",
                  active === t.key ? "nk-brand-grad text-white shadow-sm" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                {t.icon}
                {t.label}
                {t.key !== "home" && t.key !== "compare" && t.key !== "choice" && lab.choice.option === t.key && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="اختيارك الحالي" />
                )}
              </button>
            ))}
          </nav>

          {/* عدادات حية */}
          {optMetrics && (
            <div className="ms-auto flex items-center gap-1.5 shrink-0" aria-live="polite">
              <span className="nk-badge n" title="عدد النقرات الفعلي على عناصر البديل"><MousePointerClick className="w-3 h-3" /> <b className="nk-num" dir="ltr">{optMetrics.clicks}</b></span>
              <span className="nk-badge n hidden sm:inline-flex" title="انتقالات الشاشات/المراحل"><Route className="w-3 h-3" /> <b className="nk-num" dir="ltr">{optMetrics.transitions}</b></span>
              <span className="nk-badge n hidden sm:inline-flex" title="زمن تفاعلك داخل البديل"><Timer className="w-3 h-3" /> <b className="nk-num" dir="ltr">{elapsedText(optMetrics.startedAt ? ((optMetrics.finishedAt ?? Date.now()) - optMetrics.startedAt) : 0)}</b></span>
              <button
                type="button"
                onClick={() => lab.setOffline(!lab.offline)}
                aria-pressed={lab.offline}
                title="محاكاة انقطاع الشبكة — الحفظ يتحول لطابور والقفل يُرفض"
                className={cn(
                  "h-8 px-2.5 rounded-xl border text-[11px] font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  lab.offline ? "bg-amber-500 text-white border-amber-500" : "bg-card text-muted-foreground border-border hover:bg-muted/60",
                )}
              >
                <WifiOff className="w-3.5 h-3.5 inline" /> شبكة {lab.offline ? "مقطوعة" : "شغالة"}
              </button>
              <button
                type="button"
                onClick={() => { lab.resetFlow(active as OptionId); }}
                title="إعادة تعيين هذا البديل (حالة + عدادات)"
                className="h-8 w-8 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground grid place-items-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* المحتوى */}
      <main className="max-w-5xl mx-auto px-3 py-4 pb-16">
        {active === "home" && <Home />}
        {active === "quickplus" && <OptionQuickPlus />}
        {active === "quick" && <OptionQuick />}
        {active === "guided" && <OptionGuided />}
        {active === "cockpit" && <OptionCockpit />}
        {active === "compare" && <Compare />}
        {active === "choice" && <ChoiceCard />}
      </main>
    </div>
  );
}

/* شاشة المختبر الرئيسية */
function Home() {
  const lab = useLab();
  const cards: { id: OptionId; body: string; best: string }[] = [
    { id: "quickplus", body: "السريعة الأصلية زي ما هي بالظبط — مضافة عليها طلباك: زرار QR واحد بيفتح كود بيتجدد كل 10 ثواني، وإشعار أولياء أمور بقانون واحد: حاضر أو غايب. مفيش أي سؤال زيادة.", best: "قرارك المختار — الاستقبال والمدرس المشغول" },
    { id: "quick", body: "افتراض «الكل حاضر» بضغطة، وتصلّح الاستثناءات بس، وتقفل من نفس الشاشة. مصممة لأقل نقرات ممكنة.", best: "الاستقبال والمدرس المشغول" },
    { id: "guided", body: "3 مراحل واضحة (حضور ← ملاحظات ← مراجعة) بإتمام صريح لكل مرحلة، والقفل مش بيحصل غير لما الحضور يتسجل.", best: "الانضباط والتوثيق التربوي" },
    { id: "cockpit", body: "شاشة حية واحدة: القائمة + العدادات + القفل قدامك في نفس اللحظة — صفر انتقالات، والتفاصيل تحت كتمة.", best: "الإشراف اللحظي واتخاذ القرار" },
  ];

  return (
    <div className="nk-anim-in">
      <div className="nk-card rounded-3xl p-6 mb-3 nk-brand-grad nk-portal-card text-white border-transparent">
        <h1 className="text-2xl font-extrabold flex items-center gap-2"><FlaskConical className="w-6 h-6" /> مختبر تدفّق الحصة — النخبة</h1>
        <p className="text-sm mt-2 opacity-90 leading-relaxed">
          نفس الحصة الاصطناعية ({SCENARIO.groupName} · {SCENARIO.teacherName} · {SCENARIO.room} · {SCENARIO.time}) شغالة في
          <b> 4 تصاميم تشغيلية</b>: 3 مدارس مختلفة + «السريعة+» المبنية على قرارك المسجّل. جرّب كل بديل من أول فتح الحصة
          لحد القفل والخلاصة، شوف عدادات نقراتك الحية، قارن الأرقام المُقاسة، وسجّل اختيارك بتعليق — القرار مش بيتطبق
          على الإنتاج غير لما توافق بنفسك بعدين.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className="nk-badge" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }}>❌ مفيش صور ثابتة — كله تفاعلي فعلي</span>
          <span className="nk-badge" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }}>❌ مفيش أي كتابة على بيانات حقيقية</span>
          <span className="nk-badge" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }}>✓ قياس نقرات فعلي من الـ DOM</span>
          <span className="nk-badge" style={{ background: "rgba(255,255,255,.18)", color: "#fff" }}>✓ RTL + موبايل + داكن</span>
        </div>
      </div>

      {/* شريط قرار المالك المسجّل — مصدر بناء السريعة+ */}
      <div className="nk-card rounded-3xl p-4 mb-3 border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-2xl bg-emerald-600 grid place-items-center text-white shrink-0"><BadgeCheck className="w-5 h-5" /></span>
          <div className="min-w-0">
            <h3 className="font-extrabold text-sm flex items-center gap-2 flex-wrap">
              قرارك المسجّل: {OWNER_DECISION.option}
              <span className="text-[11px] font-bold text-muted-foreground">({OWNER_DECISION.at})</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{OWNER_DECISION.note}</p>
            <ul className="mt-2 space-y-1">
              {OWNER_DECISION.asks.map((a) => (
                <li key={a} className="text-xs font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />{a} — <span className="text-emerald-700 dark:text-emerald-300">تنفيذت في «السريعة+» تحت ✓</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-2">
              جرّبها ولو عجبتك بنطبّقها على المنتج الحقيقي بعد موافقتك الصريحة بس — والقرار ده قابل للتراجع في أي وقت.
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.id} className={c.id === "quickplus" ? "nk-card rounded-3xl p-4 flex flex-col ring-2 ring-emerald-500/40" : "nk-card rounded-3xl p-4 flex flex-col"}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-10 h-10 rounded-2xl nk-brand-grad grid place-items-center text-white shrink-0">{OPTION_ICONS[c.id]}</span>
              <div>
                <h3 className="font-extrabold">{OPTION_META[c.id].name}</h3>
                <p className="text-[11px] text-muted-foreground">{OPTION_META[c.id].pitch}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{c.body}</p>
            <p className="text-xs font-bold mt-2"><span className="text-muted-foreground">الأنسب لـ:</span> {c.best}</p>
            {lab.choice.option === c.id && <Badge className="mt-2 bg-emerald-600 w-fit">اختيارك المسجّل</Badge>}
            <Button className="mt-3 h-11 rounded-2xl nk-btn-brand" onClick={() => lab.setActive(c.id)}>
              جرّب {OPTION_META[c.id].name}
            </Button>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Button variant="outline" size="lg" className="h-14 rounded-3xl justify-start px-5" onClick={() => lab.setActive("compare")}>
          <Scale className="w-5 h-5 text-primary" /> <span className="text-start"><b>جدول المقارنة المُقاسة</b><br /><span className="text-xs font-normal text-muted-foreground">نقرات، انتقالات، قرارات، مخاطر — بالأرقام</span></span>
        </Button>
        <Button variant="outline" size="lg" className="h-14 rounded-3xl justify-start px-5" onClick={() => lab.setActive("choice")}>
          <BookOpenCheck className="w-5 h-5 text-emerald-600" /> <span className="text-start"><b>سجّل اختيارك + تعليقك</b><br /><span className="text-xs font-normal text-muted-foreground">محليًا وقابل للتراجع — بدون تطبيق تلقائي</span></span>
        </Button>
      </div>

      <div className="nk-card rounded-3xl p-4 mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          كل بديل حالته مستقلة تمامًا — التنقل بينهم مش بيكسر أي حاجة، والعدادات بتتصفّر بإعادة التعيين.
        </p>
        <Button variant="ghost" size="sm" className="rounded-xl text-destructive hover:text-destructive" onClick={() => { lab.resetAll(); }}>
          <Trash2 className="w-3.5 h-3.5" /> إعادة تعيين المختبر كله
        </Button>
      </div>
    </div>
  );
}

export default function UxLab() {
  return (
    <LabProvider>
      <LabInner />
    </LabProvider>
  );
}
