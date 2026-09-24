"use client";

/* Students view — search + one coherent academic profile (spec §7) */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, ChevronLeft, TrendingUp, TrendingDown, Users2, Percent, NotebookPen, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { acaApi, ApiErr, fmtDate, ATT_LABEL, type AcaUserClient } from "./client";
import { cn } from "@/lib/utils";

type StudentRow = {
  profileId: string; code: string; name: string; gradeName: string | null; isActive: boolean;
  groups: { id: string; name: string; subject: string; color: string; teacher: string }[];
};
type Profile = {
  student: { profileId: string; code: string; name: string; username: string; gradeName: string | null; parentName: string | null; parentPhone: string | null; notes: string | null; since: string; isActive: boolean };
  groups: { id: string; name: string; subject: { name: string; color: string }; teacher: { name: string }; schedules: { id: string; dayOfWeek: number; startTime: string; endTime: string }[] }[];
  stats: { attendanceRate: number | null; attendanceTotal: number; homeworkRate: number | null; homeworkDone: number; homeworkTotal: number; homeworkPoints: number; sessionsTotal: number };
  subjectsPerf: { name: string; color: string; count: number; avg: number | null }[];
  strengths: { name: string; avg: number | null }[];
  weaknesses: { name: string; avg: number | null }[];
  progress: { groupId: string; subject: string; color: string; totalLessons: number; attendedSessions: number; pct: number | null }[];
  recent: {
    attendance: { id: string; status: string; session: { date: string; startTime: string; group: { name: string; subject: { name: string; color: string } } } }[];
    homework: { id: string; completed: boolean; score: number | null; session: { date: string; group: { name: string } } }[];
    exams: { id: string; score: number | null; exam: { title: string; type: string; date: string; maxScore: number; subject: { name: string; color: string } } }[];
  };
};

export function StudentsView({ user }: { user: AcaUserClient }) {
  const [q, setQ] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await acaApi<{ students: StudentRow[] }>(`/api/academia/students?q=${encodeURIComponent(q)}`);
      setStudents(d.students);
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const openProfile = async (id: string) => {
    try { setProfile(await acaApi<Profile>(`/api/academia/students/${id}`)); }
    catch (e) { if (e instanceof ApiErr) toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-black">الطلاب</h2>
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الكود" className="ps-10 h-12 rounded-2xl text-base font-bold" />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid gap-1.5">
          {students.map((s) => (
            <button key={s.profileId} onClick={() => openProfile(s.profileId)}
              className="flex items-center gap-3 rounded-2xl border border-border bg-white/80 dark:bg-white/5 p-3 text-start hover:shadow-sm transition">
              <div className="w-10 h-10 rounded-full nk-brand-bg text-white flex items-center justify-center font-black text-sm shrink-0">
                {s.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm truncate">{s.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  <span dir="ltr">{s.code}</span> · {s.gradeName ?? "—"} · {s.groups.map((g) => g.subject).join("، ") || "غير مسجل"}
                </p>
              </div>
              <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
          {students.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">مفيش نتائج</p>}
        </div>
      )}

      <Dialog open={!!profile} onOpenChange={(o) => !o && setProfile(null)}>
        <DialogContent className="max-w-xl max-h-[88dvh] overflow-y-auto rounded-3xl">
          {profile && <ProfileBody p={profile} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileBody({ p }: { p: Profile }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-start font-black">{p.student.name}</DialogTitle>
      </DialogHeader>
      <div className="text-xs text-muted-foreground font-bold -mt-2" dir="ltr">{p.student.code} · {p.student.username}</div>

      {/* stats */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat icon={<Percent className="w-4 h-4" />} label="الحضور" value={p.stats.attendanceRate != null ? `${p.stats.attendanceRate}%` : "—"} />
        <MiniStat icon={<NotebookPen className="w-4 h-4" />} label="الواجب" value={p.stats.homeworkRate != null ? `${p.stats.homeworkRate}%` : "—"} />
        <MiniStat icon={<ClipboardList className="w-4 h-4" />} label="امتحانات" value={String(p.recent.exams.length)} />
        <MiniStat icon={<Users2 className="w-4 h-4" />} label="مجموعات" value={String(p.groups.length)} />
      </div>

      {/* groups + schedule */}
      <section>
        <h3 className="font-extrabold text-sm mb-2">المجموعات والمواعيد</h3>
        <div className="space-y-1.5">
          {p.groups.map((g) => (
            <div key={g.id} className="rounded-xl border border-border p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: g.subject.color }} />
                <span className="font-bold text-sm">{g.name}</span>
                <span className="text-[11px] text-muted-foreground">أ. {g.teacher.name}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {g.schedules.map((s) => `${ATT_DOW[s.dayOfWeek]} ${s.startTime}`).join(" · ") || "بدون مواعيد"}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* performance / strengths / weaknesses */}
      {p.subjectsPerf.length > 0 && (
        <section>
          <h3 className="font-extrabold text-sm mb-2">الأداء في المواد</h3>
          <div className="grid gap-1.5">
            {p.subjectsPerf.map((s) => (
              <div key={s.name} className="flex items-center gap-2.5">
                <span className="text-xs font-bold w-20 shrink-0">{s.name}</span>
                <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full", (s.avg ?? 0) >= 85 ? "bg-emerald-500" : (s.avg ?? 0) < 60 ? "bg-red-500" : "bg-amber-500")} style={{ width: `${s.avg ?? 0}%` }} />
                </div>
                <span className="text-xs font-black w-10 text-end">{s.avg ?? "—"}%</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {p.strengths.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <TrendingUp className="w-3 h-3" /> قوي: {s.name}
              </span>
            ))}
            {p.weaknesses.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800">
                <TrendingDown className="w-3 h-3" /> محتاج دعم: {s.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* curriculum progress */}
      {p.progress.length > 0 && (
        <section>
          <h3 className="font-extrabold text-sm mb-2">التقدم في المنهج</h3>
          <div className="grid gap-1.5">
            {p.progress.map((pr) => (
              <div key={pr.groupId} className="flex items-center gap-2.5">
                <span className="text-xs font-bold w-20 shrink-0">{pr.subject}</span>
                <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full nk-brand-bg" style={{ width: `${pr.pct ?? 0}%` }} />
                </div>
                <span className="text-[11px] font-bold text-muted-foreground w-16 text-end">{pr.attendedSessions} حصة</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* recent exams */}
      {p.recent.exams.length > 0 && (
        <section>
          <h3 className="font-extrabold text-sm mb-2">آخر الامتحانات</h3>
          <div className="grid gap-1.5">
            {p.recent.exams.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-bold truncate">{r.exam.title}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDate(r.exam.date)} · {r.exam.subject.name}</p>
                </div>
                <span className={cn("font-black text-sm", r.score != null && r.score / r.exam.maxScore >= 0.85 && "text-emerald-600", r.score != null && r.score / r.exam.maxScore < 0.6 && "text-red-600")}>
                  {r.score ?? "—"} / {r.exam.maxScore}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* recent attendance */}
      {p.recent.attendance.length > 0 && (
        <section>
          <h3 className="font-extrabold text-sm mb-2">آخر الحضور</h3>
          <div className="flex flex-wrap gap-1.5">
            {p.recent.attendance.slice(0, 12).map((a) => (
              <span key={a.id} className={cn(
                "text-[11px] font-extrabold rounded-full px-2.5 py-1 border",
                a.status === "PRESENT" && "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
                a.status === "ABSENT" && "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
                a.status === "LATE" && "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
                a.status === "EXCUSED" && "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
              )}>
                {a.session.date.slice(5)} · {ATT_LABEL[a.status]}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const ATT_DOW = ["الأحد", "الإتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/70 dark:bg-white/5 p-2.5 text-center">
      <div className="flex justify-center nk-brand-text">{icon}</div>
      <p className="font-black text-sm mt-0.5">{value}</p>
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
    </div>
  );
}
