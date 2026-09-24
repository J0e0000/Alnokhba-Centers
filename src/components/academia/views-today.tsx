"use client";

/* Today view — the classroom entry point (spec §15):
   Home → Today's Session → Open Session (Focus Mode) */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PlayCircle, MapPin, Users2, RefreshCw, AlertTriangle, FileCheck2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acaApi, ApiErr, fmt12, fmtDate, type AcaUserClient, type SessionListItem } from "./client";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "لسه", STARTED: "شغالة", IN_PROGRESS: "شغالة", COMPLETED: "خلصت", CANCELLED: "ملغية",
};

export function TodayView({ user, today, onOpenGroups }: { user: AcaUserClient; today: string; onOpenGroups: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<{
    pendingRequests: number; todayCount: number; completedToday: number;
    needsAttendance: { id: string; name: string; startTime: string }[];
    running: { id: string; name: string; startTime: string }[];
    upcomingExams: { id: string; title: string; date: string; group: string; subject: { name: string; color: string } }[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await acaApi<{ sessions: SessionListItem[] }>(`/api/academia/sessions?date=${date}`);
      setSessions(d.sessions);
    } catch (e) {
      if (e instanceof ApiErr) toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    type Dash = {
      pendingRequests: number; todayCount: number; completedToday: number;
      needsAttendance: { id: string; name: string; startTime: string }[];
      running: { id: string; name: string; startTime: string }[];
      upcomingExams: { id: string; title: string; date: string; group: string; subject: { name: string; color: string } }[];
    };
    acaApi<Dash>("/api/academia/dashboard", { silent: true }).then(setDash).catch(() => {});
  }, []);

  const greeting = user.role === "TEACHER" ? "حصة النهاردة" : "إيه اللي محتاج انتباهك؟";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black">{greeting} 👋</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{fmtDate(date)}</p>
      </div>

      {/* attention strip — one glance (spec §26) */}
      {dash && user.role !== "TEACHER" && (
        <div className="grid grid-cols-2 gap-2">
          <AttentionCard label="طلبات مستنية قرار" value={dash.pendingRequests} tone={dash.pendingRequests > 0 ? "amber" : "plain"} />
          <AttentionCard label="حصص النهاردة" value={dash.todayCount} sub={`${dash.completedToday} خلصت`} />
        </div>
      )}
      {dash && user.role !== "TEACHER" && dash.upcomingExams.length > 0 && (
        <div className="rounded-2xl border border-border bg-white/70 dark:bg-white/5 p-3.5">
          <p className="text-xs font-extrabold text-muted-foreground mb-2 flex items-center gap-1.5"><FileCheck2 className="w-4 h-4" /> امتحانات الأسبوع الجاي</p>
          <div className="space-y-1.5">
            {dash.upcomingExams.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span className="font-bold truncate">{e.title} <span className="text-muted-foreground">· {e.group}</span></span>
                <span className="text-xs font-bold shrink-0 text-muted-foreground">{fmtDate(e.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* date switcher */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="rounded-full font-extrabold" onClick={() => shift(-1)}>اليوم اللي فات</Button>
        <Button size="sm" className="rounded-full font-extrabold nk-brand-bg text-white" onClick={() => setDate(today)}>النهاردة</Button>
        <Button variant="outline" size="sm" className="rounded-full font-extrabold" onClick={() => shift(1)}>بكرة</Button>
        <Button variant="ghost" size="icon" className="ms-auto rounded-full" onClick={load} aria-label="تحديث">
          <RefreshCw className={cn("w-4.5 h-4.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* sessions */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : sessions.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center space-y-2">
          <CalendarClock className="w-9 h-9 mx-auto text-muted-foreground" />
          <p className="font-extrabold">مفيش حصص {date === today ? "النهاردة" : "في اليوم ده"}</p>
          <p className="text-sm text-muted-foreground">الحصص بتتولّد لوحدها من الجدول الأسبوعي للمجموعات.</p>
          {user.role !== "TEACHER" && (
            <Button variant="outline" className="rounded-xl font-extrabold mt-2" onClick={onOpenGroups}>افتح المجموعات</Button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} onOpen={() => router.push(`/academia/session/${s.id}`)} />
          ))}
        </div>
      )}
    </div>
  );

  function shift(days: number) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }
}

function SessionCard({ s, onOpen }: { s: SessionListItem; onOpen: () => void }) {
  const color = s.color || "#0E9F6E";
  return (
    <button
      onClick={onOpen}
      className="w-full text-start rounded-3xl border border-border bg-white/80 dark:bg-white/5 p-4 hover:shadow-md transition active:scale-[0.995] flex items-center gap-3.5"
    >
      <div className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-black text-base">{fmt12(s.startTime)}</span>
          <span className="nk-chip-subject text-xs font-extrabold px-2 py-0.5 rounded-full" style={{ "--subject-color": color } as React.CSSProperties}>{s.subject}</span>
          {s.isMakeup && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">تعويضية</span>}
        </div>
        <p className="font-bold text-sm mt-1 truncate">{s.groupName}</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
          <span className="inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" />{s.room ?? "بدون قاعة"}</span>
          <span className="inline-flex items-center gap-0.5"><Users2 className="w-3 h-3" />{s.marked}/{s.roster} متسجل حضور</span>
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <span className={cn(
          "text-[10px] font-black px-2 py-1 rounded-full",
          s.status === "COMPLETED" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
          (s.status === "STARTED" || s.status === "IN_PROGRESS") && "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
          s.status === "SCHEDULED" && "bg-muted text-muted-foreground",
          s.status === "CANCELLED" && "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
        )}>{STATUS_LABEL[s.status]}</span>
        {s.status !== "COMPLETED" && s.status !== "CANCELLED" ? (
          <span className="inline-flex items-center gap-1 text-xs font-extrabold nk-brand-text">
            <PlayCircle className="w-4 h-4" /> افتح
          </span>
        ) : (
          <span className="text-xs font-bold text-muted-foreground">تفاصيل</span>
        )}
      </div>
    </button>
  );
}

function AttentionCard({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "amber" | "plain" }) {
  return (
    <div className={cn(
      "rounded-2xl border p-3.5",
      tone === "amber" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800" : "border-border bg-white/70 dark:bg-white/5",
    )}>
      <p className="text-2xl font-black leading-none">{value}</p>
      <p className="text-[11px] font-bold text-muted-foreground mt-1 flex items-center gap-1">
        {tone === "amber" && value > 0 && <AlertTriangle className="w-3 h-3" />}
        {label}{sub ? ` · ${sub}` : ""}
      </p>
    </div>
  );
}
