"use client";
/* البديل A — الجلسة السريعة
   فلسفة: افتراضات ذكية (الكل حاضر افتراضيًا) → تبقى الاستثناءات بس اللي محتاجة نقرات.
   كل حاجة في شاشة واحدة: حضور + ملاحظات سريعة + قفل من نفس الشاشة. */

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLab } from "./store";
import { STUDENTS } from "./scenario";
import { attendanceSummary, AttButtons, CloseConfirm, SaveChip, SessionInfoBar, StudentRow, WeaknessInput, WeaknessList, MiniStat } from "./ui-bits";
import { Zap, Users, ScanLine, Lock, Undo2, Plus, ChevronDown, ClipboardList } from "lucide-react";

export default function OptionQuick() {
  const lab = useLab();
  const st = lab.state("quick");
  const sum = attendanceSummary(st);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingWeak, setAddingWeak] = useState<string | null>(null);

  /* ---------- دخول ---------- */
  if (st.phase === "entry") {
    return (
      <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-11 h-11 rounded-2xl nk-brand-grad grid place-items-center text-white shrink-0"><Zap className="w-5 h-5" /></span>
          <div>
            <h3 className="font-extrabold text-lg">حصص النهاردة — {lab.offline ? "وضع الشبكة المقطوعة (محاكاة)" : "كل حاجة جاهزة"}</h3>
            <p className="text-sm text-muted-foreground">فتحة واحدة والافتراض «الكل حاضر» شغال — بتصلّح الاستثناءات بس وتقفل.</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-extrabold">فيزياء — ثانوية عامة</div>
            <div className="text-xs text-muted-foreground mt-0.5">أ. كريم منصور · قاعة A · <span dir="ltr" className="nk-num">5:00–6:30</span> م · <span className="nk-num" dir="ltr">12</span> طالب</div>
          </div>
          <Button size="lg" className="h-12 px-6 rounded-2xl nk-btn-brand text-base" onClick={() => lab.openSession("quick")}>
            افتح الحصة <ChevronDown className="-rotate-90 w-5 h-5" />
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- الخلاصة بعد القفل ---------- */
  if (st.phase === "summary") {
    return (
      <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
        <div className="text-center mb-4">
          <span className="inline-grid place-items-center w-14 h-14 rounded-full bg-emerald-600 text-white mb-2"><Users className="w-7 h-7" /></span>
          <h3 className="text-xl font-extrabold">الحصة اتقفلت — كله اتثبت ✓</h3>
          <p className="text-sm text-muted-foreground mt-1">الأرقام بقت في التقارير والحساب اتعمل تلقائيًا.</p>
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <MiniStat label="حاضر" value={sum.present} tone="ok" />
          <MiniStat label="متأخر" value={sum.late} tone="warn" />
          <MiniStat label="غايب" value={sum.absent} />
          <MiniStat label="تحصيل" value={sum.collectedText} tone="info" />
        </div>
        {sum.weaknesses > 0 && (
          <p className="text-sm text-muted-foreground text-center mb-2">اتسجلت <b className="nk-num" dir="ltr">{sum.weaknesses}</b> ملاحظة ضعف — هتلاقيها في تقرير الطالب.</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" className="flex-1 h-11 rounded-2xl" onClick={() => lab.reopenSession("quick")}>
            <Undo2 className="w-4 h-4" /> تراجع عن القفل (تعديل)
          </Button>
          <Button className="flex-1 h-11 rounded-2xl nk-btn-brand" onClick={() => lab.backToEntry("quick")}>
            <ClipboardList className="w-4 h-4" /> رجوع لحصص اليوم
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- الشاشة الحية ---------- */
  return (
    <div className="nk-anim-in" data-lab-scope>
      {st.loading ? (
        <div className="nk-card rounded-3xl p-8 text-center text-muted-foreground">
          <span className="inline-block w-8 h-8 rounded-full border-3 border-primary border-t-transparent animate-spin mb-3" style={{ borderWidth: 3 }} />
          بنجهّز الحصة…
        </div>
      ) : (
        <>
          <SessionInfoBar right={<SaveChip save={st.save} offline={lab.offline} />} />

          {/* شريط الافتراضات الذكية */}
          <div className="mt-3 rounded-3xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20 p-3 flex flex-wrap items-center gap-2">
            <Button className="h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { lab.markAllPresent("quick"); toast.success("الكل اتعلّم حاضر — صلّح الاستثناءات بس"); }}>
              <Users className="w-4 h-4" /> علّم الكل حاضر
            </Button>
            <Button variant="outline" className="h-11 rounded-2xl" onClick={() => lab.simulateSelfCheckin("quick")}>
              <ScanLine className="w-4 h-4" /> محاكاة تسجيل ذاتي QR
            </Button>
            <span className="text-xs text-muted-foreground font-semibold ms-auto text-start">
              {st.selfCheckins.length > 0 ? <>آخر تسجيل ذاتي: {STUDENTS.find(s => s.id === st.selfCheckins[st.selfCheckins.length - 1])?.name}</> : "الفكرة: افتراض واحد بيوفر 11 نقرة"}
            </span>
          </div>

          {/* القائمة */}
          <div className="mt-3 space-y-1.5">
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
                  actions={
                    <div className="flex items-center gap-1.5 shrink-0">
                      <AttButtons
                        current={mark?.status}
                        size="sm"
                        onPick={(v) => lab.mark("quick", s.id, v)}
                        onClear={() => lab.unmark("quick", s.id)}
                      />
                      <button
                        type="button"
                        title="إضافة نقطة ضعف"
                        aria-label={`إضافة نقطة ضعف لـ${s.name}`}
                        onClick={() => { setExpanded(open ? null : s.id); setAddingWeak(s.id); }}
                        className="w-8 h-8 rounded-xl border border-border bg-card grid place-items-center text-muted-foreground hover:text-rose-600 hover:border-rose-300 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  }
                  extra={
                    <div className="space-y-2">
                      {addingWeak === s.id ? (
                        <WeaknessInput
                          onSave={(t) => { lab.addWeakness("quick", s.id, t); setAddingWeak(null); }}
                          onCancel={() => setAddingWeak(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddingWeak(s.id)}
                          className="text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline"
                        >
                          + نقطة ضعف / ملاحظة
                        </button>
                      )}
                      <WeaknessList items={weak} onRemove={(t) => lab.removeWeakness("quick", s.id, t)} />
                      {s.lastWeakness && (
                        <p className="text-[11px] text-muted-foreground">من حصة سابقة: {s.lastWeakness}</p>
                      )}
                    </div>
                  }
                />
              );
            })}
          </div>

          {/* شريط القفل الثابت */}
          <div className="sticky bottom-4 mt-3 z-10">
            <div className={cn("nk-glass-bar rounded-3xl border border-border p-3 flex items-center gap-3 shadow-lg")}>
              <div className="flex gap-1.5 min-w-0 overflow-hidden">
                <span className="nk-badge g shrink-0">حاضر <b className="nk-num">{sum.present}</b></span>
                {sum.late > 0 && <span className="nk-badge o shrink-0">متأخر <b className="nk-num">{sum.late}</b></span>}
                {sum.absent > 0 && <span className="nk-badge r shrink-0">غايب <b className="nk-num">{sum.absent}</b></span>}
                <span className="nk-badge n shrink-0 hidden sm:inline-flex">{sum.collectedText}</span>
              </div>
              <Button
                size="lg"
                className="ms-auto h-12 px-6 rounded-2xl nk-btn-brand shrink-0"
                onClick={() => setConfirm(true)}
              >
                <Lock className="w-4 h-4" /> قفل الحصة
              </Button>
            </div>
          </div>

          <CloseConfirm
            open={confirm}
            onOpenChange={setConfirm}
            summary={sum}
            requireAttendanceDone
            onConfirm={() => { void lab.closeSession("quick"); }}
          />
        </>
      )}
    </div>
  );
}
