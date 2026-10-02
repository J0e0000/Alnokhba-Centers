"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FileCheck2, Plus, Loader2, Trash2, Send, Eye, X, CheckCircle2, Clock,
  ShieldAlert, ShieldCheck, Timer, RotateCcw, Users, Ban, Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import { PageHeader, Chip, EmptyState, Loading, SectionCard } from "./shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAcademics } from "./students";
import { ShareSheet } from "./share-sheet";
import { toast } from "sonner";
import type { SessionUser } from "./lib";

/* ============================================================
   إدارة الامتحانات — نظام صارم (مختلف عن الكويزات):
   - نافذة امتحان + مدة محاولة — السيرفر بيحسب الوقت والدرجة
   - سياسة أمن: تنبيه (WARNING) أو صارم (STRICT — الخروج بيلغي المحاولة)
   - المحاولات + الأحداث الأمنية ظاهرة للمدير، وإغلاق/تصفير بصلاحية مدير
============================================================ */

type ExamRow = {
  id: string; title: string; instructions: string | null; status: string;
  groupId: string; groupName: string; subject: string;
  startAt: string; endAt: string; durationMin: number; maxScore: number;
  attemptsAllowed: number; shuffleQuestions: boolean; shuffleOptions: boolean;
  allowAnswerEdit: boolean; securityMode: string; reviewVideoUrl: string | null;
  questionsCount: number; attemptsCount: number; avgPct: number | null; securityFlags: number;
  createdAt: string; createdByName: string;
};

type SecEvent = { id: string; type: string; createdAt: string };

type Attempt = {
  id: string; status: string; score: number | null; maxScore: number;
  startedAt: string; expiresAt: string; submittedAt: string | null;
  student: { id: string; name: string; code: string };
  securityEvents: SecEvent[];
};

type ExamDetail = ExamRow & {
  questions: { id: string; text: string; type: string; options: string | null; correctAnswer: string | null; points: number; order: number }[];
  attempts: Attempt[];
};

type DraftQuestion = { text: string; type: "MCQ" | "TRUE_FALSE" | "NUM"; options: string[]; correct: number | null; correctNum: string; points: number };
type GroupOpt = { id: string; name: string; subject: string; grade: string };

const emptyQ = (): DraftQuestion => ({ text: "", type: "MCQ", options: ["", ""], correct: null, correctNum: "", points: 1 });

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-white/5" },
  PUBLISHED: { label: "منشور", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  CLOSED: { label: "مقفول", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
};

const SEC_LABEL: Record<string, string> = {
  EXAM_STARTED: "بدأ الامتحان",
  RESUMED: "استكمل بعد انقطاع",
  EXAM_SUBMITTED: "سلّم الامتحان",
  EXAM_AUTO_SUBMITTED: "تسليم أوتوماتيك (انتهى الوقت)",
  TAB_HIDDEN: "خلى التاب — تبديل تبويب",
  PAGE_LEFT: "سيب صفحة الامتحان",
  FULLSCREEN_EXIT: "خرج من ملء الشاشة",
  FOCUS_LOST: "فقد التركيز",
  ATTEMPT_INVALIDATED: "المحاولة اتلغت (سياسة صارمة)",
};

const ATTEMPT_LABEL: Record<string, string> = {
  IN_PROGRESS: "شغالة دلوقتي",
  SUBMITTED: "سلّم",
  AUTO_SUBMITTED: "تسليم أوتوماتيك",
  INVALIDATED: "ملغاة — سياسة صارمة",
};

function fmtDT(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function toLocalInput(v: string | Date): string {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ExamManagerView({ user }: { user: SessionUser }) {
  const acad = useAcademics();
  const groups = acad?.groups ?? [];
  const [rows, setRows] = useState<ExamRow[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ exams: ExamRow[] }>("/api/exams", { silent: true })
      .then((d) => setRows(d.exams))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="الامتحانات"
        subtitle="امتحانات إلكترونية بمؤقت من السيرفر — الطالب يتحول لوضع ملء الشاشة، والدرجة بتتصحح فورًا. سياسة الأمن: تنبيه أو إنهاء فوري."
        action={
          <button onClick={() => setCreateOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2.5 shadow flex items-center gap-1.5 text-sm active:scale-[0.98]">
            <Plus className="w-4 h-4" /> امتحان جديد
          </button>
        }
      />

      {!rows ? (
        <Loading label="جاري تحميل الامتحانات..." />
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<FileCheck2 className="w-8 h-8" />}
            title="مفيش امتحانات لسه"
            hint="اعمل أول امتحان — نافذة زمنية + مدة + أسئلة، والنظام يتكفل بالباقي."
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((e) => (
            <button
              key={e.id}
              onClick={() => setDetailId(e.id)}
              className="nk-card rounded-2xl p-4 text-start hover:shadow-md active:scale-[0.99] transition space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{e.title}</h3>
                  <p className="text-[11px] font-bold text-muted-foreground">{e.subject} — {e.groupName}</p>
                </div>
                <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0", STATUS_STYLE[e.status]?.cls)}>
                  {STATUS_STYLE[e.status]?.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                <Chip className="bg-muted/60 border-border"><Clock className="w-3 h-3 inline" /> <span className="nk-num">{e.durationMin}</span> دقيقة</Chip>
                <Chip className="bg-muted/60 border-border"><span className="nk-num">{e.questionsCount}</span> سؤال</Chip>
                <Chip className="bg-muted/60 border-border"><Users className="w-3 h-3 inline" /> <span className="nk-num">{e.attemptsCount}</span> محاولة</Chip>
                {e.avgPct != null && <Chip className="bg-muted/60 border-border">متوسط <span className="nk-num">{e.avgPct}%</span></Chip>}
                {e.securityMode === "STRICT"
                  ? <Chip className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300"><ShieldAlert className="w-3 h-3 inline" /> صارم</Chip>
                  : <Chip className="bg-muted/60 border-border"><ShieldCheck className="w-3 h-3 inline" /> تنبيهات</Chip>}
                {e.securityFlags > 0 && (
                  <Chip className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300">
                    <ShieldAlert className="w-3 h-3 inline" /> <span className="nk-num">{e.securityFlags}</span> حدث أمني
                  </Chip>
                )}
              </div>
              <p className="text-[11px] font-bold text-muted-foreground nk-num" dir="rtl">
                من {fmtDT(e.startAt)} لـ {fmtDT(e.endAt)}
              </p>
            </button>
          ))}
        </div>
      )}

      <ExamFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groups={groups}
        onSaved={() => { setCreateOpen(false); load(); }}
      />
      {detailId && (
        <ExamDetailDialog id={detailId} user={user} groups={groups} onClose={() => { setDetailId(null); load(); }} />
      )}
    </div>
  );
}

/* ============================= نموذج إنشاء/تعديل ============================= */

function ExamFormDialog({ open, onOpenChange, groups, onSaved, initial }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: GroupOpt[];
  onSaved: () => void;
  initial?: ExamDetail | null; // موجودة = تعديل
}) {
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [durationMin, setDurationMin] = useState("30");
  const [securityMode, setSecurityMode] = useState<"WARNING" | "STRICT">("WARNING");
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [allowAnswerEdit, setAllowAnswerEdit] = useState(true);
  const [reviewVideoUrl, setReviewVideoUrl] = useState("");
  const [qs, setQs] = useState<DraftQuestion[]>([emptyQ()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setGroupId(initial.groupId);
      setTitle(initial.title);
      setInstructions(initial.instructions ?? "");
      setStartAt(toLocalInput(initial.startAt));
      setEndAt(toLocalInput(initial.endAt));
      setDurationMin(String(initial.durationMin));
      setSecurityMode(initial.securityMode === "STRICT" ? "STRICT" : "WARNING");
      setShuffleQuestions(initial.shuffleQuestions);
      setShuffleOptions(initial.shuffleOptions);
      setAllowAnswerEdit(initial.allowAnswerEdit);
      setReviewVideoUrl(initial.reviewVideoUrl ?? "");
      setQs(initial.questions.map((q) => ({
        text: q.text,
        type: (["MCQ", "TRUE_FALSE", "NUM"].includes(q.type) ? q.type : "MCQ") as DraftQuestion["type"],
        options: q.options ? (JSON.parse(q.options) as string[]) : ["", ""],
        correct: q.type === "MCQ" && q.correctAnswer != null ? Number(q.correctAnswer) : null,
        correctNum: q.type === "NUM" ? (q.correctAnswer ?? "") : "",
        points: q.points,
      })));
    } else {
      setGroupId(""); setTitle(""); setInstructions(""); setStartAt(""); setEndAt("");
      setDurationMin("30"); setSecurityMode("WARNING"); setShuffleQuestions(false);
      setShuffleOptions(false); setAllowAnswerEdit(true); setReviewVideoUrl("");
      setQs([emptyQ()]);
    }
  }, [open, initial]);

  function setQ(i: number, patch: Partial<DraftQuestion>) {
    setQs((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  const valid = title.trim().length >= 3 && groupId && startAt && endAt && Number(durationMin) >= 1
    && qs.every((q) => q.text.trim() && (q.type !== "MCQ" || (q.correct != null && q.options.filter(Boolean).length >= 2)) && (q.type !== "NUM" || q.correctNum.trim()));

  async function submit(publish: boolean) {
    if (busy || !valid) return;
    setBusy(true);
    try {
      const payload = {
        groupId, title: title.trim(), instructions: instructions.trim() || null,
        startAt: new Date(startAt).toISOString(), // لحظة عالمية — مفيش لبس توقيت
        endAt: new Date(endAt).toISOString(),
        durationMin: Number(durationMin),
        attemptsAllowed: 1,
        shuffleQuestions, shuffleOptions, allowAnswerEdit,
        securityMode,
        reviewVideoUrl: reviewVideoUrl.trim() || null,
        questions: qs.map((q) => ({
          text: q.text, type: q.type, points: q.points,
          options: q.type === "MCQ" ? q.options.filter(Boolean) : undefined,
          correctAnswer: q.type === "MCQ" ? String(q.correct ?? "") : q.type === "TRUE_FALSE" ? "true" : q.correctNum,
        })),
      };
      if (initial) {
        await api(`/api/exams/${initial.id}`, { method: "PATCH", body: { action: "update", ...payload } });
        toast.success("الامتحان اتعدّل ✅");
      } else {
        await api("/api/exams", { method: "POST", body: { ...payload, publish } });
        toast.success(publish ? "الامتحان اتنشر — الطلاب يشوفوه في بورتالهم" : "الامتحان اتحفظ كمسودة");
      }
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 nk-brand-text" /> {initial ? "تعديل امتحان" : "امتحان جديد"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">المجموعة</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!!initial}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm disabled:opacity-60">
                <option value="">اختار المجموعة…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.subject} — {g.grade} {g.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">عنوان الامتحان</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: امتحان الفترة — فيزياء"
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">يفتح في</label>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">يقفل في</label>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">مدة المحاولة (دقايق)</label>
              <input value={durationMin} onChange={(e) => setDurationMin(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric" dir="ltr" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">سياسة الأمن</label>
              <select value={securityMode} onChange={(e) => setSecurityMode(e.target.value as "WARNING" | "STRICT")}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm">
                <option value="WARNING">تنبيهات — تحذير عند الخروج</option>
                <option value="STRICT">صارم — الخروج بيلغي المحاولة</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">تعليمات للطالب (اختياري)</label>
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                placeholder="اقرأ كل سؤال كويس — الامتحان بيتسلم أوتوماتيك لما الوقت يخلص"
                className="w-full rounded-xl border-2 border-input bg-card px-3 py-2 font-bold text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">فيديو المراجعة بعد التسليم (اختياري)</label>
              <input value={reviewVideoUrl} onChange={(e) => setReviewVideoUrl(e.target.value)} dir="ltr"
                placeholder="https://youtube.com/..." 
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Toggle label="ترتيب عشوائي للأسئلة" checked={shuffleQuestions} onChange={setShuffleQuestions} />
            <Toggle label="ترتيب عشوائي للاختيارات" checked={shuffleOptions} onChange={setShuffleOptions} />
            <Toggle label="الطالب يقدر يعدل إجابته قبل التسليم" checked={allowAnswerEdit} onChange={setAllowAnswerEdit} />
          </div>

          {securityMode === "STRICT" && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 p-3 flex gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300 leading-relaxed">
                السياسة الصارمة: أول خروج من شاشة الامتحان (تبديل تاب/تصغير/خروج من ملء الشاشة) بيلغي المحاولة فورًا وبيسجل كل حاجة — الطالب بيشوف رسالة واضحة بالسبب.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {qs.map((q, i) => (
              <div key={i} className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black nk-brand-text">سؤال {i + 1}</span>
                  <div className="flex items-center gap-1.5">
                    <select value={q.type} onChange={(e) => setQ(i, { type: e.target.value as DraftQuestion["type"], correct: null, correctNum: "" })}
                      className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                      <option value="MCQ">اختيار من متعدد</option>
                      <option value="TRUE_FALSE">صح وغلط</option>
                      <option value="NUM">رقمي</option>
                    </select>
                    <input value={q.points} onChange={(e) => setQ(i, { points: Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 1 })}
                      title="النقاط" inputMode="numeric" dir="ltr"
                      className="w-12 h-8 rounded-lg border border-input bg-card px-2 text-center text-[11px] font-bold nk-num" />
                    {qs.length > 1 && (
                      <button onClick={() => setQs((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label="حذف السؤال" className="h-8 w-8 grid place-items-center rounded-lg text-rose-600 hover:bg-rose-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <input value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} placeholder={`نص السؤال ${i + 1}…`}
                  className="w-full h-10 rounded-xl border border-input bg-card px-3 font-bold text-sm" />
                {q.type === "MCQ" && (
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-1.5">
                        <button
                          onClick={() => setQ(i, { correct: oi })}
                          aria-label="تحديد كإجابة صحيحة"
                          className={cn("w-8 h-8 shrink-0 rounded-lg border-2 grid place-items-center transition",
                            q.correct === oi ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-card text-muted-foreground")}
                        >
                          {q.correct === oi ? <CheckCircle2 className="w-4 h-4" /> : <span className="text-[11px] font-black">{oi + 1}</span>}
                        </button>
                        <input value={opt} onChange={(e) => setQ(i, { options: q.options.map((o, x) => (x === oi ? e.target.value : o)) })}
                          placeholder={`الاختيار ${oi + 1}…`} className="flex-1 h-9 rounded-lg border border-input bg-card px-3 text-sm font-bold" />
                        {q.options.length > 2 && (
                          <button onClick={() => setQ(i, { options: q.options.filter((_, x) => x !== oi), correct: q.correct === oi ? null : q.correct })}
                            aria-label="حذف الاختيار" className="w-7 h-8 grid place-items-center text-rose-600">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {q.options.length < 6 && (
                      <button onClick={() => setQ(i, { options: [...q.options, ""] })}
                        className="text-[11px] font-black nk-brand-text flex items-center gap-1">
                        <Plus className="w-3 h-3" /> اختيار إضافي
                      </button>
                    )}
                  </div>
                )}
                {q.type === "TRUE_FALSE" && (
                  <select value={q.correct ?? "true"} onChange={(e) => setQ(i, { correct: e.target.value === "true" ? 0 : 1 })}
                    className="h-9 rounded-lg border border-input bg-card px-2 text-xs font-bold">
                    <option value="true">الإجابة الصحيحة: صح</option>
                    <option value="false">الإجابة الصحيحة: غلط</option>
                  </select>
                )}
                {q.type === "NUM" && (
                  <input value={q.correctNum} onChange={(e) => setQ(i, { correctNum: e.target.value })}
                    dir="ltr" placeholder="الإجابة الرقمية الصحيحة — مثال: 9.8"
                    className="w-full h-9 rounded-lg border border-input bg-card px-3 text-sm font-bold nk-num" />
                )}
              </div>
            ))}
            <button onClick={() => setQs((prev) => [...prev, emptyQ()])}
              className="border-2 border-dashed border-border rounded-2xl w-full py-2.5 text-xs font-black text-muted-foreground hover:nk-brand-text hover:border-[var(--c-primary)] transition flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" /> سؤال جديد
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            {initial ? (
              <button onClick={() => submit(false)} disabled={busy || !valid}
                className="flex-1 h-11 rounded-xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} حفظ التعديلات
              </button>
            ) : (
              <>
                <button onClick={() => submit(true)} disabled={busy || !valid}
                  className="flex-1 h-11 rounded-xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} نشر للطلاب
                </button>
                <button onClick={() => submit(false)} disabled={busy || !valid}
                  className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4 disabled:opacity-50">
                  حفظ كمسودة
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={cn("rounded-xl border-2 px-3 py-2.5 text-start text-[11px] font-bold transition flex items-center gap-2",
        checked ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card text-muted-foreground")}>
      <span className={cn("w-4 h-4 rounded-md border-2 grid place-items-center shrink-0",
        checked ? "bg-emerald-500 border-emerald-500 text-white" : "border-border")}>
        {checked && <CheckCircle2 className="w-3 h-3" />}
      </span>
      <span className="leading-snug">{label}</span>
    </button>
  );
}

/* ============================= التفاصيل + المحاولات ============================= */

function ExamDetailDialog({ id, user, groups, onClose }: { id: string; user: SessionUser; groups: GroupOpt[]; onClose: () => void }) {
  const [data, setData] = useState<ExamDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(() => {
    api<{ exam: ExamDetail }>(`/api/exams/${id}`, { silent: true })
      .then((d) => setData(d.exam))
      .catch(() => onClose());
  }, [id, onClose]);
  useEffect(() => { load(); }, [load]);

  async function act(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/exams/${id}`, { method: "PATCH", body: { action, ...extra } });
      toast.success("تم");
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  if (!data) return <Dialog open onOpenChange={() => onClose()}><DialogContent><Loading label="جاري التحميل..." /></DialogContent></Dialog>;

  const statusStyle = STATUS_STYLE[data.status];
  const isManager = user.role === "MANAGER";
  const windowClosed = new Date(data.endAt) < new Date();

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto nk-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {data.title}
              <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5", statusStyle?.cls)}>{statusStyle?.label}</span>
              {data.securityMode === "STRICT" && (
                <span className="text-[10px] font-bold rounded-full border border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 px-2 py-0.5">صارم</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs font-bold text-muted-foreground">
            {data.subject} — {data.groupName} · من <span className="nk-num">{fmtDT(data.startAt)}</span> لـ <span className="nk-num">{fmtDT(data.endAt)}</span> · المدة <span className="nk-num">{data.durationMin}</span> دقيقة
          </p>

          <SectionCard title={`الأسئلة (${data.questions.length}) — الدرجة الكلية ${data.maxScore}`} icon={<Eye className="w-4 h-4" />}>
            <div className="space-y-2">
              {data.questions.map((q, i) => (
                <div key={q.id} className="rounded-xl border border-border bg-card p-2.5 text-xs font-bold">
                  <span className="nk-brand-text font-black me-1.5">{i + 1}.</span>{q.text}
                  <span className="text-muted-foreground"> · <span className="nk-num">{q.points}</span> نقطة</span>
                  {q.type === "MCQ" && q.options && (
                    <p className="text-muted-foreground mt-1">
                      الصحيحة: {(JSON.parse(q.options) as string[])[Number(q.correctAnswer ?? "-1")] ?? "—"}
                    </p>
                  )}
                  {q.type === "TRUE_FALSE" && <p className="text-muted-foreground mt-1">الصحيحة: {q.correctAnswer === "false" ? "غلط" : "صح"}</p>}
                  {q.type === "NUM" && <p className="text-muted-foreground mt-1 nk-num" dir="ltr">الصحيحة: {q.correctAnswer}</p>}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={`المحاولات (${data.attempts.length})`} icon={<Users className="w-4 h-4" />}>
            {data.attempts.length === 0 ? (
              <p className="text-xs font-bold text-muted-foreground">لسه مفيش محاولات.</p>
            ) : (
              <div className="space-y-2.5">
                {data.attempts.map((a) => (
                  <div key={a.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-extrabold">{a.student.name} <span className="nk-num text-muted-foreground text-[11px]">· {a.student.code}</span></span>
                      <div className="flex items-center gap-1.5">
                        {a.score != null ? (
                          <Chip className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300">
                            <span className="nk-num">{a.score}/{a.maxScore}</span>
                          </Chip>
                        ) : (
                          <Chip className="bg-muted border-border">{ATTEMPT_LABEL[a.status] ?? a.status}</Chip>
                        )}
                        {a.status === "IN_PROGRESS" && (
                          <button disabled={busy || !isManager} title={isManager ? "إغلاق قسري وتصحيح فوري" : "للمدير فقط"}
                            onClick={() => act("forceSubmit", { attemptId: a.id, reason: "إغلاق من شاشة المتابعة" })}
                            className="rounded-lg bg-amber-500 text-white p-1.5 disabled:opacity-40">
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {a.status !== "IN_PROGRESS" && (
                          <button disabled={busy || !isManager} title={isManager ? "تصفير المحاولة — الطالب يعيد" : "للمدير فقط"}
                            onClick={() => act("resetAttempt", { attemptId: a.id, reason: "تصفير من شاشة المتابعة" })}
                            className="rounded-lg border border-border bg-card p-1.5 disabled:opacity-40">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] font-bold text-muted-foreground nk-num">
                      بدأت {fmtDT(a.startedAt)} · تنتهي {fmtDT(a.expiresAt)}{a.submittedAt ? ` · تسليمت ${fmtDT(a.submittedAt)}` : ""}
                    </p>
                    {a.securityEvents.length > 0 && (
                      <div className="border-t border-border/60 pt-1.5 space-y-1">
                        {a.securityEvents.map((ev) => (
                          <p key={ev.id} className={cn("text-[11px] font-bold flex items-center gap-1.5",
                            ev.type === "ATTEMPT_INVALIDATED" ? "text-rose-600" : "text-amber-600")}>
                            <ShieldAlert className="w-3 h-3 shrink-0" />
                            {SEC_LABEL[ev.type] ?? ev.type} · <span className="nk-num">{fmtDT(ev.createdAt)}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="flex gap-2 flex-wrap">
            {data.status === "DRAFT" && (
              <button onClick={() => act("publish")} disabled={busy} className="flex-1 min-w-32 h-11 rounded-xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
                <Send className="w-4 h-4" /> نشر للطلاب
              </button>
            )}
            {data.status === "PUBLISHED" && !windowClosed && (
              <button onClick={() => act("close")} disabled={busy} className="flex-1 min-w-32 h-11 rounded-xl bg-rose-600 text-white font-extrabold disabled:opacity-50">
                قفل الامتحان
              </button>
            )}
            {data.status === "CLOSED" && (
              <button onClick={() => act("reopen")} disabled={busy} className="flex-1 min-w-32 h-11 rounded-xl border-2 border-border bg-card font-extrabold disabled:opacity-50">
                رجوع لمسودة
              </button>
            )}
            {data.status === "PUBLISHED" && (
              <button onClick={() => setShareOpen(true)} disabled={busy}
                className="h-11 rounded-xl nk-brand-bg-soft nk-brand-text border-2 nk-brand-border font-extrabold px-4 flex items-center gap-1.5">
                <Share2 className="w-4 h-4" /> مشاركة
              </button>
            )}
            <button onClick={() => setEditOpen(true)} disabled={busy}
              className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4">تعديل</button>
            <button onClick={onClose} className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4">إغلاق</button>
          </div>
          <p className="text-[10px] font-bold text-muted-foreground">
            المؤقت والدرجة محسوبة على السيرفر — ساعة جهاز الطالب ملهاش تأثير. إغلاق/تصفير المحاولات للمدير فقط وبيتسجل في سجل التدقيق.
          </p>
        </DialogContent>
      </Dialog>

      {editOpen && (
        <ExamFormDialog
          open
          onOpenChange={(v) => { if (!v) setEditOpen(false); }}
          groups={groups}
          onSaved={() => { setEditOpen(false); load(); }}
          initial={data}
        />
      )}

      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        title={data.title}
        description={`${data.subject} — ${data.groupName}`}
        path={`/portal?tab=exams&open=${data.id}`}
      />
    </>
  );
}
