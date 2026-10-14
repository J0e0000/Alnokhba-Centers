"use client";
/* البديل C — قمرة القيادة
   فلسفة: شاشة تشغيلية حية واحدة — القائمة والملخص والقفل كلهم قدامك في نفس اللحظة،
   صفر انتقالات، والتفاصيل تحت كتمة (progressive disclosure). */

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLab } from "./store";
import { STUDENTS } from "./scenario";
import { attendanceSummary, AttButtons, CloseConfirm, MiniStat, SaveChip, StudentRow, WeaknessInput, WeaknessList } from "./ui-bits";
import { Gauge, Lock, Undo2, ScanLine, Users, Radio, ClipboardList, Layers } from "lucide-react";

export default function OptionCockpit() {
  const lab = useLab();
  const st = lab.state("cockpit");
  const sum = attendanceSummary(st);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingWeak, setAddingWeak] = useState<string | null>(null);

  /* ---------- دخول ---------- */
  if (st.phase === "entry") {
    return (
      <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-11 h-11 rounded-2xl nk-brand-grad grid place-items-center text-white shrink-0"><Gauge className="w-5 h-5" /></span>
          <div>
            <h3 className="font-extrabold text-lg">حصص النهاردة</h3>
            <p className="text-sm text-muted-foreground">قمرة قيادة حية: القائمة + الملخص + القفل في شاشة واحدة — مفيش أي تنقل خالص.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-extrabold">فيزياء — ثانوية عامة</div>
            <div className="text-xs text-muted-foreground mt-0.5">أ. كريم منصور · قاعة A · <span dir="ltr" className="nk-num">5:00–6:30</span> م · <span className="nk-num" dir="ltr">12</span> طالب</div>
          </div>
          <Button size="lg" className="h-12 px-6 rounded-2xl nk-btn-brand text-base" onClick={() => lab.openSession("cockpit")}>
            <Layers className="w-5 h-5" /> افتح القمرة
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- الخلاصة ---------- */
  if (st.phase === "summary") {
    return (
      <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
        <div className="text-center mb-4">
          <span className="inline-grid place-items-center w-14 h-14 rounded-full bg-emerald-600 text-white mb-2"><Users className="w-7 h-7" /></span>
          <h3 className="text-xl font-extrabold">الحصة اتقفلت من القمرة ✓</h3>
          <p className="text-sm text-muted-foreground mt-1">كل حاجة كانت قدامك — والأرقام اتثبتت زي ما شفتها.</p>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <MiniStat label="حاضر" value={sum.present} tone="ok" />
          <MiniStat label="متأخر" value={sum.late} tone="warn" />
          <MiniStat label="غايب" value={sum.absent} />
          <MiniStat label="تحصيل" value={sum.collectedText} tone="info" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" className="flex-1 h-11 rounded-2xl" onClick={() => lab.reopenSession("cockpit")}>
            <Undo2 className="w-4 h-4" /> تراجع عن القفل (تعديل)
          </Button>
          <Button className="flex-1 h-11 rounded-2xl nk-btn-brand" onClick={() => lab.backToEntry("cockpit")}>
            <ClipboardList className="w-4 h-4" /> حصص اليوم
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- القمرة ---------- */
  return (
    <div className="nk-anim-in" data-lab-scope>
      {st.loading ? (
        <div className="nk-card rounded-3xl p-8 text-center text-muted-foreground">بترفع القمرة…</div>
      ) : (
        <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-3">
          {/* القائمة */}
          <div>
            <div className="nk-card rounded-3xl p-4 mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-extrabold nk-brand-text">فيزياء — ثانوية عامة <Radio className="inline w-4 h-4 text-emerald-600 animate-pulse" /></div>
                <div className="text-xs text-muted-foreground mt-0.5">أ. كريم منصور · قاعة A · <span dir="ltr" className="nk-num">5:00–6:30</span> م</div>
              </div>
              <SaveChip save={st.save} offline={lab.offline} />
            </div>

            {/* شريط الملخص المضغوط للموبايل */}
            <div className="lg:hidden grid grid-cols-4 gap-1.5 mb-3">
              <MiniStat label="حاضر" value={sum.present} tone="ok" />
              <MiniStat label="متأخر" value={sum.late} tone="warn" />
              <MiniStat label="غايب" value={sum.absent} />
              <MiniStat label="تحصيل" value={sum.collectedText} tone="info" />
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Button variant="outline" className="h-10 rounded-2xl" onClick={() => { lab.markAllPresent("cockpit"); toast.success("الكل حاضر — القمرة بتعكس الاستثناءات فورًا"); }}>
                <Users className="w-4 h-4" /> الكل حاضر
              </Button>
              <Button variant="outline" className="h-10 rounded-2xl" onClick={() => lab.simulateSelfCheckin("cockpit")}>
                <ScanLine className="w-4 h-4" /> تسجيل ذاتي QR
              </Button>
            </div>

            <div className="space-y-1.5">
              {STUDENTS.map((s) => {
                const mark = st.marks[s.id];
                const weak = st.weaknesses[s.id] || [];
                const open = expanded === s.id;
                return (
                  <StudentRow
                    key={s.id}
                    name={s.name}
                    code={s.code}
                    mark={mark}
                    weakCount={weak.length}
                    usualLate={s.usualLate}
                    expanded={open}
                    onToggleExpand={() => setExpanded(open ? null : s.id)}
                    actions={<AttButtons current={mark?.status} size="sm" onPick={(v) => lab.mark("cockpit", s.id, v)} onClear={() => lab.unmark("cockpit", s.id)} />}
                    extra={
                      <div className="space-y-2">
                        {addingWeak === s.id ? (
                          <WeaknessInput onSave={(t) => { lab.addWeakness("cockpit", s.id, t); setAddingWeak(null); }} onCancel={() => setAddingWeak(null)} />
                        ) : (
                          <button type="button" onClick={() => setAddingWeak(s.id)} className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline">+ نقطة ضعف / ملاحظة</button>
                        )}
                        <WeaknessList items={weak} onRemove={(t) => lab.removeWeakness("cockpit", s.id, t)} />
                        {s.lastWeakness && <p className="text-[11px] text-muted-foreground">من حصة سابقة: {s.lastWeakness}</p>}
                      </div>
                    }
                  />
                );
              })}
            </div>
          </div>

          {/* الرِيل الحية — ديسك توب */}
          <aside className="hidden lg:block">
            <div className="sticky top-4 space-y-3">
              <div className="nk-card rounded-3xl p-4">
                <h4 className="font-extrabold mb-3 flex items-center gap-1.5"><Gauge className="w-4 h-4 text-primary" /> الحالة الحية</h4>
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat label="حاضر" value={sum.present} tone="ok" />
                  <MiniStat label="متأخر" value={sum.late} tone="warn" />
                  <MiniStat label="غايب" value={sum.absent} />
                  <MiniStat label="بعذر" value={sum.excused} tone="info" />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <MiniStat label="تحصيل متوقع" value={sum.collectedText} tone="info" />
                  <MiniStat label="ملاحظات ضعف" value={sum.weaknesses} tone={sum.weaknesses ? "warn" : "muted"} />
                </div>
                <div className="mt-3 text-[11px] text-muted-foreground text-center">
                  اتسجل <b className="nk-num" dir="ltr">{sum.marked}</b> / <b className="nk-num" dir="ltr">{sum.total}</b> — أرقام بتتحرك لايف مع كل لمسة
                </div>
              </div>

              {st.selfCheckins.length > 0 && (
                <div className="nk-card rounded-3xl p-4">
                  <h4 className="font-extrabold mb-2 text-sm">آخر تسجيلات ذاتية (QR)</h4>
                  <ul className="space-y-1">
                    {[...st.selfCheckins].reverse().slice(0, 4).map((id) => {
                      const s = STUDENTS.find(x => x.id === id);
                      return <li key={id} className="text-xs font-bold flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{s?.name}</li>;
                    })}
                  </ul>
                </div>
              )}

              <Button size="lg" className="w-full h-14 rounded-2xl nk-btn-brand text-base" onClick={() => setConfirm(true)}>
                <Lock className="w-5 h-5" /> قفل الحصة
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* شريط القفل للموبايل */}
      {!st.loading && (
        <div className="lg:hidden sticky bottom-4 mt-3 z-10">
          <div className="nk-glass-bar rounded-3xl border border-border p-3 flex items-center gap-2 shadow-lg">
            <span className="nk-badge g shrink-0">حاضر <b className="nk-num">{sum.present}</b></span>
            {sum.absent > 0 && <span className="nk-badge r shrink-0">غايب <b className="nk-num">{sum.absent}</b></span>}
            <Button size="lg" className="ms-auto h-12 px-6 rounded-2xl nk-btn-brand shrink-0" onClick={() => setConfirm(true)}>
              <Lock className="w-4 h-4" /> قفل
            </Button>
          </div>
        </div>
      )}

      <CloseConfirm open={confirm} onOpenChange={setConfirm} summary={sum} requireAttendanceDone
            onConfirm={() => { void lab.closeSession("cockpit"); }} />
    </div>
  );
}
