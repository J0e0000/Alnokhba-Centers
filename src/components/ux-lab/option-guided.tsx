"use client";
/* البديل B — الجلسة المُوجَّهة
   فلسفة: 4 مراحل بهوية واضحة، إتمام صريح لكل مرحلة، والقفل مش بيحصل غير لما الحضور يتسجل
   (الحفظ ≠ القفل). الرجوع لأي مرحلة مش بيضيع أي حاجة. */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLab } from "./store";
import { STUDENTS } from "./scenario";
import { attendanceSummary, AttButtons, CloseConfirm, MiniStat, SaveChip, SessionInfoBar, StudentRow, WeaknessInput, WeaknessList } from "./ui-bits";
import { RATING_LABEL, InteractionRating } from "./types";
import { ListChecks, Check, Lock, Undo2, ChevronRight, ScanLine, MessageSquareWarning, ClipboardCheck, Play } from "lucide-react";

const STAGES = [
  { key: "attendance", label: "الحضور", hint: "علّم كل طالب — الغايب هو اللي مش متعلّم" },
  { key: "notes", label: "الملاحظات والنقاط الضعيفة", hint: "اختياري بالكامل — تقدر تتخطاه" },
  { key: "review", label: "المراجعة", hint: "بص على الأرقام قبل القفل" },
] as const;

const RATING_STYLE: Record<InteractionRating, string> = {
  GREAT: "bg-emerald-600 text-white border-emerald-600",
  GOOD: "bg-sky-600 text-white border-sky-600",
  QUIET: "bg-slate-500 text-white border-slate-500",
  DISRUPTIVE: "bg-rose-600 text-white border-rose-600",
};

const WEAK_CHIPS = ["مشكلة في الأساسيات", "تأخر في الواجب", "تركيز ضعيف", "غايب عن التقييم"];

export default function OptionGuided() {
  const lab = useLab();
  const st = lab.state("guided");
  const sum = attendanceSummary(st);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingWeak, setAddingWeak] = useState<string | null>(null);
  const s = st.phase === "live" ? Math.min(st.stage, 2) : 0;

  /* ---------- دخول ---------- */
  if (st.phase === "entry") {
    return (
      <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-11 h-11 rounded-2xl nk-brand-grad grid place-items-center text-white shrink-0"><ListChecks className="w-5 h-5" /></span>
          <div>
            <h3 className="font-extrabold text-lg">حصص النهاردة</h3>
            <p className="text-sm text-muted-foreground">3 مراحل بإرشاد صريح: حضور ← ملاحظات ← مراجعة، وبعدها القفل بشرط الحضور.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-extrabold">فيزياء — ثانوية عامة</div>
            <div className="text-xs text-muted-foreground mt-0.5">أ. كريم منصور · قاعة A · <span dir="ltr" className="nk-num">5:00–6:30</span> م · <span className="nk-num" dir="ltr">12</span> طالب</div>
          </div>
          <Button size="lg" className="h-12 px-6 rounded-2xl nk-btn-brand text-base" onClick={() => lab.openSession("guided")}>
            <Play className="w-5 h-5" /> ابدأ الحصة
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
          <span className="inline-grid place-items-center w-14 h-14 rounded-full bg-emerald-600 text-white mb-2"><ClipboardCheck className="w-7 h-7" /></span>
          <h3 className="text-xl font-extrabold">الحصة اتنهت واتثبتت ✓</h3>
          <p className="text-sm text-muted-foreground mt-1">كل مرحلة اتسجلت بالترتيب — إشعارات الغياب اتظبطت تلقائيًا.</p>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <MiniStat label="حاضر" value={sum.present} tone="ok" />
          <MiniStat label="متأخر" value={sum.late} tone="warn" />
          <MiniStat label="غايب" value={sum.absent} />
          <MiniStat label="تحصيل" value={sum.collectedText} tone="info" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" className="flex-1 h-11 rounded-2xl" onClick={() => lab.reopenSession("guided")}>
            <Undo2 className="w-4 h-4" /> تراجع عن الإنهاء (تعديل)
          </Button>
          <Button className="flex-1 h-11 rounded-2xl nk-btn-brand" onClick={() => lab.backToEntry("guided")}>حصص اليوم</Button>
        </div>
      </div>
    );
  }

  /* ---------- حية ---------- */
  return (
    <div className="nk-anim-in" data-lab-scope>
      {st.loading ? (
        <div className="nk-card rounded-3xl p-8 text-center text-muted-foreground">بنجهّز الحصة…</div>
      ) : (
        <>
          <SessionInfoBar right={<SaveChip save={st.save} offline={lab.offline} />} />

          {/* شرائط المراحل */}
          <div className="mt-3 nk-card rounded-3xl p-3" role="tablist" aria-label="مراحل الحصة">
            <div className="grid grid-cols-3 gap-1.5">
              {STAGES.map((g, i) => {
                const done = st.stageDone[g.key];
                const active = s === i;
                return (
                  <button
                    key={g.key}
                    role="tab"
                    aria-selected={active}
                    type="button"
                    onClick={() => { lab.setStage("guided", i); }}
                    className={cn(
                      "rounded-2xl px-2 py-2.5 text-xs font-extrabold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 border",
                      active ? "nk-brand-grad text-white border-transparent shadow-md" : done ? "border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-border bg-card text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    <span className="flex items-center justify-center gap-1">
                      {done ? <Check className="w-3.5 h-3.5" /> : <span className="nk-num" dir="ltr">{i + 1}</span>}
                      <span className="truncate">{g.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2 text-center">{STAGES[s].hint}</p>
          </div>

          {/* المرحلة 1: الحضور */}
          {s === 0 && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Button variant="outline" className="h-10 rounded-2xl" onClick={() => lab.simulateSelfCheckin("guided")}>
                  <ScanLine className="w-4 h-4" /> محاكاة تسجيل ذاتي QR
                </Button>
                <span className="text-xs text-muted-foreground font-semibold">
                  اتسجل <b className="nk-num" dir="ltr">{sum.marked}</b> من <b className="nk-num" dir="ltr">{sum.total}</b>
                </span>
              </div>
              <div className="space-y-1.5">
                {STUDENTS.map((stu) => {
                  const mark = st.marks[stu.id];
                  const weak = st.weaknesses[stu.id] || [];
                  const open = expanded === stu.id;
                  return (
                    <StudentRow
                      key={stu.id}
                      name={stu.name}
                      code={stu.code}
                      mark={mark}
                      weakCount={weak.length}
                      usualLate={stu.usualLate}
                      expanded={open}
                      onToggleExpand={() => setExpanded(open ? null : stu.id)}
                      actions={<AttButtons current={mark?.status} size="sm" onPick={(v) => lab.mark("guided", stu.id, v)} onClear={() => lab.unmark("guided", stu.id)} />}
                      extra={
                        <div className="space-y-2">
                          {addingWeak === stu.id ? (
                            <WeaknessInput onSave={(t) => { lab.addWeakness("guided", stu.id, t); setAddingWeak(null); }} onCancel={() => setAddingWeak(null)} />
                          ) : (
                            <button type="button" onClick={() => setAddingWeak(stu.id)} className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline">+ نقطة ضعف</button>
                          )}
                          <WeaknessList items={weak} onRemove={(t) => lab.removeWeakness("guided", stu.id, t)} />
                        </div>
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* المرحلة 2: الملاحظات */}
          {s === 1 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-muted-foreground mb-1">تقييم سريع لكل طالب + نقاط ضعف — كله اختياري، وتقدر تتخطى المرحلة كلها.</p>
              {STUDENTS.map((stu) => {
                const r = st.ratings[stu.id];
                const weak = st.weaknesses[stu.id] || [];
                const mark = st.marks[stu.id];
                const open = expanded === stu.id;
                return (
                  <StudentRow
                    key={stu.id}
                    name={stu.name}
                    code={stu.code}
                    mark={mark}
                    weakCount={weak.length}
                    expanded={open}
                    onToggleExpand={() => setExpanded(open ? null : stu.id)}
                    actions={
                      <div className="flex items-center gap-1 shrink-0">
                        {(Object.keys(RATING_LABEL) as InteractionRating[]).map((k) => (
                          <button
                            key={k}
                            type="button"
                            aria-pressed={r === k}
                            title={RATING_LABEL[k]}
                            onClick={() => lab.rate("guided", stu.id, k)}
                            className={cn(
                              "h-8 px-2 rounded-lg border text-[10px] font-extrabold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                              r === k ? RATING_STYLE[k] : "bg-card text-muted-foreground border-border hover:bg-muted/60",
                            )}
                          >
                            {RATING_LABEL[k]}
                          </button>
                        ))}
                      </div>
                    }
                    extra={
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {WEAK_CHIPS.map((c) => (
                            <button key={c} type="button" onClick={() => lab.addWeakness("guided", stu.id, c)}
                              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-bold hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 dark:hover:bg-rose-950/40 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                              + {c}
                            </button>
                          ))}
                          {addingWeak === stu.id ? (
                            <WeaknessInput onSave={(t) => { lab.addWeakness("guided", stu.id, t); setAddingWeak(null); }} onCancel={() => setAddingWeak(null)} />
                          ) : (
                            <button type="button" onClick={() => setAddingWeak(stu.id)} className="text-[11px] font-bold text-rose-600 hover:underline">+ حرة</button>
                          )}
                        </div>
                        <WeaknessList items={weak} onRemove={(t) => lab.removeWeakness("guided", stu.id, t)} />
                      </div>
                    }
                  />
                );
              })}
            </div>
          )}

          {/* المرحلة 3: المراجعة */}
          {s === 2 && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <MiniStat label="حاضر" value={sum.present} tone="ok" />
                <MiniStat label="متأخر" value={sum.late} tone="warn" />
                <MiniStat label="بعذر" value={sum.excused} tone="info" />
                <MiniStat label="غايب" value={sum.absent} />
              </div>
              {sum.absent > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20 p-3 text-sm font-bold text-amber-800 dark:text-amber-300">
                  هتتبعت إشعارات غياب تلقائيًا لأهالي <b className="nk-num" dir="ltr">{sum.absent}</b> طلاب عند القفل.
                </div>
              )}
              {sum.weaknesses === 0 && (
                <div className="rounded-2xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <MessageSquareWarning className="w-4 h-4 shrink-0" />
                  مفيش أي نقطة ضعف مسجلة النهاردة — لو عايز تضيف، ارجع لمرحلة الملاحظات (اختياري).
                </div>
              )}
              <div className="nk-card rounded-3xl p-4">
                <label className="text-sm font-extrabold block mb-2" htmlFor="g-notes">ملاحظات الحصة (بتتحفظ تلقائي)</label>
                <textarea
                  id="g-notes"
                  value={st.notes}
                  onChange={(e) => lab.setNotes("guided", e.target.value)}
                  rows={3}
                  placeholder="مثال: خلصنا الفصل التالت وراجعنا مسائل الأمواج…"
                  className="w-full rounded-2xl border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="تحصيل متوقع" value={sum.collectedText} tone="info" />
                <MiniStat label="ملاحظات ضعف" value={sum.weaknesses} tone={sum.weaknesses ? "warn" : "muted"} />
              </div>
            </div>
          )}

          {/* الفوتر المتحول */}
          <div className="sticky bottom-4 mt-3 z-10">
            <div className="nk-glass-bar rounded-3xl border border-border p-3 flex items-center gap-2 shadow-lg">
              {s > 0 && (
                <Button variant="outline" className="h-12 rounded-2xl shrink-0" onClick={() => { lab.setStage("guided", s - 1); }}>
                  <ChevronRight className="w-4 h-4" /> السابق
                </Button>
              )}
              <div className="min-w-0 flex-1 text-center hidden sm:block">
                <span className="text-xs text-muted-foreground font-bold truncate">
                  مرحلة {STAGES[s].label} — {st.stageDone[STAGES[s].key] ? "مكتملة ✓" : "شغّالة"}
                </span>
              </div>
              {s < 2 ? (
                <Button
                  size="lg"
                  className="ms-auto h-12 px-5 rounded-2xl nk-btn-brand shrink-0"
                  onClick={() => lab.completeStage("guided", STAGES[s].key)}
                >
                  {STAGES[s].key === "notes" ? "إتمام / تخطي" : "إتمام"} المرحلة <ChevronRight className="w-4 h-4 rotate-180" />
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="ms-auto h-12 px-5 rounded-2xl nk-btn-brand shrink-0"
                  onClick={() => setConfirm(true)}
                  disabled={!st.stageDone.attendance}
                  title={!st.stageDone.attendance ? "لازم تُتمم مرحلة الحضور الأول" : undefined}
                >
                  <Lock className="w-4 h-4" /> إنهاء الحصة وتثبيت كل حاجة
                </Button>
              )}
            </div>
          </div>

          <CloseConfirm
            open={confirm}
            onOpenChange={setConfirm}
            summary={sum}
            requireAttendanceDone
            onConfirm={() => { void lab.closeSession("guided"); }}
          />
        </>
      )}
    </div>
  );
}
