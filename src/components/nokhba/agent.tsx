"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, X, Send, Mic, MicOff, Maximize2, Minimize2, History, CircleHelp,
  BrainCircuit, Loader2, WifiOff, GraduationCap, ListChecks, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import type { SessionUser } from "./lib";
import {
  AgentCardView, ConfirmationCard, PlanCard, StepChip, ErrorCard, SuccessCard,
  type AgentCard, type StepItem, type CardActionHandler,
} from "./agent-cards";
import { ZakiInsightsPanel } from "./zaki";

/* ============================================================
   ZAKI AGENT — واجهة الوكيل الذكي (spec §10/§12/§18/§29/§35-§43)
   زكي = الشخصية (moods وحركات وردود) — العقل = orchestrator سيرفري.
   الموبايل أولًا: bottom-sheet + وضع fullscreen + مايك صوتي.
============================================================ */

type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "agent"; text: string; plan?: string[]; options?: string[] }
  | { id: string; kind: "step"; step: StepItem }
  | { id: string; kind: "cards"; cards: AgentCard[] }
  | { id: string; kind: "confirmation"; confirmationId: string; summary: string; risk: string }
  | { id: string; kind: "error"; text: string; retry?: boolean }
  | { id: string; kind: "success"; text: string };

type AgentEvent = {
  type: string;
  state?: string;
  taskId?: string;
  title?: string;
  status?: string;
  id?: string;
  kind?: string;
  text?: string;
  plan?: string[];
  options?: string[];
  step?: StepItem;
  cards?: AgentCard[];
  confirmationId?: string;
  summary?: string;
  risk?: string;
  message?: string;
};

const STATE_LABEL: Record<string, string> = {
  UNDERSTANDING: "بفهم طلبك…",
  ANALYZING: "بشوف البيانات…",
  PLANNING: "برتب الخطوات…",
  EXECUTING: "بنفذ…",
  VERIFYING: "بتأكد من النتيجة…",
  WAITING_CONFIRMATION: "مستني تأكيدك",
  COMPLETED: "خلصت",
  FAILED: "حصلت مشكلة",
};

const STATE_ICON: Record<string, React.ReactNode> = {
  UNDERSTANDING: <BrainCircuit className="w-3.5 h-3.5" />,
  ANALYZING: <Sparkles className="w-3.5 h-3.5" />,
  PLANNING: <ListChecks className="w-3.5 h-3.5" />,
  EXECUTING: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  VERIFYING: <CheckCircleIcon />,
  WAITING_CONFIRMATION: <ShieldIcon />,
};

function CheckCircleIcon() { return <span className="nk-num">✓</span>; }
function ShieldIcon() { return <span className="nk-num">🔐</span>; }

/* ---------- أمثلة واختصارات (spec §19/§37/§41) ---------- */
const EXAMPLES: { label: string; text: string }[] = [
  { label: "إيه اللي حصل النهارده؟", text: "إيه اللي حصل النهارده؟" },
  { label: "مين غايب النهارده؟", text: "مين غايب النهارده؟" },
  { label: "اللي غابوا أكتر من 3 مرات", text: "هاتلي الطلبة اللي غابوا أكتر من 3 مرات" },
  { label: "ابحث عن طالب", text: "هاتلي " },
  { label: "إيه المجموعات اللي عندي؟", text: "إيه المجموعات اللي عندي؟" },
  { label: "ملخص الحضور", text: "اعمللي تقرير الحضور الأسبوع ده" },
];

function quickActionsFor(view?: string): { label: string; text: string }[] {
  if (view === "students") {
    return [
      { label: "تقرير الطالب المفتوح", text: "طلّعلي تقريره" },
      { label: "اللي غابوا أكتر من 3 مرات", text: "هاتلي الطلبة اللي غابوا أكتر من 3 مرات" },
      { label: "ابحث عن طالب", text: "هاتلي " },
    ];
  }
  if (view === "today" || view === "scan" || view === "schedule") {
    return [
      { label: "مين غايب النهارده؟", text: "مين غايب النهارده؟" },
      { label: "افتح حضور الحصة", text: "افتح حضور حصة " },
      { label: "الغياب المتكرر", text: "مين الطلبة اللي غيابهم متكرر؟" },
    ];
  }
  if (view === "reports") {
    return [
      { label: "ملخص الأسبوع", text: "اعمللي تقرير عن أداء الطلاب الأسبوع ده" },
      { label: "أهم المشاكل", text: "إيه أهم المشاكل الموجودة؟" },
    ];
  }
  return [
    { label: "إيه أهم حاجة محتاجة متابعة؟", text: "إيه أهم حاجة محتاجة متابعة النهارده؟" },
    { label: "ملخص النهاردة", text: "بصلي كده على اللي حصل النهارده" },
    { label: "اللي غابوا أكتر من 3 مرات", text: "هاتلي الطلبة اللي غابوا أكتر من 3 مرات" },
  ];
}

const HINTS: Record<string, string> = {
  students: "تقدر تقول: «اعمللي تقرير عن الطالب ده» وأنا هفهم تقصد مين.",
  today: "تقدر تقول: «مين غايب النهارده؟» وأنا هطلعهم لك.",
  schedule: "تقدر تقول: «افتح حضور حصة كذا» وأنا هجهزها.",
  home: "جرّب: «إيه أهم حاجة محتاجة متابعة؟»",
};

/* ---------- البرنامج التعليمي (spec §35) ---------- */
const TUTORIAL: { title: string; body: string; demo?: React.ReactNode }[] = [
  { title: "كلمني بطريقتك العادية", body: "مفيش أوامر محفوظة — قول اللي عايزه طبيعي: «مين غايب النهارده؟»" },
  { title: "بفهم وبشوف البيانات", body: "أنا بفهم طلبك وببص على داتا سنترك الحقيقية قبل ما أجاوب." },
  { title: "لو الشغل خطوات، بخطط الأول", body: "هوريك خطة قصيرة (من غير حشو) وببدأ تنفيذ خطوة خطوة." },
  { title: "التغييرات المهمة بتاخد تأكيدك", body: "أي تعديل على البيانات هعرضلك بالظبط هعمل إيه — مفيش حاجة بتحصل من غير إذنك." },
  { title: "وبتأكد إن اللي اتعمل حصل فعلًا", body: "بعد التنفيذ براجع الداتابيز نفسها وأقولك النتيجة الحقيقية." },
  { title: "بالعربي أو English", body: "«هاتلي تقرير أحمد» أو \"Show today's attendance\" — الاتنين زي بعض." },
];

/* ---------- الصوت (spec §11) — مدخل صوتي اختياري ---------- */
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void; stop(): void;
};
type SRWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

export function AgentDock({ user, view }: { user: SessionUser; view: string }) {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<"chat" | "tasks" | "help" | "tutorial">("chat");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<string>("IDLE");
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [online, setOnline] = useState(true);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [tasks, setTasks] = useState<{ id: string; title: string; status: string; createdAt: string }[]>([]);
  const [hintHidden, setHintHidden] = useState(true);

  const taskIdRef = useRef<string | null>(null);
  const lastUserText = useRef<string>("");
  const ctxRef = useRef<{ studentId?: string; sessionId?: string }>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // سياق الصفحة — من shell (view) + من أحداث التطبيق (طالب/حصة مفتوحة)
  useEffect(() => {
    const onCtx = (e: Event) => {
      const d = (e as CustomEvent).detail as { studentId?: string; sessionId?: string };
      ctxRef.current = { studentId: d.studentId, sessionId: d.sessionId };
    };
    window.addEventListener("nk-agent-context", onCtx);
    return () => window.removeEventListener("nk-agent-context", onCtx);
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // تلميح السياق — يظهر مرة لكل واجهة
  useEffect(() => {
    if (!open) return;
    const key = `nk-agent-hint-${view}`;
    setHintHidden(localStorage.getItem(key) === "1");
  }, [open, view]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, state]);

  const push = useCallback((item: ChatItem) => setItems((prev) => [...prev, item]), []);

  const handleEvent = useCallback((e: AgentEvent) => {
    switch (e.type) {
      case "state":
        setState(e.state ?? "IDLE");
        break;
      case "task":
        if (e.taskId) taskIdRef.current = e.taskId;
        break;
      case "message": {
        if (e.kind === "error") {
          push({ id: e.id ?? crypto.randomUUID(), kind: "error", text: e.text ?? "حصلت مشكلة.", retry: true });
        } else if (e.kind === "question") {
          push({ id: e.id ?? crypto.randomUUID(), kind: "agent", text: e.text ?? "", options: e.options });
        } else {
          push({ id: e.id ?? crypto.randomUUID(), kind: "agent", text: e.text ?? "", plan: e.plan });
        }
        break;
      }
      case "step":
        if (e.step) push({ id: crypto.randomUUID(), kind: "step", step: e.step });
        break;
      case "cards":
        if (e.cards?.length) push({ id: crypto.randomUUID(), kind: "cards", cards: e.cards });
        break;
      case "confirmation":
        setState("WAITING_CONFIRMATION");
        if (e.confirmationId) {
          push({ id: crypto.randomUUID(), kind: "confirmation", confirmationId: e.confirmationId, summary: e.summary ?? "", risk: e.risk ?? "MEDIUM" });
        }
        break;
      case "done":
        setRunning(false);
        setState(e.status === "COMPLETED" ? "COMPLETED" : e.status === "FAILED" ? "FAILED" : e.status === "WAITING_CONFIRMATION" ? "WAITING_CONFIRMATION" : "IDLE");
        break;
      case "error":
        setRunning(false);
        push({ id: crypto.randomUUID(), kind: "error", text: e.message ?? "خطأ غير متوقع.", retry: true });
        break;
    }
  }, [push]);

  const runSSE = useCallback(async (url: string, body: Record<string, unknown>) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`agent-http-${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.trim();
          if (!line.startsWith("data:")) continue;
          try { handleEvent(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setRunning(false);
        push({ id: crypto.randomUUID(), kind: "error", text: "مش قادر أوصل للسيرفر — شوف اتصالك وجرب تاني.", retry: true });
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [handleEvent, push]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    if (!t || running || !online) return;
    lastUserText.current = t;
    setInput("");
    push({ id: crypto.randomUUID(), kind: "user", text: t });
    setMode("chat");
    void runSSE("/api/agent/message", {
      text: t,
      taskId: taskIdRef.current ?? undefined,
      context: { view, ...ctxRef.current },
    });
  }, [online, push, running, runSSE, view]);

  const retry = useCallback(() => {
    if (lastUserText.current) send(lastUserText.current);
  }, [send]);

  const decide = useCallback(async (decision: "confirm" | "cancel") => {
    if (!taskIdRef.current || confirmBusy) return;
    setConfirmBusy(true);
    setItems((prev) => prev.filter((i) => i.kind !== "confirmation"));
    push({ id: crypto.randomUUID(), kind: "user", text: decision === "confirm" ? "أكّد — نفّذ" : "ألغى العملية" });
    await runSSE("/api/agent/confirm", { taskId: taskIdRef.current, decision });
    setConfirmBusy(false);
  }, [confirmBusy, push, runSSE]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setState("IDLE");
  }, []);

  /* ---------- الصوت ---------- */
  const toggleMic = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as SRWindow;
    const SRCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SRCtor) return;
    const rec = new SRCtor();
    rec.lang = "ar-EG";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((prev) => `${prev}${prev ? " " : ""}${transcript}`);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening]);

  /* ---------- المهام السابقة ---------- */
  const loadTasks = useCallback(async () => {
    try {
      const d = await api<{ tasks: { id: string; title: string; status: string; createdAt: string }[] }>("/api/agent/tasks", { silent: true });
      setTasks(d.tasks ?? []);
    } catch { /* silent */ }
  }, []);

  const openTask = useCallback(async (id: string) => {
    try {
      const d = await api<{
        task: {
          id: string; title: string; status: string; result: { cards?: AgentCard[] } | null;
          messages: { id: string; role: string; kind: string; content: { text?: string; plan?: string[]; need_info?: { question?: string; options?: string[] } } }[];
          confirmations: { id: string; summary: string; risk: string; status: string }[];
        };
      }>(`/api/agent/tasks/${id}`, { silent: true });
      const rebuilt: ChatItem[] = [];
      for (const m of d.task.messages) {
        if (m.role === "user" && !m.content.text?.startsWith("[")) {
          rebuilt.push({ id: m.id, kind: "user", text: m.content.text ?? "" });
        } else if (m.role === "assistant") {
          if (m.content.need_info) {
            rebuilt.push({ id: m.id, kind: "agent", text: m.content.need_info.question ?? "", options: m.content.need_info.options });
          } else if (m.content.text || m.content.plan) {
            rebuilt.push({ id: m.id, kind: "agent", text: m.content.text ?? "", plan: m.content.plan });
          }
        }
      }
      for (const c of d.task.confirmations) {
        if (c.status === "PENDING") {
          rebuilt.push({ id: c.id, kind: "confirmation", confirmationId: c.id, summary: c.summary, risk: c.risk });
        }
      }
      if (d.task.result?.cards?.length) {
        rebuilt.push({ id: "result", kind: "cards", cards: d.task.result.cards });
      }
      taskIdRef.current = d.task.id;
      setItems(rebuilt);
      setMode("chat");
      setState(d.task.status === "WAITING_CONFIRMATION" ? "WAITING_CONFIRMATION" : "IDLE");
    } catch { /* silent */ }
  }, []);

  const onCardAction: CardActionHandler = useCallback((a) => {
    if (a.action === "agent" && a.text) {
      send(a.text);
      return;
    }
    if (a.action === "navigate" && a.view) {
      window.dispatchEvent(new CustomEvent("nk-navigate", { detail: { view: a.view, studentId: a.studentId } }));
      setOpen(false);
    }
  }, [send]);

  const firstTime = typeof window !== "undefined" && !localStorage.getItem("nk-agent-tutorial-v1");
  const showTutorialOnOpen = useCallback(() => {
    if (!localStorage.getItem("nk-agent-tutorial-v1")) setMode("tutorial");
    else setMode("chat");
  }, []);

  const finishTutorial = useCallback(() => {
    localStorage.setItem("nk-agent-tutorial-v1", "1");
    setMode("chat");
  }, []);

  const hasVoice = typeof window !== "undefined" && !!((window as SRWindow).SpeechRecognition || (window as SRWindow).webkitSpeechRecognition);
  const stateLabel = STATE_LABEL[state];

  return (
    <>
      {/* الزرار العائم — زكي */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.6, type: "spring", stiffness: 260, damping: 18 }}
        onClick={() => { setOpen(true); showTutorialOnOpen(); }}
        aria-label="افتح زكي — وكيل النخبة الذكي"
        className={cn(
          "fixed bottom-[5.4rem] md:bottom-6 end-4 z-[70] rounded-full shadow-lg text-white",
          "w-13 h-13 md:w-14 md:h-14 p-3.5 flex items-center justify-center nk-brand-grad",
        )}
      >
        <Sparkles className={cn("w-6 h-6", running && "animate-pulse")} />
      </motion.button>

      {/* ملاحظات زكي الحتمية (نفس لوحة القواعد القديمة) */}
      <ZakiInsightsPanel open={insightsOpen} onClose={() => setInsightsOpen(false)} />

      {/* لوحة الوكيل */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className={cn(
              "fixed z-[85] flex flex-col overflow-hidden",
              fullscreen
                ? "inset-x-0 bottom-0 top-0 rounded-none"
                : "inset-x-2 bottom-2 rounded-3xl max-h-[85dvh] md:inset-x-auto md:end-6 md:bottom-24 md:w-[27rem] md:max-h-[78vh]",
            )}
          >
            <div className="nk-card rounded-3xl shadow-2xl border border-border overflow-hidden flex flex-col h-full min-h-0">
              {/* الهيدر */}
              <div className="nk-brand-grad text-white p-3.5 flex items-center gap-2.5 shrink-0">
                <div className="w-10 h-10 rounded-2xl bg-white/15 grid place-items-center shrink-0 backdrop-blur">
                  <Sparkles className="w-5.5 h-5.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black leading-tight">زكي — وكيل النخبة</p>
                  <p className="text-[10.5px] font-bold text-white/85 flex items-center gap-1">
                    {running || state === "WAITING_CONFIRMATION" ? (
                      <>{STATE_ICON[state] ?? <Loader2 className="w-3 h-3 animate-spin" />} {stateLabel ?? "بشتغل…"}</>
                    ) : (
                      "جاهز — قولّي عايز إيه"
                    )}
                  </p>
                </div>
                <button onClick={() => { setMode("tasks"); void loadTasks(); }} aria-label="المهام" className="p-2 rounded-xl hover:bg-white/15">
                  <History className="w-4.5 h-4.5" />
                </button>
                <button onClick={() => setMode("help")} aria-label="طريقة الاستخدام" className="p-2 rounded-xl hover:bg-white/15">
                  <CircleHelp className="w-4.5 h-4.5" />
                </button>
                {!fullscreen && (
                  <button onClick={() => setFullscreen(true)} aria-label="شاشة كاملة" className="p-2 rounded-xl hover:bg-white/15 md:hidden">
                    <Maximize2 className="w-4.5 h-4.5" />
                  </button>
                )}
                {fullscreen && (
                  <button onClick={() => setFullscreen(false)} aria-label="تصغير" className="p-2 rounded-xl hover:bg-white/15 md:hidden">
                    <Minimize2 className="w-4.5 h-4.5" />
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="إغلاق" className="p-2 rounded-xl hover:bg-white/15">
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              {/* شريط الحالة أثناء الشغل */}
              {(running || state === "WAITING_CONFIRMATION") && (
                <div className="shrink-0 bg-muted/60 border-b border-border px-4 py-1.5 flex items-center gap-2">
                  {STATE_ICON[state] ?? <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span className="text-[11px] font-black">{stateLabel ?? "بشتغل…"}</span>
                  {running && (
                    <button onClick={stop} className="ms-auto text-[10px] font-extrabold text-muted-foreground underline underline-offset-2">
                      إيقاف
                    </button>
                  )}
                </div>
              )}

              {/* الجسم */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto nk-scroll p-3.5 space-y-3 min-h-0">
                {/* ==== البرنامج التعليمي ==== */}
                {mode === "tutorial" && <Tutorial onFinish={finishTutorial} onSkip={finishTutorial} />}

                {/* ==== المساعدة ==== */}
                {mode === "help" && (
                  <HelpView onPick={(t) => send(t)} />
                )}

                {/* ==== تاريخ المهام ==== */}
                {mode === "tasks" && (
                  <TasksView tasks={tasks} onOpen={openTask} onBack={() => setMode("chat")} />
                )}

                {/* ==== الشات ==== */}
                {mode === "chat" && (
                  <>
                    {items.length === 0 ? (
                      <div className="space-y-4 py-2">
                        <div className="text-center space-y-1.5">
                          <div className="w-14 h-14 mx-auto rounded-3xl nk-brand-grad text-white grid place-items-center shadow-lg">
                            <Sparkles className="w-7 h-7" />
                          </div>
                          <p className="font-black text-base mt-2">أنا زكي</p>
                          <p className="text-xs font-bold text-muted-foreground leading-relaxed max-w-[26ch] mx-auto">
                            قولّي عايز تعمل إيه — هفهم الطلب وأساعدك تنفذه جوه النظام.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 justify-center">
                          {EXAMPLES.map((ex) => (
                            <button
                              key={ex.label}
                              onClick={() => (ex.text.endsWith(" ") ? setInput(ex.text) : send(ex.text))}
                              className="rounded-full border nk-brand-border nk-brand-bg-soft px-3 py-2 text-[11px] font-extrabold nk-brand-text active:scale-[0.97] transition"
                            >
                              {ex.label}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => setInsightsOpen(true)}
                          className="w-full rounded-2xl border border-border bg-muted/40 px-3 py-2.5 text-[11px] font-extrabold text-muted-foreground flex items-center justify-center gap-1.5"
                        >
                          <Lightbulb className="w-3.5 h-3.5" /> ملاحظات زكي الحتمية عن سنترك
                        </button>
                      </div>
                    ) : (
                      items.map((it) => <ItemView key={it.id} item={it} onAction={onCardAction} onRetry={retry} onDecide={decide} confirmBusy={confirmBusy} onPick={send} />)
                    )}

                    {/* تلميح سياقي */}
                    {!hintHidden && HINTS[view] && (
                      <div className="rounded-2xl border border-dashed nk-brand-border nk-brand-bg-soft px-3 py-2.5 flex items-start gap-2">
                        <Lightbulb className="w-3.5 h-3.5 nk-brand-text shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold flex-1 leading-relaxed">{HINTS[view]}</p>
                        <button
                          onClick={() => { localStorage.setItem(`nk-agent-hint-${view}`, "1"); setHintHidden(true); }}
                          className="text-[10px] font-extrabold text-muted-foreground shrink-0"
                        >
                          متظهرش تاني
                        </button>
                      </div>
                    )}

                    {/* اختصارات سياقية */}
                    {items.length > 0 && !running && (
                      <div className="flex flex-wrap gap-1.5">
                        {quickActionsFor(view).map((q) => (
                          <button
                            key={q.label}
                            onClick={() => (q.text.endsWith(" ") ? setInput(q.text) : send(q.text))}
                            className="rounded-full border border-border bg-card px-3 py-1.5 text-[10.5px] font-extrabold text-muted-foreground active:scale-[0.97] transition"
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* شريط الإدخال */}
              {mode === "chat" && (
                <div className="shrink-0 border-t border-border bg-card p-2.5">
                  {!online && (
                    <p className="text-[10.5px] font-extrabold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1.5">
                      <WifiOff className="w-3.5 h-3.5" /> مستني الاتصال… الطلب مش هيتبعت لحد ما النت يرجع
                    </p>
                  )}
                  <div className="flex items-end gap-1.5">
                    {hasVoice && (
                      <button
                        onClick={toggleMic}
                        aria-label={listening ? "إيقاف المايك" : "تسجيل صوتي"}
                        className={cn(
                          "w-10 h-10 rounded-2xl grid place-items-center shrink-0 border transition",
                          listening ? "bg-rose-600 text-white border-rose-600 animate-pulse" : "border-border bg-muted/50 text-muted-foreground",
                        )}
                      >
                        {listening ? <MicOff className="w-4.5 h-4.5" /> : <Mic className="w-4.5 h-4.5" />}
                      </button>
                    )}
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                      placeholder={listening ? "بتسمعك…" : "اكتب طلبك… مثال: مين غايب النهارده؟"}
                      disabled={running || !online}
                      className="flex-1 min-w-0 rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm font-bold outline-none focus:ring-2 nk-brand-ring disabled:opacity-50"
                      maxLength={1000}
                    />
                    <button
                      onClick={() => send(input)}
                      disabled={running || !online || !input.trim()}
                      aria-label="إرسال"
                      className="w-10 h-10 rounded-2xl nk-brand-bg text-white grid place-items-center shrink-0 disabled:opacity-40 active:scale-[0.96] transition"
                    >
                      {running ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                  <p className="text-[9px] font-bold text-muted-foreground mt-1.5 text-center">
                    زكي بينفذ بصلاحيات حسابك وبيطلب تأكيدك لأي تعديل — زرار «؟» فوق يوريك تقدر تطلبه إيه
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ============================================================
   عرض عنصر شات واحد
============================================================ */
function ItemView({
  item, onAction, onRetry, onDecide, confirmBusy, onPick,
}: {
  item: ChatItem;
  onAction: CardActionHandler;
  onRetry: () => void;
  onDecide: (d: "confirm" | "cancel") => void;
  confirmBusy: boolean;
  onPick?: (t: string) => void;
}) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-te-sm bg-muted px-3.5 py-2.5 text-sm font-bold leading-relaxed">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === "agent") {
    return (
      <div className="space-y-2">
        {item.plan && <PlanCard plan={item.plan} />}
        {item.text && (
          <div className="max-w-[92%] rounded-2xl rounded-ts-sm nk-brand-bg-soft border nk-brand-border px-3.5 py-2.5 text-sm font-bold leading-relaxed">
            {item.text}
          </div>
        )}
        {item.options?.length ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {item.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onPick?.(opt)}
                className="rounded-full border nk-brand-border nk-brand-bg-soft px-3 py-1.5 text-[11px] font-extrabold nk-brand-text active:scale-[0.97] transition"
              >
                {opt}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (item.kind === "step") return <StepChip step={item.step} />;
  if (item.kind === "cards") {
    return (
      <div className="space-y-2">
        {item.cards.map((c, i) => <AgentCardView key={i} card={c} onAction={onAction} />)}
      </div>
    );
  }
  if (item.kind === "confirmation") {
    return <ConfirmationCard summary={item.summary} risk={item.risk} onDecide={onDecide} busy={confirmBusy} />;
  }
  if (item.kind === "error") return <ErrorCard text={item.text} onRetry={item.retry ? onRetry : undefined} />;
  if (item.kind === "success") return <SuccessCard text={item.text} />;
  return null;
}

/* ============================================================
   البرنامج التعليمي — قصير بتقود زكي (spec §35)
============================================================ */
function Tutorial({ onFinish, onSkip }: { onFinish: () => void; onSkip: () => void }) {
  const [i, setI] = useState(0);
  const step = TUTORIAL[i];
  const last = i === TUTORIAL.length - 1;
  return (
    <div className="space-y-4 py-4">
      <div className="text-center space-y-2">
        <div className="w-14 h-14 mx-auto rounded-3xl nk-brand-grad text-white grid place-items-center shadow-lg">
          <GraduationCap className="w-7 h-7" />
        </div>
        <p className="font-black text-sm">تعرف على Zaki Agent — {i + 1}/{TUTORIAL.length}</p>
      </div>
      <div className="rounded-2xl border nk-brand-border nk-brand-bg-soft p-4 space-y-2">
        <p className="font-black text-sm">{step.title}</p>
        <p className="text-xs font-bold text-muted-foreground leading-relaxed">{step.body}</p>
      </div>
      <div className="flex gap-2">
        {i > 0 && (
          <button onClick={() => setI((v) => v - 1)} className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-extrabold text-muted-foreground">
            السابق
          </button>
        )}
        <button
          onClick={() => (last ? onFinish() : setI((v) => v + 1))}
          className="flex-1 rounded-xl nk-brand-bg text-white py-2.5 text-sm font-black active:scale-[0.98] transition"
        >
          {last ? "جاهز — جرّب تطلب مني حاجة" : "التالي"}
        </button>
        <button onClick={onSkip} className="rounded-xl px-3 py-2.5 text-xs font-extrabold text-muted-foreground underline underline-offset-2">
          تخطي
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   المساعدة الدائمة — ٥ أنواع طلبات (spec §36)
============================================================ */
function HelpView({ onPick }: { onPick: (t: string) => void }) {
  const types: { icon: string; title: string; desc: string; example: string }[] = [
    { icon: "اسألني", title: "اسألني", desc: "أسئلة عن داتا سنترك", example: "مين غاب أكتر من 3 مرات؟" },
    { icon: "دورلي", title: "دورلي", desc: "بحث سريع", example: "هاتلي أحمد محمد." },
    { icon: "حلللي", title: "حلللي", desc: "تحليل واتجاهات", example: "مين مستواه نازل الشهر ده؟" },
    { icon: "اعمللي", title: "اعمللي", desc: "تنفيذ بتأكيد", example: "سجل أحمد في Group B." },
    { icon: "تابعلي", title: "تابعلي", desc: "متابعة دورية", example: "قولي مين محتاج متابعة الأسبوع ده." },
  ];
  return (
    <div className="space-y-3">
      <p className="font-black text-sm text-center">تقدر تطلب مني ٥ أنواع من الحاجات</p>
      {types.map((t) => (
        <div key={t.title} className="rounded-2xl border border-border bg-card p-3 space-y-1.5">
          <p className="font-black text-xs">{t.title} — <span className="font-bold text-muted-foreground">{t.desc}</span></p>
          <button
            onClick={() => onPick(t.example)}
            className="text-[11px] font-extrabold nk-brand-text underline underline-offset-2"
          >
            جرّب: «{t.example}»
          </button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   تاريخ المهام (spec §9)
============================================================ */
function TasksView({ tasks, onOpen, onBack }: {
  tasks: { id: string; title: string; status: string; createdAt: string }[];
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const STATUS: Record<string, { label: string; cls: string }> = {
    COMPLETED: { label: "تمت", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
    ACTIVE: { label: "شغالة", cls: "nk-brand-bg text-white" },
    WAITING_CONFIRMATION: { label: "مستنية تأكيد", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    FAILED: { label: "فشلت", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
    CANCELLED: { label: "ملغاة", cls: "bg-muted text-muted-foreground" },
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-black text-sm">مهامك الأخيرة</p>
        <button onClick={onBack} className="text-[11px] font-extrabold nk-brand-text underline underline-offset-2">رجوع للشات</button>
      </div>
      {tasks.length === 0 && (
        <div className="rounded-2xl border border-border bg-muted/40 p-4 text-center">
          <p className="font-extrabold text-sm">مفيش مهام لسه</p>
          <p className="text-[11px] font-bold text-muted-foreground mt-1">أول طلب هيعمل أول مهمة — وهتلاقيها هنا بتاريخها وخطواتها.</p>
        </div>
      )}
      {tasks.map((t) => {
        const s = STATUS[t.status] ?? STATUS.ACTIVE;
        return (
          <button
            key={t.id}
            onClick={() => onOpen(t.id)}
            className="w-full text-start rounded-2xl border border-border bg-card p-3 space-y-1.5 hover:bg-muted/40 transition"
          >
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[9.5px] font-black", s.cls)}>{s.label}</span>
              <span className="text-[10px] font-bold text-muted-foreground nk-num ms-auto">
                {new Date(t.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p className="text-xs font-extrabold leading-relaxed line-clamp-2">{t.title}</p>
          </button>
        );
      })}
    </div>
  );
}
