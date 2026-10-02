"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NotebookPen, Loader2, AlarmClock, ChevronRight, CheckCircle2, XCircle,
  Video, Save, Send, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { papi } from "./portal-api";

/* ============================================================
   الواجبات في بورتال الطالب — التجربة المرنة (مش امتحان):
   - تسيب وترجع تكمل لحد ميعاد التسليم (السيرفر هو اللي بيقرر الميعاد)
   - حفظ تلقائي للمسودة كل شوية + زرار حفظ يدوي
   - التسليم: تصحيح فوري + فيديو المراجعة لو موجود
   - التأخير: مرفوض من السيرفر إلا لو المدير سمح بيه (يتعلّم متأخر)
============================================================ */

type AssignmentRow = {
  id: string; title: string; subject: string; groupName: string;
  deadline: string; allowLate: boolean; maxScore: number; mode: string;
  state: string; score: number | null; late: boolean; submittedAt: string | null;
};

type StudentQuestion = { id: string; order: number; text: string; type: string; points: number; options: string[] | null };

type OpenState = {
  phase: "open";
  title: string; instructions: string | null; mode: string;
  deadline: string; remainingMs: number; allowLate: boolean; maxScore: number;
  questions: StudentQuestion[];
  answers: { questionId: string; answer: string }[];
  draftSavedAt: string | null;
};

type SubmittedState = {
  phase: "submitted";
  title: string; maxScore: number; status: string; score: number | null;
  late: boolean; submittedAt: string | null; reviewVideoUrl: string | null;
};

type Opened = OpenState | SubmittedState | { phase: "missed" } | { phase: "closed" };

const STATE_STYLE: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "متاح", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  IN_PROGRESS: { label: "بدأته — كمّل", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300" },
  SUBMITTED: { label: "تسلّم", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  GRADED: { label: "متصحح", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  MISSED: { label: "فوّت الميعاد", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
  CLOSED: { label: "مقفول", cls: "bg-muted text-muted-foreground border-border" },
};

function fmtDT(v: string | Date | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function remainingLabel(ms: number): string {
  if (ms <= 0) return "خلص الوقت";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `باقي ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `باقي ${hours} ساعة و${mins % 60} دقيقة`;
  return `باقي ${Math.floor(hours / 24)} يوم و${hours % 24} ساعة`;
}

export function PortalAssignments() {
  const [rows, setRows] = useState<AssignmentRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    papi<{ assignments: AssignmentRow[] }>("/api/portal/assignments", { silent: true })
      .then((d) => setRows(d.assignments))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // ديب-لينك من زرار المشاركة: /portal?tab=assignments&open=<id> — يفتح الواجب على طول
  useEffect(() => {
    try {
      const open = new URLSearchParams(window.location.search).get("open");
      if (open) {
        setOpenId(open);
        window.history.replaceState(null, "", "/portal?tab=assignments");
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (openId) return <AssignmentRunner id={openId} onExit={() => { setOpenId(null); load(); }} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-lg flex items-center gap-2"><NotebookPen className="w-5 h-5 nk-brand-text" /> الواجبات</h2>
        <button onClick={load} className="text-xs font-bold text-muted-foreground">تحديث</button>
      </div>

      {!rows ? (
        <div className="nk-card rounded-2xl p-8 flex items-center justify-center gap-2 text-muted-foreground font-bold">
          <Loader2 className="w-5 h-5 animate-spin" /> جاري التحميل…
        </div>
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl p-8 text-center text-sm font-bold text-muted-foreground">
          مفيش واجبات دلوقتي — لما المدرس ينشر واجب هيظهر هنا.
        </div>
      ) : (
        rows.map((a) => {
          const st = STATE_STYLE[a.state] ?? STATE_STYLE.CLOSED;
          const past = new Date(a.deadline) < new Date();
          return (
            <button key={a.id} onClick={() => setOpenId(a.id)}
              className="nk-card rounded-2xl p-4 w-full text-start hover:shadow-md active:scale-[0.99] transition space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{a.title}</h3>
                  <p className="text-[11px] font-bold text-muted-foreground">{a.subject} — {a.groupName}</p>
                </div>
                <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0", st.cls)}>{st.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-muted-foreground">
                <span className={cn("flex items-center gap-1", past && a.state !== "SUBMITTED" && a.state !== "GRADED" && "text-rose-600")}>
                  <AlarmClock className="w-3 h-3" /> التسليم: <span className="nk-num">{fmtDT(a.deadline)}</span>
                </span>
                {a.late && <span className="text-amber-600">متأخر</span>}
                {a.score != null && (
                  <span className="nk-brand-text font-black nk-num">درجتك: {a.score}/{a.maxScore}</span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

/* ============================= شاشة الواجب ============================= */

function AssignmentRunner({ id, onExit }: { id: string; onExit: () => void }) {
  const [state, setState] = useState<Opened | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const pendingRef = useRef<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef<Record<string, string>>({});
  const cacheKey = `nk-assign-${id}`;

  const openState = useCallback(async () => {
    setLoading(true);
    try {
      const d = await papi<Opened>(`/api/portal/assignments/${id}`);
      setState(d);
      if (d.phase === "open") {
        const saved: Record<string, string> = {};
        for (const a of d.answers) saved[a.questionId] = a.answer;
        try {
          const local = JSON.parse(localStorage.getItem(cacheKey) ?? "{}") as Record<string, string>;
          for (const [qid, ans] of Object.entries(local)) {
            if (!(qid in saved)) { saved[qid] = ans; pendingRef.current[qid] = ans; }
          }
        } catch { /* ignore */ }
        setAnswers(saved);
        deadlineRef.current = Date.now() + d.remainingMs;
      }
    } catch { /* toast */ } finally { setLoading(false); }
  }, [id, cacheKey]);

  const deadlineRef = useRef(0);
  useEffect(() => { openState(); }, [openState]);

  // عداد الميعاد (عرض بس — السيرفر هو الحاكم)
  useEffect(() => {
    if (state?.phase !== "open") return;
    const t = setInterval(() => setRemaining(Math.max(0, deadlineRef.current - Date.now())), 1000);
    return () => clearInterval(t);
  }, [state]);

  const save = useCallback(async (silent = true) => {
    const batch = { ...pendingRef.current };
    const all = { ...answersRef.current, ...batch };
    if (state?.phase !== "open") return;
    pendingRef.current = {};
    setSaving("saving");
    try {
      await papi(`/api/portal/assignments/${id}`, {
        method: "POST",
        body: { action: "save", answers: Object.entries(all).map(([questionId, answer]) => ({ questionId, answer })) },
        silent,
      });
      setSaving("saved");
      try { localStorage.setItem(cacheKey, JSON.stringify(all)); } catch { /* ignore */ }
    } catch {
      pendingRef.current = { ...batch, ...pendingRef.current };
      if (!silent) toast.error("مقدرناش نحفظ دلوقتي — هنجرب تاني أوتوماتيك");
      setSaving("idle");
    }
  }, [id, state, cacheKey]);

  // مرجع إجابات حي للفلاش الدوري
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // حفظ تلقائي كل 8 ثواني لو فيه تغييرات
  useEffect(() => {
    if (state?.phase !== "open") return;
    saveTimer.current = setInterval(() => {
      if (Object.keys(pendingRef.current).length) save();
    }, 8000);
    return () => { if (saveTimer.current) clearInterval(saveTimer.current); };
  }, [state, save]);

  function pick(questionId: string, answer: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    pendingRef.current[questionId] = answer;
  }

  async function submit() {
    if (submitting || state?.phase !== "open") return;
    setSubmitting(true);
    try {
      await save();
      const d = await papi<SubmittedState>(`/api/portal/assignments/${id}`, {
        method: "POST",
        body: { action: "submit", answers: Object.entries(answersRef.current).map(([questionId, answer]) => ({ questionId, answer })) },
        silent: true,
      });
      setState(d);
      toast.success("اتسلّم ✅");
      try { localStorage.removeItem(cacheKey); } catch { /* ignore */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "مشكلة في التسليم");
    } finally { setSubmitting(false); }
  }

  if (loading) {
    return <div className="nk-card rounded-2xl p-8 flex items-center justify-center gap-2 text-muted-foreground font-bold"><Loader2 className="w-5 h-5 animate-spin" /> جاري التحميل…</div>;
  }

  if (!state) return <div className="nk-card rounded-2xl p-8 text-center text-sm font-bold text-muted-foreground">حصلت مشكلة في فتح الواجب.</div>;

  if (state.phase === "missed") {
    return (
      <Wrap onExit={onExit}>
        <div className="nk-card rounded-2xl p-8 text-center space-y-2">
          <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
          <h3 className="font-black">فوّت ميعاد التسليم</h3>
          <p className="text-xs font-bold text-muted-foreground">الواجب اتقفل — كلّم المدرس لو فيه ظرف.</p>
        </div>
      </Wrap>
    );
  }
  if (state.phase === "closed") {
    return (
      <Wrap onExit={onExit}>
        <div className="nk-card rounded-2xl p-8 text-center space-y-2">
          <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
          <h3 className="font-black">الواجب مقفول</h3>
        </div>
      </Wrap>
    );
  }

  if (state.phase === "submitted") {
    return (
      <Wrap onExit={onExit}>
        <div className={cn("nk-card rounded-2xl p-6 space-y-3 text-center", state.late && "border-amber-300 dark:border-amber-500/40")}>
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h3 className="font-black text-lg">اتسلّم ✅</h3>
          <p className="text-xs font-bold text-muted-foreground">{state.title} · تسليم {fmtDT(state.submittedAt)}</p>
          {state.late && <p className="text-xs font-black text-amber-600">متسلّم بعد الميعاد — متعلّم متأخر</p>}
          {state.score != null && (
            <div className="rounded-2xl border border-border bg-muted/30 p-5">
              <p className="text-4xl font-black nk-num nk-brand-text">{state.score}<span className="text-lg text-muted-foreground">/{state.maxScore}</span></p>
              <p className="text-[11px] font-bold text-muted-foreground mt-1">الدرجة</p>
            </div>
          )}
          {state.status === "SUBMITTED" && state.score == null && (
            <p className="text-xs font-bold text-muted-foreground">الدرجة هتظهر بعد مراجعة المدرس.</p>
          )}
        </div>
        {state.reviewVideoUrl && (
          <a href={state.reviewVideoUrl} target="_blank" rel="noreferrer" className="nk-card rounded-2xl p-4 flex items-center gap-3 hover:shadow-md transition">
            <div className="w-10 h-10 rounded-xl nk-brand-bg grid place-items-center shrink-0"><Video className="w-5 h-5 text-white" /></div>
            <div>
              <p className="font-extrabold text-sm">فيديو مراجعة الواجب</p>
              <p className="text-[11px] font-bold text-muted-foreground">اضغط للمشاهدة</p>
            </div>
          </a>
        )}
      </Wrap>
    );
  }

  // ---------- شاشة الحل (مرنة) ----------
  const q = state.questions[0] ? state.questions : [];
  const answeredCount = Object.keys(answers).length;
  return (
    <Wrap onExit={onExit}>
      <div className="nk-card rounded-2xl p-4 space-y-2 sticky top-0 z-20">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black text-sm truncate">{state.title}</h3>
          <span className={cn("rounded-lg px-2.5 py-1 text-xs font-black nk-num shrink-0",
            remaining < 30 * 60_000 ? "bg-rose-600 text-white" : "bg-muted text-foreground")}>
            <AlarmClock className="w-3.5 h-3.5 inline" /> {remainingLabel(remaining)}
          </span>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground">
          تقدر تسيب وترجع في أي وقت — <span className="nk-num">{answeredCount}/{q.length}</span> متجاوب
          {saving === "saving" ? " · بيتحفظ…" : saving === "saved" ? " · اتحفظ ✅" : ""}
        </p>
      </div>

      {state.instructions && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/30 p-3 flex gap-2">
          <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
          <p className="text-xs font-bold text-sky-800 dark:text-sky-300 leading-relaxed">{state.instructions}</p>
        </div>
      )}

      {state.questions.map((qq) => (
        <div key={qq.id} className="nk-card rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-extrabold text-sm leading-relaxed">{qq.order}. {qq.text}</h3>
            <span className="text-[10px] font-black text-muted-foreground shrink-0 nk-num">{qq.points} ن</span>
          </div>
          {qq.type === "MCQ" && qq.options && (
            <div className="space-y-1.5">
              {qq.options.map((opt, oi) => (
                <button key={oi} onClick={() => pick(qq.id, String(oi))}
                  className={cn("w-full text-start rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition active:scale-[0.99]",
                    answers[qq.id] === String(oi) ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card")}>
                  {opt}
                </button>
              ))}
            </div>
          )}
          {qq.type === "TRUE_FALSE" && (
            <div className="grid grid-cols-2 gap-2">
              {[["true", "صح"], ["false", "غلط"]].map(([v, label]) => (
                <button key={v} onClick={() => pick(qq.id, v)}
                  className={cn("rounded-xl border-2 px-3 py-3 text-sm font-black transition active:scale-[0.99]",
                    answers[qq.id] === v ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card")}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {qq.type === "NUM" && (
            <input
              value={answers[qq.id] ?? ""}
              onChange={(e) => pick(qq.id, e.target.value)}
              inputMode="decimal" dir="ltr" placeholder="اكتب إجابتك الرقمية…"
              className="w-full h-14 rounded-xl border-2 border-input bg-card px-4 text-xl font-black text-center nk-num"
            />
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <button onClick={() => save(false)} disabled={saving === "saving"}
          className="flex-1 h-12 rounded-2xl border-2 border-border bg-card font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
          <Save className="w-4 h-4" /> حفظ التقدم
        </button>
        <button onClick={submit} disabled={submitting}
          className="flex-1 h-12 rounded-2xl nk-brand-bg text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} سلّم الواجب
        </button>
      </div>
      <p className="text-[10px] font-bold text-muted-foreground text-center">
        {state.allowLate ? "التسليم بعد الميعاد مسموح بس هيتعلّم متأخر." : "آخر لحظة للتسليم هي الميعاد — بعده السيرفر بيرفض."}
      </p>
    </Wrap>
  );
}

function Wrap({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  return (
    <div className="space-y-3">
      <button onClick={onExit} className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
        <ChevronRight className="w-4 h-4" /> رجوع للواجبات
      </button>
      {children}
    </div>
  );
}
