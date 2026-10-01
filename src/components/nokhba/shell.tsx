"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, ScanLine, CreditCard, Users, CalendarDays, Layers,
  Calculator, BarChart3, Settings, LogOut, MoreHorizontal, ChevronLeft,
  Building2, BadgeCheck, Receipt, MonitorCog, Activity, GraduationCap, Menu, BookOpen, MessageSquareText,
  ShieldAlert, UserCog, DatabaseBackup, LifeBuoy, Sparkles, ClipboardCheck, UserPlus, ClipboardList,
  FileCheck2, NotebookPen,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, applyCenterBranding, type SessionUser } from "./lib";
import { AlNokhbaMark, ThemeToggle } from "./shared";
import { Tour } from "./tour";
import { HelpButton } from "./help";
import { CENTER_TOUR, RECEPTION_TOUR, ADMIN_TOUR } from "./help-content";
import { StaffNotificationsBell } from "./staff-bell";
import { ZakiAssistant } from "./zaki";
import { UndoRedoButtons } from "./undo-buttons";
import {
  Sheet, SheetContent, SheetTrigger, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

export type ViewId =
  | "home" | "scan" | "payments" | "students" | "schedule"
  | "groups" | "quizzes" | "exams" | "assignments" | "books" | "messages" | "accounting" | "reports" | "settings"
  | "emergency" | "approvals";

export const NAV_ICONS: Record<ViewId, ReactNode> = {
  home: <LayoutDashboard className="w-5 h-5" />,
  scan: <ScanLine className="w-5 h-5" />,
  payments: <CreditCard className="w-5 h-5" />,
  students: <Users className="w-5 h-5" />,
  schedule: <CalendarDays className="w-5 h-5" />,
  groups: <Layers className="w-5 h-5" />,
  quizzes: <ClipboardList className="w-5 h-5" />,
  exams: <FileCheck2 className="w-5 h-5" />,
  assignments: <NotebookPen className="w-5 h-5" />,
  books: <BookOpen className="w-5 h-5" />,
  messages: <MessageSquareText className="w-5 h-5" />,
  accounting: <Calculator className="w-5 h-5" />,
  reports: <BarChart3 className="w-5 h-5" />,
  settings: <Settings className="w-5 h-5" />,
  emergency: <ShieldAlert className="w-5 h-5" />,
  approvals: <ClipboardCheck className="w-5 h-5" />,
};

export const NAV_LABELS: Record<ViewId, string> = {
  home: "الرئيسية",
  scan: "الحضور",
  payments: "الدفع",
  students: "الطلاب",
  schedule: "الجداول",
  groups: "المجموعات",
  quizzes: "الكويزات",
  exams: "الامتحانات",
  assignments: "الواجبات",
  books: "الكتب",
  messages: "الرسائل",
  accounting: "الحسابات",
  reports: "التقارير",
  settings: "الإعدادات",
  emergency: "الطوارئ",
  approvals: "الموافقات",
};

const RECEPTION_NAV: ViewId[] = ["home", "scan", "payments", "students", "schedule", "books", "messages"];
const MANAGER_NAV: ViewId[] = ["home", "scan", "payments", "students", "approvals", "groups", "quizzes", "exams", "assignments", "schedule", "books", "messages", "accounting", "reports", "emergency", "settings"];
// مدرس بحساب موظف — امتحانات/كويزات/واجبات بس، من غير فلوس ولا طلاب ولا إعدادات
const TEACHER_NAV: ViewId[] = ["home", "quizzes", "exams", "assignments", "schedule"];

export function CenterShell({
  user,
  onLogout,
  children,
  view,
  setView,
}: {
  user: SessionUser;
  onLogout: () => void;
  children: ReactNode;
  view: ViewId;
  setView: (v: ViewId) => void;
}) {
  const nav = user.role === "MANAGER" ? MANAGER_NAV : user.role === "TEACHER" ? TEACHER_NAV : RECEPTION_NAV;
  const center = user.center!;
  const [moreOpen, setMoreOpen] = useState(false);

  // ===== الجولة التعليمية — أول دخول بس، وترجع من زرار المساعدة =====
  const [tourOpen, setTourOpen] = useState(false);
  const tourKey = `nk-tour-center-${user.id}`;
  useEffect(() => {
    const t = setTimeout(() => {
      // تحت الأتمتة (اختبارات Playwright) مفيش جولة تلقائية — بتوقف التفاعل
      const automated = typeof navigator !== "undefined" && (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
      try { if (!localStorage.getItem(tourKey) && !automated) setTourOpen(true); } catch { /* ignore */ }
    }, 700);
    return () => clearTimeout(t);
  }, [tourKey]);
  useEffect(() => {
    const onStart = () => setTourOpen(true);
    window.addEventListener("nk-start-tour", onStart);
    return () => window.removeEventListener("nk-start-tour", onStart);
  }, []);
  const finishTour = () => {
    setTourOpen(false);
    try { localStorage.setItem(tourKey, "1"); } catch { /* ignore */ }
  };

  useEffect(() => {
    applyCenterBranding(center);
  }, [center]);

  const initials = useMemo(() => user.name.split(" ").slice(0, 2).map((w) => w[0]).join(""), [user.name]);

  // ===== بانر دخول الدعم الفني — الأدمن متصرف باسم المستخدم =====
  const support = user.support ?? null;
  const [, setSupportTick] = useState(0);
  useEffect(() => {
    if (!support) return;
    const t = setInterval(() => setSupportTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [support]);
  const supportMinutesLeft = support
    ? Math.max(0, Math.ceil((new Date(support.expiresAt).getTime() - Date.now()) / 60000))
    : null;

  async function exitSupport() {
    try {
      await api("/api/auth", { method: "POST", body: { action: "support-exit" } });
      toast.success("رجعت لحسابك — انتهت جلسة الدعم.");
    } catch { /* toast */ }
    window.location.reload();
  }

  // ===== إعلان أول استخدام — «النظام بقى أسهل» (يتقفل بالـ X وبيقفل للأبد) =====
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    // deferred بعد الـ mount — مفيش محتوى في الـ HTML السيرفري → مفيش hydration mismatch
    const t = setTimeout(() => {
      try {
        if (!localStorage.getItem("nk-seen-restructure-v1")) setShowWelcome(true);
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  function dismissWelcome() {
    setShowWelcome(false);
    try { localStorage.setItem("nk-seen-restructure-v1", "1"); } catch { /* ignore */ }
  }

  // ===== شريط الحالة المصغّر: 🟢 N حصص شغالة =====
  const [activeLessons, setActiveLessons] = useState<{ id: string; label: string }[]>([]);
  const loadActive = useCallback(() => {
    api<{ sessions: { id: string; status: string; subject: string; grade: string; groupName: string }[] }>("/api/sessions", { silent: true })
      .then((d) => {
        setActiveLessons(
          d.sessions
            .filter((s) => s.status === "OPEN")
            .map((s) => ({ id: s.id, label: `${s.subject} — ${s.grade} ${s.groupName}` })),
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadActive();
    const t = setInterval(loadActive, 25000);
    const onFocus = () => loadActive();
    window.addEventListener("focus", onFocus);
    // أي فتح/قفل حصة → حدّث الشريط فورًا (مفيش انتظار للبول التالي)
    window.addEventListener("nk-sessions-changed", loadActive);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("nk-sessions-changed", loadActive);
    };
  }, [loadActive]);

  function openActiveLesson() {
    if (activeLessons.length === 1) {
      window.dispatchEvent(new CustomEvent("nk-open-session", { detail: { id: activeLessons[0].id } }));
    } else {
      setView("scan");
    }
  }

  async function logout() {
    try { await api("/api/auth", { method: "DELETE" }); } catch { /* ignore */ }
    toast.success("تم تسجيل الخروج — سلام!");
    onLogout();
  }

  const NavButton = ({ v, compact }: { v: ViewId; compact?: boolean }) => (
    <button
      data-tour={`nav-${v}`}
      onClick={() => { setView(v); setMoreOpen(false); }}
      className={cn(
        "flex items-center gap-3 rounded-xl font-bold transition w-full",
        compact ? "px-3 py-2.5 text-sm" : "px-4 py-3 text-[15px]",
        view === v
          ? "nk-brand-grad text-white shadow-md"
          : "text-foreground/80 hover:bg-muted"
      )}
    >
      {NAV_ICONS[v]}
      <span>{NAV_LABELS[v]}</span>
      {/* مؤشر التب النشط — إسفين البوابة الذهبية (هندسة اللوجو) */}
      {view === v && <span className="ms-auto w-2.5 h-3.5 nk-portal-mark" aria-hidden />}
    </button>
  );

  const mobileBar = nav.slice(0, 4);
  const mobileMore = nav.slice(4);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ===== بانر الدعم الفني — فوق كل حاجة، واضح ومستمر ===== */}
      {support && (
        <div className="sticky top-0 z-[50] w-full bg-sky-700 text-white print:hidden" role="alert">
          <div className="mx-auto max-w-7xl px-3 md:px-6 h-auto py-2 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 font-extrabold text-xs shrink-0">
              <LifeBuoy className="w-4 h-4" /> دخول دعم فني
            </span>
            <span className="text-xs font-bold opacity-90 truncate">
              بتتصرف باسم: <b>{support.targetName}</b> · بواسطة {support.byAdminName}
              {support.reason && <span className="opacity-80"> · السبب: {support.reason}</span>}
            </span>
            {supportMinutesLeft !== null && (
              <span className={cn("text-[11px] font-extrabold rounded-full px-2 py-0.5 shrink-0",
                supportMinutesLeft <= 5 ? "bg-rose-500/90" : "bg-white/20")}>
                {supportMinutesLeft} دقيقة متفاضلة
              </span>
            )}
            <button
              onClick={exitSupport}
              className="ms-auto shrink-0 rounded-lg bg-card text-sky-700 font-extrabold text-xs px-3.5 py-1.5 hover:bg-sky-50 active:scale-[0.98] transition"
            >
              خروج من الدعم
            </button>
          </div>
        </div>
      )}

      {/* ===== إعلان أول استخدام — إزالة واحدة وخلاص ===== */}
      {showWelcome && !support && (
        <div className="relative nk-brand-bg-soft border-b nk-brand-border print:hidden">
          <div className="mx-auto max-w-7xl px-3 md:px-6 py-4 flex items-start gap-3">
            <span className="relative w-10 h-10 rounded-xl nk-brand-grad text-white grid place-items-center shrink-0">
              <Sparkles className="w-5 h-5" />
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 nk-portal-mark" aria-hidden />
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="font-extrabold text-sm nk-brand-text">النخبة سنترز بقت أسهل</h2>
              <ul className="text-[11px] font-bold text-muted-foreground mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 leading-relaxed">
                <li>• حصص اليوم كلها في مكان واحد على الرئيسية</li>
                <li>• تسجيل حضور ودفع أسرع من المسح والبحث</li>
                <li>• الحصة ليها حالة واضحة: شغالة / مقفولة</li>
                <li>• الحسابات والتقارير أوضح وأسهل</li>
              </ul>
            </div>
            <button onClick={dismissWelcome} aria-label="إغلاق الإعلان"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ===== Top bar ===== */}
      <header className="nk-glass-bar sticky top-0 z-40 print:hidden nk-safe-top">
        <div className="mx-auto max-w-7xl px-3 md:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {center.logo ? (
              <img src={center.logo} alt={center.name} className="w-10 h-10 rounded-xl object-cover border border-border bg-card" />
            ) : (
              /* لوجو النظام الأساسي — أعلى يمين الشاشة */
              <span className="w-10 h-10 rounded-xl bg-card border border-border grid place-items-center shrink-0 overflow-hidden" aria-hidden>
                <img src="/logo.png" alt="" className="w-full h-full object-contain p-[6%]" draggable={false} />
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <h1 className="font-extrabold text-[15px] md:text-base truncate nk-brand-text">{center.name}</h1>
              <p className="text-[10px] md:text-[11px] text-muted-foreground font-bold tracking-wide">
                {user.role === "MANAGER" ? "بورتال المدير" : "شاشة الاستقبال"} · نخبة سنترز
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-bold">
              <span className="w-7 h-7 rounded-full nk-brand-grad text-white grid place-items-center text-[11px]">{initials}</span>
              {user.name}
            </span>
            <UndoRedoButtons />
            <StaffNotificationsBell variant="center" />
            <ThemeToggle />
            <Button
              variant="outline"
              size="icon"
              onClick={logout}
              aria-label="تسجيل الخروج"
              className="rounded-xl h-10 w-10 border-border bg-card"
            >
              <LogOut className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>
        {/* خط شعري كحلي-ذهبي — لحظة براند تحت الهيدر */}
        <div className="nk-brand-hairline" aria-hidden />
      </header>

      <div className="mx-auto max-w-7xl w-full flex-1 flex gap-6 px-3 md:px-6 py-4 md:py-6">
        {/* ===== Desktop sidebar ===== */}
        <aside className="hidden lg:flex flex-col gap-2 w-60 shrink-0 sticky top-24 self-start print:hidden">
          {nav.map((v) => <NavButton key={v} v={v} />)}
          {/* شريط الحالة المصغّر — كم حصة شغالة دلوقتي */}
          {activeLessons.length > 0 && (
            <button
              onClick={openActiveLesson}
              className="mt-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2.5 text-start flex items-center gap-2 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition"
            >
              <span className="relative flex w-2.5 h-2.5 shrink-0">
                <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 animate-ping" />
                <span className="relative inline-flex w-full h-full rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                {activeLessons.length === 1 ? activeLessons[0].label.length > 22 ? "حصة شغالة" : `${activeLessons[0].label} — شغالة` : `${activeLessons.length} حصص شغالة`}
              </span>
            </button>
          )}
          <div className="mt-4 rounded-2xl border border-dashed border-border p-4 text-center nk-brand-bg-soft">
            <AlNokhbaMark size={30} showText={false} />
            <p className="text-[10px] text-muted-foreground font-bold mt-2 leading-relaxed">
              القوى التقنية لمنظومة النخبة
            </p>
          </div>
        </aside>

        {/* ===== Main content ===== */}
        <main className="flex-1 min-w-0 pb-24 lg:pb-6">{children}</main>
      </div>

      {/* ===== شريط الحالة المصغّر على الموبايل — فوق الناف ===== */}
      {activeLessons.length > 0 && (
        <button
          onClick={openActiveLesson}
          className="lg:hidden fixed bottom-[76px] inset-x-0 z-30 mx-auto w-fit rounded-full bg-emerald-700 text-white px-4 py-2 shadow-lg flex items-center gap-2 active:scale-[0.97] transition"
          style={{ marginBottom: "max(env(safe-area-inset-bottom), 4px)" }}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-white/90 animate-pulse shrink-0" />
          <span className="text-xs font-extrabold">
            {activeLessons.length === 1
              ? `${activeLessons[0].label.split(" — ")[0]} — الحصة شغالة`
              : `${activeLessons.length} حصص شغالة`}
          </span>
        </button>
      )}

      {/* ===== زكي — المساعد الذكي (قواعد حتمية، مش AI) ===== */}
      <ZakiAssistant />

      {/* ===== Mobile bottom nav ===== */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 nk-glass-bar border-t print:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 4px)" }} aria-label="التنقل الرئيسي">
        <div className="grid grid-cols-5 h-16">
          {mobileBar.map((v) => (
            <button
              key={v}
              data-tour={`nav-${v}`}
              onClick={() => setView(v)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition",
                view === v ? "nk-brand-text" : "text-muted-foreground"
              )}
            >
              <span key={view === v ? `${v}-on` : `${v}-off`} className={cn("grid place-items-center", view === v && "nk-anim-tab")}>
                {NAV_ICONS[v]}
              </span>
              <span>{NAV_LABELS[v]}</span>
            </button>
          ))}
          {mobileMore.length > 0 ? (
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger className={cn(
                "flex flex-col items-center justify-center gap-1 text-[10px] font-bold",
                mobileMore.includes(view) ? "nk-brand-text" : "text-muted-foreground"
              )}>
                <MoreHorizontal className="w-5 h-5" />
                <span>المزيد</span>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-3xl px-4 pb-8 pt-3">
                <SheetTitle className="text-start mb-2">القايمة</SheetTitle>
                <div className="grid gap-2">
                  {mobileMore.map((v) => <NavButton key={v} v={v} compact />)}
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <button
              onClick={logout}
              className="flex flex-col items-center justify-center gap-1 text-[10px] font-bold text-muted-foreground"
            >
              <LogOut className="w-5 h-5" />
              <span>خروج</span>
            </button>
          )}
        </div>
      </nav>

      {/* ===== الجولة التعليمية + زرار المساعدة (كل الشاشات) ===== */}
      <Tour
        steps={user.role === "MANAGER" ? CENTER_TOUR : RECEPTION_TOUR}
        open={tourOpen}
        onClose={finishTour}
        onFinish={finishTour}
        onNavigate={(v) => setView(v as ViewId)}
      />
      <HelpButton view={view} viewLabel={NAV_LABELS[view]} />
    </div>
  );
}

// ============================= Admin shell =============================

export type AdminViewId = "centers" | "subscriptions" | "analytics" | "students" | "billing" | "system" | "monitor" | "teams" | "backups" | "requests";

export const ADMIN_NAV: { id: AdminViewId; label: string; icon: ReactNode }[] = [
  { id: "centers", label: "السناتر", icon: <Building2 className="w-5 h-5" /> },
  { id: "analytics", label: "تحليلات المنصة", icon: <Activity className="w-5 h-5" /> },
  { id: "requests", label: "طلبات الانضمام", icon: <UserPlus className="w-5 h-5" /> },
  { id: "subscriptions", label: "الاشتراكات", icon: <BadgeCheck className="w-5 h-5" /> },
  { id: "students", label: "الطلاب", icon: <GraduationCap className="w-5 h-5" /> },
  { id: "billing", label: "الفوترة", icon: <Receipt className="w-5 h-5" /> },
  { id: "teams", label: "الفرق", icon: <UserCog className="w-5 h-5" /> },
  { id: "backups", label: "النسخ الاحتياطية", icon: <DatabaseBackup className="w-5 h-5" /> },
  { id: "system", label: "النظام", icon: <MonitorCog className="w-5 h-5" /> },
  { id: "monitor", label: "المراقبة", icon: <Activity className="w-5 h-5" /> },
];

export function AdminShell({
  user, onLogout, children, view, setView,
}: {
  user: SessionUser;
  onLogout: () => void;
  children: ReactNode;
  view: AdminViewId;
  setView: (v: AdminViewId) => void;
}) {
  useEffect(() => {
    applyCenterBranding(null); // platform identity = AlNokhba navy/gold الرسمي
  }, []);

  // ===== الجولة التعليمية للأدمن =====
  const [tourOpen, setTourOpen] = useState(false);
  const tourKey = `nk-tour-admin-${user.id}`;
  useEffect(() => {
    const t = setTimeout(() => {
      // تحت الأتمتة (اختبارات Playwright) مفيش جولة تلقائية — بتوقف التفاعل
      const automated = typeof navigator !== "undefined" && (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
      try { if (!localStorage.getItem(tourKey) && !automated) setTourOpen(true); } catch { /* ignore */ }
    }, 700);
    return () => clearTimeout(t);
  }, [tourKey]);
  useEffect(() => {
    const onStart = () => setTourOpen(true);
    window.addEventListener("nk-start-tour", onStart);
    return () => window.removeEventListener("nk-start-tour", onStart);
  }, []);
  const finishTour = () => {
    setTourOpen(false);
    try { localStorage.setItem(tourKey, "1"); } catch { /* ignore */ }
  };

  async function logout() {
    try { await api("/api/auth", { method: "DELETE" }); } catch { /* ignore */ }
    onLogout();
  }

  // إشعار «طلب انضمام» → افتح تاب طلبات الانضمام على طول
  useEffect(() => {
    const onNavAdmin = (e: Event) => {
      const detail = (e as CustomEvent<{ view: AdminViewId }>).detail;
      if (detail?.view) setView(detail.view);
    };
    window.addEventListener("nk-navigate-admin", onNavAdmin);
    return () => window.removeEventListener("nk-navigate-admin", onNavAdmin);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="nk-glass-bar sticky top-0 z-40 print:hidden nk-safe-top">
        <div className="mx-auto max-w-7xl px-3 md:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlNokhbaMark size={40} />
            <div className="leading-tight hidden sm:block">
              <h1 className="font-extrabold text-[15px] md:text-base">منصة النخبة — إدارة السنترز</h1>
              <p className="text-[10px] md:text-[11px] text-muted-foreground font-bold">Admin Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-bold">
              <span className="w-7 h-7 rounded-full nk-brand-grad text-white grid place-items-center text-[11px]">أد</span>
              {user.name}
            </span>
            <StaffNotificationsBell variant="admin" />
            <Button variant="outline" size="icon" onClick={logout} aria-label="تسجيل الخروج" className="rounded-xl h-10 w-10 bg-card">
              <LogOut className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>
        <div className="nk-brand-hairline" aria-hidden />
      </header>

      <div className="mx-auto max-w-7xl w-full flex-1 flex gap-6 px-3 md:px-6 py-4 md:py-6">
        <aside className="hidden lg:flex flex-col gap-1.5 w-56 shrink-0 sticky top-24 self-start print:hidden">
          {ADMIN_NAV.map((n) => (
            <button
              key={n.id}
              data-tour={`nav-${n.id}`}
              onClick={() => setView(n.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold transition w-full",
                view === n.id ? "nk-brand-grad text-white shadow-md" : "text-foreground/80 hover:bg-muted"
              )}
            >
              {n.icon}
              <span>{n.label}</span>
              {view === n.id ? (
                <span className="ms-auto w-2.5 h-3.5 nk-portal-mark" aria-hidden />
              ) : (
                <ChevronLeft className="w-4 h-4 ms-auto text-muted-foreground/50" />
              )}
            </button>
          ))}
        </aside>

        <main className="flex-1 min-w-0 pb-24 lg:pb-6">
          {/* mobile admin tabs */}
          <div className="lg:hidden flex gap-2 overflow-x-auto nk-scroll pb-3 -mx-1 px-1 mb-2">
            {ADMIN_NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold whitespace-nowrap transition",
                  view === n.id ? "nk-brand-grad text-white border-transparent" : "bg-card border-border text-muted-foreground"
                )}
              >
                <span className="scale-90">{n.icon}</span>
                {n.label}
              </button>
            ))}
          </div>
          {children}
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 nk-glass-bar border-t print:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 4px)" }} aria-label="التنقل">
        <div className="grid grid-cols-5 h-16">
          {ADMIN_NAV.slice(0, 4).map((n) => (
            <button key={n.id} onClick={() => setView(n.id)}
              className={cn("flex flex-col items-center justify-center gap-1 text-[10px] font-bold", view === n.id ? "nk-brand-text" : "text-muted-foreground")}>
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
          <Sheet>
            <SheetTrigger className="flex flex-col items-center justify-center gap-1 text-[10px] font-bold text-muted-foreground">
              <Menu className="w-5 h-5" />
              <span>المزيد</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-3xl px-4 pb-8 pt-3">
              <SheetTitle className="text-start mb-2">القايمة</SheetTitle>
              <div className="grid gap-2">
                {ADMIN_NAV.slice(4).map((n) => (
                  <button key={n.id} data-tour={`nav-${n.id}`} onClick={() => setView(n.id)}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold bg-muted/60">
                    {n.icon}
                    {n.label}
                  </button>
                ))}
                <button onClick={logout} className="flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-bold text-rose-600 bg-rose-50">
                  <LogOut className="w-5 h-5" /> تسجيل خروج
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      {/* الجولة + المساعدة */}
      <Tour steps={ADMIN_TOUR} open={tourOpen} onClose={finishTour} onFinish={finishTour} onNavigate={(v) => setView(v as AdminViewId)} />
      <HelpButton view={`admin-${view}`} viewLabel={`أدمن — ${ADMIN_NAV.find((n) => n.id === view)?.label ?? view}`} />
    </div>
  );
}
