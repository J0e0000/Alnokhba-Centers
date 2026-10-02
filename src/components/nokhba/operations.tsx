"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DoorClosed, Users, AlertTriangle, CalendarClock, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, formatTime12, type SessionUser } from "./lib";
import { PageHeader, SectionCard, EmptyState, Loading } from "./shared";
import type { ViewId } from "./shell";

/* ============================================================
   تاب «القاعات والتشغيل»:
   - كروت القاعات: السعة · إشغال النهاردة · حالة القاعة دلوقتي
   - كشف تعارضات النهاردة (نفس القاعة أو نفس المدرس بنفس الوقت)
   - إشغال الإجمالي / الاستغلال
   التعارض هنا عرض تحذيري فقط — المنع الفعلي بيحصل على السيرفر
   وقت فتح أي حصة (assertNoSessionConflicts)
============================================================ */

type Room = { id: string; name: string; capacity: number | null; order: number };

type SessionRow = {
  id: string; startTime: string; endTime: string; room: string | null; status: string;
  subject: string; grade: string; groupName: string; teacher: string; teacherId: string | null;
};

type SessionsData = { date: string; sessions: SessionRow[] };

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function nowHM(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function OperationsView({ setView }: {
  setView: (v: ViewId) => void;
  user: SessionUser;
}) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [data, setData] = useState<SessionsData | null>(null);

  const load = useCallback(() => {
    api<{ rooms: Room[] }>("/api/rooms").then((d) => setRooms(d.rooms)).catch(() => {});
    api<SessionsData>("/api/sessions").then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);

  // تعارضات النهاردة: نفس القاعة بنفس الوقت أو نفس المدرس بنفس الوقت (مش ملغاة)
  const conflicts = useMemo(() => {
    const out: { kind: "room" | "teacher"; a: SessionRow; b: SessionRow; label: string }[] = [];
    const active = sessions.filter((s) => s.status !== "CANCELLED");
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]; const b = active[j];
        const overlap = toMin(a.startTime) < toMin(b.endTime) && toMin(a.endTime) > toMin(b.startTime);
        if (!overlap) continue;
        if (a.room && b.room && a.room === b.room) {
          out.push({ kind: "room", a, b, label: `القاعة "${a.room}" محجوزة لحصتين بنفس الوقت` });
        } else if (a.teacherId && a.teacherId === b.teacherId) {
          out.push({ kind: "teacher", a, b, label: `المدرس ${a.teacher} عنده حصتين بنفس الوقت` });
        }
      }
    }
    return out;
  }, [sessions]);

  const hm = nowHM();

  const roomCards = useMemo(() => {
    if (!rooms) return [];
    return rooms.map((r) => {
      const rs = sessions.filter((s) => s.room === r.name && s.status !== "CANCELLED");
      const nowSession = rs.find((s) => s.status === "OPEN" && hm >= s.startTime && hm < s.endTime);
      const bookedMinutes = rs.reduce((sum, s) => sum + Math.max(0, toMin(s.endTime) - toMin(s.startTime)), 0);
      const openMinutes = 14 * 60; // نافذة التشغيل المرجعية 8:00 → 22:00
      const utilization = Math.round((bookedMinutes / openMinutes) * 100);
      const nextSession = rs.filter((s) => s.startTime > hm).sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
      return { room: r, sessions: rs, nowSession, utilization, nextSession };
    });
  }, [rooms, sessions, hm]);

  if (!rooms || !data) return <Loading />;

  const usedRooms = roomCards.filter((r) => r.nowSession).length;
  const capacitySum = rooms.reduce((s, r) => s + (r.capacity ?? 0), 0);

  return (
    <div className="space-y-5 nk-anim-stagger">
      <PageHeader
        title="القاعات والتشغيل"
        subtitle={`${rooms.length} قاعة · ${usedRooms} مشغولة دلوقتي · ${sessions.filter((s) => s.status !== "CANCELLED").length} حصة النهاردة`}
      />

      {/* ===== تعارضات النهاردة — أول حاجة المدير المفروض يشوفها ===== */}
      {conflicts.length > 0 && (
        <SectionCard title={`تعارضات النهاردة (${conflicts.length})`} icon={<AlertTriangle className="w-4 h-4" />}>
          <div className="space-y-2">
            {conflicts.map((c, i) => (
              <div key={i} className="rounded-2xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {c.label}
                </div>
                <p className="text-[11.5px] font-bold mt-1 opacity-80">
                  {c.a.subject} ({formatTime12(c.a.startTime)}–{formatTime12(c.a.endTime)}) ↔ {c.b.subject} ({formatTime12(c.b.startTime)}–{formatTime12(c.b.endTime)})
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ===== كروت القاعات ===== */}
      <SectionCard title="القاعات" icon={<DoorClosed className="w-4 h-4" />}>
        {rooms.length === 0 ? (
          <EmptyState
            icon={<DoorClosed className="w-8 h-8" />}
            title="مفيش قاعات متسجلة"
            hint="ضيف قاعات من تاب الحصص ← الجداول ← القاعات."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {roomCards.map(({ room, sessions: rs, nowSession, utilization, nextSession }) => (
              <div key={room.id} className={cn(
                "nk-card rounded-2xl p-4 space-y-3 border-2",
                nowSession ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-border",
              )}>
                <div className="flex items-center gap-2.5">
                  <span className={cn("rounded-xl p-2", nowSession ? "bg-emerald-600 text-white" : "nk-brand-bg-soft nk-brand-text")}>
                    <DoorClosed className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-[15px] truncate">{room.name}</h3>
                    <p className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      {room.capacity ? `سعة ${room.capacity} طالب` : "سعة غير محددة"}
                    </p>
                  </div>
                  <span className={cn(
                    "text-[10.5px] font-extrabold rounded-full px-2.5 py-1 shrink-0",
                    nowSession ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground",
                  )}>
                    {nowSession ? "مشغولة دلوقتي" : "فاضية"}
                  </span>
                </div>

                {nowSession && (
                  <div className="rounded-xl bg-card border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs font-extrabold">
                    <span className="nk-num">{formatTime12(nowSession.startTime)}–{formatTime12(nowSession.endTime)}</span>
                    {" · "}{nowSession.subject} — {nowSession.groupName}
                  </div>
                )}
                {!nowSession && nextSession && (
                  <div className="rounded-xl bg-muted/60 px-3 py-2 text-xs font-bold text-muted-foreground">
                    الحصة الجاية: <span className="nk-num">{formatTime12(nextSession.startTime)}</span> — {nextSession.subject}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between text-[10.5px] font-bold text-muted-foreground mb-1">
                    <span>إشغال النهاردة ({rs.length} حصة)</span>
                    <span className="nk-num">{utilization}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full nk-brand-grad transition-all")} style={{ width: `${Math.min(100, utilization)}%` }} />
                  </div>
                </div>

                {rs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rs.slice(0, 6).map((s) => (
                      <span key={s.id} className="rounded-lg bg-muted/70 px-2 py-1 text-[10px] font-extrabold nk-num" dir="ltr">
                        {s.startTime}
                      </span>
                    ))}
                    {rs.length > 6 && <span className="rounded-lg px-2 py-1 text-[10px] font-bold text-muted-foreground">+{rs.length - 6}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== ملخص تشغيلي سريع ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile value={`${usedRooms}/${rooms.length}`} label="قاعات شغالة" icon={<DoorClosed className="w-4 h-4" />} />
        <SummaryTile value={String(sessions.filter((s) => s.status === "OPEN").length)} label="حصص شغالة" icon={<CalendarClock className="w-4 h-4" />} />
        <SummaryTile value={String(sessions.filter((s) => s.status === "CLOSED").length)} label="حصص خلصت" icon={<CalendarClock className="w-4 h-4" />} />
        <SummaryTile value={capacitySum ? String(capacitySum) : "—"} label="إجمالي السعة" icon={<Users className="w-4 h-4" />} />
      </div>

      {/* روابط سريعة للتشغيل المالي والطوارئ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => setView("accounting")} className="nk-card rounded-2xl p-4 flex items-center gap-3 hover:shadow-md transition active:scale-[0.99] text-start">
          <span className="rounded-xl p-2.5 nk-brand-bg-soft nk-brand-text"><CalendarClock className="w-5 h-5" /></span>
          <span className="flex-1">
            <span className="block font-extrabold text-sm">الحسابات والصندوق</span>
            <span className="block text-[11px] font-bold text-muted-foreground">مصروفات · مستحقات · قفل يوم</span>
          </span>
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <button onClick={() => setView("emergency")} className="nk-card rounded-2xl p-4 flex items-center gap-3 hover:shadow-md transition active:scale-[0.99] text-start">
          <span className="rounded-xl p-2.5 bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"><AlertTriangle className="w-5 h-5" /></span>
          <span className="flex-1">
            <span className="block font-extrabold text-sm">الطوارئ والتصدير</span>
            <span className="block text-[11px] font-bold text-muted-foreground">حزمة طوارئ · استرداد</span>
          </span>
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

function SummaryTile({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="nk-card rounded-2xl p-4 flex items-center gap-3">
      <span className="rounded-xl p-2.5 nk-brand-bg-soft nk-brand-text shrink-0">{icon}</span>
      <span>
        <span className="block text-xl font-black nk-num leading-none">{value}</span>
        <span className="block text-[11px] font-extrabold text-muted-foreground mt-1">{label}</span>
      </span>
    </div>
  );
}
