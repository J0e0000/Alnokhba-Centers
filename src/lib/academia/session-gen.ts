import "server-only";
import { db } from "@/lib/db";
import { dowOf } from "./dates";

/* ============================================================
   SESSION GENERATION (spec §11, §14)
   Idempotently materialize AcaSession rows from active weekly
   GroupSchedule occurrences for a given date. Called lazily by
   "today"/date endpoints — never duplicates existing sessions.
   Race guard: in-flight map dedupes concurrent calls for the same
   date within one server instance (find-then-create would otherwise
   double-create under parallel GETs).
============================================================ */

const inFlight = new Map<string, Promise<number>>();

export function ensureSessionsForDate(date: string): Promise<number> {
  const running = inFlight.get(date);
  if (running) return running;
  const p = ensureSessionsForDateInner(date).finally(() => inFlight.delete(date));
  inFlight.set(date, p);
  return p;
}

async function ensureSessionsForDateInner(date: string): Promise<number> {
  const dow = dowOf(date);
  const occs = await db.acaGroupSchedule.findMany({
    where: { dayOfWeek: dow, status: "ACTIVE" },
    include: { group: { select: { id: true, teacherId: true, room: true, isActive: true } } },
  });
  let created = 0;
  for (const occ of occs) {
    if (!occ.group.isActive) continue;
    const exists = await db.acaSession.findFirst({
      where: { groupId: occ.groupId, date, startTime: occ.startTime, scheduleId: occ.id },
      select: { id: true },
    });
    if (exists) continue;
    await db.acaSession.create({
      data: {
        groupId: occ.groupId,
        scheduleId: occ.id,
        date,
        startTime: occ.startTime,
        endTime: occ.endTime,
        room: occ.room ?? occ.group.room ?? null,
        teacherId: occ.group.teacherId,
        status: "SCHEDULED",
        workspace: JSON.stringify({ stages: { attendance: "pending", interaction: "pending", homework: "pending", exams: "pending", review: "pending" } }),
      },
    });
    created += 1;
  }
  return created;
}

export function defaultWorkspace(): string {
  return JSON.stringify({ stages: { attendance: "pending", interaction: "pending", homework: "pending", exams: "pending", review: "pending" } });
}

export type StageState = "pending" | "done";

export type Workspace = {
  stages: { attendance: StageState; interaction: StageState; homework: StageState; exams: StageState; review: StageState };
};

export function parseWorkspace(raw: string | null): Workspace {
  try {
    const w = raw ? JSON.parse(raw) : null;
    if (w && w.stages) return w as Workspace;
  } catch { /* fallthrough */ }
  return JSON.parse(defaultWorkspace()) as Workspace;
}
