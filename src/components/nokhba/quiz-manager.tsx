"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardList, Plus, Loader2, Trash2, Send, Eye, Pencil, X, CheckCircle2, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import { PageHeader, Chip, EmptyState, Loading, SectionCard } from "./shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAcademics } from "./students";
import { toast } from "sonner";

/* ============================================================
   إدارة الكويزات — بسيطة عن قصد (spec §1): مفيش بنك أسئلة.
   كويز → أسئلته مباشرة (اختياري/صح وغلط/مكتوب) → نشر → نتايج.
============================================================ */

type QuizRow = {
  id: string; title: string; description: string | null; status: string;
  groupId: string; groupName: string; subject: string; durationMin: number | null;
  questionsCount: number; attemptsCount: number; avgPct: number | null;
  createdAt: string; createdByName: string;
};

type Attempt = {
  id: string; status: string; score: number | null; maxScore: number;
  submittedAt: string | null; student: { id: string; name: string; code: string };
};

type QuizDetail = {
  id: string; title: string; status: string; description: string | null;
  groupName: string; subject: string; durationMin: number | null;
  questions: { id: string; text: string; type: string; options: string | null; correctAnswer: string | null; points: number; order: number }[];
  attempts: Attempt[];
};

type DraftQuestion = { text: string; type: "MCQ" | "TRUE_FALSE" | "WRITTEN"; options: string[]; correct: number | null; points: number };

const emptyQ = (): DraftQuestion => ({ text: "", type: "MCQ", options: ["", ""], correct: null, points: 1 });

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-white/5" },
  PUBLISHED: { label: "منشور", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  CLOSED: { label: "مقفول", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
};

export function QuizManagerView() {
  const acad = useAcademics();
  const groups = acad?.groups ?? [];
  const [rows, setRows] = useState<QuizRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ quizzes: QuizRow[] }>("/api/quizzes", { silent: true })
      .then((d) => setRows(d.quizzes))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="الكويزات"
        subtitle="كويزات بسيطة لكل مجموعة — الطالب يحلها من بورتال الطالب، والتصحيح آلي للأسئلة الموضوعية"
        action={
          <button onClick={() => setOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2.5 shadow flex items-center gap-1.5 text-sm active:scale-[0.98]">
            <Plus className="w-4 h-4" /> كويز جديد
          </button>
        }
      />

      {!rows ? (
        <Loading label="جاري تحميل الكويزات..." />
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<ClipboardList className="w-8 h-8" />}
            title="مفيش كويزات لسه"
            hint="اعمل أول كويز — اختيار مجموعة + أسئلة سريعة، والباقي علينا."
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((q) => (
            <button
              key={q.id}
              onClick={() => setDetailId(q.id)}
              className="nk-card rounded-2xl p-4 text-start hover:shadow-md active:scale-[0.99] transition space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{q.title}</h3>
                  <p className="text-[11px] font-bold text-muted-foreground">{q.subject} — {q.groupName}</p>
                </div>
                <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0", STATUS_STYLE[q.status]?.cls)}>
                  {STATUS_STYLE[q.status]?.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                <Chip className="bg-muted/60 border-border">{q.questionsCount} سؤال</Chip>
                <Chip className="bg-muted/60 border-border">{q.attemptsCount} محاولة</Chip>
                {q.avgPct != null && (
                  <Chip className="bg-muted/60 border-border">متوسط <span className="nk-num">{q.avgPct}%</span></Chip>
                )}
                {q.durationMin && <Chip className="bg-muted/60 border-border"><Clock className="w-3 h-3 inline" /> <span className="nk-num">{q.durationMin}</span>د</Chip>}
              </div>
            </button>
          ))}
        </div>
      )}

      <QuizCreateDialog open={open} onOpenChange={setOpen} groups={groups} onCreated={() => { setOpen(false); load(); }} />
      {detailId && <QuizDetailDialog id={detailId} onClose={() => { setDetailId(null); load(); }} />}
    </div>
  );
}

/* ============================= إنشاء كويز ============================= */

function QuizCreateDialog({ open, onOpenChange, groups, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  groups: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [qs, setQs] = useState<DraftQuestion[]>([emptyQ()]);
  const [busy, setBusy] = useState(false);

  function setQ(i: number, patch: Partial<DraftQuestion>) {
    setQs((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  async function submit(publish: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/quizzes", {
        method: "POST",
        body: {
          groupId, title,
          durationMin: durationMin ? Number(durationMin) : null,
          publish,
          questions: qs.map((q) => ({
            text: q.text, type: q.type, points: q.points,
            options: q.type === "MCQ" ? q.options.filter(Boolean) : undefined,
            correctAnswer: q.type === "MCQ" ? String(q.correct ?? "") : q.type === "TRUE_FALSE" ? "true" : undefined,
          })),
        },
      });
      toast.success(publish ? "الكويز اتنشر — الطلاب يشوفوه في البورتال" : "الكويز اتحفظ كمسودة");
      setGroupId(""); setTitle(""); setDurationMin(""); setQs([emptyQ()]);
      onCreated();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardList className="w-5 h-5 nk-brand-text" /> كويز جديد</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">المجموعة</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm">
                <option value="">اختار المجموعة…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">المدة (دقايق — اختياري)</label>
              <input value={durationMin} onChange={(e) => setDurationMin(e.target.value.replace(/\D/g, "").slice(0, 3))}
                inputMode="numeric" dir="ltr" placeholder="—" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold block mb-1">عنوان الكويز</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: كويز الوحدة الأولى"
              className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm" />
          </div>

          <div className="space-y-3">
            {qs.map((q, i) => (
              <div key={i} className="rounded-2xl border border-border bg-muted/30 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black nk-brand-text">سؤال {i + 1}</span>
                  <div className="flex items-center gap-1.5">
                    <select value={q.type} onChange={(e) => setQ(i, { type: e.target.value as DraftQuestion["type"], correct: null })}
                      className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                      <option value="MCQ">اختيار من متعدد</option>
                      <option value="TRUE_FALSE">صح وغلط</option>
                      <option value="WRITTEN">سؤال مكتوب</option>
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
                  <p className="text-[11px] font-bold text-muted-foreground">الإجابة الصحيحة: صح (بتتعدل في التصحيح لو محتاج).</p>
                )}
                {q.type === "WRITTEN" && (
                  <p className="text-[11px] font-bold text-muted-foreground">السؤال المكتوب بيتصحح يدويًا بعد تسليم الطالب.</p>
                )}
              </div>
            ))}
            <button onClick={() => setQs((prev) => [...prev, emptyQ()])}
              className="border-2 border-dashed border-border rounded-2xl w-full py-2.5 text-xs font-black text-muted-foreground hover:nk-brand-text hover:border-[var(--c-primary)] transition flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" /> سؤال جديد
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => submit(true)} disabled={busy || !groupId || title.trim().length < 3}
              className="flex-1 h-11 rounded-xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} نشر للطلاب
            </button>
            <button onClick={() => submit(false)} disabled={busy || !groupId || title.trim().length < 3}
              className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4 disabled:opacity-50">
              حفظ كمسودة
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============================= تفاصيل + نتايج ============================= */

function QuizDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<QuizDetail | null>(null);
  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ quiz: QuizDetail }>(`/api/quizzes/${id}`, { silent: true })
      .then((d) => setData(d.quiz))
      .catch(() => onClose());
  }, [id, onClose]);
  useEffect(() => { load(); }, [load]);

  async function act(action: string) {
    setBusy(true);
    try {
      await api(`/api/quizzes/${id}`, { method: "PATCH", body: { action } });
      toast.success("تم");
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function gradeAttempt(attemptId: string, questions: QuizDetail["questions"]) {
    setBusy(true);
    try {
      await api(`/api/quizzes/${id}`, { method: "PATCH", body: { action: "grade", attemptId, writtenScores: scores[attemptId] ?? {} } });
      toast.success("اتصحح ✅");
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  if (!data) return <Dialog open onOpenChange={() => onClose()}><DialogContent><Loading label="جاري التحميل..." /></DialogContent></Dialog>;

  const statusStyle = STATUS_STYLE[data.status];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {data.title}
            <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5", statusStyle?.cls)}>{statusStyle?.label}</span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs font-bold text-muted-foreground">{data.subject} — {data.groupName}</p>

        {/* الأسئلة */}
        <SectionCard title={`الأسئلة (${data.questions.length})`} icon={<Eye className="w-4 h-4" />}>
          <div className="space-y-2">
            {data.questions.map((q, i) => (
              <div key={q.id} className="rounded-xl border border-border bg-card p-2.5 text-xs font-bold">
                <span className="nk-brand-text font-black me-1.5">{i + 1}.</span>{q.text}
                <span className="text-muted-foreground"> · {q.points} نقطة</span>
                {q.type === "MCQ" && q.options && (
                  <p className="text-muted-foreground mt-1">
                    الصحيحة: {(JSON.parse(q.options) as string[])[Number(q.correctAnswer ?? "-1")] ?? "—"}
                  </p>
                )}
                {q.type === "TRUE_FALSE" && <p className="text-muted-foreground mt-1">الصحيحة: صح</p>}
                {q.type === "WRITTEN" && <p className="text-amber-600 mt-1">تصحيح يدوي</p>}
              </div>
            ))}
          </div>
        </SectionCard>

        {/* المحاولات */}
        <SectionCard title={`المحاولات (${data.attempts.length})`} icon={<ClipboardList className="w-4 h-4" />}>
          {data.attempts.length === 0 ? (
            <p className="text-xs font-bold text-muted-foreground">لسه مفيش محاولات.</p>
          ) : (
            <div className="space-y-2.5">
              {data.attempts.map((a) => {
                const needsGrading = a.status === "SUBMITTED";
                const writtenQs = data.questions.filter((q) => q.type === "WRITTEN");
                return (
                  <div key={a.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-extrabold">{a.student.name} <span className="nk-num text-muted-foreground text-[11px]">· {a.student.code}</span></span>
                      {a.score != null ? (
                        <Chip className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300">
                          <span className="nk-num">{a.score}/{a.maxScore}</span>
                        </Chip>
                      ) : needsGrading ? (
                        <Chip className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300">محتاج تصحيح</Chip>
                      ) : (
                        <Chip className="bg-muted border-border">ما سلّمش</Chip>
                      )}
                    </div>
                    {needsGrading && writtenQs.length > 0 && (
                      <div className="space-y-1.5 border-t border-border/60 pt-2">
                        {writtenQs.map((q) => (
                          <div key={q.id} className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-muted-foreground flex-1 truncate">{q.text}</span>
                            <input
                              value={scores[a.id]?.[q.id] ?? ""}
                              onChange={(e) => setScores((prev) => ({
                                ...prev,
                                [a.id]: { ...(prev[a.id] ?? {}), [q.id]: Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 0 },
                              }))}
                              placeholder={`من 0 لـ ${q.points}`}
                              dir="ltr"
                              className="w-20 h-8 rounded-lg border border-input bg-card px-2 text-center text-xs font-bold nk-num"
                            />
                          </div>
                        ))}
                        <button onClick={() => gradeAttempt(a.id, writtenQs)} disabled={busy}
                          className="nk-brand-bg text-white text-[11px] font-extrabold rounded-lg px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5">
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />} اعتمد التصحيح
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* أزرار الحالة */}
        <div className="flex gap-2">
          {data.status === "DRAFT" && (
            <button onClick={() => act("publish")} disabled={busy} className="flex-1 h-11 rounded-xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
              <Send className="w-4 h-4" /> نشر للطلاب
            </button>
          )}
          {data.status === "PUBLISHED" && (
            <button onClick={() => act("close")} disabled={busy} className="flex-1 h-11 rounded-xl bg-rose-600 text-white font-extrabold disabled:opacity-50">
              قفل الكويز
            </button>
          )}
          {data.status === "CLOSED" && (
            <button onClick={() => act("reopen")} disabled={busy} className="flex-1 h-11 rounded-xl border-2 border-border bg-card font-extrabold disabled:opacity-50">
              رجوع لمسودة
            </button>
          )}
          <button onClick={onClose} className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4">إغلاق</button>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground">
          ملاحظة: أسئلة الاختيارات وصح وغلط بتتصحح فورًا تلقائيًا — درجة الطالب بتظهر من غير تصحيح يدوي.
        </p>
      </DialogContent>
    </Dialog>
  );
}
