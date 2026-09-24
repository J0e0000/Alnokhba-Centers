"use client";

/* AlNokhba Academia — client helpers: api, types, autosave hook (spec §21-22) */

export type AcaUserClient = {
  id: string;
  name: string;
  username: string;
  role: "ADMIN" | "MANAGER" | "TEACHER" | "STUDENT";
  scope: "academia";
  permissions: string[];
  studentProfileId?: string | null;
};

export type Term = { id: string; name: string; type: string; startDate: string; endDate: string } | null;

export type SessionListItem = {
  id: string; groupId: string; groupName: string; subject: string; color: string;
  date: string; startTime: string; endTime: string; room: string | null;
  status: string; isMakeup: boolean; title: string | null;
  topic: { id: string; title: string } | null;
  marked: number; roster: number;
};

export type WorkspaceState = {
  stages: { attendance: "pending" | "done"; interaction: "pending" | "done"; homework: "pending" | "done"; exams: "pending" | "done"; review: "pending" | "done" };
};

export type SessionDetail = {
  id: string; groupId: string; groupName: string;
  subject: { id: string; name: string; color: string };
  date: string; startTime: string; endTime: string; room: string | null;
  status: string; isMakeup: boolean; title: string | null; notes: string | null;
  topic: { id: string; title: string; unit: { id: string; title: string } } | null;
  exams: { id: string; title: string; type: string; maxScore: number; date: string }[];
  workspace: WorkspaceState;
};

export type RosterRow = { profileId: string; code: string; name: string };

export type AttRow = { studentId: string; status: string; note: string | null; markedAt: string };

export class ApiErr extends Error {
  status: number;
  conflicts?: { type: string; message: string }[];
  constructor(message: string, status: number, conflicts?: { type: string; message: string }[]) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}

export async function acaApi<T>(url: string, init?: RequestInit & { silent?: boolean }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string; error?: string; conflicts?: { type: string; message: string }[] };
    const msg = d.message ?? d.error ?? "حصلت مشكلة — جرب تاني.";
    throw new ApiErr(msg, res.status, d.conflicts);
  }
  return data as T;
}

/* ---------------- autosave: optimistic + saved indicator ---------------- */
export type SaveState = "idle" | "saving" | "saved" | "error";

/** Tiny mutation runner: immediate local update already applied by caller;
 *  this persists targeted data and tracks the saved chip state. */
export function makeSaver(setState: (s: SaveState) => void) {
  let pending = 0;
  let failed = 0;
  return async function persist(fn: () => Promise<unknown>) {
    pending += 1;
    setState("saving");
    try {
      await fn();
      pending -= 1;
      if (pending === 0 && failed === 0) setState("saved");
      else if (pending === 0 && failed > 0) setState("error");
    } catch (e) {
      pending -= 1;
      failed += 1;
      setState("error");
      throw e;
    }
  };
}

/** debounce for text fields */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const ATT_LABEL: Record<string, string> = { PRESENT: "حاضر", ABSENT: "غايب", LATE: "متأخر", EXCUSED: "بعذر" };
export const RATING_LABEL: Record<string, string> = { GREAT: "متميز", GOOD: "متفاعل", QUIET: "هادي", DISRUPTIVE: "مشوش" };
export const STAGE_LABEL: Record<string, string> = { attendance: "الحضور", interaction: "التفاعل", homework: "الواجب", exams: "الامتحانات", review: "المراجعة" };
export const DOW_AR = ["الأحد", "الإتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function fmtDate(d: string): string {
  try {
    return new Date(d + "T00:00:00Z").toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  } catch {
    return d;
  }
}
