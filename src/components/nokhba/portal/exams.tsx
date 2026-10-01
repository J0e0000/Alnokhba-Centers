"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileCheck2, Loader2, AlarmClock, ChevronLeft, ChevronRight, ShieldAlert,
  Wifi, WifiOff, CheckCircle2, Circle, AlertTriangle, PlayCircle, XCircle, Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { papi } from "./portal-api";

/* ============================================================
   الامتحانات في بورتال الطالب — التجربة الصارمة:
   - المؤقت من السيرفر (remainingMs) — ساعة جهاز الطالب ملهاش تأثير
   - كل الإجابات بتتحفظ على السيرفر أول بأول (طابور مقاوم لضعف النت)
   - أوتوسبمنت لما الوقت يخلص — السيرفر هو اللي بيقرر
   - أحداث الأمن (تبديل تاب/خروج فول سكرين) بتتسجل سيرفرًا،
     والسياسة الصارمة بتلغي المحاولة فورًا
============================================================ */

type ExamRow = {
  id: string; title: string; subject: string; groupName: string;
  startAt: string; endAt: string; durationMin: number; maxScore: number;
  securityMode: string; state: string; score: number | null;
  submittedAt: string | null; serverNow: string;
};

type StudentQuestion = { id: string; order: number; text: string; type: string; points: number; options: string[] | null };

type Running = {
  phase: "running";
  attemptId: string;
  expiresAt: string;
  remainingMs: number;
  allowAnswerEdit: boolean;
  securityMode: string;
  title: string;
  instructions: string | null;
  maxScore: number;
  questions: StudentQuestion[];
  answers: { questionId: string; answer: string }[];
};

type Ready = {
  phase: "ready";
  title: string; instructions: string | null; durationMin: number;
  maxScore: number; questionsCount: number; securityMode: string; endAt: string;
};

type Result = {
  phase: "result";
  title: string; maxScore: number; status: string; score: number | null;
  submittedAt: string | null; reviewVideoUrl: string | null;
};

type OpenState = Ready | Running | Result | { phase: "notyet"; startAt: string } | { phase: "missed" } | { phase: "closed" };

const STATE_STYLE: Record<string, { label: string; cls: string }> = {
  NOT_YET: { label: "لسه ما فتحش", cls: "bg-muted text-muted-foreground border-border" },
  AVAILABLE: { label: "متاح دلوقتي", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  IN_PROGRESS: { label: "شغالة دلوقتي", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300" },
  SUBMITTED: { label: "تسلّم", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  INVALIDATED: { label: "اتلغت — سياسة صارمة", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
  MISSED: { label: "فوّته", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300" },
  CLOSED: { label: "مقفول", cls: "bg-muted text-muted-foreground border-border" },
};

function fmtDT(v: string | Date | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function PortalExams() {
  const [rows, setRows] = useState<ExamRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    papi<{ exams: ExamRow[] }>("/api/portal/exams", { silent: true })
      .then((d) => setRows(d.exams))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (openId) return <ExamRunner id={openId} onExit={() => { setOpenId(null); load(); }} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-lg flex items-center gap-2"><FileCheck2 className="w-5 h-5 nk-brand-text" /> الامتحانات</h2>
        <button onClick={load} className="text-xs font-bold text-muted-foreground">تحديث</button>
      </div>

      {!rows ? (
        <div className="nk-card rounded-2xl p-8 flex items-center justify-center gap-2 text-muted-foreground font-bold">
          <Loader2 className="w-5 h-5 animate-spin" /> جاري التحميل…
        </div>
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl p-8 text-center text-sm font-bold text-muted-foreground">
          مفيش امتحانات دلوقتي — لما المدرس ينشر امتحان هيظهر هنا.
        </div>
      ) : (
        rows.map((e) => {
          const st = STATE_STYLE[e.state] ?? STATE_STYLE.CLOSED;
          return (
            <button key={e.id} onClick={() => setOpenId(e.id)}
              className="nk-card rounded-2xl p-4 w-full text-start hover:shadow-md active:scale-[0.99] transition space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm truncate">{e.title}</h3>
                  <p className="text-[11px] font-bold text-muted-foreground">{e.subject} — {e.groupName}</p>
                </div>
                <span className={cn("text-[10px] font-bold rounded-full border px-2 py-0.5 shrink-0", st.cls)}>{st.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-muted-foreground">
                <span className="flex items-center gap-1"><AlarmClock className="w-3 h-3" /> <span className="nk-num">{e.durationMin}</span> دقيقة</span>
                <span className="nk-num">{fmtDT(e.startAt)} ← {fmtDT(e.endAt)}</span>
                {e.score != null && (
                  <span className="nk-brand-text font-black nk-num">درجتك: {e.score}/{e.maxScore}</span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

/* ============================= شاشة الامتحان (Runner) ============================= */

type SyncState = "synced" | "pending" | "offline";

function ExamRunner({ id, onExit }: { id: string; onExit: () => void }) {
  const [state, setState] = useState<OpenState | null>(null);
  const [loading, setLoading] = useState(true);

  // حالة المحاولة الشغالة
  const running = state?.phase === "running" ? state : null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [sync, setSync] = useState<SyncState>("synced");
  const [submitting, setSubmitting] = useState(false);
  const [terminated, setTerminated] = useState<string | null>(null);

  // طابور الحفظ المحلي (مقاوم لانقطاع النت)
  const pendingRef = useRef<Record<string, string>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number>(0);
  const focusEventAt = useRef<number>(0);
  const inFullscreen = useRef<boolean>(false);
  const submittedRef = useRef<boolean>(false);
  const attemptsCacheKey = running ? `nk-exam-${running.attemptId}` : "";

  // ============================= تحميل الحالة =============================
  // تطبيق حمولة محاولة شغالة (من GET أو من POST start) — السيرفر هو مرجع الوقت والإجابات
  const applyRunning = useCallback((d: Extract<OpenState, { phase: "running" }>) => {
    setState(d);
    deadlineRef.current = Date.now() + d.remainingMs;
    setRemaining(d.remainingMs);
    const saved: Record<string, string> = {};
    for (const a of d.answers) saved[a.questionId] = a.answer;
    // دمج الإجابات المحلية اللي ممكن ماتبعتش (أوفلاين) — السيرفر مرجع، المحلي بيكمل الفاقد
    try {
      const local = JSON.parse(localStorage.getItem(`nk-exam-${d.attemptId}`) ?? "{}") as Record<string, string>;
      for (const [qid, ans] of Object.entries(local)) {
        if (!(qid in saved)) { saved[qid] = ans; pendingRef.current[qid] = ans; }
      }
    } catch { /* ignore */ }
    setAnswers(saved);
    scheduleFlush();
  }, []);

  const openState = useCallback(async () => {
    setLoading(true);
    try {
      const d = await papi<OpenState>(`/api/portal/exams/${id}`);
      if (d.phase === "running") { applyRunning(d); }
      else setState(d);
    } catch { /* toast */ } finally { setLoading(false); }
  }, [id, applyRunning]);
  useEffect(() => { openState(); }, [openState]);

  // بدء المحاولة فعليًا — POST start على السيرفر (startedAt/expiresAt من ساعة السيرفر)
  const startExam = useCallback(async () => {
    setLoading(true);
    try {
      const d = await papi<OpenState>(`/api/portal/exams/${id}`, { method: "POST", body: { action: "start" } });
      if (d.phase === "running") { applyRunning(d); }
      else if (d.phase === "result") { setState(d); }
      else { await openState(); }
    } catch { /* toast */ } finally { setLoading(false); }
  }, [id, applyRunning, openState]);

  // ============================= حفظ إجابة (طابور + فلاش دوري) =============================
  const flush = useCallback(async () => {
    const batch = { ...pendingRef.current };
    if (!Object.keys(batch).length) return;
    pendingRef.current = {};
    setSync("pending");
    try {
      await Promise.all(
        Object.entries(batch).map(([questionId, answer]) =>
          papi(`/api/portal/exams/${id}`, { method: "POST", body: { action: "answer", questionId, answer }, silent: true }),
        ),
      );
      setSync("synced");
    } catch {
      // النت وقع — رجّع الحزمة للطابور (آخر إجابة تتفوز)
      pendingRef.current = { ...batch, ...pendingRef.current };
      setSync("offline");
    }
  }, [id]);

  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => { flush(); scheduleFlush(); }, 2500);
  }

  function pick(questionId: string, answer: string) {
    if (!running) return;
    if (!running.allowAnswerEdit && answers[questionId] != null) return;
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    pendingRef.current[questionId] = answer;
    try { localStorage.setItem(attemptsCacheKey, JSON.stringify({ ...answers, [questionId]: answer })); } catch { /* ignore */ }
  }

  // ============================= التسليم =============================
  const doSubmit = useCallback(async (auto: boolean) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await flush();
      const d = await papi<Result>(`/api/portal/exams/${id}`, {
        method: "POST",
        body: { action: "submit", auto },
        silent: auto,
      });
      setState((prev) => (prev && prev.phase === "running" ? { ...d, phase: "result" } : d));
      if (auto) toast.info("خلص الوقت — الامتحان اتسلم أوتوماتيك");
      exitFullscreen();
    } catch {
      // فشل التسليم (نت) — السيرفر هيسلمها لوحده أول ما نعمل sync
      submittedRef.current = false;
      if (!auto) toast.error("مقدرناشنسلم دلوقتي — جرب تاني أو استنى إعادة المحاولة");
    } finally { setSubmitting(false); }
  }, [id, flush]);

  const syncServer = useCallback(async () => {
    try {
      const d = await papi<OpenState>(`/api/portal/exams/${id}`, { silent: true });
      if (d.phase === "result") { setState(d); exitFullscreen(); return true; }
      if (d.phase === "running") {
        // تصحيح انحراف الساعة المحلي — السيرفر مرجع
        const drift = d.remainingMs - (deadlineRef.current - Date.now());
        if (Math.abs(drift) > 3000) deadlineRef.current = Date.now() + d.remainingMs;
        return false;
      }
      return false;
    } catch { return false; }
  }, [id]);

  // ============================= ساعة العرض =============================
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const left = deadlineRef.current - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0 && !submittedRef.current) {
        doSubmit(true); // أوتوسبمنت عند الصفر — السيرفر بيتحقق برضه
      }
    }, 500);
    // إعادة مزامنة من السيرفر كل 45 ثانية (تصحيح انحراف + كشف الإنهاء من ناحية السيرفر)
    const s = setInterval(() => { syncServer().then((done) => { if (done) submittedRef.current = true; }); }, 45_000);
    return () => { clearInterval(t); clearInterval(s); };
  }, [running, doSubmit, syncServer]);

  // ============================= أحداث الأمن (أثناء المحاولة بس) =============================

  const reportEvent = useCallback(async (type: string) => {
    if (!running || submittedRef.current) return;
    try {
      const d = await papi<{ terminated?: boolean; reason?: string }>(`/api/portal/exams/${id}`, {
        method: "POST", body: { action: "event", type }, silent: true,
      });
      if (d.terminated) {
        submittedRef.current = true;
        exitFullscreen();
        try { localStorage.removeItem(attemptsCacheKey); } catch { /* ignore */ }
        setTerminated(type);
      }
    } catch { /* نت ضعيف — الحدث بيتسجل أول ما يرجع الاتصال عبر event تاني */ }
  }, [running, id, attemptsCacheKey]);

  useEffect(() => {
    if (!running || terminated) return;

    const onVis = () => { if (document.hidden) reportEvent("TAB_HIDDEN"); };
    const onHide = () => {
      // صفحة بتقفل/بتتنقل — ابعت اللي في الطابور بأقصى جهد (keepalive)
      flush();
      reportEvent("PAGE_LEFT");
    };
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      if (inFullscreen.current && !fs) reportEvent("FULLSCREEN_EXIT");
      inFullscreen.current = fs;
    };
    const onBlur = () => {
      const now = Date.now();
      if (now - focusEventAt.current > 15_000) { focusEventAt.current = now; reportEvent("FOCUS_LOST"); }
    };
    const onOnline = () => { setSync((s) => (s === "offline" ? "pending" : s)); flush(); };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("blur", onBlur);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("online", onOnline);
    };
  }, [running, terminated, reportEvent, flush]);

  function requestFullscreen() {
    try {
      document.documentElement.requestFullscreen?.().then(() => { inFullscreen.current = true; }).catch(() => {});
    } catch { /* مش مدعوم — مش مشكلة */ }
  }
  function exitFullscreen() {
    try { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); } catch { /* ignore */ }
  }

  // ============================= الشاشات =============================

  if (loading) {
    return <div className="nk-card rounded-2xl p-8 flex items-center justify-center gap-2 text-muted-foreground font-bold"><Loader2 className="w-5 h-5 animate-spin" /> جاري التحميل…</div>;
  }

  if (terminated) {
    return (
      <div className="nk-card rounded-2xl p-6 space-y-4 text-center">
        <XCircle className="w-12 h-12 text-rose-600 mx-auto" />
        <h3 className="font-black text-lg">الامتحان اتلغى</h3>
        <p className="text-sm font-bold text-muted-foreground leading-relaxed">
          المحاولة اتقفلت لأنك سبت شاشة الامتحان ({terminated === "FULLSCREEN_EXIT" ? "خرجت من ملء الشاشة" : "فتحت تاب/تطبيق تاني"}).
          كل إجاباتك المحفوظة اتسجلت. كلّم المدرس لو حصل خلاف — الحدث متسجل عندنا بالتوقيت.
        </p>
        <button onClick={onExit} className="nk-brand-bg text-white font-extrabold rounded-xl px-5 py-2.5">رجوع للامتحانات</button>
      </div>
    );
  }

  if (!state) {
    return <div className="nk-card rounded-2xl p-8 text-center text-sm font-bold text-muted-foreground">حصلت مشكلة في فتح الامتحان.</div>;
  }

  // ---------- قبل الفتح ----------
  if (state.phase === "notyet") {
    return <CenterMsg icon={<AlarmClock className="w-10 h-10 text-muted-foreground mx-auto" />} title="الامتحان لسه ما فتحش" sub={`بيفتح في ${fmtDT(state.startAt)}`} onBack={onExit} />;
  }
  if (state.phase === "missed") {
    return <CenterMsg icon={<XCircle className="w-10 h-10 text-rose-600 mx-auto" />} title="فوّت الامتحان" sub="وقت الامتحان خلص وماتبعتش محاولة." onBack={onExit} />;
  }
  if (state.phase === "closed") {
    return <CenterMsg icon={<XCircle className="w-10 h-10 text-rose-600 mx-auto" />} title="الامتحان مقفول" onBack={onExit} />;
  }

  // ---------- النتيجة ----------
  if (state.phase === "result") {
    const invalid = state.status === "INVALIDATED";
    return (
      <div className="space-y-3">
        <button onClick={onExit} className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
          <ChevronRight className="w-4 h-4" /> رجوع للامتحانات
        </button>
        <div className={cn("nk-card rounded-2xl p-6 space-y-3 text-center",
          invalid && "border-rose-300 dark:border-rose-500/40")}>
          {invalid ? <XCircle className="w-12 h-12 text-rose-600 mx-auto" /> : <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />}
          <h3 className="font-black text-lg">{invalid ? "المحاولة اتلغت" : "اتسلّم ✅"}</h3>
          <p className="text-xs font-bold text-muted-foreground">{state.title} · تسليم {fmtDT(state.submittedAt)}</p>
          {state.score != null && (
            <div className="rounded-2xl border border-border bg-muted/30 p-5">
              <p className="text-4xl font-black nk-num nk-brand-text">{state.score}<span className="text-lg text-muted-foreground">/{state.maxScore}</span></p>
              <p className="text-[11px] font-bold text-muted-foreground mt-1">النتيجة النهائية</p>
            </div>
          )}
          <p className="text-[11px] font-bold text-muted-foreground">
            {state.status === "AUTO_SUBMITTED" ? "اتسلّم أوتوماتيك لما الوقت خلص" : state.status === "INVALIDATED" ? "اتلغت بسبب مخالفة سياسة الامتحان" : "تسليم يدوي"}
          </p>
        </div>
        {state.reviewVideoUrl && (
          <a href={state.reviewVideoUrl} target="_blank" rel="noreferrer"
            className="nk-card rounded-2xl p-4 flex items-center gap-3 hover:shadow-md transition">
            <div className="w-10 h-10 rounded-xl nk-brand-bg grid place-items-center shrink-0"><Video className="w-5 h-5 text-white" /></div>
            <div>
              <p className="font-extrabold text-sm">فيديو المراجعة والتصحيح</p>
              <p className="text-[11px] font-bold text-muted-foreground">اضغط للمشاهدة — مراجعة المدرس للامتحان</p>
            </div>
          </a>
        )}
      </div>
    );
  }

  // ---------- شاشة البداية (التعليمات) ----------
  if (state.phase === "ready") {
    const strict = state.securityMode === "STRICT";
    return (
      <div className="space-y-3">
        <button onClick={onExit} className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
          <ChevronRight className="w-4 h-4" /> رجوع للامتحانات
        </button>
        <div className="nk-card rounded-2xl p-5 space-y-3">
          <h3 className="font-black text-lg">{state.title}</h3>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-muted/60 border border-border px-2.5 py-1 nk-num">{state.questionsCount} سؤال</span>
            <span className="rounded-full bg-muted/60 border border-border px-2.5 py-1 nk-num">{state.maxScore} درجة</span>
            <span className="rounded-full bg-muted/60 border border-border px-2.5 py-1 flex items-center gap-1"><AlarmClock className="w-3 h-3" /> <span className="nk-num">{state.durationMin}</span> دقيقة</span>
          </div>
          {state.instructions && <p className="text-sm font-bold text-muted-foreground leading-relaxed border-s-4 border-[var(--c-primary)] ps-3">{state.instructions}</p>}
          <div className={cn("rounded-2xl p-3.5 flex gap-2.5 border", strict
            ? "border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30"
            : "border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/30")}>
            <ShieldAlert className={cn("w-5 h-5 shrink-0 mt-0.5", strict ? "text-rose-600" : "text-sky-600")} />
            <p className={cn("text-xs font-bold leading-relaxed", strict ? "text-rose-700 dark:text-rose-300" : "text-sky-800 dark:text-sky-300")}>
              {strict
                ? "الامتحان ده صارم: هيفتح ملء الشاشة، وأي خروج من الشاشة (تبديل تاب/تصغير/فتح تطبيق) بيلغي المحاولة فورًا وبيتسجل بالتوقيت. قعد في مكان هادي وخلص في مرة واحدة."
                : "الامتحان هيفتح ملء الشاشة، ومحاولات الخروج أثناء الحل بتتسجل وبتوصل للمدرس. المؤقت شغال من السيرفر — لو النت قطع لحظة، إجاباتك محفوظة وبتترجع لما يرجع."}
            </p>
          </div>
          <button
            onClick={() => { requestFullscreen(); startExam(); }}
            className="w-full h-12 rounded-2xl nk-brand-bg text-white font-extrabold flex items-center justify-center gap-2">
            <PlayCircle className="w-5 h-5" /> ابدأ الامتحان
          </button>
          <p className="text-[11px] font-bold text-muted-foreground text-center">المحاولة الواحدة بس — أول ما تبدأ الوقت بيشتغل من السيرفر على طول.</p>
        </div>
      </div>
    );
  }

  // ---------- شاشة الحل ----------
  const qs = running?.questions ?? [];
  const q = qs[current];
  const answeredCount = Object.keys(answers).length;
  return (
    <div className="space-y-3 select-none" dir="rtl">
      {/* شريط علوي: مؤقت كبير + مزامنة */}
      <div className="nk-card rounded-2xl p-3.5 flex items-center justify-between gap-2 sticky top-0 z-20">
        <div className={cn("rounded-xl px-3.5 py-2 font-black text-2xl nk-num tabular-nums tracking-wider",
          remaining < 60_000 ? "bg-rose-600 text-white animate-pulse" : remaining < 300_000 ? "bg-amber-500 text-white" : "nk-brand-bg text-white")}>
          {mmss(remaining)}
        </div>
        <div className="text-center min-w-0">
          <p className="text-xs font-black truncate">{running?.title}</p>
          <p className="text-[10px] font-bold text-muted-foreground nk-num">{answeredCount}/{qs.length} متجاوب</p>
        </div>
        <SyncBadge state={sync} pending={Object.keys(pendingRef.current).length} />
      </div>

      {/* شريط تنبيه صارم */}
      {running?.securityMode === "STRICT" && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/30 px-3 py-2 text-[11px] font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> وضع صارم — أي خروج من الشاشة بيلغي المحاولة فورًا
        </div>
      )}

      {/* السؤال الحالي */}
      {q && (
        <div className="nk-card rounded-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-extrabold text-sm leading-relaxed">{q.order}. {q.text}</h3>
            <span className="text-[10px] font-black text-muted-foreground shrink-0 nk-num">{q.points} ن</span>
          </div>
          {q.type === "MCQ" && q.options && (
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => (
                <button key={oi} onClick={() => pick(q.id, String(oi))}
                  className={cn("w-full text-start rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition active:scale-[0.99]",
                    answers[q.id] === String(oi) ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card")}>
                  {opt}
                </button>
              ))}
            </div>
          )}
          {q.type === "TRUE_FALSE" && (
            <div className="grid grid-cols-2 gap-2">
              {[["true", "صح"], ["false", "غلط"]].map(([v, label]) => (
                <button key={v} onClick={() => pick(q.id, v)}
                  className={cn("rounded-xl border-2 px-3 py-3 text-sm font-black transition active:scale-[0.99]",
                    answers[q.id] === v ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card")}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {q.type === "NUM" && (
            <input
              value={answers[q.id] ?? ""}
              onChange={(e) => pick(q.id, e.target.value)}
              inputMode="decimal" dir="ltr" placeholder="اكتب إجابتك الرقمية…"
              className="w-full h-14 rounded-xl border-2 border-input bg-card px-4 text-xl font-black text-center nk-num"
            />
          )}
        </div>
      )}

      {/* تنقل الأسئلة */}
      <div className="nk-card rounded-2xl p-3.5 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {qs.map((qq, i) => (
            <button key={qq.id} onClick={() => setCurrent(i)}
              className={cn("w-9 h-9 rounded-lg text-xs font-black nk-num border-2 grid place-items-center transition",
                i === current ? "nk-brand-bg text-white border-transparent"
                  : answers[qq.id] != null ? "border-emerald-400 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10"
                  : "border-border bg-card text-muted-foreground")}>
              {answers[qq.id] != null ? <Circle className="w-3 h-3 fill-current" /> : i + 1}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}
            className="flex-1 h-11 rounded-xl border-2 border-border bg-card font-extrabold disabled:opacity-40 flex items-center justify-center gap-1">
            <ChevronRight className="w-4 h-4" /> السابق
          </button>
          {current < qs.length - 1 ? (
            <button onClick={() => setCurrent((c) => Math.min(qs.length - 1, c + 1))}
              className="flex-1 h-11 rounded-xl nk-brand-bg text-white font-extrabold flex items-center justify-center gap-1">
              التالي <ChevronLeft className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={() => doSubmit(false)} disabled={submitting}
              className="flex-1 h-11 rounded-xl bg-emerald-600 text-white font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} سلّم الامتحان
            </button>
          )}
        </div>
        <button onClick={() => doSubmit(false)} disabled={submitting}
          className="w-full h-11 rounded-2xl border-2 border-emerald-600 text-emerald-700 dark:text-emerald-300 font-extrabold disabled:opacity-50 flex items-center justify-center gap-2">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} سلّم دلوقتي
        </button>
        <p className="text-[10px] font-bold text-muted-foreground text-center">
          لو الوقت خلص والامتحان هيتسلم لوحده — إجاباتك المحفوظة هي اللي تتصلح.
        </p>
      </div>
    </div>
  );
}

function SyncBadge({ state, pending }: { state: SyncState; pending: number }) {
  if (state === "offline") {
    return (
      <span className="rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 px-2.5 py-1 text-[10px] font-black flex items-center gap-1 shrink-0">
        <WifiOff className="w-3 h-3" /> أوفلاين — محفوظ محليًا
      </span>
    );
  }
  if (state === "pending" || pending > 0) {
    return (
      <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 px-2.5 py-1 text-[10px] font-black flex items-center gap-1 shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" /> بيتزامن…
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 px-2.5 py-1 text-[10px] font-black flex items-center gap-1 shrink-0">
      <Wifi className="w-3 h-3" /> محفوظ
    </span>
  );
}

function CenterMsg({ icon, title, sub, onBack }: { icon: React.ReactNode; title: string; sub?: string; onBack: () => void }) {
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
        <ChevronRight className="w-4 h-4" /> رجوع
      </button>
      <div className="nk-card rounded-2xl p-8 text-center space-y-2">
        {icon}
        <h3 className="font-black text-lg">{title}</h3>
        {sub && <p className="text-xs font-bold text-muted-foreground nk-num">{sub}</p>}
      </div>
    </div>
  );
}
