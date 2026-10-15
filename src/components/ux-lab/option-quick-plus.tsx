"use client";
/* البديل D — السريعة+ (نسخة قرار المالك المسجّل 15/10/2026)
   قرار المالك: عجبته السريعة لأنها بسيطة ومفيهاش أسئلة كتير (المستخدم مش سوبر يوزر)،
   وطلب تعديلين محددين:
     1) QR للحصة يبقى بضغطة واحدة.
     2) إشعارات أولياء الأمور تبقى ثنائية: حاضر أو غايب بس — تبسيط كامل.
   الفلسفة: السريعة الأصلية زي ما هي بالظبط (نفس مسار 4 نقرات) — التعديلان مضافين
   بدون أي سؤال أو خطوة إضافية إجبارية. كل البيانات اصطناعية وصفر شبكة. */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLab } from "./store";
import { STUDENTS } from "./scenario";
import { attendanceSummary, AttButtons, CloseConfirm, SaveChip, SessionInfoBar, StudentRow, WeaknessInput, WeaknessList, MiniStat } from "./ui-bits";
import { Zap, Users, QrCode, Lock, Undo2, Plus, ChevronDown, ClipboardList, BellRing, X, ScanLine, Camera } from "lucide-react";

const SLOT_MS = 10_000; // نفس فلسفة الإنتاج: كود واحد ثابت 10 ثواني ثم يموت
/* نطاق example.com محجوز من IANA — الترميز وهمي 100% ومفيش أي بيانات حقيقية جواه */
const fakePayload = (slot: number) => `https://example.com/uxlab/slot-${slot}`;

export default function OptionQuickPlus() {
  const lab = useLab();
  const st = lab.state("quickplus");
  const sum = attendanceSummary(st);
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingWeak, setAddingWeak] = useState<string | null>(null);

  /* طلب المالك رقم 1: QR بضغطة — أوفرلاي اصطناعي بسلوت بيتجدد */
  const [qrOpen, setQrOpen] = useState(false);
  const [slotEnd, setSlotEnd] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(0); // بعد الماونت بس — مفيش hydration mismatch (نفس نمط الإنتاج)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const slot = slotEnd ? Math.floor(slotEnd / SLOT_MS) : 0;
  const leftSec = slotEnd ? Math.max(0, Math.ceil((slotEnd - nowTs) / 1000)) : 10;
  const progress = slotEnd ? Math.max(0, Math.min(1, (slotEnd - nowTs) / SLOT_MS)) : 1;
  const lowTime = leftSec > 0 && leftSec <= 3;

  /* فتح/قفل الكود — ضبط السلوت في حدث المستخدم (مش في effect) */
  const openQr = () => { setNowTs(Date.now()); setSlotEnd(Date.now() + SLOT_MS); setQrOpen(true); };
  const closeQr = () => { setQrOpen(false); setSlotEnd(null); };

  /* طلب المالك رقم 2: إشعار ثنائي — حاضر أو غايب بس (غايب = لسه مسجلش وقت القفل) */
  const [notifyOn, setNotifyOn] = useState(true);
  const absentNames = STUDENTS.filter((s) => !st.marks[s.id]).map((s) => s.name);

  /* مؤقّت السلوت — الكود بيتجدد أوتوماتيك كل 10 ثواني (بدون setState متزامن في جسم الـ effect) */
  useEffect(() => {
    if (!qrOpen) return;
    const iv = setInterval(() => {
      const t = Date.now();
      setNowTs(t);
      setSlotEnd((end) => (end !== null && end - t <= 0 ? t + SLOT_MS : end));
    }, 250);
    return () => clearInterval(iv);
  }, [qrOpen]);

  /* رسم الكود الاصطناعي — بيتغير شكله فعليًا مع كل سلوت جديد */
  useEffect(() => {
    if (!qrOpen) return;
    const canvas = qrCanvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, fakePayload(slot), {
      width: 232,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    }).catch(() => { /* العرض التوضيحي مستمر حتى لو فشل الرسم */ });
  }, [qrOpen, slot]);

  /* Escape يقفل الـ QR */
  useEffect(() => {
    if (!qrOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeQr(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrOpen]);

  /* ---------- دخول ---------- */
  if (st.phase === "entry") {
    return (
      <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
        <div className="flex items-start gap-3 mb-4">
          <span className="w-11 h-11 rounded-2xl nk-brand-grad grid place-items-center text-white shrink-0"><Zap className="w-5 h-5" /></span>
          <div className="min-w-0">
            <h3 className="font-extrabold text-lg flex items-center gap-2 flex-wrap">
              حصص النهاردة — السريعة+
              <span className="nk-badge g shrink-0">نسختك المعدّلة — بطلباتك</span>
            </h3>
            <p className="text-sm text-muted-foreground">
              نفس بساطة السريعة بالظبط (الاستثناءات بس اللي محتاجة نقرات) + طلبينك من قرارك:
              <b className="text-foreground"> QR بضغطة واحدة</b> و<b className="text-foreground">إشعار حاضر أو غايب بس</b> — مفيش أي سؤال زيادة.
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-extrabold">فيزياء — ثانوية عامة</div>
            <div className="text-xs text-muted-foreground mt-0.5">أ. كريم منصور · قاعة A · <span dir="ltr" className="nk-num">5:00–6:30</span> م · <span className="nk-num" dir="ltr">12</span> طالب</div>
          </div>
          <Button size="lg" className="h-12 px-6 rounded-2xl nk-btn-brand text-base" onClick={() => lab.openSession("quickplus")}>
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
        {notifyOn && (
          <p className="text-sm text-muted-foreground text-center mb-2">
            {sum.absent > 0
              ? <>إشعارات أولياء الأمور (حاضر أو غايب بس): اتبعت <b className="nk-num" dir="ltr">{sum.absent}</b> إشعار غياب ✓ <span className="opacity-70">(محاكاة — مفيش رسائل حقيقية)</span></>
              : <>إشعارات أولياء الأمور: الكل حاضر — مفيش أي إشعار هيتبعت ✓</>}
          </p>
        )}
        {sum.weaknesses > 0 && (
          <p className="text-sm text-muted-foreground text-center mb-2">اتسجلت <b className="nk-num" dir="ltr">{sum.weaknesses}</b> ملاحظة ضعف — هتلاقيها في تقرير الطالب.</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" className="flex-1 h-11 rounded-2xl" onClick={() => lab.reopenSession("quickplus")}>
            <Undo2 className="w-4 h-4" /> تراجع عن القفل (تعديل)
          </Button>
          <Button className="flex-1 h-11 rounded-2xl nk-btn-brand" onClick={() => lab.backToEntry("quickplus")}>
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

          {/* شريط الافتراضات + طلب المالك رقم 1: QR بضغطة */}
          <div className="mt-3 rounded-3xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20 p-3 flex flex-wrap items-center gap-2">
            <Button className="h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { lab.markAllPresent("quickplus"); toast.success("الكل اتعلّم حاضر — صلّح الاستثناءات بس"); }}>
              <Users className="w-4 h-4" /> علّم الكل حاضر
            </Button>
            <Button className="h-11 rounded-2xl nk-btn-brand" onClick={openQr}>
              <QrCode className="w-4 h-4" /> QR بضغطة
            </Button>
            <span className="text-xs text-muted-foreground font-semibold ms-auto text-start">
              {st.selfCheckins.length > 0
                ? <>سجلوا ذاتيًا بالكود: <b className="nk-num" dir="ltr">{st.selfCheckins.length}</b></>
                : "الفكرة: نفس مسار السريعة — والكود بضغطة واحدة برضه"}
            </span>
          </div>

          {/* طلب المالك رقم 2: إشعار ثنائي — حاضر أو غايب بس */}
          <div className="mt-3 rounded-3xl border border-border bg-card p-3.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="font-extrabold text-sm flex items-center gap-1.5">
                <BellRing className="w-4 h-4 text-primary" /> إشعار أولياء الأمور — حاضر أو غايب بس
              </h4>
              <button
                type="button"
                aria-pressed={notifyOn}
                onClick={() => setNotifyOn(!notifyOn)}
                className={cn(
                  "h-8 px-2.5 rounded-xl border text-[11px] font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  notifyOn ? "bg-emerald-600 text-white border-emerald-600" : "bg-card text-muted-foreground border-border hover:bg-muted/60",
                )}
              >
                الإشعار التلقائي: {notifyOn ? "شغال" : "مقفول"}
              </button>
            </div>
            {notifyOn ? (
              absentNames.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs font-bold">
                    لو قفلت دلوقتي: هيتبعت <b className="nk-num" dir="ltr">{absentNames.length}</b> إشعار غياب —
                    {" "}{absentNames.slice(0, 3).join(" · ")}{absentNames.length > 3 && ` و${absentNames.length - 3} كمان`}
                  </p>
                  <p className="text-[11px] text-muted-foreground rounded-xl bg-muted/50 border border-border px-2.5 py-1.5">
                    قالب واحد ثابت: «ابنكم {absentNames[0]} اتسجل غايب النهاردة في حصة الفيزياء.»
                  </p>
                </div>
              ) : (
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 mt-2">مفيش أي غياب — مفيش أي إشعار هيتبعت ✓</p>
              )
            ) : (
              <p className="text-xs text-muted-foreground mt-2">الإشعار التلقائي مقفول — مفيش أي رسالة هتتبعت.</p>
            )}
            <p className="text-[10.5px] text-muted-foreground mt-1.5">
              تبسيط قرارك: مفيش «متأخر/بعذر» في الإشعارات — أي حد اتسجل بيدخل تحت «حاضر». عرض محاكاة بس — مفيش أي رسالة حقيقية بتتبعت.
            </p>
          </div>

          {/* القائمة — نفس السريعة بالظبط */}
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
                        onPick={(v) => lab.mark("quickplus", s.id, v)}
                        onClear={() => lab.unmark("quickplus", s.id)}
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
                          onSave={(t) => { lab.addWeakness("quickplus", s.id, t); setAddingWeak(null); }}
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
                      <WeaknessList items={weak} onRemove={(t) => lab.removeWeakness("quickplus", s.id, t)} />
                      {s.lastWeakness && (
                        <p className="text-[11px] text-muted-foreground">من حصة سابقة: {s.lastWeakness}</p>
                      )}
                    </div>
                  }
                />
              );
            })}
          </div>

          {/* شريط القفل الثابت — نفس السريعة */}
          <div className="sticky bottom-4 mt-3 z-10">
            <div className="nk-glass-bar rounded-3xl border border-border p-3 flex items-center gap-3 shadow-lg">
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
            onConfirm={() => { void lab.closeSession("quickplus"); }}
          />

          {/* أوفرلاي الـ QR — بضغطة واحدة (Portal لـ body زي الإنتاج بالظبط) */}
          {qrOpen && createPortal(
            <div
              className="fixed inset-0 z-[90] bg-black/60 grid place-items-center p-4"
              data-lab-scope
              onClick={closeQr}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="QR حضور الحصة — محاكاة"
                className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl nk-anim-in"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={closeQr}
                  aria-label="إغلاق الكود"
                  className="absolute top-3 end-3 rounded-xl border border-border bg-card p-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="text-center mb-3">
                  <h4 className="font-extrabold flex items-center justify-center gap-1.5">
                    <QrCode className="w-4 h-4 text-primary" /> QR الحصة — حضور ذاتي
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    اتفتح بضغطة واحدة — كود جديد كل 10 ثواني والقديم بيموت فورًا (مضاد للتصوير)
                  </p>
                </div>
                <div className="rounded-2xl bg-white p-3 w-fit mx-auto shadow-inner">
                  <canvas ref={qrCanvasRef} width={232} height={232} aria-label="كود حضور اصطناعي" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden min-w-10">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-300 ease-linear", lowTime ? "bg-amber-500" : "nk-brand-bg")}
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <span className="nk-num text-[10px] font-bold shrink-0">كود جديد بعد {leftSec}ث</span>
                </div>
                <Button className="w-full h-11 rounded-2xl mt-3 nk-btn-brand" onClick={() => lab.simulateSelfCheckin("quickplus")}>
                  <ScanLine className="w-4 h-4" /> محاكاة طالب مسح الكود
                </Button>
                <p className="text-center text-[11px] text-muted-foreground mt-2">
                  <Camera className="w-3 h-3 inline" /> سجلوا ذاتيًا: <b className="nk-num" dir="ltr">{st.selfCheckins.length}</b> — الجهاز بيتقفل للحصة (جهاز واحد = حضور واحد)
                </p>
                <p className="text-center text-[10px] text-muted-foreground/70 mt-1">
                  كود اصطناعي 100% (نطاق example.com المحجوز) — مفيش أي بيانات حقيقية
                </p>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}
