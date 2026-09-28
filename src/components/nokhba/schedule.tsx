"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays, Plus, Pencil, Trash2, Copy, Clock, DoorClosed, Play,
  MapPin, Loader2, GraduationCap, Building2, X, Check, Ban, Printer, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, DAY_TABS, sessionPhase, type SessionUser } from "./lib";
import { PageHeader, Chip, Loading, SectionCard, EmptyState } from "./shared";
import { usePrint, PrintableDaySchedule, type DayScheduleHall } from "./print";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Slot = {
  id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null;
  groupId: string; groupName: string; subject: string; grade: string; teacher: string;
  teacherId: string | null; price: number; teacherPercent: number; students: number;
};

type Room = { id: string; name: string; capacity: number | null };

type ScheduleData = {
  days: { dayOfWeek: number; slots: Slot[] }[];
  rooms: Room[];
  conflicts?: { type: string; label: string; detail: string }[];
  groups: { id: string; name: string; subject: string; grade: string; teacher: string | null; price: number; teacherPercent: number; room: string | null }[];
};

type TodaySession = {
  id: string; startTime: string; endTime: string; status: string; subject: string; grade: string;
  groupName: string; teacher: string; price: number; attendanceCount: number; presentCount: number;
  room?: string | null;
};

export function ScheduleView({ user, openSession }: { user: SessionUser; openSession: (id: string) => void }) {
  const isManager = user.role === "MANAGER";
  const [data, setData] = useState<ScheduleData | null>(null);
  const [day, setDay] = useState(() => new Date().getDay());
  const [editSlot, setEditSlot] = useState<Slot | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [today, setToday] = useState<TodaySession[]>([]);
  const [suggestions, setSuggestions] = useState<{ scheduleId: string; subject: string; grade: string; groupName: string; startTime: string }[]>([]);

  const load = () => api<ScheduleData>("/api/schedule").then(setData).catch(() => {});
  const loadToday = () =>
    api<{ sessions: TodaySession[]; suggestions: typeof suggestions }>("/api/sessions")
      .then((d) => { setToday(d.sessions); setSuggestions(d.suggestions); })
      .catch(() => {});

  useEffect(() => { load(); loadToday(); }, []);
  useEffect(() => {
    const t = setInterval(loadToday, 20000);
    return () => clearInterval(t);
  }, [loadToday]);

  const slots = useMemo(() => data?.days.find((d) => d.dayOfWeek === day)?.slots ?? [], [data, day]);

  // group slots of the selected day per hall (registry order first, then legacy names)
  const hallTables = useMemo(() => {
    if (!data) return [];
    const roomNames = data.rooms.map((r) => r.name);
    const byRoom = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = s.room ?? "";
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key)!.push(s);
    }
    // registry rooms in order (even empty) + any legacy room names not in registry + "بدون قاعة" last
    const keys = [
      ...roomNames,
      ...[...byRoom.keys()].filter((k) => k && !roomNames.includes(k)),
    ];
    const unassigned = byRoom.get("");
    if (unassigned?.length) keys.push("");
    return keys.map((name) => ({
      room: data.rooms.find((r) => r.name === name) ?? null,
      name,
      slots: (byRoom.get(name) ?? []).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
  }, [data, slots]);

  const printDay = usePrint();

  /** أقرب تاريخ فعلي ليوم الأسبوع المختار (للعنوان في النسخة المطبوعة) */
  const dayDateStr = useMemo(() => {
    const d = new Date();
    const diff = (day - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [day]);

  function printSchedule() {
    const halls: DayScheduleHall[] = hallTables
      .filter((h) => h.slots.length > 0)
      .map(({ name, room, slots: hs }) => ({
        name: name || "بدون قاعة",
        capacity: room?.capacity ?? null,
        slots: hs.map((s) => ({
          startTime: s.startTime, endTime: s.endTime, subject: s.subject,
          grade: s.grade, groupName: s.groupName, teacher: s.teacher, students: s.students,
        })),
      }));
    const dayLabel = DAY_TABS.find((t) => t.dow === day)?.label ?? "";
    printDay(
      <PrintableDaySchedule dayLabel={dayLabel} dateStr={dayDateStr} halls={halls} center={user.center} />,
      `جدول ${dayLabel} — ${user.center?.name ?? "السنتر"}`,
    );
  }

  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الجداول"
        subtitle="جدول الحصص الأسبوعي — لكل قاعة جدولها"
        action={
          <div className="flex gap-2">
            <button onClick={printSchedule}
              className="border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98]">
              <Printer className="w-4.5 h-4.5" /> طباعة اليوم
            </button>
            {isManager && (
              <>
                <button onClick={() => setRoomsOpen(true)} className="border-2 border-border bg-card font-extrabold rounded-xl px-4 py-2.5 flex items-center gap-2 active:scale-[0.98]">
                  <Building2 className="w-4.5 h-4.5" /> القاعات
                </button>
                <button onClick={() => setAddOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98]">
                  <Plus className="w-4.5 h-4.5" /> حصة جديدة
                </button>
              </>
            )}
          </div>
        }
      />

      {/* ===== تنبيهات الجدول الذكية (spec §12) ===== */}
      {data.conflicts && data.conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2 dark:bg-amber-500/10 dark:border-amber-500/40">
          <p className="font-extrabold text-sm flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4" /> تنبيهات الجدول — {data.conflicts.length} ملاحظة
          </p>
          <div className="space-y-1.5">
            {data.conflicts.slice(0, 6).map((c, i) => (
              <div key={i} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
                <p className="text-xs font-extrabold text-amber-900 dark:text-amber-200">{c.label}</p>
                <p className="text-[11px] font-bold text-amber-800/80 dark:text-amber-300/80">{c.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-bold text-amber-800/70 dark:text-amber-300/70">
            التنبيهات استشارية بس — مفيش أي تغيير تلقائي على جدولك.
          </p>
        </div>
      )}

      {/* ===== today's live sessions ===== */}
      <SectionCard title="حصص النهاردة" icon={<CalendarDays className="w-4 h-4" />}>
        {today.length === 0 && suggestions.length === 0 ? (
          <EmptyState title="مفيش حصص النهاردة" hint="الجدول الأسبوعي تحت — شوف ميعاد الجاي." />
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
                    phase === "now" ? "nk-brand-bg text-white border-transparent" : "bg-card border-border"
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

      {/* ===== weekly day tabs ===== */}
      <div className="flex gap-1.5 overflow-x-auto nk-scroll pb-1">
        {DAY_TABS.map((t) => {
          const count = data.days.find((d) => d.dayOfWeek === t.dow)?.slots.length ?? 0;
          return (
            <button key={t.dow} onClick={() => setDay(t.dow)}
              className={cn(
                "shrink-0 rounded-2xl border px-4 py-2.5 font-extrabold text-sm transition flex items-center gap-2",
                day === t.dow ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}>
              {t.label}
              {count > 0 && (
                <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 font-bold", day === t.dow ? "bg-white/25" : "bg-muted")}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ===== single per-day table with hall-section headers ===== */}
      {hallTables.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش قاعات ولا حصص"
            hint={isManager ? "ضيف قاعات من زرار «القاعات» فوق، وبعدين جدول الحصص." : "المدير بيضيف القاعات والحصص."} />
        </div>
      ) : (
        <div className="nk-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto nk-scroll">
            <table className="w-full text-sm min-w-[640px] border-collapse">
              <thead>
                <tr className="text-[11px] text-muted-foreground font-bold border-b bg-muted/40">
                  <th className="px-3 py-2.5 text-start w-[130px]">الوقت</th>
                  <th className="px-3 py-2.5 text-start">الحصة</th>
                  <th className="px-3 py-2.5 text-start w-[120px]">المدرس</th>
                  <th className="px-3 py-2.5 text-center w-[70px]">الطلاب</th>
                  <th className="px-3 py-2.5 text-center w-[90px]">السعر</th>
                  {isManager && <th className="px-3 py-2.5 text-center w-[110px]">إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {hallTables.map(({ room, name, slots: hallSlots }) => (
                  <HallSection
                    key={name || "__none"}
                    name={name}
                    capacity={room?.capacity ?? null}
                    slots={hallSlots}
                    isManager={isManager}
                    dayLabel={DAY_TABS.find((t) => t.dow === day)?.label ?? ""}
                    onEdit={(s) => setEditSlot(s)}
                    onCopy={(s) => { setAddOpen(true); setEditSlot({ ...s, id: "" }); }}
                    onDelete={async (s) => {
                      if (!confirm(`تلغي حصة ${s.subject} من يوم ${DAY_TABS.find((t) => t.dow === day)?.label}؟`)) return;
                      try { await api(`/api/schedule?id=${s.id}`, { method: "DELETE" }); toast.success("تم إلغاء الحصة من الجدول."); load(); } catch { /* toast */ }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* add / edit dialog */}
      <SlotDialog
        open={addOpen}
        slot={editSlot}
        groups={data.groups}
        rooms={data.rooms}
        onClose={() => { setAddOpen(false); setEditSlot(null); }}
        onSaved={() => { setAddOpen(false); setEditSlot(null); load(); toast.success("تم حفظ الجدول."); }}
      />

      {/* rooms management dialog */}
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

function IconBtn({ onClick, icon, label, danger }: { onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={cn(
        "flex items-center justify-center rounded-lg w-8 h-8 transition",
        danger ? "text-rose-600 hover:bg-rose-50" : "text-muted-foreground hover:bg-muted"
      )}>
      {icon}
    </button>
  );
}

/**
 * One hall = a section-divider row (full-width header with hall name + capacity + count)
 * followed by the hall's slots rows. Empty halls show a hint row.
 */
/**
 * One hall = a section-divider row (full-width header with hall name + capacity + count)
 * followed by the hall's slots rows. Empty halls show a hint row.
 */
/**
 * One hall = a section-divider row (full-width header with hall name + capacity + count)
 * followed by the hall's slots rows. Empty halls show a hint row.
 */
/**
 * One hall = a section-divider row (full-width header with hall name + capacity + count)
 * followed by the hall's slots rows. Empty halls show a hint row.
 */
/**
 * One hall = a section-divider row (full-width header with hall name + capacity + count)
 * followed by the hall's slots rows. Empty halls show a hint row.
 */
function HallSection({ name, capacity, slots, isManager, dayLabel, onEdit, onCopy, onDelete }: {
  name: string;
  capacity: number | null;
  slots: Slot[];
  isManager: boolean;
  dayLabel: string;
  onEdit: (s: Slot) => void;
  onCopy: (s: Slot) => void;
  onDelete: (s: Slot) => void;
}) {
  const colSpan = isManager ? 6 : 5;
  const display = name || "بدون قاعة";
  return (
    <>
      <tr className="nk-brand-row border-y-2">
        <th colSpan={colSpan} scope="rowgroup" className="px-3 py-2.5 text-start">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-7 h-7 rounded-lg nk-brand-bg text-white grid place-items-center shrink-0">
              <MapPin className="w-3.5 h-3.5" />
            </span>
            <span className="font-extrabold text-sm nk-brand-text">{display}</span>
            <span className="text-[10px] font-bold rounded-full bg-card border border-border px-2 py-0.5 nk-num">{slots.length} حصة</span>
            {capacity ? <span className="text-[10px] font-bold text-muted-foreground">سعة {capacity} طالب</span> : null}
            {!name && isManager && <span className="text-[10px] font-bold text-muted-foreground ms-auto">حدد قاعة من تعديل الحصة</span>}
          </div>
        </th>
      </tr>
      {slots.length === 0 ? (
        <tr className="border-b border-dashed">
          <td colSpan={colSpan} className="px-3 py-4 text-center text-xs font-bold text-muted-foreground">
            مفيش حصص في القاعة دي يوم {dayLabel}.
          </td>
        </tr>
      ) : (
        slots.map((s) => (
          <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition">
            <td className="px-3 py-3">
              <span className="nk-num font-extrabold text-xs whitespace-nowrap">{formatTime12(s.startTime)} – {formatTime12(s.endTime)}</span>
            </td>
            <td className="px-3 py-3">
              <span className="block font-extrabold text-[13px]">{s.subject} — {s.grade} {s.groupName}</span>
              <span className="block text-[11px] text-muted-foreground font-semibold mt-0.5">للمدرس {s.teacherPercent}%</span>
            </td>
            <td className="px-3 py-3 text-xs font-semibold">{s.teacher}</td>
            <td className="px-3 py-3 text-center">
              <span className="inline-flex items-center gap-1 text-xs font-bold nk-num">
                <GraduationCap className="w-3.5 h-3.5 text-muted-foreground" /> {s.students}
              </span>
            </td>
            <td className="px-3 py-3 text-center">
              <span className="nk-num text-xs font-extrabold">{fmt(s.price)} ج</span>
            </td>
            {isManager && (
              <td className="px-3 py-3">
                <div className="flex items-center justify-center gap-1">
                  <IconBtn onClick={() => onEdit(s)} icon={<Pencil className="w-4 h-4" />} label="تعديل" />
                  <IconBtn onClick={() => onCopy(s)} icon={<Copy className="w-4 h-4" />} label="تكرار" />
                  <IconBtn danger onClick={() => onDelete(s)} icon={<Trash2 className="w-4 h-4" />} label="إلغاء" />
                </div>
              </td>
            )}
          </tr>
        ))
      )}
    </>
  );
}

// =====================================================================
// Rooms (قاعات) management

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

  // reset the rename editor whenever the dialog opens fresh
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
                        className="w-9 h-9 rounded-lg hover:bg-rose-50 grid place-items-center text-rose-600" aria-label="حذف">
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

// =====================================================================
// Slot add / edit dialog

function SlotDialog({ open, slot, groups, rooms, onClose, onSaved }: {
  open: boolean; slot: Slot | null; groups: ScheduleData["groups"]; rooms: Room[];
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!slot?.id;
  // initial state computed once on mount — dialog is conditionally rendered so it remounts
  const [form, setForm] = useState(() => {
    if (slot) {
      return {
        dayOfWeek: isEdit ? slot.dayOfWeek : 6,
        startTime: slot.startTime, endTime: slot.endTime, groupId: slot.groupId,
        room: slot.room ?? "", price: String(slot.price / 100), teacherPercent: String(slot.teacherPercent),
      };
    }
    const g = groups[0];
    return {
      dayOfWeek: 6, startTime: "17:00", endTime: "18:30", groupId: g?.id ?? "",
      room: g?.room ?? "", price: g ? String(g.price / 100) : "", teacherPercent: g ? String(g.teacherPercent) : "",
    };
  });

  const selectedGroup = groups.find((g) => g.id === form.groupId);
  // keep legacy room names selectable even if not in the registry
  const roomOptions = useMemo(() => {
    const names = rooms.map((r) => r.name);
    if (form.room && !names.includes(form.room)) return [...names, form.room];
    return names;
  }, [rooms, form.room]);

  async function save() {
    try {
      const body: Record<string, unknown> = {
        dayOfWeek: form.dayOfWeek, startTime: form.startTime, endTime: form.endTime,
        groupId: form.groupId, room: form.room || null,
      };
      if (isEdit) body.id = slot!.id;
      await api("/api/schedule", { method: isEdit ? "PATCH" : "POST", body });
      // optional price update
      if (form.price && selectedGroup && parseFloat(form.price) !== selectedGroup.price / 100) {
        await api("/api/schedule", { method: "PUT", body: { groupId: form.groupId, price: parseFloat(form.price) } });
      }
      if (form.teacherPercent && selectedGroup && parseInt(form.teacherPercent) !== selectedGroup.teacherPercent) {
        await api("/api/schedule", { method: "PUT", body: { groupId: form.groupId, teacherPercent: parseInt(form.teacherPercent, 10) } });
      }
      onSaved();
    } catch { /* toast */ }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل حصة" : slot ? "تكرار الحصة في يوم تاني" : "حصة جديدة في الجدول"}</DialogTitle>
        </DialogHeader>
        {groups.length === 0 ? (
          <EmptyState title="مفيش مجموعات" hint="اعمل مجموعة الأول من صفحة المجموعات." />
        ) : (
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-sm font-bold">اليوم</label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_TABS.map((t) => (
                  <button key={t.dow} type="button" onClick={() => setForm({ ...form, dayOfWeek: t.dow })}
                    className={cn("rounded-xl border px-3 py-2 text-xs font-extrabold",
                      form.dayOfWeek === t.dow ? "nk-brand-bg text-white border-transparent" : "bg-card border-border")}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-bold">من الساعة</label>
                <input type="time" dir="ltr" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold nk-num"
                  value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold">لحد الساعة</label>
                <input type="time" dir="ltr" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold nk-num"
                  value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold">المجموعة</label>
              <select className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-semibold text-sm"
                value={form.groupId}
                onChange={(e) => {
                  const g = groups.find((x) => x.id === e.target.value);
                  setForm({ ...form, groupId: e.target.value, price: g ? String(g.price / 100) : form.price, teacherPercent: g ? String(g.teacherPercent) : form.teacherPercent, room: (isEdit ? form.room : g?.room ?? form.room) });
                }}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.subject} — {g.grade} {g.name} ({g.teacher ?? "بدون مدرس"})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-bold">القاعة</label>
                <select className="w-full h-11 rounded-xl border-2 border-input bg-card px-2 font-semibold text-sm"
                  value={form.room}
                  onChange={(e) => setForm({ ...form, room: e.target.value })}>
                  <option value="">بدون قاعة</option>
                  {roomOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
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

            <div className="flex gap-2">
              <button onClick={save} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 hidden" /> {isEdit ? "حفظ التعديل" : "إضافة"}
              </button>
              <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
