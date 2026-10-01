"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NotebookPen, Plus, Loader2, Trash2, Send, Eye, X, CheckCircle2, Clock,
  Users, Pencil, AlarmClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import { PageHeader, Chip, EmptyState, Loading, SectionCard } from "./shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAcademics } from "./students";
import { toast } from "sonner";
import type { SessionUser } from "./lib";

/* ============================================================
   إدارة الواجبات — قابل للاستكمال (مش جلسة صارمة زي الامتحان):
   - الطالب يسيب ويرجع ويكمل لحد الـ deadline (سيرفر)
   - Mode A: أونلاين تصحيح آلي فوري — Mode B (ملفات): جاي لاحقًا
   - التسليم المتأخر مسموح بس لو المدير فعّله (يتعلّم late)
============================================================ */

type AssignmentRow = {
  id: string; title: string; instructions: string | null; mode: string; status: string;
  groupId: string; groupName: string; subject: string;
  deadline: string; allowLate: boolean; maxScore: number; reviewVideoUrl: string | null;
  questionsCount: number; submissionsCount: number; lateCount: number;
  createdAt: string; createdByName: string;
};

type Submission = {
  id: string; status: string; score: number | null; late: boolean;
  draftSavedAt: string | null; submittedAt: string | null;
  student: { id: string; name: string; code: string };
};

type AssignmentDetail = AssignmentRow & {
  questions: { id: string; text: string; type: string; options: string | null; correctAnswer: string | null; points: number; order: number }[];
  submissions: Submission[];
};

type DraftQuestion = { text: string; type: "MCQ" | "TRUE_FALSE" | "NUM"; options: string[]; correct: number | null; correctNum: string; points: number };
type GroupOpt = { id: string; name: string; subject: string; grade: string };

const emptyQ = (): DraftQuestion => ({ text: "", type: "MCQ", options: ["", ""], correct: null, correctNum: "", points: 1 });

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "مسودة", cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-white/5" },
  PUBLISHED: { label: "منشور", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  CLOSED: { label: "مقفول", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
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

export function AssignmentManagerView({ user }: { user: SessionUser }) {
  void user;
  const acad = useAcademics();
  const groups = acad?.groups ?? [];
  const [rows, setRows] = useState<AssignmentRow[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ assignments: AssignmentRow[] }>("/api/assignments", { silent: true })
      .then((d) => setRows(d.assignments))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="الواجبات"
        subtitle="واجبات أونلاين بتصحيح آلي — الطالب يقدر يسيب ويرجع ويكمل لحد ميعاد التسليم. التسليم بعد الميعاد بيتقفل من السيرفر."
        action={
          <button onClick={() => setCreateOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2.5 shadow flex items-center gap-1.5 text-sm active:scale-[0.98]">
            <Plus className="w-4 h-4" /> واجب جديد
          </button>
        }
      />

      {!rows ? (
        <Loading label="جاري تحميل الواجبات..." />
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<NotebookPen className="w-8 h-8" />}
            title="مفيش واجبات لسه"
            hint="اعمل أول واجب — ميعاد تسليم + أسئلة، والدرجة تظهر للطالب فورًا."
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((a) => {
            const past = new Date(a.deadline) < new Date();
            return (
              <button
                key={a.id}
                onClick={() => setDetailId(a.id)}
                className="nk-card rounded-2xl p-4 text-start hover:shadow-md active:scale-[0.99] transition space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-sm truncate">{a.title}</h3>
                    <p className="text-[11px] font-bold text-muted-foreground">{a.subject} — {a.groupName}</p>
                  </div>
                  <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0", STATUS_STYLE[a.status]?.cls)}>
                    {STATUS_STYLE[a.status]?.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                  <Chip className={cn("border", past ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" : "bg-muted/60 border-border")}>
                    <AlarmClock className="w-3 h-3 inline" /> التسليم: <span className="nk-num">{fmtDT(a.deadline)}</span>
                  </Chip>
                  <Chip className="bg-muted/60 border-border"><span className="nk-num">{a.questionsCount}</span> سؤال</Chip>
                  <Chip className="bg-muted/60 border-border"><Users className="w-3 h-3 inline" /> <span className="nk-num">{a.submissionsCount}</span> تسليم</Chip>
                  {a.lateCount > 0 && <Chip className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300"><span className="nk-num">{a.lateCount}</span> متأخر</Chip>}
                  {a.allowLate && <Chip className="bg-muted/60 border-border">يسمح بالتأخير</Chip>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <AssignmentFormDialog open={createOpen} onOpenChange={setCreateOpen} groups={groups} onSaved={() => { setCreateOpen(false); load(); }} />
      {detailId && <AssignmentDetailDialog id={detailId} groups={groups} onClose={() => { setDetailId(null); load(); }} />}
    </div>
  );
}

/* ============================= نموذج إنشاء/تعديل ============================= */

function AssignmentFormDialog({ open, onOpenChange, groups, onSaved, initial }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: GroupOpt[];
  onSaved: () => void;
  initial?: AssignmentDetail | null;
}) {
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deadline, setDeadline] = useState("");
  const [allowLate, setAllowLate] = useState(false);
  const [reviewVideoUrl, setReviewVideoUrl] = useState("");
  const [qs, setQs] = useState<DraftQuestion[]>([emptyQ()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setGroupId(initial.groupId);
      setTitle(initial.title);
      setInstructions(initial.instructions ?? "");
      setDeadline(toLocalInput(initial.deadline));
      setAllowLate(initial.allowLate);
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
      setGroupId(""); setTitle(""); setInstructions(""); setDeadline("");
      setAllowLate(false); setReviewVideoUrl(""); setQs([emptyQ()]);
    }
  }, [open, initial]);

  function setQ(i: number, patch: Partial<DraftQuestion>) {
    setQs((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  const valid = title.trim().length >= 3 && groupId && deadline
    && qs.every((q) => q.text.trim() && (q.type !== "MCQ" || (q.correct != null && q.options.filter(Boolean).length >= 2)) && (q.type !== "NUM" || q.correctNum.trim()));

  async function submit(publish: boolean) {
    if (busy || !valid) return;
    setBusy(true);
    try {
      const payload = {
        groupId, title: title.trim(), instructions: instructions.trim() || null,
        deadline: new Date(deadline).toISOString(),
        allowLate,
        reviewVideoUrl: reviewVideoUrl.trim() || null,
        questions: qs.map((q) => ({
          text: q.text, type: q.type, points: q.points,
          options: q.type === "MCQ" ? q.options.filter(Boolean) : undefined,
          correctAnswer: q.type === "MCQ" ? String(q.correct ?? "") : q.type === "TRUE_FALSE" ? "true" : q.correctNum,
        })),
      };
      if (initial) {
        await api(`/api/assignments/${initial.id}`, { method: "PATCH", body: { action: "update", ...payload } });
        toast.success("الواجب اتعدّل ✅");
      } else {
        await api("/api/assignments", { method: "POST", body: { ...payload, publish } });
        toast.success(publish ? "الواجب اتنشر — الطلاب يشوفوه في بورتالهم" : "الواجب اتحفظ كمسودة");
      }
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="w-5 h-5 nk-brand-text" /> {initial ? "تعديل واجب" : "واجب جديد"}
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
              <label className="text-xs font-bold block mb-1">عنوان الواجب</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: واجب الوحدة الثانية"
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold block mb-1">ميعاد التسليم (deadline)</label>
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={() => setAllowLate(!allowLate)}
                className={cn("w-full h-11 rounded-xl border-2 px-3 text-xs font-bold transition flex items-center gap-2",
                  allowLate ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card text-muted-foreground")}>
                <span className={cn("w-4 h-4 rounded-md border-2 grid place-items-center shrink-0",
                  allowLate ? "bg-emerald-500 border-emerald-500 text-white" : "border-border")}>
                  {allowLate && <CheckCircle2 className="w-3 h-3" />}
                </span>
                السماح بالتسليم المتأخر (يتعلّم متأخر)
              </button>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">تعليمات الواجب</label>
              <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2}
                placeholder="حل الأسئلة كلها — تقدر تسيب وترجع تكمل لحد ميعاد التسليم"
                className="w-full rounded-xl border-2 border-input bg-card px-3 py-2 font-bold text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-bold block mb-1">فيديو المراجعة بعد التسليم (اختياري)</label>
              <input value={reviewVideoUrl} onChange={(e) => setReviewVideoUrl(e.target.value)} dir="ltr"
                placeholder="https://youtube.com/..."
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" />
            </div>
          </div>

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
                        <button onClick={() => setQ(i, { correct: oi })} aria-label="تحديد كإجابة صحيحة"
                          className={cn("w-8 h-8 shrink-0 rounded-lg border-2 grid place-items-center transition",
                            q.correct === oi ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-card text-muted-foreground")}>
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
                    dir="ltr" placeholder="الإجابة الرقمية الصحيحة — مثال: 42"
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

/* ============================= التفاصيل + التسليمات ============================= */

function AssignmentDetailDialog({ id, groups, onClose }: { id: string; groups: GroupOpt[]; onClose: () => void }) {
  const [data, setData] = useState<AssignmentDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [gradeScore, setGradeScore] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api<{ assignment: AssignmentDetail }>(`/api/assignments/${id}`, { silent: true })
      .then((d) => setData(d.assignment))
      .catch(() => onClose());
  }, [id, onClose]);
  useEffect(() => { load(); }, [load]);

  async function act(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/assignments/${id}`, { method: "PATCH", body: { action, ...extra } });
      toast.success("تم");
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  if (!data) return <Dialog open onOpenChange={() => onClose()}><DialogContent><Loading label="جاري التحميل..." /></DialogContent></Dialog>;

  const statusStyle = STATUS_STYLE[data.status];

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto nk-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {data.title}
              <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5", statusStyle?.cls)}>{statusStyle?.label}</span>
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs font-bold text-muted-foreground">
            {data.subject} — {data.groupName} · التسليم: <span className="nk-num">{fmtDT(data.deadline)}</span> {data.allowLate ? "· مسموح التأخير" : ""}
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

          <SectionCard title={`التسليمات (${data.submissions.filter((s) => s.submittedAt).length})`} icon={<Users className="w-4 h-4" />}>
            {data.submissions.length === 0 ? (
              <p className="text-xs font-bold text-muted-foreground">لسه مفيش تسليمات ولا مسودات.</p>
            ) : (
              <div className="space-y-2.5">
                {data.submissions.map((s) => (
                  <div key={s.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-extrabold">
                        {s.student.name} <span className="nk-num text-muted-foreground text-[11px]">· {s.student.code}</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        {s.late && <Chip className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300">متأخر</Chip>}
                        {s.score != null ? (
                          <Chip className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300">
                            <span className="nk-num">{s.score}/{data.maxScore}</span>
                          </Chip>
                        ) : s.status === "SUBMITTED" ? (
                          <Chip className="bg-muted border-border">سلّم — بدون درجة</Chip>
                        ) : (
                          <Chip className="bg-muted border-border">مسودة {s.draftSavedAt ? `· ${fmtDT(s.draftSavedAt)}` : ""}</Chip>
                        )}
                      </div>
                    </div>
                    {s.submittedAt && <p className="text-[11px] font-bold text-muted-foreground nk-num">تسليم {fmtDT(s.submittedAt)}</p>}
                    {s.status !== "DRAFT" && (
                      <div className="flex items-center gap-1.5 border-t border-border/60 pt-2">
                        <input
                          value={gradeScore[s.id] ?? (s.score != null ? String(s.score) : "")}
                          onChange={(e) => setGradeScore((prev) => ({ ...prev, [s.id]: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                          placeholder={`من 0 لـ ${data.maxScore}`} dir="ltr"
                          className="w-24 h-8 rounded-lg border border-input bg-card px-2 text-center text-xs font-bold nk-num"
                        />
                        <button disabled={busy}
                          onClick={() => act("grade", { submissionId: s.id, score: Number(gradeScore[s.id] ?? s.score ?? 0) })}
                          className="nk-brand-bg text-white text-[11px] font-extrabold rounded-lg px-3 py-1.5 disabled:opacity-50 flex items-center gap-1.5">
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />} رصد/تعديل الدرجة
                        </button>
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
            {data.status === "PUBLISHED" && (
              <button onClick={() => act("close")} disabled={busy} className="flex-1 min-w-32 h-11 rounded-xl bg-rose-600 text-white font-extrabold disabled:opacity-50">
                قفل الواجب
              </button>
            )}
            {data.status === "CLOSED" && (
              <button onClick={() => act("reopen")} disabled={busy} className="flex-1 min-w-32 h-11 rounded-xl border-2 border-border bg-card font-extrabold disabled:opacity-50">
                رجوع لمسودة
              </button>
            )}
            <button onClick={() => setEditOpen(true)} disabled={busy}
              className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4">تعديل</button>
            <button onClick={onClose} className="h-11 rounded-xl border-2 border-border bg-card font-extrabold px-4">إغلاق</button>
          </div>
          <p className="text-[10px] font-bold text-muted-foreground">
            <Clock className="w-3 h-3 inline" /> الميعاد بيتقفل من السيرفر — ساعة جهاز الطالب ملهاش تأثير. الواجب مختلف عن الامتحان: الطالب يسيب ويرجع براحته.
          </p>
        </DialogContent>
      </Dialog>

      {editOpen && (
        <AssignmentFormDialog
          open
          onOpenChange={(v) => { if (!v) setEditOpen(false); }}
          groups={groups}
          onSaved={() => { setEditOpen(false); load(); }}
          initial={data}
        />
      )}
    </>
  );
}
