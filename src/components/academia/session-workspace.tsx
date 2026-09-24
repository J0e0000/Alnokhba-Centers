"use client";

/* ============================================================
   SESSION WORKSPACE — Focus Mode (spec §14, §16, §17, §19, §21)
   Rendered standalone at /academia/session/[id] — NO shell/nav
   is mounted (real app state, not CSS hiding).
   Stages: الحضور → التفاعل → الواجب → الامتحانات → المراجعة
   Explicit stage completion. Optimistic UI + targeted autosave.
============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronRight, X, Check, CloudUpload, CloudCheck, CloudAlert, Search,
  UserCheck, UserX, Clock, ShieldCheck, CheckCheck, Loader2, ArrowLeft,
  NotebookPen, FileCheck2, ClipboardList, MessageSquareText, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  acaApi, ApiErr, makeSaver, debounce, fmt12, fmtDate,
  ATT_LABEL, RATING_LABEL, STAGE_LABEL,
  type AcaUserClient, type SessionDetail, type RosterRow, type AttRow, type SaveState,
} from "./client";
import { cn } from "@/lib/utils";

type Stage = "attendance" | "interaction" | "homework" | "exams" | "review";
const STAGE_ORDER: Stage[] = ["attendance", "interaction", "homework", "exams", "review"];

const RATING_OPTIONS = ["GREAT", "GOOD", "QUIET", "DISRUPTIVE"] as const;
const HW_SCORES = [10, 5, -5] as const;

export function SessionWorkspace({ sessionId, user }: { sessionId: string; user: AcaUserClient }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [att, setAtt] = useState<Record<string, string>>({});
  const [interactions, setInteractions] = useState<Record<string, string>>({});
  const [homework, setHomeworkState] = useState<Record<string, { completed: boolean; score: number | null }>>({});
  const [stage, setStage] = useState<Stage>("attendance");
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [finishing, setFinishing] = useState(false);

  const persist = useMemo(() => makeSaver(setSaveState), []);

  // debounced notes autosave — hook MUST run before any early return
  const saveNotes = useRef(debounce((text: string) => {
    persist(() => acaApi(`/api/academia/sessions/${sessionId}`, {
      method: "PATCH", body: JSON.stringify({ action: "notes", notes: text }),
    })).catch(() => toast.error("الملحوظات متحفظتش — جرب تاني"));
  }, 600)).current;

  // reset error state after a while
  useEffect(() => {
    if (saveState === "saved") {
      const t = setTimeout(() => setSaveState("idle"), 2500);
      return () => clearTimeout(t);
    }
    if (saveState === "error") {
      const t = setTimeout(() => setSaveState("idle"), 4000);
      return () => clearTimeout(t);
    }
  }, [saveState]);

  const load = useCallback(async () => {
    try {
      const d = await acaApi<{
        session: SessionDetail;
        roster: RosterRow[];
        attendance: AttRow[];
        interactions: { studentId: string; rating: string }[];
        homework: { studentId: string; completed: boolean; score: number | null }[];
      }>(`/api/academia/sessions/${sessionId}`);
      setSession(d.session);
      setRoster(d.roster);
      const a: Record<string, string> = {};
      d.attendance.forEach((r) => (a[r.studentId] = r.status));
      setAtt(a);
      const it: Record<string, string> = {};
      d.interactions.forEach((r) => (it[r.studentId] = r.rating));
      setInteractions(it);
      const hw: Record<string, { completed: boolean; score: number | null }> = {};
      d.homework.forEach((r) => (hw[r.studentId] = { completed: r.completed, score: r.score }));
      setHomeworkState(hw);
      setNotes(d.session.notes ?? "");
      const stages = d.session.workspace.stages;
      const firstPending = STAGE_ORDER.find((s) => stages[s] !== "done");
      setStage(firstPending ?? "review");
      setLoading(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "مشكلة في تحميل الحصة");
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-7 h-7 animate-spin" />
          <p className="text-sm font-bold">جاري فتح الحصة…</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-3">
          <p className="font-bold">الحصة دي مش موجودة</p>
          <Button onClick={() => router.push("/academia")}>رجوع</Button>
        </div>
      </main>
    );
  }

  const canEdit = user.role !== "STUDENT" && user.permissions.includes("attendance.edit");
  const locked = session.status === "COMPLETED" || session.status === "CANCELLED";

  // ---------------- mutations (optimistic → targeted persist) ----------------
  const markAttendance = (studentId: string, status: string) => {
    if (!canEdit || locked) return;
    const prev = att[studentId];
    setAtt((m) => ({ ...m, [studentId]: status })); // instant UI (spec §22)
    persist(() => acaApi(`/api/academia/sessions/${sessionId}/records`, {
      method: "POST", body: JSON.stringify({ kind: "attendance", studentId, status }),
    })).catch(() => {
      // rollback on failure
      setAtt((m) => { const c = { ...m }; if (prev) c[studentId] = prev; else delete c[studentId]; return c; });
      toast.error("مقدرناش نحفظ الحضور — جرب تاني");
    });
  };

  const setInteraction = (studentId: string, rating: string) => {
    if (!canEdit || locked) return;
    const prev = interactions[studentId];
    setInteractions((m) => ({ ...m, [studentId]: rating }));
    persist(() => acaApi(`/api/academia/sessions/${sessionId}/records`, {
      method: "POST", body: JSON.stringify({ kind: "interaction", studentId, rating }),
    })).catch(() => {
      setInteractions((m) => { const c = { ...m }; if (prev) c[studentId] = prev; else delete c[studentId]; return c; });
      toast.error("مقدرناش نحفظ التفاعل — جرب تاني");
    });
  };

  const updateHomework = (studentId: string, patch: { completed?: boolean; score?: number | null }) => {
    if (!canEdit || locked) return;
    const prev = homework[studentId] ?? { completed: false, score: null as number | null };
    const next = { completed: patch.completed ?? prev.completed, score: patch.score === undefined ? prev.score : patch.score };
    setHomeworkState((m) => ({ ...m, [studentId]: next }));
    persist(() => acaApi(`/api/academia/sessions/${sessionId}/records`, {
      method: "POST", body: JSON.stringify({ kind: "homework", studentId, completed: next.completed, score: next.score }),
    })).catch(() => {
      setHomeworkState((m) => ({ ...m, [studentId]: prev }));
      toast.error("مقدرناش نحفظ الواجب — جرب تاني");
    });
  };

  const completeStage = async (s: Stage) => {
    if (!canEdit || locked) return;
    try {
      const d = await acaApi<{ stages: SessionDetail["workspace"]["stages"] }>(`/api/academia/sessions/${sessionId}/records`, {
        method: "POST", body: JSON.stringify({ kind: "stage", stage: s, done: true }),
      });
      setSession((cur) => cur ? { ...cur, workspace: { stages: d.stages } } : cur);
      toast.success(`اتمّمت ${STAGE_LABEL[s]} ✓`);
      const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(s) + 1];
      if (nextStage) setStage(nextStage);
    } catch (e) {
      if (e instanceof ApiErr) toast.error(e.message);
    }
  };

  const finishSession = async () => {
    if (!canEdit || locked) return;
    if (session.workspace.stages.attendance !== "done") {
      toast.error("إتمام الحضور الأول قبل إنهاء الحصة.");
      return;
    }
    if (!confirm("إنهاء الحصة؟ الحصة هتتقفل وكل البيانات هتتثبت.")) return;
    setFinishing(true);
    try {
      await acaApi(`/api/academia/sessions/${sessionId}`, {
        method: "PATCH", body: JSON.stringify({ action: "finish" }),
      });
      toast.success("الحصة انتهت ✓");
      router.push("/academia");
    } catch (e) {
      if (e instanceof ApiErr) toast.error(e.message);
      setFinishing(false);
    }
  };

  const markedCount = Object.keys(att).length;
  const presentCount = Object.values(att).filter((s) => s === "PRESENT" || s === "LATE").length;
  const absentCount = Object.values(att).filter((s) => s === "ABSENT").length;

  return (
    <main className="min-h-dvh bg-background flex flex-col nk-safe-top" data-focus-mode="true">
      {/* ---------- Focus header: only session context — no global nav ---------- */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={() => router.push("/academia")} aria-label="خروج من وضع التركيز">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-extrabold text-base leading-tight truncate">{session.groupName}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {fmtDate(session.date)} · {fmt12(session.startTime)}–{fmt12(session.endTime)}{session.room ? ` · ${session.room}` : ""}
            </p>
          </div>
          <SaveChip state={saveState} />
        </div>
        {/* stage stepper — "التالي" = المرحلة الجاية مش الطالب الجاي (spec §17) */}
        <div className="max-w-3xl mx-auto px-4 pb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {STAGE_ORDER.map((s, i) => {
            const done = session.workspace.stages[s] === "done";
            const active = stage === s;
            return (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-extrabold border transition flex items-center gap-1",
                  active && "nk-brand-bg text-white border-transparent",
                  !active && done && "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                  !active && !done && "border-border text-muted-foreground bg-white/60 dark:bg-white/5",
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : <span className="opacity-70">{i + 1}</span>}
                {STAGE_LABEL[s]}
              </button>
            );
          })}
        </div>
      </header>

      {/* ---------- stage content ---------- */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-4 pb-28">
        {session.status === "SCHEDULED" && canEdit && (
          <div className="mb-4 rounded-2xl border-2 nk-brand-border bg-[color-mix(in_srgb,var(--c-primary)_6%,white)] dark:bg-white/5 p-4 flex items-center justify-between gap-3">
            <p className="text-sm font-bold">الحصة لسه مفتوحةش — ابدأها عشان تسجل الحضور والتفاعل.</p>
            <Button
              className="shrink-0 rounded-xl nk-brand-bg text-white font-extrabold"
              onClick={() => acaApi(`/api/academia/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ action: "start" }) })
                .then(() => setSession((c) => c ? { ...c, status: "STARTED" } : c))
                .catch((e) => e instanceof ApiErr && toast.error(e.message))}
            >
              <ChevronRight className="w-4 h-4 rotate-180" /> ابدأ الحصة
            </Button>
          </div>
        )}
        {session.status === "CANCELLED" && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-4 text-sm font-bold text-red-700 dark:text-red-300">
            الحصة دي ملغية.
          </div>
        )}

        {stage === "attendance" && (
          <AttendanceStage
            roster={roster} att={att} onMark={markAttendance} canEdit={canEdit}
            markedCount={markedCount} presentCount={presentCount} absentCount={absentCount}
            done={session.workspace.stages.attendance === "done"}
            onComplete={() => completeStage("attendance")}
            rosterTotal={roster.length}
          />
        )}

        {stage === "interaction" && (
          <InteractionStage roster={roster} interactions={interactions} onSet={setInteraction} canEdit={canEdit}
            done={session.workspace.stages.interaction === "done"} onComplete={() => completeStage("interaction")} />
        )}

        {stage === "homework" && (
          <HomeworkStage roster={roster} homework={homework} onSet={updateHomework} canEdit={canEdit}
            done={session.workspace.stages.homework === "done"} onComplete={() => completeStage("homework")} />
        )}

        {stage === "exams" && (
          <ExamsStage session={session} onGoExams={() => router.push("/academia?view=exams")}
            done={session.workspace.stages.exams === "done"} onComplete={() => completeStage("exams")} canEdit={canEdit} />
        )}

        {stage === "review" && (
          <ReviewStage session={session} notes={notes} setNotes={(v) => { setNotes(v); saveNotes(v); }} canEdit={canEdit}
            markedCount={markedCount} presentCount={presentCount} absentCount={absentCount}
            onFinish={finishSession} finishing={finishing} locked={locked} />
        )}
      </div>

      {/* ---------- footer: explicit stage completion (spec §19) ---------- */}
      {canEdit && !locked && (
        <footer className="fixed bottom-0 inset-x-0 z-20 border-t bg-background/95 backdrop-blur nk-safe-bottom">
          <div className="max-w-3xl mx-auto px-4 py-3">
            {stage !== "review" ? (
              <Button
                size="lg"
                className="w-full h-12 rounded-2xl text-base font-extrabold nk-brand-bg text-white"
                onClick={() => completeStage(stage)}
              >
                <CheckCheck className="w-5 h-5" />
                إتمام {STAGE_LABEL[stage]}{stage === "attendance" ? ` (${presentCount} حاضر · ${absentCount} غايب)` : ""}
              </Button>
            ) : (
              <Button
                size="lg"
                disabled={finishing}
                className="w-full h-12 rounded-2xl text-base font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={finishSession}
              >
                {finishing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCheck className="w-5 h-5" />}
                إنهاء الحصة وتثبيت كل حاجة
              </Button>
            )}
          </div>
        </footer>
      )}
    </main>
  );
}

/* ================= stages ================= */

function SaveChip({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <div aria-live="polite" className={cn(
      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold flex items-center gap-1",
      state === "saving" && "bg-muted text-muted-foreground",
      state === "saved" && "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
      state === "error" && "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
    )}>
      {state === "saving" && <><CloudUpload className="w-3.5 h-3.5 animate-pulse" /> بيتحفظ…</>}
      {state === "saved" && <><CloudCheck className="w-3.5 h-3.5" /> تم الحفظ ✓</>}
      {state === "error" && <><CloudAlert className="w-3.5 h-3.5" /> مش متحفظ</>}
    </div>
  );
}

/** Compact searchable attendance (spec §17-18): keyboard stays open,
 *  results above keyboard, Present/Absent directly tappable. */
function AttendanceStage({ roster, att, onMark, canEdit, markedCount, presentCount, absentCount, done, onComplete, rosterTotal }: {
  roster: RosterRow[]; att: Record<string, string>; onMark: (id: string, status: string) => void; canEdit: boolean;
  markedCount: number; presentCount: number; absentCount: number; done: boolean; onComplete: () => void; rosterTotal: number;
}) {
  const [q, setQ] = useState("");
  const [kb, setKb] = useState(0); // keyboard overlap height (visualViewport)
  const searchRef = useRef<HTMLInputElement>(null);

  // keyboard-aware layout (spec §18): lift footer/list, no hardcoded coords
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKb(overlap > 120 ? overlap : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  const rows = useMemo(() => {
    const needle = q.replace(/[\u0660-\u0669]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
    if (!needle) return roster;
    return roster.filter((r) => r.name.includes(needle) || r.code.includes(needle));
  }, [roster, q]);

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="متسجل" value={markedCount} total={rosterTotal} />
        <Stat label="حاضر" value={presentCount} tone="emerald" />
        <Stat label="غايب" value={absentCount} tone="red" />
      </div>

      <div className="sticky top-[92px] z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            inputMode="search"
            enterKeyHint="search"
            placeholder="اكتب اسم أو كود الطالب — الكيبورد هيفضل مفتوح"
            className="ps-10 h-12 rounded-2xl text-base font-bold"
            aria-label="بحث في الطلاب"
          />
          {q && (
            <button onClick={() => setQ("")} className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="مسح البحث">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5" style={{ paddingBottom: kb ? `${Math.min(kb - 60, 260)}px` : undefined }}>
        {rows.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">مفيش نتائج للبحث ده</p>}
        {rows.map((r) => {
          const status = att[r.profileId];
          return (
            <div key={r.profileId} className={cn(
              "flex items-center gap-2 rounded-2xl border p-2.5 transition",
              status === "PRESENT" && "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 dark:border-emerald-800",
              status === "ABSENT" && "border-red-300 bg-red-50/70 dark:bg-red-950/30 dark:border-red-800",
              status === "LATE" && "border-amber-300 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-800",
              status === "EXCUSED" && "border-sky-300 bg-sky-50/70 dark:bg-sky-950/30 dark:border-sky-800",
              !status && "border-border bg-white/70 dark:bg-white/5",
            )}>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm truncate">{r.name}</p>
                <p className="text-[11px] text-muted-foreground" dir="ltr">{r.code}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <TapBtn active={status === "PRESENT"} tone="emerald" disabled={!canEdit} onClick={() => onMark(r.profileId, "PRESENT")} label="حاضر">
                  <UserCheck className="w-4 h-4" />
                </TapBtn>
                <TapBtn active={status === "ABSENT"} tone="red" disabled={!canEdit} onClick={() => onMark(r.profileId, "ABSENT")} label="غايب">
                  <UserX className="w-4 h-4" />
                </TapBtn>
                <TapBtn active={status === "LATE"} tone="amber" disabled={!canEdit} onClick={() => onMark(r.profileId, "LATE")} label="متأخر">
                  <Clock className="w-4 h-4" />
                </TapBtn>
                <TapBtn active={status === "EXCUSED"} tone="sky" disabled={!canEdit} onClick={() => onMark(r.profileId, "EXCUSED")} label="بعذر">
                  <ShieldCheck className="w-4 h-4" />
                </TapBtn>
              </div>
            </div>
          );
        })}
      </div>

      {done && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-4 text-sm font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCheck className="w-5 h-5" /> الحضور اتتمّم خلاص — تقدر تعدّل أي حالة لو احتجت.
        </div>
      )}
    </div>
  );
}

function InteractionStage({ roster, interactions, onSet, canEdit, done, onComplete }: {
  roster: RosterRow[]; interactions: Record<string, string>; onSet: (id: string, rating: string) => void; canEdit: boolean; done: boolean; onComplete: () => void;
}) {
  const [q, setQ] = useState("");
  const rows = q.trim() ? roster.filter((r) => r.name.includes(q.trim()) || r.code.includes(q.trim())) : roster;
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <MessageSquareText className="w-4 h-4" /> سجّل تفاعل كل طالب في الحصة — معلومة بسيطة النهاردة بتبني تقرير أكاديمي بعدين.
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.profileId} className="rounded-2xl border border-border bg-white/70 dark:bg-white/5 p-2.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-bold text-sm">{r.name}</p>
              <span className="text-[11px] text-muted-foreground" dir="ltr">{r.code}</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {RATING_OPTIONS.map((rt) => (
                <TapBtn key={rt} active={interactions[r.profileId] === rt}
                  tone={rt === "GREAT" ? "emerald" : rt === "GOOD" ? "sky" : rt === "QUIET" ? "amber" : "red"}
                  disabled={!canEdit} onClick={() => onSet(r.profileId, rt)} label={RATING_LABEL[rt]} small>
                  {rt === "GREAT" ? <Star className="w-4 h-4" /> : <MessageSquareText className="w-4 h-4" />}
                </TapBtn>
              ))}
            </div>
          </div>
        ))}
      </div>
      {done && <DoneNote />}
    </div>
  );
}

function HomeworkStage({ roster, homework, onSet, canEdit, done, onComplete }: {
  roster: RosterRow[]; homework: Record<string, { completed: boolean; score: number | null }>; onSet: (id: string, patch: { completed?: boolean; score?: number | null }) => void; canEdit: boolean; done: boolean; onComplete: () => void;
}) {
  const [q, setQ] = useState("");
  const rows = q.trim() ? roster.filter((r) => r.name.includes(q.trim()) || r.code.includes(q.trim())) : roster;
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <NotebookPen className="w-4 h-4" /> الواجب بسيط: خلّص ولا لأ + درجة (+10 / +5 / -5). مفيش تعقيد.
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const hw = homework[r.profileId];
          return (
            <div key={r.profileId} className={cn(
              "rounded-2xl border p-2.5 transition",
              hw?.completed ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-800" : "border-border bg-white/70 dark:bg-white/5",
            )}>
              <div className="flex items-center gap-2">
                <button
                  disabled={!canEdit}
                  onClick={() => onSet(r.profileId, { completed: !hw?.completed })}
                  className={cn(
                    "w-11 h-11 shrink-0 rounded-xl border-2 flex items-center justify-center transition",
                    hw?.completed ? "nk-brand-bg text-white border-transparent" : "border-border bg-card dark:bg-transparent",
                  )}
                  aria-label={hw?.completed ? "الواجب خلص" : "علّم إن الواجب خلص"}
                >
                  {hw?.completed ? <Check className="w-5 h-5" /> : <NotebookPen className="w-5 h-5 text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">{hw?.completed ? "الواجب خلص" : "لسه"}</p>
                </div>
                <div className="flex items-center gap-1">
                  {HW_SCORES.map((s) => (
                    <TapBtn key={s} active={hw?.score === s} tone={s === 10 ? "emerald" : s === 5 ? "sky" : "red"}
                      disabled={!canEdit}
                      onClick={() => onSet(r.profileId, { score: hw?.score === s ? null : s, completed: true })}
                      label={`${s > 0 ? "+" : ""}${s}`} small>
                      <span className="text-xs font-extrabold">{s > 0 ? "+" : ""}{s}</span>
                    </TapBtn>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {done && <DoneNote />}
    </div>
  );
}

function ExamsStage({ session, onGoExams, done, onComplete, canEdit }: {
  session: SessionDetail; onGoExams: () => void; done: boolean; onComplete: () => void; canEdit: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground flex items-center gap-1.5">
        <FileCheck2 className="w-4 h-4" /> لو في كويز النهاردة، ارصده من شاشة الامتحانات — درجات الامتحان هي درجات الطالب في النظام.
      </p>
      {session.exams.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          مفيش امتحانات مربوطة بالحصة دي.
        </div>
      ) : (
        session.exams.map((e) => (
          <div key={e.id} className="rounded-2xl border border-border bg-white/70 dark:bg-white/5 p-3.5 flex items-center justify-between gap-2">
            <div>
              <p className="font-bold text-sm">{e.title}</p>
              <p className="text-xs text-muted-foreground">{fmtDate(e.date)} · الدرجة الكاملة {e.maxScore}</p>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl font-extrabold" onClick={onGoExams}>رصد الدرجات</Button>
          </div>
        ))
      )}
      {canEdit && (
        <Button variant="outline" className="w-full h-11 rounded-2xl font-extrabold" onClick={onGoExams}>
          <ClipboardList className="w-4 h-4" /> إنشاء امتحان / رصد درجات
        </Button>
      )}
      {done && <DoneNote />}
    </div>
  );
}

function ReviewStage({ session, notes, setNotes, canEdit, markedCount, presentCount, absentCount, onFinish, finishing, locked }: {
  session: SessionDetail; notes: string; setNotes: (v: string) => void; canEdit: boolean;
  markedCount: number; presentCount: number; absentCount: number; onFinish: () => void; finishing: boolean; locked: boolean;
}) {
  const hwDone = Object.values(session.workspace.stages).filter((s) => s === "done").length;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-white/70 dark:bg-white/5 p-4 space-y-2">
        <h3 className="font-extrabold text-sm mb-1">ملخص الحصة</h3>
        <Row label="الطلاب المتسجلين" value={String(markedCount)} />
        <Row label="حاضر" value={String(presentCount)} tone="emerald" />
        <Row label="غايب" value={String(absentCount)} tone="red" />
        <Row label="المراحل المكتملة" value={`${hwDone} من 5`} />
        <Row label="حالة الحصة" value={session.status === "COMPLETED" ? "خلصت" : session.status === "CANCELLED" ? "ملغية" : "شغالة"} />
      </div>

      <div>
        <label className="text-sm font-extrabold mb-1.5 block flex items-center gap-1.5">
          <MessageSquareText className="w-4 h-4" /> ملحوظات الحصة (بتتحفظ لوحدها)
        </label>
        <Textarea
          value={notes}
          disabled={!canEdit || locked}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="اكتب أي ملاحظة عن الحصة… (الطالب الفلاني كان متأخر، شرحنا الدرس كذا…)"
          className="rounded-2xl text-sm font-bold"
        />
      </div>

      {locked && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-4 text-sm font-bold text-emerald-800 dark:text-emerald-300">
          الحصة دي خلصت واتثبتت — التعديل من غير تصريح الإدارة مش متاح.
        </div>
      )}
    </div>
  );
}

/* ================= small pieces ================= */

function TapBtn({ active, tone, disabled, onClick, label, children, small }: {
  active: boolean; tone: "emerald" | "red" | "amber" | "sky"; disabled?: boolean; onClick: () => void; label: string; children: React.ReactNode; small?: boolean;
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-600 text-white border-emerald-600",
    red: "bg-red-600 text-white border-red-600",
    amber: "bg-amber-500 text-white border-amber-500",
    sky: "bg-sky-600 text-white border-sky-600",
  };
  const idleTones: Record<string, string> = {
    emerald: "text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800",
    red: "text-red-700 border-red-200 hover:bg-red-50 dark:text-red-300 dark:border-red-800",
    amber: "text-amber-700 border-amber-200 hover:bg-amber-50 dark:text-amber-300 dark:border-amber-800",
    sky: "text-sky-700 border-sky-200 hover:bg-sky-50 dark:text-sky-300 dark:border-sky-800",
  };
  return (
    <button
      type="button" disabled={disabled} onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={cn(
        "rounded-xl border-2 font-extrabold transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed",
        small ? "h-9 px-2.5 text-[11px] flex items-center gap-1" : "h-11 px-3 text-xs flex items-center gap-1",
        active ? tones[tone] : cn("bg-card dark:bg-transparent", idleTones[tone]),
      )}
    >
      {children}
      {small ? null : label}
    </button>
  );
}

function Stat({ label, value, total, tone }: { label: string; value: number; total?: number; tone?: "emerald" | "red" }) {
  return (
    <div className={cn(
      "rounded-2xl border p-3 text-center",
      tone === "emerald" && "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-800",
      tone === "red" && "border-red-200 bg-red-50/60 dark:bg-red-950/30 dark:border-red-800",
      !tone && "border-border bg-white/70 dark:bg-white/5",
    )}>
      <p className="text-xl font-black leading-none">{value}{total != null ? <span className="text-xs text-muted-foreground font-bold"> / {total}</span> : null}</p>
      <p className="text-[11px] font-bold text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "red" }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground font-bold">{label}</span>
      <span className={cn("font-extrabold", tone === "emerald" && "text-emerald-700 dark:text-emerald-300", tone === "red" && "text-red-700 dark:text-red-300")}>{value}</span>
    </div>
  );
}

function DoneNote() {
  return (
    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 p-4 text-sm font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
      <CheckCheck className="w-5 h-5" /> المرحلة دي اتتمّمت.
    </div>
  );
}
