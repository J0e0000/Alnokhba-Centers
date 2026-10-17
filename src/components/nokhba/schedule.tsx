"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays, Plus, Pencil, Trash2, Copy, DoorClosed, Play,
  MapPin, Loader2, GraduationCap, Building2, X, Check, Ban, Printer, AlertTriangle,
  Move, Info, GripVertical, CheckCircle2, Users, Percent, Coins, CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  api, fmt, formatTime12, DAY_TABS, sessionPhase, todayStr, dayNameAR,
  userCan, type SessionUser,
} from "./lib";
import { PageHeader, Loading, SectionCard, EmptyState } from "./shared";
import { usePrint, PrintableDaySchedule, type DayScheduleHall } from "./print";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/* ============================================================
   الجدول التفاعلي v2 — شبكة القاعات × 7 بلوكات ثابتة (08:00→22:00)
   - الصفوف = القاعات · الأعمدة = 7 بلوكات ساعتين (آخرها 20:00–22:00)
   - الحصة المتعددة بلوكات بتترسم شريط واحد متصل (بالنِسب الزمنية)
   - الأخضر = مفيش تعارض موارد · الأصفر = تعارض مدرس/قاعة (بيتحفظ بتأكيد)
   - مطابقة الصف/المادة/القسم لوحدها عمرها ما تعارض — الحصص المتوازية حرة
   - السحب والإفلات بمعاينة + إعادة حساب التعارض قبل الحفظ + بديل كيبورد (نقل)
   - موبايل: قايمة مريحة بدل الشبكة المصغرة
============================================================ */

// ====== البلوكات الثابتة ======
const BLOCKS = [
  { start: "08:00", end: "10:00" },
  { start: "10:00", end: "12:00" },
  { start: "12:00", end: "14:00" },
  { start: "14:00", end: "16:00" },
  { start: "16:00", end: "18:00" },
  { start: "18:00", end: "20:00" },
  { start: "20:00", end: "22:00" },
];
const DAY_START_MIN = 8 * 60;
const DAY_SPAN_MIN = 14 * 60; // 08:00 → 22:00
const ROW_H = 78; // ارتفاع صف القاعة لكل لين

type Slot = {
  id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null;
  groupId: string; groupName: string; subject: string; grade: string; teacher: string;
  teacherId: string | null; price: number; teacherPercent: number; students: number;
  updatedAt: string; lastOverrideAt: string | null;
};

type Room = { id: string; name: string; capacity: number | null };

type ScheduleData = {
  days: { dayOfWeek: number; slots: Slot[] }[];
  rooms: Room[];
  conflicts?: { type: string; label: string; detail: string }[];
  groups: { id: string; name: string; subject: string; grade: string; teacher: string | null; price: number; teacherPercent: number; room: string | null; teacherId: string | null }[];
};

type TodaySession = {
  id: string; startTime: string; endTime: string; status: string; subject: string; grade: string;
  groupName: string; teacher: string; price: number; attendanceCount: number; presentCount: number;
  room?: string | null;
};

type Suggestion = { scheduleId: string; subject: string; grade: string; groupName: string; startTime: string };

type SlotFlag = { type: "TEACHER" | "ROOM" | "DUPLICATE"; label: string; detail: string };

// ============================= أدوات الوقت =============================

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function fromMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function overlapsMin(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}
/** تاريخ وتوقيت القاهرة — السنترات بتشتغل بتوقيت مصر مش ساعة الجهاز */
function cairoToday(): { date: string; dow: number } {
  const ds = todayStr();
  return { date: ds, dow: new Date(`${ds}T12:00:00Z`).getUTCDay() };
}
/** أقرب تاريخ فعلي ليوم أسبوعي معين (من النهاردة بالقاهرة) */
function dateForDow(dow: number): string {
  const { date, dow: td } = cairoToday();
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((dow - td + 7) % 7));
  return d.toISOString().slice(0, 10);
}
function nowMinCairo(): number {
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
  return toMin(hm);
}

// ============================= محرك التعارض (زي السيرفر حرفيًا) =============================

/** تداخل فتري حقيقي — كل البلوكات المشغولة، مش مطابقة وقت البداية */
function computeDayFlags(daySlots: Slot[]): Map<string, SlotFlag[]> {
  const map = new Map<string, SlotFlag[]>();
  const mins = daySlots.map((s) => ({ s, s0: toMin(s.startTime), e0: toMin(s.endTime) }));
  for (const a of mins) {
    const flags: SlotFlag[] = [];
    for (const b of mins) {
      if (a.s.id === b.s.id) continue; // مفيش self-conflict
      if (!overlapsMin(a.s0, a.e0, b.s0, b.e0)) continue;
      if (a.s.teacherId && a.s.teacherId === b.s.teacherId) {
        flags.push({
          type: "TEACHER",
          label: `تعارض مدرس — ${a.s.teacher}`,
          detail: `متقاطع مع ${b.s.subject} (${b.s.groupName}) ${formatTime12(b.s.startTime)}–${formatTime12(b.s.endTime)}`,
        });
      }
      if (a.s.room && b.s.room && a.s.room === b.s.room) {
        flags.push({
          type: "ROOM",
          label: `تعارض قاعة — ${a.s.room}`,
          detail: `القاعة محجوزة لـ ${b.s.subject} (${b.s.groupName}) ${formatTime12(b.s.startTime)}–${formatTime12(b.s.endTime)}`,
        });
      }
      if (a.s.groupId === b.s.groupId) {
        flags.push({
          type: "DUPLICATE",
          label: `تكرار محتمل — ${a.s.subject} (${a.s.groupName})`,
          detail: `نفس المجموعة ليها حصة متقاطعة ${formatTime12(b.s.startTime)}–${formatTime12(b.s.endTime)} — لو مقصودة كمّل عادي`,
        });
      }
    }
    map.set(a.s.id, flags);
  }
  return map;
}

function blockingFlags(flags: SlotFlag[] | undefined): SlotFlag[] {
  return (flags ?? []).filter((f) => f.type === "TEACHER" || f.type === "ROOM");
}
function hintFlags(flags: SlotFlag[] | undefined): SlotFlag[] {
  return (flags ?? []).filter((f) => f.type === "DUPLICATE");
}

// ============================= تخطيط اللينات (حصص متعارضة جنب بعض) =============================

type Placed = { slot: Slot; s0: number; e0: number; lane: number; lanes: number };

function layoutRoom(slots: Slot[]): { placed: Placed[]; lanes: number } {
  const items = slots
    .map((s) => ({ slot: s, s0: toMin(s.startTime), e0: toMin(s.endTime) }))
    .sort((a, b) => a.s0 - b.s0 || a.e0 - b.e0);
  const laneEnds: number[] = [];
  const raw = items.map((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.s0);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.e0); }
    else laneEnds[lane] = it.e0;
    return { ...it, lane };
  });
  const lanes = Math.max(1, laneEnds.length);
  return { placed: raw.map((r) => ({ ...r, lanes })), lanes };
}

// ============================= المكوّن الرئيسي =============================

export function ScheduleView({ user, openSession }: { user: SessionUser; openSession: (id: string) => void }) {
  const isManager = user.role === "MANAGER";
  const canOpenSessions = userCan(user, "START_SESSION");

  const [data, setData] = useState<ScheduleData | null>(null);
  const [day, setDay] = useState(() => cairoToday().dow);
  const [today, setToday] = useState<TodaySession[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);

  // فلاتر المورد + وضع أسبوع المورد
  const [fTeacher, setFTeacher] = useState("");
  const [fGroup, setFGroup] = useState("");
  const [fRoom, setFRoom] = useState("");
  const [weekMode, setWeekMode] = useState(false);

  // الحوارات
  const [dialogSlot, setDialogSlot] = useState<Slot | null>(null); // edit / duplicate (id="")
  const [createSeed, setCreateSeed] = useState<{ day: number; room: string; blockIdx: number } | null>(null);
  const [detailsSlot, setDetailsSlot] = useState<Slot | null>(null);
  const [moveSlot, setMoveSlot] = useState<Slot | null>(null);
  const [roomsOpen, setRoomsOpen] = useState(false);

  // السحب والإفلات
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const cairoNow = cairoToday();

  const load = () => api<ScheduleData>("/api/schedule").then(setData).catch(() => {});
  const loadToday = () =>
    api<{ sessions: TodaySession[]; suggestions: Suggestion[] }>("/api/sessions")
      .then((d) => { setToday(d.sessions); setSuggestions(d.suggestions); })
      .catch(() => {});

  useEffect(() => { load(); loadToday(); }, []);
  useEffect(() => {
    const t = setInterval(loadToday, 20000);
    return () => clearInterval(t);
  }, [loadToday]);

  const daySlots = useMemo(
    () => data?.days.find((d) => d.dayOfWeek === day)?.slots ?? [],
    [data, day],
  );

  // الفلاتر
  const filteredSlots = useMemo(
    () => daySlots.filter((s) =>
      (!fTeacher || s.teacherId === fTeacher) &&
      (!fGroup || s.groupId === fGroup) &&
      (!fRoom || (s.room ?? "") === fRoom)),
    [daySlots, fTeacher, fGroup, fRoom],
  );
  const resourceActive = !!(fTeacher || fGroup || fRoom);

  // كل أساتذة المجموعات (للفلتر)
  const teachers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of data?.groups ?? []) if (g.teacherId && g.teacher) seen.set(g.teacherId, g.teacher);
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [data]);

  // تعارضات اليوم على كامل حصص اليوم — مش الفلتر: النقل جوه شبكة مفلترة لازم يشوف كل التعارضات
  const dayFlags = useMemo(() => computeDayFlags(daySlots), [daySlots]);
  // تعارضات الأسبوع كله (لوضع أسبوع المورد)
  const weekFlags = useMemo(() => {
    const m = new Map<string, SlotFlag[]>();
    for (const d of data?.days ?? []) for (const [k, v] of computeDayFlags(d.slots)) m.set(k, v);
    return m;
  }, [data]);
  const conflictCount = useMemo(
    () => [...dayFlags.values()].filter((f) => blockingFlags(f).length > 0).length,
    [dayFlags],
  );

  // صفوف القاعات: سجل القاعات الأول + أسماء قديمة موجودة في الجدول + "بدون قاعة" آخرًا
  const roomRows = useMemo(() => {
    if (!data) return [];
    const registry = data.rooms.map((r) => r.name);
    const used = new Set(filteredSlots.map((s) => s.room ?? ""));
    const legacy = [...used].filter((k) => k && !registry.includes(k));
    const keys = [...registry, ...legacy];
    if (used.has("")) keys.push("");
    return keys
      .filter((k) => !fRoom || k === fRoom)
      .map((name) => ({
        name,
        room: data.rooms.find((r) => r.name === name) ?? null,
        slots: filteredSlots.filter((s) => (s.room ?? "") === name),
      }));
  }, [data, filteredSlots, fRoom]);

  // حصص خارج الشبكة (قبل 8 أو بعد 10 مساءً) — نادرة بس مش بنخفيها
  const offGrid = useMemo(
    () => filteredSlots.filter((s) => toMin(s.endTime) <= DAY_START_MIN || toMin(s.startTime) >= DAY_SPAN_MIN + DAY_START_MIN),
    [filteredSlots],
  );

  const printDay = usePrint();
  function printSchedule() {
    const halls: DayScheduleHall[] = roomRows
      .filter((h) => h.slots.length > 0)
      .map(({ name, room, slots: hs }) => ({
        name: name || "بدون قاعة",
        capacity: room?.capacity ?? null,
        slots: hs.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => ({
          startTime: s.startTime, endTime: s.endTime, subject: s.subject,
          grade: s.grade, groupName: s.groupName, teacher: s.teacher, students: s.students,
        })),
      }));
    const dayLabel = DAY_TABS.find((t) => t.dow === day)?.label ?? "";
    printDay(
      <PrintableDaySchedule dayLabel={dayLabel} dateStr={dateForDow(day)} halls={halls} center={user.center} />,
      `جدول ${dayLabel} — ${user.center?.name ?? "السنتر"}`,
    );
  }

  /** إسقاط حصة على خلية: معاينة النقل + إعادة حساب التعارض قبل الحفظ */
  function handleDrop(roomName: string, blockIdx: number) {
    setDropTarget(null);
    if (!dragId) return;
    const slot = daySlots.find((s) => s.id === dragId);
    setDragId(null);
    if (!slot) return;
    const sameRoom = (slot.room ?? "") === roomName;
    const curBlock = BLOCKS.findIndex((b) => b.start === slot.startTime);
    if (sameRoom && curBlock === blockIdx) return; // نفس المكان — مفيش حاجة
    setMoveSlot(slot);
    setMoveSeed({ day: slot.dayOfWeek, room: roomName, blockIdx, fromDrag: true });
  }

  const [moveSeed, setMoveSeed] = useState<{ day: number; room: string; blockIdx: number; fromDrag?: boolean } | null>(null);

  if (!data) return <Loading />;

  const empty = roomRows.length === 0 && offGrid.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الجداول"
        subtitle="جدول تفاعلي — كل قاعة صف، وكل بلوك ساعتين عمود"
        action={
          <div className="flex gap-2 flex-wrap">
            <button onClick={printSchedule}
              className="border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98]">
              <Printer className="w-4.5 h-4.5" /> طباعة اليوم
            </button>
            {isManager && (
              <>
                <button onClick={() => setRoomsOpen(true)} className="border-2 border-border bg-card font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98]">
                  <Building2 className="w-4.5 h-4.5" /> القاعات
                </button>
                <button onClick={() => { setCreateSeed({ day, room: fRoom, blockIdx: 4 }); setDialogSlot(null); }}
                  className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98]">
                  <Plus className="w-4.5 h-4.5" /> حصة جديدة
                </button>
              </>
            )}
          </div>
        }
      />

      {/* ===== تنبيهات الجدول الذكية ===== */}
      {data.conflicts && data.conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2 dark:bg-amber-500/10 dark:border-amber-500/40">
          <button onClick={() => setAlertsOpen(!alertsOpen)} className="w-full font-extrabold text-sm flex items-center gap-2 text-amber-800 dark:text-amber-300" aria-expanded={alertsOpen}>
            <AlertTriangle className="w-4 h-4" /> تنبيهات الجدول — {data.conflicts.length} ملاحظة
            <span className="ms-auto text-[11px] font-bold">{alertsOpen ? "إخفاء" : "عرض"}</span>
          </button>
          {alertsOpen && (
            <div className="space-y-1.5">
              {data.conflicts.slice(0, 8).map((c, i) => (
                <div key={i} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
                  <p className="text-xs font-extrabold text-amber-900 dark:text-amber-200">{c.label}</p>
                  <p className="text-[11px] font-bold text-amber-800/80 dark:text-amber-300/80">{c.detail}</p>
                </div>
              ))}
              <p className="text-[10px] font-bold text-amber-800/70 dark:text-amber-300/70">
                التنبيهات استشارية بس — مفيش أي تغيير تلقائي على جدولك.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ===== فلاتر المورد ===== */}
      <div className="nk-card rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-extrabold text-muted-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5" /> فلترة:</span>
        <select value={fTeacher} onChange={(e) => setFTeacher(e.target.value)} aria-label="فلتر المدرس"
          className="h-10 rounded-xl border-2 border-input bg-card px-2.5 text-xs font-bold max-w-[150px]">
          <option value="">كل المدرسين</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} aria-label="فلتر المجموعة"
          className="h-10 rounded-xl border-2 border-input bg-card px-2.5 text-xs font-bold max-w-[170px]">
          <option value="">كل المجموعات</option>
          {(data?.groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>{g.subject} — {g.grade} {g.name}</option>
          ))}
        </select>
        <select value={fRoom} onChange={(e) => { setFRoom(e.target.value); }} aria-label="فلتر القاعة"
          className="h-10 rounded-xl border-2 border-input bg-card px-2.5 text-xs font-bold max-w-[140px]">
          <option value="">كل القاعات</option>
          {(data?.rooms ?? []).map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>
        {resourceActive && (
          <>
            <button onClick={() => setWeekMode(!weekMode)}
              className={cn("h-10 rounded-xl px-3.5 text-xs font-extrabold border-2 flex items-center gap-1.5",
                weekMode ? "nk-brand-bg text-white border-transparent" : "bg-card border-border nk-brand-text")}>
              <CalendarClock className="w-3.5 h-3.5" /> أسبوع المورد
            </button>
            <button onClick={() => { setFTeacher(""); setFGroup(""); setFRoom(""); setWeekMode(false); }}
              className="h-10 rounded-xl px-3 text-xs font-extrabold border-2 border-border bg-card text-muted-foreground flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> مسح الفلاتر
            </button>
          </>
        )}
      </div>

      {/* ===== وضع أسبوع المورد: كل الأيام بقايمة مختصرة ===== */}
      {resourceActive && weekMode ? (
        <div className="space-y-3">
          {DAY_TABS.map((t) => {
            const slots = (data.days.find((d) => d.dayOfWeek === t.dow)?.slots ?? [])
              .filter((s) => (!fTeacher || s.teacherId === fTeacher) && (!fGroup || s.groupId === fGroup) && (!fRoom || (s.room ?? "") === fRoom))
              .sort((a, b) => a.startTime.localeCompare(b.startTime));
            return (
              <div key={t.dow} className="nk-card rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => { setDay(t.dow); setWeekMode(false); }} className="font-extrabold text-sm nk-brand-text hover:underline">
                    {t.label}
                  </button>
                  {t.dow === cairoNow.dow && <span className="text-[10px] font-extrabold rounded-full nk-brand-bg text-white px-2 py-0.5">النهاردة</span>}
                  <span className="text-[10px] font-bold text-muted-foreground nk-num">{dateForDow(t.dow)}</span>
                  <span className="ms-auto text-[10px] font-bold rounded-full bg-muted px-2 py-0.5 nk-num">{slots.length} حصة</span>
                </div>
                {slots.length === 0 ? (
                  <p className="text-xs font-bold text-muted-foreground py-2">مفيش حصص مطابقة للفلتر.</p>
                ) : (
                  <div className="space-y-1.5">
                    {slots.map((s) => (
                      <button key={s.id} onClick={() => setDetailsSlot(s)}
                        className="w-full flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-start hover:bg-muted/40 transition">
                        <span className="nk-num text-xs font-extrabold shrink-0 w-[110px]">{formatTime12(s.startTime)}–{formatTime12(s.endTime)}</span>
                        <span className="flex-1 min-w-0 font-bold text-[13px] truncate">{s.subject} — {s.grade} {s.groupName}</span>
                        <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{s.teacher}</span>
                        {blockingFlags(weekFlags.get(s.id)).length > 0 && (
                          <span className="shrink-0 text-[10px] font-extrabold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 flex items-center gap-1 dark:text-amber-200">
                            <AlertTriangle className="w-3 h-3" /> تعارض
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* ===== تابات الأيام ===== */}
          <div className="flex gap-1.5 overflow-x-auto nk-scroll pb-1" role="tablist" aria-label="أيام الأسبوع">
            {DAY_TABS.map((t) => {
              const count = data.days.find((d) => d.dayOfWeek === t.dow)?.slots.length ?? 0;
              const isToday = t.dow === cairoNow.dow;
              return (
                <button key={t.dow} role="tab" aria-selected={day === t.dow} onClick={() => setDay(t.dow)}
                  className={cn(
                    "shrink-0 rounded-2xl border px-4 py-2.5 font-extrabold text-sm transition flex items-center gap-2",
                    day === t.dow ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}>
                  {t.label}
                  {isToday && <span className={cn("w-1.5 h-1.5 rounded-full", day === t.dow ? "bg-white/80" : "nk-brand-bg")} aria-label="النهاردة" />}
                  {count > 0 && (
                    <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 font-bold nk-num", day === t.dow ? "bg-white/25" : "bg-muted")}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ===== الشبكة (ديسكتوب) ===== */}
          <div className="hidden md:block nk-card rounded-2xl overflow-hidden">
            {empty ? (
              <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش قاعات ولا حصص"
                hint={isManager ? "ضيف قاعات من زرار «القاعات» فوق، وبعدين دوس على أي خلية فاضية تضيف حصة." : "المدير بيضيف القاعات والحصص."} />
            ) : (
              <div className="overflow-x-auto nk-scroll">
                <div className="min-w-[880px]">
                  {/* رأس الأوقات */}
                  <div className="flex sticky top-0 z-20 bg-card border-b-2 border-border">
                    <div className="w-32 shrink-0 px-3 py-2.5 text-[11px] font-extrabold text-muted-foreground flex items-center gap-1.5">
                      <DoorClosed className="w-3.5 h-3.5" /> القاعة
                    </div>
                    <div className="flex-1 grid grid-cols-7">
                      {BLOCKS.map((b, i) => (
                        <div key={i} className="px-2 py-2.5 text-center text-[11px] font-extrabold text-muted-foreground border-s border-border/60 nk-num"
                          title={`بلوك ${i + 1} من 7`}>
                          {formatTime12(b.start)}<span className="mx-0.5">–</span>{formatTime12(b.end)}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* صفوف القاعات */}
                  {roomRows.map(({ name, room, slots: roomSlots }) => {
                    const { placed, lanes } = layoutRoom(roomSlots);
                    const display = name || "بدون قاعة";
                    const showNow = day === cairoNow.dow;
                    const nowFrac = ((nowMinCairo() - DAY_START_MIN) / DAY_SPAN_MIN) * 100;
                    return (
                      <div key={name || "__none"} className="flex border-b border-border/50 last:border-0">
                        {/* اسم القاعة */}
                        <div className="w-32 shrink-0 px-3 py-3 bg-muted/30 border-s-0 flex flex-col justify-center gap-1">
                          <span className="font-extrabold text-[13px] nk-brand-text flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" /> {display}</span>
                          {room?.capacity ? <span className="text-[10px] font-bold text-muted-foreground nk-num">سعة {room.capacity}</span> : null}
                          <span className="text-[10px] font-bold text-muted-foreground nk-num">{roomSlots.length} حصة</span>
                        </div>
                        {/* شبكة اليوم */}
                        <div className="relative flex-1" style={{ height: Math.max(lanes, 1) * ROW_H }}>
                          {/* خلفية البلوكات = أزرار إضافة + أهداف الإسقاط */}
                          <div className="absolute inset-0 grid grid-cols-7">
                            {BLOCKS.map((b, i) => {
                              const key = `${name || "__none"}:${i}`;
                              return (
                                <button key={i}
                                  disabled={!isManager}
                                  onClick={() => { setCreateSeed({ day, room: name, blockIdx: i }); setDialogSlot(null); }}
                                  onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTarget(key); } }}
                                  onDragLeave={() => setDropTarget((cur) => (cur === key ? null : cur))}
                                  onDrop={(e) => { e.preventDefault(); handleDrop(name, i); }}
                                  aria-label={isManager ? `إضافة حصة في ${display} بلوك ${formatTime12(b.start)}` : undefined}
                                  className={cn(
                                    "border-s border-border/40 first:border-s-0 transition-colors",
                                    isManager && "hover:bg-[color-mix(in_srgb,var(--c-primary)_6%,transparent)]",
                                    isManager && !dragId && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    dropTarget === key && "bg-amber-100/80 dark:bg-amber-500/20 ring-2 ring-inset ring-amber-400",
                                  )} />
                              );
                            })}
                          </div>
                          {/* خط الساعة الحالية */}
                          {showNow && nowFrac >= 0 && nowFrac <= 100 && (
                            <div className="absolute top-0 bottom-0 z-10 pointer-events-none w-0.5 bg-rose-400/70" style={{ insetInlineStart: `${nowFrac}%` }} aria-hidden="true">
                              <span className="absolute -top-0.5 w-2 h-2 rounded-full bg-rose-400" style={{ insetInlineStart: -3 }} />
                            </div>
                          )}
                          {/* الحصص */}
                          {placed.map(({ slot, lane, lanes: ln, s0, e0 }) => (
                            <SlotChip key={slot.id} slot={slot} lane={lane} lanes={ln}
                              flags={dayFlags.get(slot.id) ?? []}
                              dragging={dragId === slot.id}
                              onDragStart={() => setDragId(slot.id)}
                              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                              onClick={() => setDetailsSlot(slot)}
                              draggable={isManager} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ===== الموبايل: قايمة مريحة بدل الشبكة المصغرة ===== */}
          <div className="md:hidden space-y-3">
            {empty ? (
              <div className="nk-card rounded-2xl">
                <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش قاعات ولا حصص"
                  hint={isManager ? "ضيف قاعات من زرار «القاعات» فوق." : "المدير بيضيف القاعات والحصص."} />
              </div>
            ) : (
              <>
                {roomRows.map(({ name, room, slots: roomSlots }) => (
                  <div key={name || "__none"} className="nk-card rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="w-7 h-7 rounded-lg nk-brand-bg text-white grid place-items-center shrink-0"><MapPin className="w-3.5 h-3.5" /></span>
                      <span className="font-extrabold text-sm nk-brand-text">{name || "بدون قاعة"}</span>
                      {room?.capacity ? <span className="text-[10px] font-bold text-muted-foreground">سعة {room.capacity}</span> : null}
                      {isManager && (
                        <button onClick={() => { setCreateSeed({ day, room: name, blockIdx: 4 }); setDialogSlot(null); }}
                          className="ms-auto w-9 h-9 rounded-lg nk-brand-bg text-white grid place-items-center" aria-label={`إضافة حصة في ${name || "بدون قاعة"}`}>
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {roomSlots.length === 0 ? (
                      <p className="text-xs font-bold text-muted-foreground py-2">مفيش حصص في القاعة دي.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {roomSlots.sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => {
                          const flags = dayFlags.get(s.id) ?? [];
                          const blocked = blockingFlags(flags).length > 0;
                          return (
                            <button key={s.id} onClick={() => setDetailsSlot(s)}
                              className={cn("w-full rounded-xl border p-3 text-start transition active:scale-[0.99]",
                                blocked ? "border-amber-300 bg-amber-50/70 dark:bg-amber-500/10" : "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-500/5 dark:border-emerald-500/30")}>
                              <div className="flex items-center gap-2">
                                <span className="nk-num text-[11px] font-extrabold shrink-0 rounded-lg bg-card border border-border px-2 py-1">
                                  {formatTime12(s.startTime)}–{formatTime12(s.endTime)}
                                </span>
                                <span className="flex-1 min-w-0 font-extrabold text-[13px] truncate">{s.subject} — {s.grade} {s.groupName}</span>
                                {blocked ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-label="تعارض" />
                                  : <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-label="مفيش تعارض" />}
                              </div>
                              <p className="text-[11px] font-semibold text-muted-foreground mt-1">
                                {s.teacher} · {s.students} طالب · {fmt(s.price)} ج
                              </p>
                              {blocked && (
                                <p className="text-[10.5px] font-bold text-amber-800 mt-1 dark:text-amber-200">
                                  {blockingFlags(flags).map((f) => f.label).join(" · ")}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
                {offGrid.length > 0 && (
                  <div className="nk-card rounded-2xl p-4 space-y-2">
                    <p className="font-extrabold text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> حصص خارج الشبكة (قبل 8 ص أو بعد 10 م)</p>
                    {offGrid.map((s) => (
                      <button key={s.id} onClick={() => setDetailsSlot(s)} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-start font-bold text-[13px]">
                        {s.subject} — {s.groupName} ({formatTime12(s.startTime)}–{formatTime12(s.endTime)})
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* حصص خارج الشبكة — ديسكتوب */}
          {!empty && offGrid.length > 0 && (
            <div className="hidden md:block nk-card rounded-2xl p-4 space-y-2">
              <p className="font-extrabold text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" /> حصص خارج الشبكة (قبل 8 ص أو بعد 10 م)</p>
              <div className="flex flex-wrap gap-2">
                {offGrid.map((s) => (
                  <button key={s.id} onClick={() => setDetailsSlot(s)} className="rounded-xl border border-border bg-card px-3 py-2 font-bold text-xs hover:bg-muted/40">
                    {s.subject} — {s.groupName} ({formatTime12(s.startTime)}–{formatTime12(s.endTime)})
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== حصص النهاردة الحية ===== */}
      <SectionCard title="حصص النهاردة" icon={<CalendarDays className="w-4 h-4" />}>
        {today.length === 0 && suggestions.length === 0 ? (
          <EmptyState title="مفيش حصص النهاردة" hint="الجدول الأسبوعي فوق — شوف ميعاد الجاي." />
        ) : (
          <div className="space-y-2">
            {today.map((s) => {
              const phase = sessionPhase(s.startTime, s.endTime);
              return (
                <button key={s.id} onClick={() => openSession(s.id)}
                  className="w-full rounded-2xl border bg-card p-3.5 flex items-center gap-3 text-start hover:shadow-md transition">
                  <span className={cn(
                    "nk-num shrink-0 rounded-xl px-2.5 py-2 text-center font-extrabold text-sm border",
                    s.status === "CLOSED" ? "bg-muted text-muted-foreground border-transparent" :
                    phase === "now" ? "nk-brand-bg text-white border-transparent" : "bg-card border-border",
                  )}>
                    {formatTime12(s.startTime)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-extrabold text-sm">{s.subject} — {s.grade} {s.groupName}</span>
                    <span className="block text-xs text-muted-foreground font-semibold">{s.teacher}{s.room ? ` · ${s.room}` : ""} · {s.presentCount} طالب · {fmt(s.price)} ج</span>
                  </span>
                  {s.status === "OPEN" && phase !== "past" && (
                    <span className="nk-brand-text text-xs font-extrabold flex items-center gap-1 shrink-0"><Play className="w-3.5 h-3.5" /> افتح</span>
                  )}
                  {s.status === "CLOSED" && <span className="text-xs font-bold text-muted-foreground shrink-0">مقفولة</span>}
                </button>
              );
            })}
            {suggestions.map((s) => (
              <button key={s.scheduleId}
                onClick={async () => {
                  try {
                    await api("/api/sessions", { method: "POST", body: { scheduleId: s.scheduleId } });
                    toast.success("تم فتح الحصة.");
                    loadToday();
                  } catch { /* toast */ }
                }}
                className="w-full rounded-2xl border border-dashed border-border bg-white/60 p-3.5 flex items-center gap-3 text-start hover:bg-muted/40 transition">
                <span className="nk-num shrink-0 rounded-xl px-2.5 py-2 text-center font-extrabold text-sm border border-border bg-card">{formatTime12(s.startTime)}</span>
                <span className="flex-1">
                  <span className="block font-extrabold text-sm">افتح: {s.subject} — {s.grade} {s.groupName}</span>
                </span>
                <Plus className="w-4 h-4 nk-brand-text shrink-0" />
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== الحوارات ===== */}
      {dialogSlot !== null || createSeed !== null ? (
        <SlotDialog
          open
          slot={dialogSlot?.id ? dialogSlot : null}
          copySlot={dialogSlot && !dialogSlot.id ? dialogSlot : null}
          seed={createSeed}
          allSlots={data.days.flatMap((d) => d.slots)}
          groups={data.groups}
          rooms={data.rooms}
          onClose={() => { setDialogSlot(null); setCreateSeed(null); }}
          onSaved={() => { setDialogSlot(null); setCreateSeed(null); load(); toast.success("تم حفظ الجدول."); }}
          onStale={() => { setDialogSlot(null); setCreateSeed(null); load(); }}
        />
      ) : null}

      {detailsSlot && (
        <DetailsDialog
          slot={detailsSlot}
          flags={dayFlags.get(detailsSlot.id) ?? []}
          isManager={isManager}
          canOpenSessions={canOpenSessions}
          isToday={detailsSlot.dayOfWeek === cairoNow.dow}
          alreadyOpen={today.some((t) => t.status !== "CLOSED" && t.startTime === detailsSlot.startTime && t.groupName === detailsSlot.groupName)}
          dayLabel={DAY_TABS.find((t) => t.dow === detailsSlot.dayOfWeek)?.label ?? ""}
          onClose={() => setDetailsSlot(null)}
          onEdit={(s) => { setDetailsSlot(null); setCreateSeed(null); setDialogSlot(s); }}
          onMove={(s) => { setDetailsSlot(null); setMoveSeed(null); setMoveSlot(s); }}
          onDuplicate={(s) => { setDetailsSlot(null); setCreateSeed(null); setDialogSlot({ ...s, id: "" }); }}
          onDelete={async (s) => {
            if (!confirm(`تلغي حصة ${s.subject} (${s.groupName}) من يوم ${DAY_TABS.find((t) => t.dow === s.dayOfWeek)?.label}؟`)) return;
            try {
              await api(`/api/schedule?id=${s.id}`, { method: "DELETE" });
              toast.success("تم إلغاء الحصة من الجدول.");
              setDetailsSlot(null);
              load();
            } catch { /* toast */ }
          }}
          onOpenToday={async (s) => {
            try {
              const res = await api<{ session: { id: string } }>("/api/sessions", { method: "POST", body: { scheduleId: s.id }, silent: true });
              toast.success("تم فتح الحصة.");
              setDetailsSlot(null);
              loadToday();
              openSession(res.session.id);
            } catch { /* toast */ }
          }}
        />
      )}

      {moveSlot && (
        <MoveDialog
          slot={moveSlot}
          seed={moveSeed}
          days={data.days}
          rooms={data.rooms.map((r) => r.name)}
          onClose={() => { setMoveSlot(null); setMoveSeed(null); }}
          onSaved={() => { setMoveSlot(null); setMoveSeed(null); load(); toast.success("تم نقل الحصة."); }}
          onStale={() => { setMoveSlot(null); setMoveSeed(null); load(); }}
        />
      )}

      <RoomsDialog
        open={roomsOpen}
        rooms={data.rooms}
        allSlots={data.days.flatMap((d) => d.slots)}
        onClose={() => setRoomsOpen(false)}
        onChanged={() => { load(); }}
      />
    </div>
  );
}

// ============================================================
// كارت الحصة على الشبكة — موضعه بالنِسب الزمنية الحقيقية
// ============================================================

function SlotChip({ slot, lane, lanes, flags, dragging, draggable, onDragStart, onDragEnd, onClick }: {
  slot: Slot; lane: number; lanes: number; flags: SlotFlag[];
  dragging: boolean; draggable: boolean;
  onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
}) {
  const blocked = blockingFlags(flags);
  const hints = hintFlags(flags);
  const s0 = Math.max(toMin(slot.startTime), DAY_START_MIN);
  const e0 = Math.min(toMin(slot.endTime), DAY_START_MIN + DAY_SPAN_MIN);
  const startPct = ((s0 - DAY_START_MIN) / DAY_SPAN_MIN) * 100;
  const widthPct = Math.max(((e0 - s0) / DAY_SPAN_MIN) * 100, 4.2);
  const laneH = 100 / lanes;
  const statusText = blocked.length > 0
    ? `فيه تعارض — ${blocked.map((f) => f.label).join(" و ")}`
    : hints.length > 0 ? `تكرار محتمل — ${hints[0].label}` : "مفيش تعارض موارد";
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", slot.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={blocked.length > 0 ? blocked.map((f) => `${f.label}: ${f.detail}`).join("\n") : `${slot.subject} — ${slot.groupName}`}
      aria-label={`${slot.subject} ${slot.groupName}، ${formatTime12(slot.startTime)} لـ ${formatTime12(slot.endTime)}، ${statusText}`}
      style={{
        insetInlineStart: `calc(${startPct}% + 3px)`,
        width: `calc(${widthPct}% - 6px)`,
        top: `calc(${lane * laneH}% + 4px)`,
        height: `calc(${laneH}% - 8px)`,
      }}
      className={cn(
        "absolute z-10 rounded-xl border-2 px-2 py-1 text-start overflow-hidden transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
        blocked.length > 0
          ? "border-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/15 dark:border-amber-500/60"
          : "border-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/40",
        dragging && "opacity-40 scale-[0.98]",
      )}
    >
      <span className="flex items-center gap-1 min-w-0">
        {blocked.length > 0
          ? <AlertTriangle className="w-3 h-3 shrink-0 text-amber-600" aria-hidden="true" />
          : hints.length > 0
            ? <Info className="w-3 h-3 shrink-0 text-sky-600" aria-hidden="true" />
            : <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-600" aria-hidden="true" />}
        <span className="font-extrabold text-[11.5px] truncate">
          {slot.subject} — {slot.grade} {slot.groupName}
        </span>
        {draggable && <GripVertical className="w-3 h-3 shrink-0 text-muted-foreground/50 ms-auto" aria-hidden="true" />}
      </span>
      <span className="block text-[10px] font-bold text-muted-foreground truncate nk-num">
        {slot.teacher} · {formatTime12(slot.startTime)}–{formatTime12(slot.endTime)}
      </span>
      {blocked.length > 0 && (
        <span className="block text-[9.5px] font-extrabold text-amber-700 truncate dark:text-amber-300">{blocked[0].label}</span>
      )}
    </button>
  );
}

// ============================================================
// حوار الإضافة / التعديل — مدمج، بيتعبّى من الخلية، بمعاينة تعارض حية
// ============================================================

type ConflictDTO = { type: string; label: string; detail: string; withSlotId?: string };

function SlotDialog({ open, slot, copySlot, seed, allSlots, groups, rooms, onClose, onSaved, onStale }: {
  open: boolean;
  slot: Slot | null; // وضع التعديل
  copySlot: Slot | null; // وضع التكرار (قيم منسوخة من غير id)
  seed: { day: number; room: string; blockIdx: number } | null;
  allSlots: Slot[];
  groups: ScheduleData["groups"];
  rooms: Room[];
  onClose: () => void;
  onSaved: () => void;
  onStale: () => void;
}) {
  const isEdit = !!slot;
  const base = slot ?? copySlot ?? null;
  const [busy, setBusy] = useState(false);
  const [serverConflicts, setServerConflicts] = useState<ConflictDTO[]>([]);
  const [overrideReason, setOverrideReason] = useState("");

  const [form, setForm] = useState(() => {
    if (base) {
      const bi = BLOCKS.findIndex((b) => b.start === base.startTime);
      const dur = Math.round((toMin(base.endTime) - toMin(base.startTime)) / 120);
      const aligned = bi >= 0 && dur >= 1 && bi + dur <= BLOCKS.length && toMin(BLOCKS[bi].start) + dur * 120 === toMin(base.endTime);
      return {
        day: base.dayOfWeek, blockIdx: aligned ? bi : 4, durBlocks: aligned ? Math.min(dur, 3) : 1,
        custom: !aligned, start: base.startTime, end: base.endTime,
        groupId: base.groupId, room: base.room ?? "",
        price: String(base.price / 100), teacherPercent: String(base.teacherPercent),
      };
    }
    const g = groups[0];
    const bi = seed?.blockIdx ?? 4;
    return {
      day: seed?.day ?? 6, blockIdx: bi, durBlocks: 1, custom: false,
      start: BLOCKS[bi].start, end: BLOCKS[bi].end,
      groupId: g?.id ?? "", room: seed?.room || g?.room || "",
      price: g ? String(g.price / 100) : "", teacherPercent: g ? String(g.teacherPercent) : "",
    };
  });

  const initialJson = useMemo(() => JSON.stringify(form), []);
  const dirty = JSON.stringify(form) !== initialJson;

  // الوقت الفعلي: بلوكات أو وقت مخصص
  const effStart = form.custom ? form.start : BLOCKS[form.blockIdx].start;
  const effEnd = form.custom ? form.end : fromMin(toMin(BLOCKS[form.blockIdx].start) + form.durBlocks * 120);
  const validTimes = /^\d{2}:\d{2}$/.test(effStart) && /^\d{2}:\d{2}$/.test(effEnd) && effEnd > effStart;

  // معاينة التعارض الحية — نفس منطق السيرفر (تداخل فتري، استبعاد الذات)
  const preview = useMemo(() => {
    if (!validTimes || !form.groupId) return { blocking: [] as SlotFlag[], hints: [] as SlotFlag[] };
    const others = allSlots.filter((s) => s.dayOfWeek === form.day && s.id !== (slot?.id ?? ""));
    const teacherId = groups.find((g) => g.id === form.groupId)?.teacherId ?? null;
    const blocking: SlotFlag[] = [];
    const hints: SlotFlag[] = [];
    for (const o of others) {
      if (!overlapsMin(toMin(effStart), toMin(effEnd), toMin(o.startTime), toMin(o.endTime))) continue;
      if (teacherId && o.teacherId === teacherId) {
        blocking.push({ type: "TEACHER", label: `تعارض مدرس — ${o.teacher}`, detail: `متقاطع مع ${o.subject} (${o.groupName}) ${formatTime12(o.startTime)}–${formatTime12(o.endTime)}` });
      }
      if (form.room && o.room && form.room === o.room) {
        blocking.push({ type: "ROOM", label: `تعارض قاعة — ${form.room}`, detail: `القاعة محجوزة لـ ${o.subject} (${o.groupName}) ${formatTime12(o.startTime)}–${formatTime12(o.endTime)}` });
      }
      if (form.groupId === o.groupId) {
        hints.push({ type: "DUPLICATE", label: `تكرار محتمل — ${o.subject} (${o.groupName})`, detail: `نفس المجموعة متقاطعة ${formatTime12(o.startTime)}–${formatTime12(o.endTime)}` });
      }
    }
    return { blocking, hints };
  }, [allSlots, form.day, form.groupId, form.room, effStart, effEnd, validTimes, slot, groups]);

  const selectedGroup = groups.find((g) => g.id === form.groupId);
  const roomOptions = useMemo(() => {
    const names = rooms.map((r) => r.name);
    if (form.room && !names.includes(form.room)) return [...names, form.room];
    return names;
  }, [rooms, form.room]);

  const maxDur = BLOCKS.length - form.blockIdx;

  function requestClose() {
    if (dirty && !confirm("في تغييرات مش محفوظة — تقفل برضه؟")) return;
    onClose();
  }

  async function save(confirmed = false) {
    if (busy) return; // منع الإرسال المكرر
    if (!validTimes) { toast.error("وقت النهاية لازم بعد البداية."); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        dayOfWeek: form.day, startTime: effStart, endTime: effEnd,
        groupId: form.groupId, room: form.room || null,
      };
      if (isEdit) { body.id = slot!.id; body.updatedAt = slot!.updatedAt; }
      if (confirmed) { body.confirmConflict = true; body.conflictReason = overrideReason; }
      await api("/api/schedule", { method: isEdit ? "PATCH" : "POST", body, silent: true });
      // تحديثات السعر/النسبة على المجموعة (زي ما كانت)
      if (selectedGroup) {
        if (form.price && parseFloat(form.price) !== selectedGroup.price / 100) {
          await api("/api/schedule", { method: "PUT", body: { groupId: form.groupId, price: parseFloat(form.price) }, silent: true });
        }
        if (form.teacherPercent && parseInt(form.teacherPercent, 10) !== selectedGroup.teacherPercent) {
          await api("/api/schedule", { method: "PUT", body: { groupId: form.groupId, teacherPercent: parseInt(form.teacherPercent, 10) }, silent: true });
        }
      }
      onSaved();
    } catch (e) {
      const d = (e as Error & { data?: { needsConfirm?: boolean; conflicts?: ConflictDTO[]; stale?: boolean; error?: string } }).data;
      if (d?.stale) {
        toast.error(d.error ?? "حد تاني عدّل الحصة قبلك — هات نسخة fresh.");
        onStale();
      } else if (d?.needsConfirm) {
        setServerConflicts(d.conflicts ?? []);
        toast("في تعارضات موارد — راجعها واكتب سبب التجاوز لو هتحفظ.", { icon: "⚠️" });
      } else if (e instanceof Error) {
        toast.error(e.message);
      }
    } finally { setBusy(false); }
  }

  const showingConflicts = serverConflicts.length > 0 || preview.blocking.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "تعديل حصة" : copySlot ? "تكرار الحصة" : `حصة جديدة — ${DAY_TABS.find((t) => t.dow === form.day)?.label ?? ""} ${formatTime12(effStart)}`}
          </DialogTitle>
        </DialogHeader>
        {groups.length === 0 ? (
          <EmptyState title="مفيش مجموعات" hint="اعمل مجموعة الأول من صفحة المجموعات." />
        ) : (
          <div className="space-y-3.5">
            {/* اليوم */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold">اليوم</label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_TABS.map((t) => (
                  <button key={t.dow} type="button" onClick={() => setForm({ ...form, day: t.dow })}
                    className={cn("rounded-xl border px-3 py-2 text-xs font-extrabold",
                      form.day === t.dow ? "nk-brand-bg text-white border-transparent" : "bg-card border-border")}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* الوقت: بلوكات أو مخصص */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold">الوقت</label>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={form.custom} onChange={(e) => setForm({ ...form, custom: e.target.checked })} className="accent-current" />
                  وقت مخصص (مثلاً 17:00–18:30)
                </label>
              </div>
              {form.custom ? (
                <div className="grid grid-cols-2 gap-3">
                  <input type="time" dir="ltr" aria-label="من الساعة" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold nk-num"
                    value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                  <input type="time" dir="ltr" aria-label="لحد الساعة" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold nk-num"
                    value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-muted-foreground block mb-1">يبدأ بلوك</label>
                    <select value={form.blockIdx} aria-label="بلوك البداية"
                      onChange={(e) => {
                        const bi = Number(e.target.value);
                        const dur = Math.min(form.durBlocks, BLOCKS.length - bi);
                        setForm({ ...form, blockIdx: bi, durBlocks: dur });
                      }}
                      className="w-full h-11 rounded-xl border-2 border-input bg-card px-2 font-bold text-sm nk-num">
                      {BLOCKS.map((b, i) => <option key={i} value={i}>{formatTime12(b.start)} – {formatTime12(b.end)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-muted-foreground block mb-1">المدة</label>
                    <select value={form.durBlocks} aria-label="المدة بالبلوكات"
                      onChange={(e) => setForm({ ...form, durBlocks: Number(e.target.value) })}
                      className="w-full h-11 rounded-xl border-2 border-input bg-card px-2 font-bold text-sm">
                      {Array.from({ length: Math.max(1, maxDur) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n === 1 ? "بلوك واحد (ساعتين)" : n === 2 ? "بلوكين (4 ساعات)" : `${n} بلوكات (${n * 2} ساعات)`}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <p className="text-[11px] font-semibold text-muted-foreground nk-num">الحصة: {formatTime12(effStart)} → {formatTime12(effEnd)} ({(toMin(effEnd) - toMin(effStart)) / 60} ساعات)</p>
            </div>

            {/* المجموعة */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold">المجموعة</label>
              <select className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-semibold text-sm"
                value={form.groupId}
                onChange={(e) => {
                  const g = groups.find((x) => x.id === e.target.value);
                  setForm({ ...form, groupId: e.target.value, price: g ? String(g.price / 100) : form.price, teacherPercent: g ? String(g.teacherPercent) : form.teacherPercent, room: !isEdit && !copySlot ? (g?.room ?? form.room) : form.room });
                }}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.subject} — {g.grade} {g.name} ({g.teacher ?? "بدون مدرس"})</option>
                ))}
              </select>
            </div>

            {/* القاعة + السعر + النسبة */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-bold">القاعة</label>
                <select className="w-full h-11 rounded-xl border-2 border-input bg-card px-2 font-semibold text-sm"
                  value={form.room}
                  onChange={(e) => setForm({ ...form, room: e.target.value })}>
                  <option value="">بدون قاعة</option>
                  {roomOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold">سعر الحصة</label>
                <input dir="ltr" inputMode="decimal" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-center nk-num"
                  value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, "") })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold">% المدرس</label>
                <input dir="ltr" inputMode="numeric" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-center nk-num"
                  value={form.teacherPercent} onChange={(e) => setForm({ ...form, teacherPercent: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold">
              السعر والنسبة بيتحفظوا على المجموعة كلها (بيتسجلو في سجل التغييرات).
            </p>

            {/* تلميحات التكرار (غير حاجزة) */}
            {preview.hints.length > 0 && (
              <div className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 space-y-1 dark:bg-sky-500/10 dark:border-sky-500/40" role="note">
                <p className="text-[11px] font-extrabold text-sky-800 dark:text-sky-300 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> تكرار محتمل — مش بيمنع الحفظ</p>
                {preview.hints.slice(0, 3).map((h, i) => <p key={i} className="text-[10.5px] font-bold text-sky-700/80 dark:text-sky-300/80">{h.label}: {h.detail}</p>)}
              </div>
            )}

            {/* التعارض: معاينة حية + تأكيد التجاوز */}
            {showingConflicts && (
              <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3.5 py-3 space-y-2 dark:bg-amber-500/10 dark:border-amber-500/50" role="alert">
                <p className="text-xs font-extrabold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> تعارض موارد ({(serverConflicts.length > 0 ? serverConflicts : preview.blocking).length})
                  <span className="font-bold text-[10px] text-amber-700/80 dark:text-amber-300">— تقدر تحفظ رغم التعارض بتأكيد</span>
                </p>
                {(serverConflicts.length > 0 ? serverConflicts : preview.blocking).slice(0, 4).map((c, i) => (
                  <div key={i} className="rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-white/5">
                    <p className="text-[11px] font-extrabold text-amber-900 dark:text-amber-200">{c.label}</p>
                    <p className="text-[10px] font-bold text-amber-800/80 dark:text-amber-300/80">{c.detail}</p>
                  </div>
                ))}
                <input
                  className="w-full h-10 rounded-lg border-2 border-amber-300 bg-white px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/10"
                  placeholder="سبب التجاوز (مثلاً: المدرس موافق يسجل من اللاب توب)"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  maxLength={200}
                />
                <p className="text-[10px] font-bold text-amber-800/70 dark:text-amber-200">
                  التجاوز بيتسجل في سجل التدقيق باسمك وبتاريخه مع الحصص المتأثرة والسبب.
                </p>
              </div>
            )}

            {/* تنبيه التكرار الأسبوعي */}
            {isEdit && (
              <p className="text-[11px] font-bold text-muted-foreground flex items-start gap-1.5 rounded-xl bg-muted/50 px-3 py-2">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                التعديل بيتطبّق على القالب الأسبوعي المتكرر (كل الأسابيع الجاية) — الحصص اللي اتفتحت أو اتقفلت قبل كده مش بتتأثر.
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => save(serverConflicts.length > 0)}
                disabled={busy || !validTimes || !form.groupId || (serverConflicts.length > 0 && !overrideReason.trim())}
                className={cn(
                  "flex-1 font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-50",
                  showingConflicts ? "bg-amber-500 text-white" : "nk-brand-bg text-white",
                )}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {serverConflicts.length > 0 ? "حفظ رغم التعارض" : isEdit ? "حفظ التعديل" : "إضافة"}
              </button>
              <button onClick={requestClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// حوار النقل — المعاينة قبل الحفظ + بديل الـ drag-and-drop المتاح بالكيبورد
// ============================================================

function MoveDialog({ slot, seed, days, rooms, onClose, onSaved, onStale }: {
  slot: Slot;
  seed: { day: number; room: string; blockIdx: number; fromDrag?: boolean } | null;
  days: ScheduleData["days"];
  rooms: string[];
  onClose: () => void;
  onSaved: () => void;
  onStale: () => void;
}) {
  const durMin = toMin(slot.endTime) - toMin(slot.startTime);
  const [busy, setBusy] = useState(false);
  const [serverConflicts, setServerConflicts] = useState<ConflictDTO[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [form, setForm] = useState(() => ({
    day: seed?.day ?? slot.dayOfWeek,
    room: seed?.room ?? (slot.room ?? ""),
    blockIdx: seed?.blockIdx ?? Math.max(0, BLOCKS.findIndex((b) => b.start === slot.startTime)),
  }));

  const effStart = BLOCKS[form.blockIdx].start;
  const effEnd = fromMin(toMin(effStart) + durMin);

  // معاينة حية ضد كل حصص اليوم المستهدف
  const preview = useMemo(() => {
    const target = days.find((d) => d.dayOfWeek === form.day)?.slots ?? [];
    const teacherId = slot.teacherId;
    const blocking: SlotFlag[] = [];
    const hints: SlotFlag[] = [];
    for (const o of target) {
      if (o.id === slot.id) continue; // استبعاد الذات
      if (!overlapsMin(toMin(effStart), toMin(effEnd), toMin(o.startTime), toMin(o.endTime))) continue;
      if (teacherId && o.teacherId === teacherId) {
        blocking.push({ type: "TEACHER", label: `تعارض مدرس — ${o.teacher}`, detail: `${o.subject} (${o.groupName}) ${formatTime12(o.startTime)}–${formatTime12(o.endTime)}` });
      }
      if (form.room && o.room && form.room === o.room) {
        blocking.push({ type: "ROOM", label: `تعارض قاعة — ${form.room}`, detail: `${o.subject} (${o.groupName}) ${formatTime12(o.startTime)}–${formatTime12(o.endTime)}` });
      }
      if (slot.groupId === o.groupId) {
        hints.push({ type: "DUPLICATE", label: `تكرار محتمل`, detail: `نفس المجموعة ${formatTime12(o.startTime)}–${formatTime12(o.endTime)}` });
      }
    }
    return { blocking, hints };
  }, [days, form.day, form.room, effStart, effEnd, slot]);

  function requestClose() {
    onClose();
  }

  async function save(confirmed = false) {
    if (busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        id: slot.id, updatedAt: slot.updatedAt,
        startTime: effStart, endTime: effEnd, room: form.room || null,
      };
      if (form.day !== slot.dayOfWeek) body.dayOfWeek = form.day;
      if (confirmed) { body.confirmConflict = true; body.conflictReason = overrideReason; }
      await api("/api/schedule", { method: "PATCH", body, silent: true });
      onSaved();
    } catch (e) {
      const d = (e as Error & { data?: { needsConfirm?: boolean; conflicts?: ConflictDTO[]; stale?: boolean; error?: string } }).data;
      if (d?.stale) { toast.error(d.error ?? "حد تاني عدّل الحصة قبلك."); onStale(); }
      else if (d?.needsConfirm) { setServerConflicts(d.conflicts ?? []); toast("في تعارضات — اكتب سبب التجاوز لو هتحفظ.", { icon: "⚠️" }); }
      else if (e instanceof Error) toast.error(e.message);
    } finally { setBusy(false); }
  }

  const showingConflicts = serverConflicts.length > 0 || preview.blocking.length > 0;
  const moved = form.day !== slot.dayOfWeek || form.room !== (slot.room ?? "") || effStart !== slot.startTime;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Move className="w-5 h-5 nk-brand-text" /> نقل حصة {seed?.fromDrag ? "(معاينة السحب)" : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <p className="text-xs font-bold text-muted-foreground rounded-xl bg-muted/50 px-3 py-2">
            {slot.subject} — {slot.grade} {slot.groupName} · المدة {durMin / 60} ساعات (بتتحافظ)
          </p>

          {/* اليوم */}
          <div className="space-y-1.5">
            <label className="text-sm font-bold">اليوم</label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_TABS.map((t) => (
                <button key={t.dow} type="button" onClick={() => setForm({ ...form, day: t.dow })}
                  className={cn("rounded-xl border px-3 py-2 text-xs font-extrabold",
                    form.day === t.dow ? "nk-brand-bg text-white border-transparent" : "bg-card border-border")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* القاعة + البلوك */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-bold">القاعة</label>
              <select value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-2 font-semibold text-sm">
                <option value="">بدون قاعة</option>
                {rooms.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold">يبدأ بلوك</label>
              <select value={form.blockIdx} onChange={(e) => setForm({ ...form, blockIdx: Number(e.target.value) })}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-2 font-bold text-sm nk-num">
                {BLOCKS.map((b, i) => <option key={i} value={i}>{formatTime12(b.start)} – {formatTime12(b.end)}</option>)}
              </select>
            </div>
          </div>

          <p className="text-xs font-extrabold nk-num rounded-xl border border-border bg-card px-3 py-2">
            {formatTime12(slot.startTime)} → {formatTime12(effStart)} · {DAY_TABS.find((t) => t.dow === slot.dayOfWeek)?.label} → {DAY_TABS.find((t) => t.dow === form.day)?.label}
            {form.room !== (slot.room ?? "") ? ` · ${slot.room || "بدون قاعة"} → ${form.room || "بدون قاعة"}` : ""}
          </p>

          {preview.hints.length > 0 && (
            <p className="text-[11px] font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> {preview.hints[0].label} — مش بيمنع الحفظ</p>
          )}

          {showingConflicts && (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3.5 py-3 space-y-2 dark:bg-amber-500/10 dark:border-amber-500/50" role="alert">
              <p className="text-xs font-extrabold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> تعارض موارد ({(serverConflicts.length > 0 ? serverConflicts : preview.blocking).length})
              </p>
              {(serverConflicts.length > 0 ? serverConflicts : preview.blocking).slice(0, 4).map((c, i) => (
                <div key={i} className="rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-white/5">
                  <p className="text-[11px] font-extrabold text-amber-900 dark:text-amber-200">{c.label}</p>
                  <p className="text-[10px] font-bold text-amber-800/80 dark:text-amber-300/80">{c.detail}</p>
                </div>
              ))}
              <input
                className="w-full h-10 rounded-lg border-2 border-amber-300 bg-white px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/10"
                placeholder="سبب التجاوز"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                maxLength={200}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => save(serverConflicts.length > 0)}
              disabled={busy || !moved || (serverConflicts.length > 0 && !overrideReason.trim())}
              className={cn("flex-1 font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-50",
                showingConflicts ? "bg-amber-500 text-white" : "nk-brand-bg text-white")}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} تأكيد النقل
            </button>
            <button onClick={requestClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// حوار تفاصيل الحصة — إجراءات سريعة حسب الصلاحيات
// ============================================================

function DetailsDialog({ slot, flags, isManager, canOpenSessions, isToday, alreadyOpen, dayLabel, onClose, onEdit, onMove, onDuplicate, onDelete, onOpenToday }: {
  slot: Slot;
  flags: SlotFlag[];
  isManager: boolean; canOpenSessions: boolean; isToday: boolean; alreadyOpen: boolean; dayLabel: string;
  onClose: () => void;
  onEdit: (s: Slot) => void; onMove: (s: Slot) => void; onDuplicate: (s: Slot) => void;
  onDelete: (s: Slot) => void; onOpenToday: (s: Slot) => void;
}) {
  const blocked = blockingFlags(flags);
  const hints = hintFlags(flags);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {blocked.length > 0 ? <AlertTriangle className="w-5 h-5 text-amber-500" /> : <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
            {slot.subject} — {slot.grade} {slot.groupName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs font-bold">
            <span className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 text-muted-foreground" /> {dayLabel} · <span className="nk-num">{formatTime12(slot.startTime)}–{formatTime12(slot.endTime)}</span></span>
            <span className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-muted-foreground" /> {slot.room || "بدون قاعة"}</span>
            <span className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5 text-muted-foreground" /> {slot.teacher}</span>
            <span className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-muted-foreground" /> <span className="nk-num">{slot.students}</span> طالب</span>
            <span className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 text-muted-foreground" /> <span className="nk-num">{fmt(slot.price)}</span> ج/حصة</span>
            <span className="rounded-xl bg-muted/50 px-3 py-2 flex items-center gap-1.5"><Percent className="w-3.5 h-3.5 text-muted-foreground" /> <span className="nk-num">{slot.teacherPercent}%</span> للمدرس</span>
          </div>

          {/* حالة التعارض بنص وأيقونات — مش باللون بس */}
          {blocked.length > 0 ? (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2.5 space-y-1 dark:bg-amber-500/10 dark:border-amber-500/50" role="alert">
              <p className="text-[11px] font-extrabold text-amber-900 dark:text-amber-300">فيه تعارض موارد — راجعه أو احفظ رغم التعارض من التعديل:</p>
              {blocked.map((f, i) => <p key={i} className="text-[10.5px] font-bold text-amber-800/90 dark:text-amber-300/90">{f.label}: {f.detail}</p>)}
            </div>
          ) : (
            <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-extrabold text-emerald-800 flex items-center gap-1.5 dark:bg-emerald-500/10 dark:border-emerald-500/40 dark:text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" /> مفيش تعارض موارد — الحصة دي سليمة
            </p>
          )}
          {hints.length > 0 && (
            <p className="text-[11px] font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> {hints[0].label} — تلميح بس، مش بيمنع حاجة</p>
          )}
          {slot.lastOverrideAt && (
            <p className="text-[10px] font-bold text-muted-foreground">
              آخر تجاوز معتمد اتسجل {new Date(slot.lastOverrideAt).toLocaleString("ar-EG")}
            </p>
          )}

          {/* إجراءات سريعة */}
          <div className="grid grid-cols-2 gap-2">
            {isToday && canOpenSessions && (
              <button onClick={() => onOpenToday(slot)} disabled={alreadyOpen}
                className="col-span-2 nk-brand-bg text-white font-extrabold rounded-xl py-3 flex items-center justify-center gap-2 disabled:opacity-50 shadow">
                <Play className="w-4 h-4" /> {alreadyOpen ? "الحصة مفتوحة النهاردة" : "افتح الحصة النهاردة"}
              </button>
            )}
            {isManager && (
              <>
                <button onClick={() => onEdit(slot)} className="rounded-xl border-2 border-border bg-card font-extrabold py-2.5 text-xs flex items-center justify-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> تعديل</button>
                <button onClick={() => onMove(slot)} className="rounded-xl border-2 border-border bg-card font-extrabold py-2.5 text-xs flex items-center justify-center gap-1.5"><Move className="w-3.5 h-3.5" /> نقل</button>
                <button onClick={() => onDuplicate(slot)} className="rounded-xl border-2 border-border bg-card font-extrabold py-2.5 text-xs flex items-center justify-center gap-1.5"><Copy className="w-3.5 h-3.5" /> تكرار</button>
                <button onClick={() => onDelete(slot)} className="rounded-xl border-2 border-rose-200 bg-rose-50 text-rose-700 font-extrabold py-2.5 text-xs flex items-center justify-center gap-1.5 dark:bg-rose-500/10 dark:border-rose-500/40"><Trash2 className="w-3.5 h-3.5" /> إلغاء من الجدول</button>
              </>
            )}
          </div>
          {!isManager && (
            <p className="text-[11px] font-bold text-muted-foreground text-center">التعديل والنقل للمدير — أي استفسار كلّم المدير.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// القاعات — إدارة (مدير)
// ============================================================

function RoomsDialog({ open, rooms, allSlots, onClose, onChanged }: {
  open: boolean;
  rooms: Room[];
  allSlots: Slot[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => { if (open) { setRenaming(null); setNewName(""); } }, [open]);

  const slotCount = (name: string) => allSlots.filter((s) => s.room === name).length;

  async function addRoom() {
    const name = newName.trim();
    if (!name) { toast.error("اكتب اسم القاعة."); return; }
    setBusy(true);
    try {
      await api("/api/rooms", { method: "POST", body: { name } });
      toast.success(`تمت إضافة ${name}.`);
      setNewName("");
      onChanged();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function renameRoom() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) { toast.error("اكتب الاسم الجديد."); return; }
    setBusy(true);
    try {
      await api("/api/rooms", { method: "PATCH", body: { id: renaming.id, name } });
      toast.success("تم تعديل اسم القاعة في كل الجدول.");
      setRenaming(null);
      onChanged();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function deleteRoom(id: string, name: string) {
    if (!confirm(`تحذف قاعة ${name}؟ الحصص اللي فيها لازم تتنقل الأول.`)) return;
    setBusy(true);
    try {
      await api(`/api/rooms?id=${id}`, { method: "DELETE" });
      toast.success(`تم حذف ${name}.`);
      onChanged();
    } catch { /* toast shows the "has slots" error */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 nk-brand-text" /> القاعات</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* add */}
          <div className="flex gap-2">
            <input
              className="flex-1 h-12 rounded-xl border-2 border-input bg-card px-4 font-bold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="اسم قاعة جديدة — مثلاً: قاعة 4"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRoom(); } }}
              disabled={busy}
            />
            <button onClick={addRoom} disabled={busy || !newName.trim()}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-4 shadow flex items-center gap-1.5 disabled:opacity-50">
              <Plus className="w-4.5 h-4.5" /> إضافة
            </button>
          </div>

          {/* list */}
          <div className="space-y-2 max-h-[45vh] overflow-y-auto nk-scroll">
            {rooms.length === 0 && (
              <p className="text-sm font-bold text-muted-foreground text-center py-6">مفيش قاعات — ضيف واحدة من فوق.</p>
            )}
            {rooms.map((r) => {
              const count = slotCount(r.name);
              const isRenaming = renaming?.id === r.id;
              return (
                <div key={r.id} className="rounded-xl border border-border bg-card px-3.5 py-2.5 flex items-center gap-2">
                  <MapPin className="w-4 h-4 nk-brand-text shrink-0" />
                  {isRenaming ? (
                    <>
                      <input
                        autoFocus
                        className="flex-1 h-10 rounded-lg border-2 border-input bg-card px-3 font-bold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={renaming.name}
                        onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); renameRoom(); } }}
                        disabled={busy}
                      />
                      <button onClick={renameRoom} disabled={busy} className="w-9 h-9 rounded-lg nk-brand-bg text-white grid place-items-center" aria-label="حفظ">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setRenaming(null)} disabled={busy} className="w-9 h-9 rounded-lg border border-border grid place-items-center text-muted-foreground" aria-label="إلغاء">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-extrabold text-sm">{r.name}</span>
                      <span className={cn("text-[10px] font-bold rounded-full px-2 py-0.5 nk-num", count > 0 ? "bg-muted" : "bg-muted/50 text-muted-foreground")}>
                        {count} حصة/أسبوع
                      </span>
                      <button onClick={() => setRenaming({ id: r.id, name: r.name })} disabled={busy}
                        className="w-9 h-9 rounded-lg hover:bg-muted grid place-items-center text-muted-foreground" aria-label="تعديل الاسم">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteRoom(r.id, r.name)} disabled={busy}
                        className="w-9 h-9 rounded-lg hover:bg-rose-50 grid place-items-center text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" aria-label="حذف">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground font-semibold flex items-start gap-1.5">
            <Ban className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            القاعة اللي فيها حصص مجدولة لازم تتنقل حصصها لقاعة تانية قبل ما تتحذف. تعديل الاسم بيتحدث في الجدول كله تلقائياً.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
