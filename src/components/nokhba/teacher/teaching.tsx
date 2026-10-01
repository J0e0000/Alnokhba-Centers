"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FileCheck2, ClipboardList, Plus, Loader2, Trash2, CheckCircle2,
  Eye, Send, Lock, Unlock, Pencil, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/* ============================================================
   بورتال المدرس — إدارة الامتحانات والواجبات (مجموعاته هو بس)
   نفس منطق نظام الموظفين بس معتمد على جلسة المدرس — كل التحقق سيرفر
============================================================ */

async function tapi<T>(path: string, opts: { method?: string; body?: unknown; silent?: boolean } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? "حصلت مشكلة — جرب تاني.";
    if (!opts.silent) toast.error(msg);
    throw new Error(msg);
  }
  return data as T;
}

type GroupOpt = { id: string; name: string; subject: string; grade: string };

type Row = {
  id: string; title: string; instructions: string | null; status: string;
  groupId: string; groupName: string; subject: string;
  startAt?: string; endAt?: string; deadline?: string;
  durationMin?: number; allowLate?: boolean;
  maxScore: number; securityMode?: string; reviewVideoUrl?: string | null;
  shuffleQuestions?: boolean; shuffleOptions?: boolean; allowAnswerEdit?: boolean;
  questionsCount: number; attemptsCount?: number; submissionsCount?: number;
  avgPct: number | null; createdByName: string; createdAt: string;
};

type Detail = Row & {
  questions: { id: string; order: number; text: string; type: string; options: string | null; correctAnswer: string | null; points: number }[];
  attempts?: { id: string; studentName: string; studentCode: string; status: string; score: number | null; maxScore: number; startedAt: string; submittedAt: string | null; securityFlags: number }[];
  submissions?: { id: string; studentName: string; studentCode: string; status: string; score: number | null; late: boolean; draftSavedAt: string | null; submittedAt: string | null }[];
};

type DraftQuestion = {
  text: string; type: "MCQ" | "TRUE_FALSE" | "NUM";
  options: string[]; correct: number | null; correctNum: string; points: number;
};

const inputCls = "w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm";
const inputSm = "w-full h-10 rounded-xl border border-input bg-card px-3 font-bold text-sm";

function emptyQ(): DraftQuestion {
  return { text: "", type: "MCQ", options: ["", ""], correct: null, correctNum: "", points: 1 };
}

function toLocalInput(d: string | Date | undefined | null): string {
  if (!d) return "";
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fmtDT(d: string | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-muted border-border text-muted-foreground",
    PUBLISHED: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300",
    CLOSED: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300",
  };
  const label: Record<string, string> = { DRAFT: "مسودة", PUBLISHED: "منشور", CLOSED: "مقفول" };
  return <span className={cn("text-[10px] font-black border rounded-full px-2.5 py-0.5", map[status] ?? map.DRAFT)}>{label[status] ?? status}</span>;
}

// ============================= المدير المشترك =============================

function TeachingManager({ kind }: { kind: "exams" | "assignments" }) {
  const isExam = kind === "exams";
  const ep = isExam ? "/api/teacher-portal/exams" : "/api/teacher-portal/assignments";

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await tapi<{ groups: GroupOpt[]; exams?: Row[]; assignments?: Row[] }>(ep, { silent: true });
      setGroups(d.groups);
      setRows((d.exams ?? d.assignments ?? []) as Row[]);
    } catch { /* toast */ } finally { setLoading(false); }
  }, [ep]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await tapi(ep, { method: "PATCH", body: { id, action } });
      toast.success("تم ✅");
      if (detailId) setDetailId(null);
      await load();
    } catch { /* toast */ } finally { setBusyId(null); }
  }

  async function del(id: string) {
    if (busyId || !confirm("متأكد من مسح المسودة؟")) return;
    setBusyId(id);
    try {
      await tapi(`${ep}?id=${id}`, { method: "DELETE" });
      toast.success("اتمسحت المسودة.");
      await load();
    } catch { /* toast */ } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-black text-base flex items-center gap-2">
          {isExam ? <FileCheck2 className="w-5 h-5 nk-brand-text" /> : <ClipboardList className="w-5 h-5 nk-brand-text" />}
          {isExam ? "امتحانات مجموعاتي" : "واجبات مجموعاتي"}
        </h2>
        <button
          onClick={() => { setEditRow(null); setFormOpen(true); }}
          className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2 shadow flex items-center gap-1.5 text-xs active:scale-[0.97] transition"
        >
          <Plus className="w-4 h-4" /> {isExam ? "امتحان جديد" : "واجب جديد"}
        </button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl p-8 text-center space-y-2">
          <p className="font-extrabold text-sm">{isExam ? "مفيش امتحانات لسه" : "مفيش واجبات لسه"}</p>
          <p className="text-xs text-muted-foreground font-bold leading-relaxed">
            {isExam ? "اعمل أول امتحان لمجموعاتك — الطالب هيلاقيه في بورتاله ويتصحح أوتوماتيك." : "اعمل أول واجب لمجموعاتك — بيتسجل لحد ميعاد التسليم ويتصحح فورًا."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id} className="nk-card rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{r.title}</h3>
                  <p className="text-[11px] text-muted-foreground font-bold">{r.subject} — {r.groupName}</p>
                </div>
                <StatusChip status={r.status} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-bold text-muted-foreground">
                <span className="rounded-lg bg-muted/60 border border-border px-2 py-0.5">{r.questionsCount} سؤال</span>
                <span className="rounded-lg bg-muted/60 border border-border px-2 py-0.5">
                  {isExam ? `${r.attemptsCount ?? 0} محاولة` : `${r.submissionsCount ?? 0} تسليم`}
                </span>
                {r.avgPct != null && <span className="rounded-lg bg-sky-50 border border-sky-200 text-sky-700 px-2 py-0.5">متوسط {r.avgPct}%</span>}
                <span className="rounded-lg bg-muted/60 border border-border px-2 py-0.5">
                  {isExam ? `يفتح ${fmtDT(r.startAt)}` : `تسليم ${fmtDT(r.deadline)}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => setDetailId(r.id)} className="rounded-xl border border-border bg-card font-bold text-xs px-3 py-2 flex items-center gap-1.5 active:scale-[0.97] transition">
                  <Eye className="w-3.5 h-3.5" /> تفاصيل
                </button>
                {r.status === "DRAFT" && (
                  <>
                    <button onClick={() => act(r.id, "publish")} disabled={!!busyId} className="rounded-xl bg-emerald-700 text-white font-bold text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-60 active:scale-[0.97] transition">
                      <Send className="w-3.5 h-3.5" /> نشر
                    </button>
                    <button onClick={() => { setEditRow(r); setFormOpen(true); }} className="rounded-xl border border-border bg-card font-bold text-xs px-3 py-2 flex items-center gap-1.5 active:scale-[0.97] transition">
                      <Pencil className="w-3.5 h-3.5" /> تعديل
                    </button>
                    <button onClick={() => del(r.id)} disabled={!!busyId} className="rounded-xl border border-rose-200 text-rose-600 bg-card font-bold text-xs px-3 py-2 active:scale-[0.97] transition" aria-label="مسح">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {r.status === "PUBLISHED" && (
                  <>
                    <button onClick={() => act(r.id, "close")} disabled={!!busyId} className="rounded-xl bg-rose-700 text-white font-bold text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-60 active:scale-[0.97] transition">
                      <Lock className="w-3.5 h-3.5" /> قفل
                    </button>
                    <button onClick={() => { setEditRow(r); setFormOpen(true); }} className="rounded-xl border border-border bg-card font-bold text-xs px-3 py-2 flex items-center gap-1.5 active:scale-[0.97] transition">
                      <Pencil className="w-3.5 h-3.5" /> تعديل
                    </button>
                  </>
                )}
                {r.status === "CLOSED" && (
                  <button onClick={() => act(r.id, "reopen")} disabled={!!busyId} className="rounded-xl border border-border bg-card font-bold text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-60 active:scale-[0.97] transition">
                    <Unlock className="w-3.5 h-3.5" /> إعادة فتح
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <FormDialog
          kind={kind}
          groups={groups}
          initial={editRow}
          onClose={() => { setFormOpen(false); setEditRow(null); }}
          onSaved={() => { setFormOpen(false); setEditRow(null); void load(); }}
        />
      )}
      {detailId && (
        <DetailDialog kind={kind} id={detailId} ep={ep}
          onClose={() => { setDetailId(null); void load(); }} />
      )}
    </div>
  );
}

export function TeacherExams() { return <TeachingManager kind="exams" />; }
export function TeacherAssignments() { return <TeachingManager kind="assignments" />; }

// ============================= فورم الإنشاء/التعديل =============================

function FormDialog({ kind, groups, initial, onClose, onSaved }: {
  kind: "exams" | "assignments";
  groups: GroupOpt[];
  initial: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isExam = kind === "exams";
  const ep = isExam ? "/api/teacher-portal/exams" : "/api/teacher-portal/assignments";

  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [deadline, setDeadline] = useState("");
  const [durationMin, setDurationMin] = useState("30");
  const [allowLate, setAllowLate] = useState(false);
  const [securityMode, setSecurityMode] = useState<"WARNING" | "STRICT">("WARNING");
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [allowAnswerEdit, setAllowAnswerEdit] = useState(true);
  const [reviewVideoUrl, setReviewVideoUrl] = useState("");
  const [qs, setQs] = useState<DraftQuestion[]>([emptyQ()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) {
      setGroupId(initial.groupId);
      setTitle(initial.title);
      setInstructions(initial.instructions ?? "");
      if (isExam) {
        setStartAt(toLocalInput(initial.startAt));
        setEndAt(toLocalInput(initial.endAt));
        setDurationMin(String(initial.durationMin ?? 30));
        setSecurityMode(initial.securityMode === "STRICT" ? "STRICT" : "WARNING");
        setShuffleQuestions(!!initial.shuffleQuestions);
        setShuffleOptions(!!initial.shuffleOptions);
        setAllowAnswerEdit(initial.allowAnswerEdit !== false);
      } else {
        setDeadline(toLocalInput(initial.deadline));
        setAllowLate(!!initial.allowLate);
      }
      setReviewVideoUrl(initial.reviewVideoUrl ?? "");
      // جيب الأسئلة من التفاصيل — محتاجين correctAnswer
      void (async () => {
        try {
          const d = await tapi<{ exam?: Detail; assignment?: Detail }>(`${ep}?id=${initial.id}`, { silent: true });
          const det = d.exam ?? d.assignment;
          if (det) {
            setQs(det.questions.map((q) => ({
              text: q.text,
              type: (["MCQ", "TRUE_FALSE", "NUM"].includes(q.type) ? q.type : "MCQ") as DraftQuestion["type"],
              options: q.options ? (JSON.parse(q.options) as string[]) : ["", ""],
              correct: q.type === "MCQ" && q.correctAnswer != null ? Number(q.correctAnswer) : null,
              correctNum: q.type === "NUM" ? (q.correctAnswer ?? "") : "",
              points: q.points,
            })));
          }
        } catch { /* toast */ }
      })();
    } else {
      setGroupId(""); setTitle(""); setInstructions(""); setStartAt(""); setEndAt("");
      setDeadline(""); setDurationMin("30"); setAllowLate(false); setSecurityMode("WARNING");
      setShuffleQuestions(false); setShuffleOptions(false); setAllowAnswerEdit(true);
      setReviewVideoUrl(""); setQs([emptyQ()]);
    }
  }, [initial, isExam, ep]);

  function setQ(i: number, patch: Partial<DraftQuestion>) {
    setQs((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  const valid = title.trim().length >= 3 && groupId
    && (!isExam || (startAt && endAt && Number(durationMin) >= 1))
    && (isExam || deadline)
    && qs.every((q) => q.text.trim()
      && (q.type !== "MCQ" || (q.correct != null && q.options.filter(Boolean).length >= 2))
      && (q.type !== "NUM" || q.correctNum.trim()));

  async function submit(publish: boolean) {
    if (busy || !valid) return;
    setBusy(true);
    try {
      const base = {
        title: title.trim(), instructions: instructions.trim() || null,
        reviewVideoUrl: reviewVideoUrl.trim() || null,
        questions: qs.map((q) => ({
          text: q.text, type: q.type, points: q.points,
          options: q.type === "MCQ" ? q.options.filter(Boolean) : undefined,
          correctAnswer: q.type === "MCQ" ? String(q.correct ?? "") : q.type === "TRUE_FALSE" ? "true" : q.correctNum,
        })),
      };
      if (initial) {
        await tapi(ep, {
          method: "PATCH",
          body: { id: initial.id, action: "update", ...(isExam ? { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), durationMin: Number(durationMin), shuffleQuestions, shuffleOptions, allowAnswerEdit, securityMode } : { deadline: new Date(deadline).toISOString(), allowLate }), ...base },
        });
        toast.success("اتعدّل ✅");
      } else {
        await tapi(ep, {
          method: "POST",
          body: { groupId, ...(isExam ? { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), durationMin: Number(durationMin), shuffleQuestions, shuffleOptions, allowAnswerEdit, securityMode } : { deadline: new Date(deadline).toISOString(), allowLate }), ...base, publish },
        });
        toast.success(publish ? "اتنشر — الطلاب يشوفوه في بورتالهم ✅" : "اتحفظ كمسودة ✅");
      }
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isExam ? <FileCheck2 className="w-5 h-5 nk-brand-text" /> : <ClipboardList className="w-5 h-5 nk-brand-text" />}
            {initial ? (isExam ? "تعديل امتحان" : "تعديل واجب") : (isExam ? "امتحان جديد" : "واجب جديد")}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {isExam
              ? "الوقت والدرجة من السيرفر — الطالب معاه مرة واحدة بمدة محددة وبيتسلم أوتوماتيك."
              : "الواجب بيتسلم لحد الميعاد — الطالب يقدر يسيب ويرجع يكمل، والتصحيح فوري."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-bold block mb-1">المجموعة</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!!initial} className={cn(inputCls, "disabled:opacity-60")}>
              <option value="">اختار المجموعة…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.subject} — {g.grade} {g.name}</option>)}
            </select>
            {groups.length === 0 && (
              <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-1.5">
                مفيش مجموعات مرتبطة بحسابك — كلم إدارة السنتر تربطك بمجموعاتك الأول.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-bold block mb-1">العنوان</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isExam ? "امتحان الفترة — فيزياء" : "واجب الأسبوع — تربيع المعادلات"} className={inputCls} />
          </div>
          {isExam ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold block mb-1">يفتح في</label>
                <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={cn(inputCls, "nk-num")} />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">يقفل في</label>
                <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className={cn(inputCls, "nk-num")} />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">مدة المحاولة (دقيقة)</label>
                <input value={durationMin} onChange={(e) => setDurationMin(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" dir="ltr" className={cn(inputCls, "nk-num")} />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">سياسة الأمن</label>
                <select value={securityMode} onChange={(e) => setSecurityMode(e.target.value as "WARNING" | "STRICT")} className={inputCls}>
                  <option value="WARNING">تنبيهات</option>
                  <option value="STRICT">صارم — الخروج بيلغي</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="text-xs font-bold block mb-1">ميعاد التسليم</label>
                <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={cn(inputCls, "nk-num")} />
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 cursor-pointer">
                <span className="text-xs font-bold">يسمح بالتسليم المتأخر (بيتعلّم عليه متأخر)</span>
                <input type="checkbox" className="w-5 h-5 accent-[var(--c-primary)]" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />
              </label>
            </div>
          )}
          <div>
            <label className="text-xs font-bold block mb-1">تعليمات للطالب (اختياري)</label>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="اقرأ كل سؤال كويس" className="w-full rounded-xl border-2 border-input bg-card px-3 py-2 font-bold text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold block mb-1">فيديو المراجعة بعد التسليم (اختياري)</label>
            <input value={reviewVideoUrl} onChange={(e) => setReviewVideoUrl(e.target.value)} dir="ltr" placeholder="https://youtube.com/..." className={cn(inputCls, "nk-num")} />
          </div>

          {isExam && (
            <div className="grid grid-cols-1 gap-1.5">
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2 cursor-pointer">
                <span className="text-xs font-bold">ترتيب عشوائي للأسئلة</span>
                <input type="checkbox" className="w-5 h-5 accent-[var(--c-primary)]" checked={shuffleQuestions} onChange={(e) => setShuffleQuestions(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2 cursor-pointer">
                <span className="text-xs font-bold">ترتيب عشوائي للاختيارات</span>
                <input type="checkbox" className="w-5 h-5 accent-[var(--c-primary)]" checked={shuffleOptions} onChange={(e) => setShuffleOptions(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2 cursor-pointer">
                <span className="text-xs font-bold">الطالب يعدل إجابته قبل التسليم</span>
                <input type="checkbox" className="w-5 h-5 accent-[var(--c-primary)]" checked={allowAnswerEdit} onChange={(e) => setAllowAnswerEdit(e.target.checked)} />
              </label>
            </div>
          )}

          <div className="space-y-2.5">
            <p className="text-xs font-black nk-brand-text">الأسئلة ({qs.length})</p>
            {qs.map((q, i) => (
              <div key={i} className="rounded-2xl border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black nk-brand-text">سؤال {i + 1}</span>
                  <div className="flex items-center gap-1.5">
                    <select value={q.type} onChange={(e) => setQ(i, { type: e.target.value as DraftQuestion["type"], correct: null, correctNum: "" })} className="h-8 rounded-lg border border-input bg-card px-2 text-[11px] font-bold">
                      <option value="MCQ">اختيار من متعدد</option>
                      <option value="TRUE_FALSE">صح وغلط</option>
                      <option value="NUM">رقمي</option>
                    </select>
                    <input value={q.points} onChange={(e) => setQ(i, { points: Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 1 })} title="النقاط" inputMode="numeric" dir="ltr" className="w-12 h-8 rounded-lg border border-input bg-card px-2 text-center text-[11px] font-bold nk-num" />
                    {qs.length > 1 && (
                      <button onClick={() => setQs((prev) => prev.filter((_, idx) => idx !== i))} aria-label="حذف السؤال" className="h-8 w-8 grid place-items-center rounded-lg text-rose-600 hover:bg-rose-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <input value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} placeholder={`نص السؤال ${i + 1}…`} className={inputSm} />
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
                        <input value={opt} onChange={(e) => setQ(i, { options: q.options.map((o, x) => (x === oi ? e.target.value : o)) })} placeholder={`الاختيار ${oi + 1}`} className="flex-1 h-9 rounded-lg border border-input bg-card px-2.5 font-bold text-xs" />
                        {q.options.length > 2 && (
                          <button onClick={() => setQ(i, { options: q.options.filter((_, x) => x !== oi), correct: q.correct === oi ? null : q.correct })} aria-label="حذف الاختيار" className="w-7 h-8 grid place-items-center rounded-lg text-rose-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {q.options.length < 6 && (
                      <button onClick={() => setQ(i, { options: [...q.options, ""] })} className="text-[11px] font-black nk-brand-text flex items-center gap-1 pt-0.5">
                        <Plus className="w-3.5 h-3.5" /> ضيف اختيار
                      </button>
                    )}
                  </div>
                )}
                {q.type === "TRUE_FALSE" && (
                  <div className="flex items-center gap-1.5">
                    {(["true", "false"] as const).map((v) => (
                      <button key={v} onClick={() => setQ(i, { correctNum: v, correct: v === "true" ? 1 : 0 })}
                        className={cn("flex-1 h-9 rounded-lg border-2 font-bold text-xs transition",
                          (q.correctNum || (q.correct != null ? (q.correct === 1 ? "true" : "false") : "")) === v
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border bg-card text-muted-foreground")}>
                        {v === "true" ? "صح ✓" : "غلط ✗"}
                      </button>
                    ))}
                  </div>
                )}
                {q.type === "NUM" && (
                  <input value={q.correctNum} onChange={(e) => setQ(i, { correctNum: e.target.value, correct: null })} dir="ltr" placeholder="الإجابة الرقمية الصحيحة — مثال: 42 أو 3.5" className={cn(inputSm, "nk-num")} />
                )}
              </div>
            ))}
            <button onClick={() => setQs((prev) => [...prev, emptyQ()])} className="w-full rounded-xl border-2 border-dashed border-border py-2.5 text-xs font-black nk-brand-text flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" /> ضيف سؤال
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={() => submit(false)} disabled={busy || !valid} className="flex-1 rounded-xl border-2 border-border bg-card font-extrabold py-3 text-sm disabled:opacity-50">
              حفظ كمسودة
            </button>
            <button onClick={() => submit(true)} disabled={busy || !valid} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3 text-sm disabled:opacity-50 flex items-center justify-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} نشر دلوقتي
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================= تفاصيل + المحاولات =============================

function DetailDialog({ kind, id, ep, onClose }: { kind: "exams" | "assignments"; id: string; ep: string; onClose: () => void }) {
  const isExam = kind === "exams";
  const [det, setDet] = useState<Detail | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const d = await tapi<{ exam?: Detail; assignment?: Detail }>(`${ep}?id=${id}`, { silent: true });
        setDet(d.exam ?? d.assignment ?? null);
      } catch { toast.error("مش قادر يجيب التفاصيل."); }
    })();
  }, [id, ep]);

  const attempts = det?.attempts ?? [];
  const submissions = det?.submissions ?? [];
  const done = isExam ? attempts.filter((a) => a.status !== "IN_PROGRESS") : submissions.filter((s) => s.status !== "DRAFT");
  const pending = isExam ? attempts.filter((a) => a.status === "IN_PROGRESS") : submissions.filter((s) => s.status === "DRAFT");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="text-base">{det?.title ?? "..."}</DialogTitle>
          <DialogDescription className="text-[11px]">
            {det ? `${det.subject} — ${det.groupName} • ${det.questions.length} سؤال • الدرجة الكلية ${det.maxScore}` : "جاري التحميل…"}
          </DialogDescription>
        </DialogHeader>
        {!det ? (
          <div className="grid place-items-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-muted/30 p-3 space-y-1.5 text-[11.5px] font-bold">
              {isExam ? (
                <>
                  <p>⏰ يفتح: <span className="nk-num">{fmtDT(det.startAt)}</span> — يقفل: <span className="nk-num">{fmtDT(det.endAt)}</span></p>
                  <p>⏱️ مدة المحاولة: <span className="nk-num">{det.durationMin}</span> دقيقة — سياسة: {det.securityMode === "STRICT" ? "صارمة" : "تنبيهات"}</p>
                </>
              ) : (
                <>
                  <p>📅 ميعاد التسليم: <span className="nk-num">{fmtDT(det.deadline)}</span>{det.allowLate ? " (بسمح بالمتأخر)" : ""}</p>
                </>
              )}
              {det.reviewVideoUrl && <p className="truncate">🎬 فيديو المراجعة: <a href={det.reviewVideoUrl} target="_blank" rel="noreferrer" className="underline nk-brand-text" dir="ltr">{det.reviewVideoUrl}</a></p>}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-black">الأسئلة والإجابات الصحيحة</p>
              {det.questions.map((q, i) => (
                <div key={q.id} className="rounded-xl border border-border bg-card p-2.5 text-[11.5px] font-bold">
                  <span className="nk-brand-text font-black">{i + 1}.</span> {q.text} <span className="text-muted-foreground">({q.points} ن)</span>
                  <p className="text-emerald-700 dark:text-emerald-400 mt-0.5">
                    الإجابة: {q.type === "MCQ" && q.options
                      ? (JSON.parse(q.options) as string[])[Number(q.correctAnswer)] ?? "—"
                      : q.type === "TRUE_FALSE" ? (q.correctAnswer === "true" ? "صح" : "غلط") : q.correctAnswer}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-black flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {isExam ? `المحاولات (${done.length} سلّموا • ${pending.length} شغالة)` : `التسليمات (${done.length} سلّموا • ${pending.length} بيكملوا)`}
              </p>
              {done.length === 0 && pending.length === 0 && (
                <p className="text-[11px] text-muted-foreground font-bold bg-muted/40 rounded-xl px-3 py-2.5">محدش بدأ لسه.</p>
              )}
              {done.map((a) => {
                const st = "status" in a ? a.status : "";
                const score = a.score;
                const flags = "securityFlags" in a ? a.securityFlags : 0;
                const late = "late" in a ? a.late : false;
                return (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[11.5px] font-bold">
                    <span className="truncate">{a.studentName} <span className="text-muted-foreground nk-num">({a.studentCode})</span></span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {late && <span className="text-[10px] font-black bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5">متأخر</span>}
                      {flags > 0 && <span className="text-[10px] font-black bg-rose-50 border border-rose-200 text-rose-700 rounded-full px-2 py-0.5">{flags} تنبيه</span>}
                      {st === "INVALIDATED" ? (
                        <span className="text-[10px] font-black bg-rose-50 border border-rose-200 text-rose-700 rounded-full px-2 py-0.5">ملغاة</span>
                      ) : score != null ? (
                        <span className="text-[10px] font-black bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full px-2 py-0.5 nk-num">{score}/{det.maxScore}</span>
                      ) : (
                        <span className="text-[10px] font-black bg-sky-50 border border-sky-200 text-sky-700 rounded-full px-2 py-0.5">اتسلم</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {pending.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] font-bold">
                  <span className="truncate">{a.studentName} <span className="text-muted-foreground nk-num">({a.studentCode})</span></span>
                  <span className="text-[10px] font-black text-amber-700 shrink-0">{isExam ? "بيحل دلوقتي…" : "بيكمل…"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
