"use client";

/* Student portal — own academic record only (spec §7, §10: self.view) */

import { useEffect, useState } from "react";
import { Loader2, LogOut, CalendarDays, Percent, NotebookPen, ClipboardList, BookOpenCheck } from "lucide-react";
import { acaApi, fmtDate, fmt12, DOW_AR, type AcaUserClient, type Term } from "./client";
import { cn } from "@/lib/utils";

export function StudentPortal({ user, term, onLogout }: { user: AcaUserClient; term: Term; onLogout: () => void }) {
  const [profile, setProfile] = useState<{
    student: { name: string; code: string; gradeName: string | null };
    groups: { id: string; name: string; subject: { name: string; color: string }; teacher: { name: string }; schedules: { id: string; dayOfWeek: number; startTime: string; endTime: string }[] }[];
    stats: { attendanceRate: number | null; homeworkRate: number | null; homeworkPoints: number };
    subjectsPerf: { name: string; color: string; avg: number | null }[];
    recent: {
      exams: { id: string; score: number | null; exam: { title: string; date: string; maxScore: number; subject: { name: string } } }[];
      homework: { id: string; completed: boolean; score: number | null; session: { date: string; group: { name: string } } }[];
    };
  } | null>(null);
  const [loading, setLoading] = useState(() => Boolean(user.studentProfileId));

  useEffect(() => {
    if (!user.studentProfileId) return;
    const t = setTimeout(() => { void 0; }, 0);
    acaApi<NonNullable<typeof profile>>(`/api/academia/students/${user.studentProfileId}`)
      .then(setProfile)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user.studentProfileId]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl nk-brand-bg text-white flex items-center justify-center shrink-0">
            <BookOpenCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-black text-sm leading-tight">بوابة الطالب — أكاديميا النخبة</h1>
            <p className="text-[10px] text-muted-foreground truncate">{term ? term.name : ""}</p>
          </div>
          <button className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" onClick={onLogout} aria-label="تسجيل الخروج">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
        ) : !profile ? (
          <p className="text-center text-sm text-muted-foreground py-10">مفيش بيانات — كلم الإدارة.</p>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-black">أهلاً {profile.student.name} 👋</h2>
              <p className="text-sm text-muted-foreground"><span dir="ltr">{profile.student.code}</span> · {profile.student.gradeName ?? "—"}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Stat icon={<Percent className="w-4 h-4" />} label="نسبة حضورك" value={profile.stats.attendanceRate != null ? `${profile.stats.attendanceRate}%` : "—"} />
              <Stat icon={<NotebookPen className="w-4 h-4" />} label="الواجب" value={profile.stats.homeworkRate != null ? `${profile.stats.homeworkRate}%` : "—"} />
              <Stat icon={<ClipboardList className="w-4 h-4" />} label="نقاط الواجب" value={String(profile.stats.homeworkPoints)} />
            </div>

            <section>
              <h3 className="font-extrabold text-sm mb-2 flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> مجموعاتك ومواعيدك</h3>
              <div className="grid gap-1.5">
                {profile.groups.map((g) => (
                  <div key={g.id} className="rounded-2xl border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: g.subject.color }} />
                      <span className="font-bold text-sm">{g.name}</span>
                      <span className="text-[11px] text-muted-foreground">أ. {g.teacher.name}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {g.schedules.map((s) => `${DOW_AR[s.dayOfWeek]} ${fmt12(s.startTime)}`).join(" · ") || "بدون مواعيد"}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {profile.subjectsPerf.length > 0 && (
              <section>
                <h3 className="font-extrabold text-sm mb-2">أدائك في المواد</h3>
                <div className="grid gap-1.5">
                  {profile.subjectsPerf.map((s) => (
                    <div key={s.name} className="flex items-center gap-2.5">
                      <span className="text-xs font-bold w-20">{s.name}</span>
                      <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full rounded-full", (s.avg ?? 0) >= 85 ? "bg-emerald-500" : (s.avg ?? 0) < 60 ? "bg-red-500" : "bg-amber-500")} style={{ width: `${s.avg ?? 0}%` }} />
                      </div>
                      <span className="text-xs font-black w-10 text-end">{s.avg ?? "—"}%</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {profile.recent.exams.length > 0 && (
              <section>
                <h3 className="font-extrabold text-sm mb-2">آخر نتايجك</h3>
                <div className="grid gap-1.5">
                  {profile.recent.exams.slice(0, 8).map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-bold truncate">{r.exam.title}</p>
                        <p className="text-[11px] text-muted-foreground">{r.exam.subject.name} · {fmtDate(r.exam.date)}</p>
                      </div>
                      <span className={cn("font-black", r.score != null && r.score / r.exam.maxScore >= 0.85 && "text-emerald-600", r.score != null && r.score / r.exam.maxScore < 0.6 && "text-red-600")}>
                        {r.score ?? "—"} / {r.exam.maxScore}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/70 dark:bg-white/5 p-3 text-center">
      <div className="flex justify-center nk-brand-text">{icon}</div>
      <p className="font-black mt-0.5">{value}</p>
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
    </div>
  );
}
