"use client";
/* مخزن المختبر — حالة مستقلة تمامًا لكل بديل + قياس نقرات فعلي + محاكاة حفظ/شبكة.
   ❌ صفر استدعاءات شبكة. ❌ صفر كتابة على أي بيانات حقيقية.
   الاختيار النهائي بس هو اللي بيتخزن (localStorage nk-uxlab-choice) — وقابل للمسح في أي وقت. */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  emptyMetrics, emptyOptionState, OptionId, OptionState, Metrics, LabChoice, AttStatus, MarkMethod, OPTION_META,
} from "./types";
import { STUDENTS as STUDENTS_ALL } from "./scenario";

const CHOICE_KEY = "nk-uxlab-choice";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type LabCtx = {
  active: OptionId | "compare" | "home" | "choice";
  setActive: (v: OptionId | "compare" | "home" | "choice") => void;
  bumpClicks: (id: OptionId) => void;
  state: (id: OptionId) => OptionState;
  metrics: (id: OptionId) => Metrics;
  offline: boolean;
  setOffline: (v: boolean) => void;
  // عمليات الحالة
  openSession: (id: OptionId) => void;
  mark: (id: OptionId, studentId: string, status: AttStatus, method?: MarkMethod) => void;
  unmark: (id: OptionId, studentId: string) => void;
  markAllPresent: (id: OptionId) => void;
  simulateSelfCheckin: (id: OptionId) => void;
  addWeakness: (id: OptionId, studentId: string, text: string) => void;
  removeWeakness: (id: OptionId, studentId: string, text: string) => void;
  rate: (id: OptionId, studentId: string, r: string) => void;
  setNotes: (id: OptionId, notes: string) => void;
  setStage: (id: OptionId, stage: number) => void;
  completeStage: (id: OptionId, stage: "attendance" | "notes" | "review") => void;
  closeSession: (id: OptionId) => Promise<boolean>;
  reopenSession: (id: OptionId) => void;
  backToEntry: (id: OptionId) => void;
  resetFlow: (id: OptionId) => void;
  resetAll: () => void;
  // الاختيار
  choice: LabChoice;
  saveChoice: (option: OptionId | null, comment: string) => void;
  clearChoice: () => void;
};

const Ctx = createContext<LabCtx | null>(null);

export function useLab() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLab outside provider");
  return v;
}

export function LabProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<OptionId | "compare" | "home" | "choice">("home");
  const [states, setStates] = useState<Record<OptionId, OptionState>>({
    quick: emptyOptionState(),
    quickplus: emptyOptionState(),
    guided: emptyOptionState(),
    cockpit: emptyOptionState(),
  });
  const [metricsMap, setMetricsMap] = useState<Record<OptionId, Metrics>>({
    quick: emptyMetrics(),
    quickplus: emptyMetrics(),
    guided: emptyMetrics(),
    cockpit: emptyMetrics(),
  });
  const [offline, setOffline] = useState(false);
  const [choice, setChoice] = useState<LabChoice>({ option: null, comment: "", savedAt: null });
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /* ---------- تحميل الاختيار المحفوظ (بعد الـ hydration لتجنب تعارض الرندر) ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(CHOICE_KEY);
        if (raw) {
          const p = JSON.parse(raw) as LabChoice;
          if (p && ("option" in p)) setChoice(p);
        }
      } catch { /* تجاهل */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const patch = useCallback((id: OptionId, fn: (s: OptionState) => OptionState) => {
    setStates((prev) => ({ ...prev, [id]: fn(prev[id]) }));
  }, []);

  const setM = useCallback((id: OptionId, fn: (m: Metrics) => Metrics) => {
    setMetricsMap((prev) => ({ ...prev, [id]: fn(prev[id]) }));
  }, []);

  /* ---------- قياس: أول تفاعل ---------- */
  const touchStart = useCallback((id: OptionId) => {
    setM(id, (m) => (m.startedAt ? m : { ...m, startedAt: Date.now() }));
  }, [setM]);

  /* قياس النقرات الفعلي من الـ DOM — الجذر بيستدعيها من capture listener */
  const bumpClicks = useCallback((id: OptionId) => {
    touchStart(id);
    setM(id, (m) => ({ ...m, clicks: m.clicks + 1 }));
  }, [setM, touchStart]);

  /* ---------- محاكاة الحفظ (Save ≠ Lock) ---------- */
  const simulateSave = useCallback(async (id: OptionId) => {
    patch(id, (s) => ({ ...s, save: "saving" }));
    await delay(300 + Math.random() * 250);
    if (offline) {
      patch(id, (s) => ({ ...s, save: "queued" }));
      return "queued" as const;
    }
    patch(id, (s) => ({ ...s, save: "saved" }));
    const key = id as string;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      patch(id, (s) => (s.save === "saved" ? { ...s, save: "idle" } : s));
    }, 1400);
    return "saved" as const;
  }, [patch, offline]);

  /* رجوع الشبكة: أي حاجة كانت في الطابور تتزامن */
  useEffect(() => {
    if (!offline) {
      (Object.keys(states) as OptionId[]).forEach((id) => {
        if (states[id].save === "queued") {
          patch(id, (s) => ({ ...s, save: "saved" }));
          toast.success("اتزامن التحويلات المعلقة ✓ (محاكاة)");
        }
      });
    }
  }, [offline, states, patch]);

  /* ---------- عمليات ---------- */
  const openSession = useCallback((id: OptionId) => {
    touchStart(id);
    setM(id, (m) => ({ ...m, transitions: m.transitions + 1 }));
    patch(id, (s) => ({ ...s, loading: true, phase: "live" }));
    setTimeout(() => patch(id, (s) => ({ ...s, loading: false })), 450); // محاكاة جلب بيانات
  }, [patch, setM, touchStart]);

  const mark = useCallback((id: OptionId, studentId: string, status: AttStatus, method: MarkMethod = "MANUAL") => {
    touchStart(id);
    const prev = states[id].marks[studentId];
    // منع الكتابة المكررة: نفس الحالة نفس الطريقة = لا كتابة جديدة
    if (prev && prev.status === status && prev.method === method) return;
    patch(id, (s) => ({ ...s, marks: { ...s.marks, [studentId]: { status, method, at: Date.now() } } }));
    void simulateSave(id);
  }, [states, patch, simulateSave, touchStart]);

  const unmark = useCallback((id: OptionId, studentId: string) => {
    touchStart(id);
    patch(id, (s) => {
      const marks = { ...s.marks };
      delete marks[studentId];
      return { ...s, marks };
    });
    void simulateSave(id);
  }, [patch, simulateSave, touchStart]);

  const markAllPresent = useCallback((id: OptionId) => {
    touchStart(id);
    patch(id, (s) => {
      const marks = { ...s.marks };
      STUDENTS_ALL.forEach((st) => {
        if (!marks[st.id]) marks[st.id] = { status: "PRESENT", method: "MANUAL", at: Date.now() };
      });
      return { ...s, marks };
    });
    void simulateSave(id);
  }, [patch, simulateSave, touchStart]);

  const simulateSelfCheckin = useCallback((id: OptionId) => {
    touchStart(id);
    const cur = states[id];
    const next = STUDENTS_ALL.find((st) => !cur.marks[st.id] && !cur.selfCheckins.includes(st.id));
    if (!next) { toast.info("كل الطلاب اتسجلوا خلاص (محاكاة)"); return; }
    patch(id, (s) => ({
      ...s,
      selfCheckins: [...s.selfCheckins, next.id],
      marks: { ...s.marks, [next.id]: { status: "PRESENT", method: "QR", at: Date.now() } },
    }));
    void simulateSave(id);
    toast.success(`${next.name} سجّل بنفسه عبر QR ✓ (محاكاة)`);
  }, [states, patch, simulateSave, touchStart]);

  const addWeakness = useCallback((id: OptionId, studentId: string, text: string) => {
    touchStart(id);
    const t = text.trim();
    if (!t) return;
    patch(id, (s) => ({
      ...s,
      weaknesses: { ...s.weaknesses, [studentId]: [...(s.weaknesses[studentId] || []), t] },
    }));
    void simulateSave(id);
  }, [patch, simulateSave, touchStart]);

  const removeWeakness = useCallback((id: OptionId, studentId: string, text: string) => {
    touchStart(id);
    patch(id, (s) => ({
      ...s,
      weaknesses: { ...s.weaknesses, [studentId]: (s.weaknesses[studentId] || []).filter((w) => w !== text) },
    }));
    void simulateSave(id);
  }, [patch, simulateSave, touchStart]);

  const rate = useCallback((id: OptionId, studentId: string, r: string) => {
    touchStart(id);
    patch(id, (s) => ({ ...s, ratings: { ...s.ratings, [studentId]: r as OptionState["ratings"][string] } }));
    void simulateSave(id);
  }, [patch, simulateSave, touchStart]);

  const setNotes = useCallback((id: OptionId, notes: string) => {
    touchStart(id);
    patch(id, (s) => ({ ...s, notes }));
    // حفظ مع تأجيل (debounce) زي ما بيحصل في الإنتاج
    if (saveTimers.current[id + ":notes"]) clearTimeout(saveTimers.current[id + ":notes"]);
    saveTimers.current[id + ":notes"] = setTimeout(() => { void simulateSave(id); }, 600);
  }, [patch, simulateSave, touchStart]);

  const setStage = useCallback((id: OptionId, stage: number) => {
    touchStart(id);
    const cur = states[id].stage;
    if (cur === stage) return;
    setM(id, (m) => ({ ...m, transitions: m.transitions + 1 }));
    patch(id, (s) => ({ ...s, stage }));
  }, [states, patch, setM, touchStart]);

  const completeStage = useCallback((id: OptionId, stage: "attendance" | "notes" | "review") => {
    touchStart(id);
    if (stage === "attendance" && Object.keys(states[id].marks).length === 0) {
      toast.error("لازم تسجّل حضور طالب واحد على الأقل قبل إتمام المرحلة");
      return;
    }
    patch(id, (s) => ({ ...s, stageDone: { ...s.stageDone, [stage]: true } }));
    void simulateSave(id);
    const order = { attendance: 1, notes: 2, review: 3 } as const;
    setM(id, (m) => ({ ...m, transitions: m.transitions + 1 }));
    patch(id, (s) => ({ ...s, stage: Math.max(s.stage, order[stage]) }));
  }, [states, patch, setM, simulateSave, touchStart]);

  const closeSession = useCallback(async (id: OptionId) => {
    touchStart(id);
    const st = states[id];
    const present = Object.keys(st.marks).length;
    if (present === 0) {
      toast.error("مقدرتش تقفل: مفيش أي حضور مسجل. سجّل حضور الأول أو علّم الكل حاضر.");
      return false;
    }
    if (offline) {
      toast.error("الشبكة مقطوعة (محاكاة) — القفل محتاج اتصال. جرب تاني بعد رجوع الشبكة.");
      return false;
    }
    patch(id, (s) => ({ ...s, save: "saving" }));
    await delay(500);
    patch(id, (s) => ({ ...s, save: "idle", phase: "summary", closed: true, closedAt: Date.now() }));
    setM(id, (m) => ({ ...m, transitions: m.transitions + 1, finishedAt: Date.now() }));
    return true;
  }, [states, offline, patch, setM, touchStart]);

  const reopenSession = useCallback((id: OptionId) => {
    touchStart(id);
    setM(id, (m) => ({ ...m, transitions: m.transitions + 1 }));
    patch(id, (s) => ({ ...s, closed: false, closedAt: null, phase: "live" }));
    toast.info("اتفتحت الحصة تاني — ممكن تعدّل وتقفل من جديد (محاكاة)");
  }, [patch, setM, toast, touchStart]);

  const backToEntry = useCallback((id: OptionId) => {
    setM(id, (m) => ({ ...m, transitions: m.transitions + 1 }));
    patch(id, (s) => ({ ...s, phase: "entry" }));
  }, [patch, setM]);

  const resetFlow = useCallback((id: OptionId) => {
    patch(id, () => emptyOptionState());
    setM(id, () => emptyMetrics());
  }, [patch, setM]);

  const resetAll = useCallback(() => {
    setStates({ quick: emptyOptionState(), quickplus: emptyOptionState(), guided: emptyOptionState(), cockpit: emptyOptionState() });
    setMetricsMap({ quick: emptyMetrics(), quickplus: emptyMetrics(), guided: emptyMetrics(), cockpit: emptyMetrics() });
    setOffline(false);
  }, []);

  /* ---------- الاختيار ---------- */
  const saveChoice = useCallback((option: OptionId | null, comment: string) => {
    const next: LabChoice = { option, comment: comment.trim(), savedAt: Date.now() };
    setChoice(next);
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify(next)); } catch { /* تجاهل */ }
    if (option) toast.success(`اتسجل اختيارك: ${OPTION_META[option].name} ✓`);
    else toast.info("اتمسح الاختيار");
  }, []);

  const clearChoice = useCallback(() => {
    const next: LabChoice = { option: null, comment: "", savedAt: null };
    setChoice(next);
    try { localStorage.removeItem(CHOICE_KEY); } catch { /* تجاهل */ }
    toast.info("اتمسح الاختيار — القرار قابل للتراجع في أي وقت");
  }, []);

  const value = useMemo<LabCtx>(() => ({
    active, setActive, bumpClicks,
    state: (id) => states[id],
    metrics: (id) => metricsMap[id],
    offline, setOffline,
    openSession, mark, unmark, markAllPresent, simulateSelfCheckin,
    addWeakness, removeWeakness, rate, setNotes, setStage, completeStage,
    closeSession, reopenSession, backToEntry, resetFlow, resetAll,
    choice, saveChoice, clearChoice,
  }), [active, states, metricsMap, offline, choice, bumpClicks, openSession, mark, unmark, markAllPresent,
       simulateSelfCheckin, addWeakness, removeWeakness, rate, setNotes, setStage, completeStage,
       closeSession, reopenSession, backToEntry, resetFlow, resetAll, saveChoice, clearChoice]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

