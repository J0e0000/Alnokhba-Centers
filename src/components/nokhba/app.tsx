"use client";

import { useCallback, useEffect, useState } from "react";
import { AlNokhbaMark } from "./shared";
import { api, applyCenterBranding, type SessionUser } from "./lib";
import { CenterShell, AdminShell, type ViewId, type AdminViewId } from "./shell";
import { TabsDashboardView } from "./tabs-dashboard";
import { TodayView } from "./today-view";
import { OperationsView } from "./operations";
import { FocusShell } from "./focus-shell";
import { SuccessBarHost } from "./success-bar";
import { ScanView } from "./scan";
import { PaymentsView } from "./payments-view";
import { StudentsView } from "./students";
import { StudentProfileView } from "./student-profile";
import { ScheduleView } from "./schedule";
import { GroupsView } from "./groups";
import { QuizManagerView } from "./quiz-manager";
import { ExamManagerView } from "./exam-manager";
import { AssignmentManagerView } from "./assignment-manager";
import { BooksView } from "./books";
import { MessagesView } from "./message-queue";
import { AccountingView } from "./accounting";
import { ReportsView } from "./reports";
import { PrintProvider } from "./print";
import { SettingsView } from "./settings";
import { SessionLiveView } from "./session-live";
import { EmergencyView } from "./emergency";
import { ApprovalsView } from "./approvals";
import { clearPending } from "./pwa";

import { CommandPalette } from "./command-palette";
import {
  AdminCentersView, AdminSubscriptionsView, AdminStudentsView,
  AdminBillingView, AdminSystemView, AdminMonitorView, AdminTeamsView, AdminBackupsView,
  AdminRequestsView, AdminAnalyticsView,
} from "./admin";
import type { AdminData } from "./admin";

export function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [view, setView] = useState<ViewId>("home");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionOverride, setSessionOverride] = useState<string | null>(null);
  const [addNewStudent, setAddNewStudent] = useState(false);
  const [adminView, setAdminView] = useState<AdminViewId>("centers");


  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/auth", { silent: true })
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  // تحديث بيانات المستخدم من أي مكان (إعدادات الطباعة مثلاً)
  useEffect(() => {
    const onUser = (e: Event) => {
      const u = (e as CustomEvent<SessionUser>).detail;
      if (u) setUser(u);
    };
    window.addEventListener("nk-user-updated", onUser);
    return () => window.removeEventListener("nk-user-updated", onUser);
  }, []);

  // تفضيلات المستخدم (spec §11): المظهر المحفوظ بيتطبق مع كل دخول
  useEffect(() => {
    if (!user) return;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { preferences?: { theme?: string | null } } | null) => {
        const theme = d?.preferences?.theme;
        if (theme && theme !== "system") {
          const root = document.documentElement;
          const isDark = root.classList.contains("dark");
          if (theme === "dark" && !isDark) root.classList.add("dark");
          if (theme === "light" && isDark) root.classList.remove("dark");
        }
      })
      .catch(() => {});
  }, [user]);

  // custom navigation events (e.g., RED scan → add student / tour → switch view)
  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<{ view: ViewId; addNew?: boolean }>).detail;
      setView(detail.view);
      // تنقل لشاشة تانية = خروج من ملف الطالب/الحصة المفتوحين
      setStudentId(null);
      setSessionId(null);
      if (detail.addNew) setAddNewStudent(true);
    };
    window.addEventListener("nk-navigate", onNav);
    return () => window.removeEventListener("nk-navigate", onNav);
  }, []);

  // شريط الحالة المصغّر → افتح الحصة الشغالة على طول
  useEffect(() => {
    const onOpenSession = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id) {
        setView("home");
        setStudentId(null);
        setSessionId(detail.id);
      }
    };
    window.addEventListener("nk-open-session", onOpenSession);
    return () => window.removeEventListener("nk-open-session", onOpenSession);
  }, []);

  // (الدخول بيحصل من /login — ده بس fallback لو اتحط session من مكان تاني)
  const onLogin = (u: SessionUser) => {
    setUser(u);
    setView("home");
    setStudentId(null);
    setSessionId(null);
    applyCenterBranding(u.center);
  };

  const onLogout = () => {
    // طابور الحضور الأوفلاين بيتفضى عند الخروج — داتا الجهاز مش بتتنقل بين الحسابات
    clearPending();
    // رجوع لشاشة دخول السنتر بتحميل نظيف (بيمسح حالة SPA بالكامل)
    window.location.href = "/login";
  };

  // مفيش جلسة على /app؟ يبقى مكانك شاشة الدخول
  useEffect(() => {
    if (user === null) window.location.replace("/login");
  }, [user]);

  if (user === undefined || user === null) {
    // null = تسجيل الخروج/غير مسجل → الـ effect فوق بينقل على /login
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <AlNokhbaMark size={52} />
          <span className="w-7 h-7 rounded-full border-[3px] border-[var(--c-primary)] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (user.role === "ADMIN") {
    return (
      <AdminPortalShell user={user} onLogout={onLogout} view={adminView} setView={setAdminView} />
    );
  }

  const openStudent = (id: string) => { setStudentId(id); };
  const openSession = (id: string) => { setSessionId(id); };
  const goScanForSession = (id: string) => { setSessionId(null); setSessionOverride(id); setView("scan"); };

  // Focus Mode: الحصة بتتشال من الشل العام خالص — مساحة تركيز مستقلة
  // (مفيش سايدبار ولا تنقل سفلي — بس شريط الحالة والخروج الآمن)
  if (sessionId) {
    return (
      <FocusShell user={user} onExit={() => { setSessionId(null); }}>
        <SessionLiveView
          key={sessionId}
          user={user}
          sessionId={sessionId}
          onBack={() => setSessionId(null)}
          onGoScan={() => goScanForSession(sessionId)}
        />
      </FocusShell>
    );
  }

  let content: React.ReactNode;
  if (studentId) {
    content = (
      <StudentProfileView
        key={studentId}
        user={user}
        studentId={studentId}
        onBack={() => setStudentId(null)}
      />
    );
  } else {
    switch (view) {
      case "home":
        content = <TabsDashboardView user={user} setView={setView} openSession={openSession} goScanForSession={goScanForSession} />;
        break;
      case "today":
        content = <TodayView user={user} setView={setView} openSession={openSession} goScanForSession={goScanForSession} />;
        break;
      case "operations":
        content = <OperationsView user={user} setView={setView} />;
        break;
      case "scan":
        content = (
          <ScanView
            user={user}
            sessionOverride={sessionOverride}
            clearSessionOverride={() => setSessionOverride(null)}
          />
        );
        break;
      case "payments":
        content = <PaymentsView user={user} />;
        break;
      case "students":
        content = (
          <StudentsView
            user={user}
            openNew={addNewStudent}
            onOpenNewConsumed={() => setAddNewStudent(false)}
            onOpenProfile={openStudent}
          />
        );
        break;
      case "schedule":
        content = <ScheduleView user={user} openSession={openSession} />;
        break;
      case "groups":
        content = <GroupsView />;
        break;
      case "quizzes":
        content = <QuizManagerView />;
        break;
      case "exams":
        content = <ExamManagerView user={user} />;
        break;
      case "assignments":
        content = <AssignmentManagerView user={user} />;
        break;
      case "books":
        content = <BooksView user={user} />;
        break;
      case "messages":
        content = <MessagesView user={user} />;
        break;
      case "accounting":
        content = <AccountingView />;
        break;
      case "reports":
        content = <ReportsView user={user} />;
        break;
      case "settings":
        content = (
          <SettingsView
            user={user}
            onBrandingChanged={(center) => setUser({ ...user, center })}
          />
        );
        break;
      case "emergency":
        content = <EmergencyView user={user} />;
        break;
      case "approvals":
        content = <ApprovalsView user={user} />;
        break;
      default:
        content = <TabsDashboardView user={user} setView={setView} openSession={openSession} goScanForSession={goScanForSession} />;
    }
  }

  return (
    <PrintProvider>
      <CenterShell user={user} onLogout={onLogout} view={view} setView={(v) => { setView(v); setStudentId(null); setSessionId(null); }}>
        {/* شريط النجاح الدائم — تحت الهيدر على طول، مبيختفيش لوحده */}
        <div className="mb-3">
          <SuccessBarHost />
        </div>
        {/* حركة دخول لكل فيو — المفتاح بيعيد التشغيل مع كل تنقل */}
        <div key={`${view}-${studentId ?? ""}`} className="nk-anim-view">
          {content}
        </div>
      </CenterShell>
      {/* Ctrl+K بحث سريع */}
      <CommandPalette
        user={user}
        setView={(v) => { setView(v); setStudentId(null); setSessionId(null); }}
        onOpenStudent={(id) => setStudentId(id)}
      />
    </PrintProvider>
  );
}

function AdminPortalShell({ user, onLogout, view, setView }: {
  user: SessionUser; onLogout: () => void; view: AdminViewId; setView: (v: AdminViewId) => void;
}) {
  const [data, setData] = useState<AdminData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    api<AdminData>("/api/admin").then(setData).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { applyCenterBranding(null); }, []);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <PrintProvider>
      <AdminShell user={user} onLogout={onLogout} view={view} setView={setView}>
        <div key={view} className="nk-anim-view">
          {view === "centers" && <AdminCentersView data={data} reload={reload} />}
          {view === "analytics" && <AdminAnalyticsView />}
          {view === "requests" && <AdminRequestsView data={data} reload={reload} />}
          {view === "subscriptions" && <AdminSubscriptionsView data={data} reload={reload} />}
          {view === "students" && <AdminStudentsView data={data} />}
          {view === "billing" && <AdminBillingView data={data} />}
          {view === "teams" && <AdminTeamsView data={data} reload={reload} />}
          {view === "backups" && <AdminBackupsView data={data} />}
          {view === "system" && <AdminSystemView data={data} />}
          {view === "monitor" && <AdminMonitorView data={data} reload={reload} />}
        </div>
      </AdminShell>
    </PrintProvider>
  );
}
