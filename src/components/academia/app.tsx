"use client";

/* ============================================================
   ALNOKHBA ACADEMIA — App shell (spec §9, §10, §29, §15)
   Role-scoped navigation: TEACHER (classroom-first), MANAGER/ADMIN
   (full control), STUDENT (own academic portal).
   Smart Insights live under More(⋯) → فريق التحليل ONLY.
============================================================ */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home, CalendarDays, Users, GraduationCap, ClipboardList, BarChart3,
  Bell, LogOut, MoreHorizontal, Settings, BrainCircuit, Loader2,
  BookOpenCheck, ShieldCheck, ScrollText, UserCog, Landmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { acaApi, fmtDate, type AcaUserClient, type Term } from "./client";
import { cn } from "@/lib/utils";
import { TodayView } from "./views-today";
import { GroupsView } from "./views-groups";
import { StudentsView } from "./views-students";
import { ExamsView } from "./views-exams";
import { RequestsView, InsightsView, ReportsView, SettingsView, AuditView } from "./views-more";
import { StudentPortal } from "./student-portal";
import { NotificationsPanel } from "./notifications";

export type ViewKey =
  | "home" | "groups" | "students" | "exams" | "requests" | "reports"
  | "insights" | "settings" | "audit" | "teachers" | "portal";

export function AcademiaApp({ initialUser, term, today, unread: initialUnread }: {
  initialUser: AcaUserClient; term: Term; today: string; unread: number;
}) {
  const router = useRouter();
  const [user] = useState<AcaUserClient>(initialUser);
  const [view, setView] = useState<ViewKey>("home");
  const [unread, setUnread] = useState(initialUnread);
  const [notifOpen, setNotifOpen] = useState(false);

  // support deep-links like /academia?view=exams (deferred — no sync setState in effect)
  useEffect(() => {
    const t = setTimeout(() => {
      const v = new URLSearchParams(window.location.search).get("view");
      if (v) setView(v as ViewKey);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
    window.location.href = "/login";
  };

  if (user.role === "STUDENT") {
    return <StudentPortal user={user} term={term} onLogout={logout} />;
  }

  const isTeacher = user.role === "TEACHER";
  const can = (p: string) => user.permissions.includes(p);

  const NAV: { key: ViewKey; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "home", label: "الرئيسية", icon: <Home className="w-5 h-5" />, show: true },
    { key: "groups", label: "المجموعات", icon: <Users className="w-5 h-5" />, show: can("groups.view") },
    { key: "students", label: "الطلاب", icon: <GraduationCap className="w-5 h-5" />, show: can("students.view") },
    { key: "exams", label: "الامتحانات", icon: <ClipboardList className="w-5 h-5" />, show: can("exams.view") },
    { key: "requests", label: "الطلبات", icon: <ScrollText className="w-5 h-5" />, show: can("requests.view") },
    { key: "reports", label: "التقارير", icon: <BarChart3 className="w-5 h-5" />, show: can("reports.view") },
  ];
  const MORE: { key: ViewKey; label: string; icon: React.ReactNode; show: boolean; desc: string }[] = [
    { key: "insights", label: "فريق التحليل", icon: <BrainCircuit className="w-5 h-5" />, show: can("insights.view"), desc: "رؤى ذكية مبنية على بيانات أكاديميا" },
    { key: "settings", label: "الإعدادات", icon: <Settings className="w-5 h-5" />, show: true, desc: "المواد والمنهج والفترات والصلاحيات" },
    { key: "audit", label: "سجل التدقيق", icon: <Landmark className="w-5 h-5" />, show: can("audit.view"), desc: "كل تغيير مهم مسجّل بمين وإمتى" },
  ];

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* ---------- topbar ---------- */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl nk-brand-bg text-white flex items-center justify-center shrink-0">
              <BookOpenCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-sm leading-tight">أكاديميا النخبة</h1>
              <p className="text-[10px] text-muted-foreground truncate">
                {isTeacher ? "مساحة المدرس" : user.role === "ADMIN" ? "إدارة الأكاديميا" : "إدارة الأكاديميا"}
                {term ? ` · ${term.name}` : ""}
              </p>
            </div>
          </div>
          <button
            className="relative w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
            onClick={() => setNotifOpen(true)}
            aria-label={`الإشعارات${unread ? ` (${unread} غير مقروء)` : ""}`}
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -end-0.5 min-w-4.5 h-4.5 px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          <button className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" onClick={logout} aria-label="تسجيل الخروج">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ---------- content ---------- */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5 pb-24">
        {MORE.some((m) => m.key === view && m.show) && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4" role="tablist" aria-label="قسم المزيد">
            {MORE.filter((m) => m.show).map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={view === m.key}
                onClick={() => setView(m.key)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-2 text-xs font-extrabold border transition flex items-center gap-1.5",
                  view === m.key ? "nk-brand-bg text-white border-transparent" : "border-border text-muted-foreground bg-white/70 dark:bg-white/5",
                )}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        )}
        {view === "home" && <TodayView user={user} today={today} onOpenGroups={() => setView("groups")} />}
        {view === "groups" && <GroupsView user={user} />}
        {view === "students" && <StudentsView user={user} />}
        {view === "exams" && <ExamsView user={user} />}
        {view === "requests" && <RequestsView user={user} />}
        {view === "reports" && <ReportsView user={user} />}
        {view === "insights" && <InsightsView user={user} />}
        {view === "settings" && <SettingsView user={user} />}
        {view === "audit" && <AuditView user={user} />}
      </main>

      {/* ---------- bottom nav (mobile-first, spec §15) ---------- */}
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur nk-safe-bottom md:hidden" aria-label="التنقل الرئيسي">
        <div className="grid grid-cols-6 h-16">
          {NAV.filter((n) => n.show).slice(0, 5).map((n) => (
            <NavBtn key={n.key} n={n} active={view === n.key} onClick={() => setView(n.key)} />
          ))}
          {MORE.some((m) => m.show) && (
            <NavBtn
              n={{ key: "home", label: "المزيد", icon: <MoreHorizontal className="w-5 h-5" />, show: true } as { key?: string; label: string; icon: React.ReactNode; show?: boolean }}
              active={MORE.some((m) => m.key === view)}
              onClick={() => setView(MORE.find((m) => m.show)?.key ?? "settings")}
            />
          )}
        </div>
      </nav>

      {/* desktop sidebar-less quick switch */}
      <div className="hidden md:flex fixed bottom-4 end-4 z-30 flex-col gap-2">
        {MORE.filter((m) => m.show).map((m) => (
          <Button key={m.key} variant={view === m.key ? "default" : "outline"} size="sm"
            className="rounded-full font-extrabold shadow-sm"
            onClick={() => setView(m.key)}>
            {m.icon} {m.label}
          </Button>
        ))}
      </div>

      {notifOpen && (
        <NotificationsPanel
          onClose={() => { setNotifOpen(false); }}
          onRead={() => setUnread(0)}
        />
      )}
    </div>
  );
}

function NavBtn({ n, active, onClick }: { n: { key?: string; label: string; icon: React.ReactNode }; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 text-[10px] font-extrabold transition",
        active ? "nk-brand-text" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {n.icon}
      {n.label}
    </button>
  );
}

export { fmtDate };
