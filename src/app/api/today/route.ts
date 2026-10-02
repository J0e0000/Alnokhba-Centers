import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { todayStr } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/today — عمود اليوم (Tabs Workflow):
   KPIs (حصص اليوم · طلاب مجدولين · قاعات شغالة) + الحصة الجاية
   + كروت حصص النهاردة المختصرة. استعلامات مجمّعة (مفيش N+1)
   + ميكرو-كاش 15 ثانية لكل (سنتر + دور) لحماية الداتابيز.
============================================================ */

type TodayEntry = { at: number; payload: unknown };
const cache = new Map<string, TodayEntry>();
const TTL_MS = 15_000;

function nowHM(): string {
  // توقيت القاهرة HH:MM — نفس مرجع سيرفر الحصص
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export const GET = handler(async () => {
  const user = await requireCenterUser();
  const centerId = user.centerId;
  const today = todayStr();

  const cacheKey = `${centerId}:${user.role}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return ok(hit.payload);

  const [sessions, plannedSlots, roomsCount] = await Promise.all([
    db.sessionInstance.findMany({
      where: { centerId, date: today },
      orderBy: { startTime: "asc" },
      include: {
        group: { include: { subject: true, grade: true, teacher: true } },
        _count: { select: { attendance: true } },
      },
    }),
    db.scheduleSlot.findMany({
      where: { centerId, dayOfWeek: new Date(`${today}T12:00:00Z`).getUTCDay(), isActive: true },
      include: { group: { include: { subject: true, grade: true, teacher: true, _count: { select: { students: true } } } } },
      orderBy: { startTime: "asc" },
    }),
    db.room.count({ where: { centerId, isActive: true } }),
  ]);

  const hm = nowHM();

  type Compact = {
    id: string; // session id — or `slot:<scheduleId>` for planned
    scheduleId: string | null;
    kind: "open" | "planned";
    status: "UPCOMING" | "LIVE" | "COMPLETED" | "CANCELLED";
    startTime: string; endTime: string; room: string | null;
    subject: string; grade: string; groupName: string; teacher: string;
    students: number; presentCount: number | null;
    groups: string[]; // group ids involved (for student KPI)
  };

  const compact: Compact[] = [];

  for (const s of sessions) {
    const running = s.status === "OPEN" && hm >= s.startTime && hm < s.endTime;
    const status: Compact["status"] =
      s.status === "CANCELLED" ? "CANCELLED" :
      s.status === "CLOSED" ? "COMPLETED" :
      s.status === "OPEN" ? (running ? "LIVE" : "UPCOMING") : "UPCOMING";
    compact.push({
      id: s.id, scheduleId: s.scheduleId, kind: "open", status,
      startTime: s.startTime, endTime: s.endTime, room: s.room,
      subject: s.group.subject.name, grade: s.group.grade.name, groupName: s.group.name,
      teacher: s.group.teacher?.name ?? "—",
      students: s._count.attendance, presentCount: s.presentCount,
      groups: [s.groupId],
    });
  }

  const cancelledSlotIds = new Set(
    sessions.filter((s) => s.status === "CANCELLED" && s.scheduleId).map((s) => s.scheduleId as string),
  );
  const materializedSlotIds = new Set(sessions.map((s) => s.scheduleId).filter(Boolean) as string[]);

  for (const p of plannedSlots) {
    if (materializedSlotIds.has(p.id) && !cancelledSlotIds.has(p.id)) continue;
    compact.push({
      id: `slot:${p.id}`, scheduleId: p.id, kind: "planned", status: "UPCOMING",
      startTime: p.startTime, endTime: p.endTime, room: p.room,
      subject: p.group.subject.name, grade: p.group.grade.name, groupName: p.group.name,
      teacher: p.group.teacher?.name ?? "—",
      students: p.group._count.students, presentCount: null,
      groups: [p.groupId],
    });
  }

  compact.sort((a, b) => a.startTime.localeCompare(b.startTime));

  // ===== KPI #1 — حصص النهاردة: {total, completed, upcoming, live, cancelled} =====
  const kpiSessions = {
    total: compact.filter((c) => c.status !== "CANCELLED").length,
    completed: compact.filter((c) => c.status === "COMPLETED").length,
    upcoming: compact.filter((c) => c.status === "UPCOMING").length,
    live: compact.filter((c) => c.status === "LIVE").length,
    cancelled: compact.filter((c) => c.status === "CANCELLED").length,
  };

  // ===== KPI #2 — طلاب مجدولين النهاردة (distinct عبر مجموعات اليوم) =====
  const todayGroupIds = [...new Set(compact.filter((c) => c.status !== "CANCELLED").flatMap((c) => c.groups))];
  let studentsScheduled = 0;
  const studentsGroups = todayGroupIds.length;
  if (todayGroupIds.length > 0) {
    const regs = await db.studentGroup.findMany({
      where: { groupId: { in: todayGroupIds }, status: "ACTIVE" },
      select: { studentId: true },
    });
    studentsScheduled = new Set(regs.map((r) => r.studentId)).size;
  }

  // ===== KPI #3 — قاعات شغالة + أقرب تحرير قاعة =====
  const runningNow = compact.filter((c) => c.status === "LIVE" && c.room);
  const roomsInUse = new Set(runningNow.map((c) => c.room as string)).size;
  const nextRelease = runningNow.length
    ? runningNow.reduce((mx, c) => (c.endTime > mx ? c.endTime : mx), runningNow[0].endTime)
    : null;

  // ===== الحصة الجاية (NEXT SESSION) — الشغالة الأول، ثم أقرب قادمة =====
  const next =
    compact.find((c) => c.status === "LIVE") ??
    compact.find((c) => c.status === "UPCOMING" && c.startTime > hm && c.kind === "open") ??
    compact.find((c) => c.status === "UPCOMING" && c.startTime > hm) ??
    compact.find((c) => c.status === "UPCOMING") ??
    null;

  const payload = {
    today,
    now: hm,
    kpis: {
      sessions: kpiSessions,
      students: { scheduled: studentsScheduled, groups: studentsGroups },
      rooms: { inUse: roomsInUse, total: roomsCount, nextRelease },
    },
    nextSession: next,
    sessions: compact,
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  if (cache.size > 200) cache.clear();
  return ok(payload);
});
