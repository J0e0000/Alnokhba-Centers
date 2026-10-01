"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Home, CalendarDays, Users, Wallet, LogOut, LogIn, UserRound, Smartphone,
  Clock, MapPin, GraduationCap, BadgeCheck, Loader2, RefreshCw, Banknote,
  ArrowDownLeft, ArrowUpRight, KeyRound, FileCheck2, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeDigits, formatTime12, formatDateAR } from "@/lib/normalize";
import { AlNokhbaMark } from "../shared";
import { Tour } from "../tour";
import { HelpButton } from "../help";
import { TEACHER_TOUR } from "../help-content";
import { TeacherExams, TeacherAssignments } from "./teaching";

// ============================= API =============================

async function tapi<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; silent?: boolean } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? "حصلت مشكلة مؤقتة — جرب مرة تانية.";
    if (!opts.silent) toast.error(msg);
    throw new Error(msg);
  }
  return data as T;
}

// ============================= Types =============================

type CenterInfo = {
  id: string; name: string; logo: string | null; slug: string;
  primaryColor: string; secondaryColor: string; accentColor: string | null;
  phone: string | null; whatsapp: string | null; slogan: string | null;
};

type TodaySession = {
  id: string;
  subject: string; groupName: string; gradeName: string;
  startTime: string; endTime: string; room: string | null;
  status: string;
  attendanceCount: number;
};

type NextLesson = {
  date: string; dayName: string; startTime: string; endTime: string;
  subject: string; groupName: string; room: string | null;
};

type HomeData = {
  teacher: { id: string; name: string; center: CenterInfo } | null;
  today: string;
  todaySessions: TodaySession[];
  todayScheduled: { subject: string; groupName: string; gradeName: string; startTime: string; endTime: string; room: string | null }[];
  nextLesson: NextLesson | null;
  stats: { groups: number; students: number; balance: number; thisMonthEarned: number; totalEarned: number };
};

type ScheduleData = {
  teacher: { name: string; center: CenterInfo } | null;
  today: string;
  week: {
    dow: number; dayName: string; isToday: boolean;
    lessons: {
      subject: string; groupName: string; gradeName: string;
      room: string | null; startTime: string; endTime: string; isPast: boolean; isNow: boolean;
    }[];
  }[];
  subjects: string[];
  empty: boolean;
};

type MoneyData = {
  teacher: { name: string; center: CenterInfo } | null;
  today: string;
  stats: { balance: number; totalEarned: number; totalPaid: number; thisMonthEarned: number };
  settlements: {
    id: string; type: string; amount: number; date: string; note: string | null;
    sessionDate: string | null; sessionTime: string | null;
  }[];
  groups: { id: string; name: string; subject: string; price: number; teacherPercent: number }[];
};

type StudentsData = {
  teacher: { name: string; center: CenterInfo } | null;
  groups: {
    id: string; name: string; subject: string; gradeName: string; room: string | null;
    students: { id: string; name: string; code: string }[];
  }[];
};

type TabId = "home" | "schedule" | "students" | "money" | "exams" | "assignments";

// ============================= Helpers =============================

/** المبالغ من الداتابيز بالقروش (100 قرش = جنيه) — بنحوّلها جنيه للعرض */
function fmtEgp(piastres: number): string {
  const egp = Math.round(piastres) / 100;
  return egp.toLocaleString("en-EG", { maximumFractionDigits: 2 });
}

// ============================= App =============================

export function TeacherPortalApp() {
  const [boot, setBoot] = useState<"loading" | "login" | "app">("loading");
  const [home, setHome] = useState<HomeData | null>(null);
  const [tab, setTab] = useState<TabId>("home");
  const [refreshing, setRefreshing] = useState(false);

  // ===== الجولة التعليمية (أول دخول + إعادة من زرار المساعدة) =====
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    const onStart = () => setTourOpen(true);
    window.addEventListener("nk-start-tour", onStart);
    return () => window.removeEventListener("nk-start-tour", onStart);
  }, []);
  const finishTour = () => {
    setTourOpen(false);
    try { localStorage.setItem(`nk-tour-teacher-${home?.teacher?.id ?? "x"}`, "1"); } catch { /* ignore */ }
  };

  const refreshHome = useCallback(async () => {
    try {
      const d = await tapi<HomeData>("/api/teacher-portal", { silent: true });
      setHome(d);
      setBoot(d.teacher ? "app" : "login");
      // أول دخول للمدرس ده → افتح الجولة بعد ما الشاشة تهدى
      if (d.teacher) {
        try {
          if (!localStorage.getItem(`nk-tour-teacher-${d.teacher.id}`)) setTimeout(() => setTourOpen(true), 800);
        } catch { /* ignore */ }
      }
    } catch {
      setBoot("login");
    }
  }, []);

  useEffect(() => { void refreshHome(); }, [refreshHome]);

  if (boot === "loading") {
    return (
      <main className="min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <AlNokhbaMark size={52} />
          <span className="w-7 h-7 rounded-full border-[3px] border-[var(--c-primary)] border-t-transparent animate-spin" />
        </div>
      </main>
    );
  }

  if (boot === "login" || !home?.teacher) {
    return <TeacherLogin onSuccess={() => { setBoot("loading"); void refreshHome(); }} />;
  }

  const t = home.teacher;

  async function logout() {
    try { await tapi("/api/teacher-portal", { method: "POST", body: { action: "logout" }, silent: true }); } catch { /* ignore */ }
    window.location.href = "/teacher";
  }

  async function doRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { await refreshHome(); toast.success("تم التحديث."); } finally { setRefreshing(false); }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background nk-safe-top">
      {/* ===== header ===== */}
      <header className="nk-glass-bar sticky top-0 z-40">
        <div className="mx-auto max-w-lg px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {t.center.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.center.logo} alt={t.center.name} className="w-9 h-9 rounded-xl object-cover border border-border bg-card" />
            ) : (
              <span className="w-9 h-9 rounded-xl bg-card border border-border grid place-items-center shrink-0 overflow-hidden" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" className="w-full h-full object-contain p-[6%]" draggable={false} />
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <h1 className="font-extrabold text-sm truncate">{t.center.name}</h1>
              <p className="text-[10px] text-muted-foreground font-bold">بورتال المدرس</p>
            </div>
          </div>
          <button
            onClick={logout}
            aria-label="تسجيل الخروج"
            className="rounded-xl h-9 w-9 border border-border bg-card grid place-items-center text-muted-foreground"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ===== content ===== */}
      <main className="flex-1 w-full mx-auto max-w-lg px-4 py-4 pb-28">
        <div key={tab} className="nk-anim-view">
          {tab === "home" && <TeacherHome data={home} onRefresh={doRefresh} refreshing={refreshing} />}
          {tab === "schedule" && <TeacherSchedule />}
          {tab === "students" && <TeacherStudents />}
          {tab === "money" && <TeacherMoney />}
          {tab === "exams" && <TeacherExams />}
          {tab === "assignments" && <TeacherAssignments />}
        </div>
      </main>

      {/* ===== bottom nav — 6 تابات: الرئيسية / امتحانات / واجبات / جدولي / طلابي / فلوسي ===== */}
      <nav className="fixed bottom-0 inset-x-0 z-40 nk-portal-nav border-t" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 4px)" }} aria-label="تنقل المدرس">
        <div className="mx-auto max-w-lg grid grid-cols-6 h-16">
          {([
            { id: "home", label: "الرئيسية", icon: <Home className="w-5 h-5" /> },
            { id: "exams", label: "امتحانات", icon: <FileCheck2 className="w-5 h-5" /> },
            { id: "assignments", label: "واجبات", icon: <ClipboardList className="w-5 h-5" /> },
            { id: "schedule", label: "جدولي", icon: <CalendarDays className="w-5 h-5" /> },
            { id: "students", label: "طلابي", icon: <Users className="w-5 h-5" /> },
            { id: "money", label: "فلوسي", icon: <Wallet className="w-5 h-5" /> },
          ] as { id: TabId; label: string; icon: React.ReactNode }[]
          ).map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition",
                tab === n.id ? "nk-brand-text" : "text-muted-foreground",
              )}
            >
              <span key={tab === n.id ? `${n.id}-on` : `${n.id}-off`} className={cn("grid place-items-center", tab === n.id && "nk-anim-tab")}>
                {n.icon}
              </span>
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ============================= Login =============================

function TeacherLogin({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const c = normalizeDigits(code).replace(/\D/g, "");
    const p = normalizeDigits(phone).replace(/\D/g, "");
    if (c.length !== 4) {
      toast.error("اكتب كود المدرس — 4 أرقام (من إدارة السنتر).");
      return;
    }
    if (p.length < 10) {
      toast.error("اكتب رقم الموبايل المتسجّل عند السنتر.");
      return;
    }
    setBusy(true);
    try {
      await tapi("/api/teacher-portal", { method: "POST", body: { action: "login", code: c, phone: p } });
      onSuccess();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden nk-safe-top">
      <div aria-hidden className="pointer-events-none absolute -top-24 -start-24 w-96 h-96 rounded-full opacity-[0.16] nk-brand-bg blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -end-24 w-[28rem] h-[28rem] rounded-full opacity-[0.12] nk-brand-bg blur-3xl" />

      <div className="w-full max-w-sm z-10">
        <div className="flex flex-col items-center gap-3 mb-6 text-center">
          <AlNokhbaMark size={56} />
          <div>
            <h1 className="text-2xl font-extrabold mt-1">بورتال المدرس</h1>
            <p className="text-sm text-muted-foreground mt-1">موبايلك + كودك — وبيتفتح على طول</p>
          </div>
        </div>

        <form onSubmit={submit} className="nk-glass rounded-3xl p-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="tphone" className="text-sm font-bold flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-muted-foreground" /> رقم الموبايل
            </label>
            <input
              id="tphone"
              dir="ltr"
              inputMode="numeric"
              className="flex h-12 w-full rounded-xl border border-input bg-card px-4 text-start font-semibold nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="01xxxxxxxxx"
              value={phone}
              autoComplete="off"
              onChange={(e) => setPhone(normalizeDigits(e.target.value).replace(/\D/g, "").slice(0, 13))}
              disabled={busy}
              autoFocus
            />
            <p className="text-[10px] font-bold text-muted-foreground">رقم الموبايل المتسجّل عند السنتر.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tcode" className="text-sm font-bold flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-muted-foreground" /> كود المدرس
            </label>
            <input
              id="tcode"
              dir="ltr"
              inputMode="numeric"
              maxLength={4}
              className="flex h-12 w-full rounded-xl border border-input bg-card px-4 text-center text-lg font-extrabold tracking-[0.3em] nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="0000"
              value={code}
              autoComplete="off"
              onChange={(e) => setCode(normalizeDigits(e.target.value).replace(/\D/g, "").slice(0, 4))}
              disabled={busy}
            />
            <p className="text-[10px] font-bold text-muted-foreground">4 أرقام — الإدارة بتديهولك.</p>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="nk-btn-brand w-full h-12 rounded-xl font-extrabold text-base flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <LogIn className="w-5 h-5" />}
            {busy ? "جاري الدخول..." : "دخول"}
          </button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground mt-5 flex items-center justify-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5" /> جوا بتشوف جدولك وطلابك ومستحقاتك
        </p>
      </div>
    </main>
  );
}

// ============================= Home =============================

function TeacherHome({ data, onRefresh, refreshing }: { data: HomeData; onRefresh: () => void; refreshing: boolean }) {
  const t = data.teacher!;
  const first = t.name.replace(/^أ\.\s*/, "").split(" ")[0];
  const st = data.stats;
  const nl = data.nextLesson;
  const bal = Math.round(st.balance); // قروش

  return (
    <div className="space-y-4 nk-anim-stagger">
      {/* greeting */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-2xl font-extrabold">أهلاً يا <span className="nk-brand-text">{first}</span> 👋</h2>
          <p className="text-sm text-muted-foreground font-bold mt-0.5">بورتال المدرس — {t.center.name}</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="تحديث"
          className="shrink-0 w-10 h-10 rounded-xl grid place-items-center border border-border bg-white/80 text-muted-foreground hover:text-foreground transition active:scale-90 disabled:opacity-60"
        >
          <RefreshCw className={cn("w-4.5 h-4.5", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* المستحقات */}
      <section className={cn(
        "rounded-2xl border p-4 flex items-center gap-3",
        bal > 0 ? "bg-emerald-50/70 border-emerald-200" :
        bal < 0 ? "bg-orange-50/70 border-orange-200" :
        "nk-card",
      )}>
        <span className={cn(
          "w-11 h-11 rounded-xl grid place-items-center shrink-0",
          bal > 0 ? "bg-emerald-100 text-emerald-700" :
          bal < 0 ? "bg-orange-100 text-orange-700" :
          "bg-muted text-muted-foreground",
        )}>
          <Banknote className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-extrabold text-muted-foreground">
            {bal > 0 ? "مستحق ليك عند السنتر" : bal < 0 ? "دفعات زيادة ليك" : "حسابك متوازن"}
          </h3>
          <p className={cn(
            "nk-num font-extrabold text-xl mt-0.5",
            bal > 0 ? "text-emerald-700" : bal < 0 ? "text-orange-600" : "text-foreground",
          )}>
            {bal > 0 ? `${fmtEgp(bal)} ج` : bal < 0 ? `${fmtEgp(Math.abs(bal))} ج` : "0 ج"}
            <span className="text-[10px] font-bold ms-2 align-middle text-muted-foreground">
              من نصيبك في الحصص المقفولة
            </span>
          </p>
          <p className="text-[10px] font-bold text-muted-foreground mt-1">
            الشهر ده كسبت {fmtEgp(st.thisMonthEarned)} ج
          </p>
        </div>
      </section>

      {/* stats */}
      <section className="grid grid-cols-2 gap-3">
        <div className="nk-card rounded-2xl p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <GraduationCap className="w-4 h-4" />
            <span className="text-[11px] font-extrabold">مجموعاتي</span>
          </div>
          <p className="nk-num font-extrabold text-xl">{st.groups}</p>
        </div>
        <div className="nk-card rounded-2xl p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Users className="w-4 h-4" />
            <span className="text-[11px] font-extrabold">طلابي</span>
          </div>
          <p className="nk-num font-extrabold text-xl">{st.students}</p>
        </div>
      </section>

      {/* أقرب حصة */}
      {nl && (
        <section className="nk-card nk-anim-lift rounded-2xl p-4">
          <h3 className="text-xs font-extrabold text-muted-foreground mb-2">أقرب حصة</h3>
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold text-lg">{nl.subject} — {nl.groupName}</span>
            <span className="text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-muted text-muted-foreground">
              {nl.dayName}
            </span>
          </div>
          <p className="text-sm text-muted-foreground font-bold mt-1 flex items-center gap-1.5 flex-wrap">
            <Clock className="w-3.5 h-3.5" />
            {formatDateAR(nl.date)} · {formatTime12(nl.startTime)} — {formatTime12(nl.endTime)}
            {nl.room && (
              <>
                <MapPin className="w-3.5 h-3.5 ms-1" />
                {nl.room}
              </>
            )}
          </p>
        </section>
      )}

      {/* حصص النهاردة */}
      <section className="space-y-2">
        <h3 className="text-xs font-extrabold text-muted-foreground px-1">حصص النهاردة</h3>
        {data.todaySessions.length === 0 && data.todayScheduled.length === 0 ? (
          <div className="nk-card rounded-2xl p-6 text-center">
            <p className="text-sm font-bold text-muted-foreground">مفيش حصص النهاردة — استمتع بيومك 🌤️</p>
          </div>
        ) : (
          <>
            {data.todaySessions.map((s) => (
              <div key={s.id} className="nk-card rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold">{s.subject} — {s.groupName}</span>
                  {s.status === "OPEN" ? (
                    <span className="text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200">
                      شغالة دلوقتي
                    </span>
                  ) : s.status === "CLOSED" ? (
                    <span className="text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-muted text-muted-foreground flex items-center gap-1">
                      <BadgeCheck className="w-3.5 h-3.5" /> خلصت
                    </span>
                  ) : (
                    <span className="text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200">
                      ملغاة
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-bold mt-1 flex items-center gap-1.5 flex-wrap">
                  <Clock className="w-3.5 h-3.5" />
                  {formatTime12(s.startTime)} — {formatTime12(s.endTime)}
                  {s.room && (
                    <>
                      <MapPin className="w-3.5 h-3.5 ms-1" />
                      {s.room}
                    </>
                  )}
                  {s.gradeName && <span className="text-[10px] bg-muted rounded-full px-2 py-0.5">{s.gradeName}</span>}
                </p>
                {s.status === "CLOSED" && (
                  <p className="text-xs font-bold text-emerald-700 mt-1.5">
                    حضر {s.attendanceCount} طالب
                  </p>
                )}
              </div>
            ))}
            {data.todayScheduled.map((s, i) => (
              <div key={`sch-${i}`} className="nk-card rounded-2xl p-4 border-dashed">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold">{s.subject} — {s.groupName}</span>
                  <span className="text-[11px] font-extrabold rounded-full px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200">
                    مجدولة
                  </span>
                </div>
                <p className="text-sm text-muted-foreground font-bold mt-1 flex items-center gap-1.5 flex-wrap">
                  <Clock className="w-3.5 h-3.5" />
                  {formatTime12(s.startTime)} — {formatTime12(s.endTime)}
                  {s.room && (
                    <>
                      <MapPin className="w-3.5 h-3.5 ms-1" />
                      {s.room}
                    </>
                  )}
                  {s.gradeName && <span className="text-[10px] bg-muted rounded-full px-2 py-0.5">{s.gradeName}</span>}
                </p>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

// ============================= Schedule =============================

function TeacherSchedule() {
  const [data, setData] = useState<ScheduleData | null>(null);

  useEffect(() => {
    tapi<ScheduleData>("/api/teacher-portal/schedule", { silent: true }).then(setData).catch(() => {});
  }, []);

  if (!data || !data.teacher) return <LoadingBlock />;
  if (data.empty) {
    return (
      <div className="nk-card rounded-2xl p-8 text-center">
        <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-extrabold">مفيش جدول لسه</p>
        <p className="text-sm text-muted-foreground font-bold mt-1">لما الإدارة تضيف مجموعاتك في الجدول هتشوفها هنا.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-extrabold">جدولي الأسبوعي</h2>
        <span className="text-[11px] font-bold text-muted-foreground">{data.subjects.length} مواد</span>
      </div>
      {data.week.map((d) => (
        <div key={d.dow} className={cn("rounded-2xl border p-4", d.isToday ? "nk-portal-card bg-card" : "nk-card")}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-extrabold">{d.dayName}</h3>
            {d.isToday && (
              <span className="text-[10px] font-extrabold rounded-full px-2.5 py-0.5 nk-brand-bg text-white">النهاردة</span>
            )}
          </div>
          {d.lessons.length === 0 ? (
            <p className="text-xs font-bold text-muted-foreground py-1">مفيش حصص</p>
          ) : (
            <div className="space-y-2">
              {d.lessons.map((l, i) => (
                <div key={i} className={cn(
                  "flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5",
                  l.isPast && "opacity-50",
                )}>
                  <span className="text-[11px] font-extrabold text-muted-foreground nk-num shrink-0 text-center leading-tight">
                    {formatTime12(l.startTime).replace(" ", "")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-extrabold truncate", l.isNow && "nk-brand-text")}>
                      {l.subject} — {l.groupName}
                    </span>
                    <span className="block text-[10px] font-bold text-muted-foreground">
                      {l.gradeName}{l.room ? ` · ${l.room}` : ""} · {formatTime12(l.startTime)} — {formatTime12(l.endTime)}
                    </span>
                  </span>
                  {l.isNow && (
                    <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 nk-brand-bg text-white shrink-0">شغالة</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================= Students =============================

function TeacherStudents() {
  const [data, setData] = useState<StudentsData | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    tapi<StudentsData>("/api/teacher-portal/students", { silent: true }).then(setData).catch(() => {});
  }, []);

  if (!data || !data.teacher) return <LoadingBlock />;

  const totalStudents = data.groups.reduce((a, g) => a + g.students.length, 0);
  if (data.groups.length === 0) {
    return (
      <div className="nk-card rounded-2xl p-8 text-center">
        <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <p className="font-extrabold">لسه مفيش مجموعات ليك</p>
        <p className="text-sm text-muted-foreground font-bold mt-1">لما الإدارة تربط مجموعات بيك هتلاقي طلابك هنا.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-extrabold">طلابي</h2>
        <span className="text-[11px] font-bold text-muted-foreground nk-num">
          {data.groups.length} مجموعات · {totalStudents} طالب
        </span>
      </div>
      {data.groups.map((g) => {
        const open = openGroup === g.id;
        return (
          <div key={g.id} className="nk-card rounded-2xl overflow-hidden">
            <button
              onClick={() => setOpenGroup(open ? null : g.id)}
              className="w-full flex items-center justify-between gap-2 p-4 text-start"
            >
              <div className="min-w-0">
                <p className="font-extrabold truncate">{g.subject} — مجموعة {g.name}</p>
                <p className="text-[10px] font-bold text-muted-foreground mt-0.5">
                  {g.gradeName}{g.room ? ` · ${g.room}` : ""} · <span className="nk-num">{g.students.length}</span> طالب
                </p>
              </div>
              <span className={cn("text-muted-foreground transition-transform text-xs font-extrabold", open && "rotate-180")}>
                ▼
              </span>
            </button>
            {open && (
              <div className="border-t border-border px-4 py-2.5 space-y-1">
                {g.students.length === 0 ? (
                  <p className="text-xs font-bold text-muted-foreground py-2">مفيش طلاب مسجلين في المجموعة دي.</p>
                ) : (
                  g.students.map((st, i) => (
                    <div key={st.id} className="flex items-center gap-3 py-1.5">
                      <span className="w-6 h-6 rounded-lg bg-muted grid place-items-center text-[10px] font-extrabold text-muted-foreground nk-num shrink-0">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-sm font-bold truncate">{st.name}</span>
                      <span className="text-[10px] font-extrabold text-muted-foreground nk-num">{st.code}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[10px] font-bold text-muted-foreground text-center px-4 leading-relaxed">
        أرقام التواصل مش ظاهرة هنا — لو محتاج تتواصل مع طالب، راجع إدارة السنتر.
      </p>
    </div>
  );
}

// ============================= Money =============================

function TeacherMoney() {
  const [data, setData] = useState<MoneyData | null>(null);

  useEffect(() => {
    tapi<MoneyData>("/api/teacher-portal/money", { silent: true }).then(setData).catch(() => {});
  }, []);

  if (!data || !data.teacher) return <LoadingBlock />;
  const st = data.stats;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-extrabold px-1">فلوسي</h2>

      {/* الرصيد */}
      <section className={cn(
        "nk-portal-card rounded-2xl border p-4 flex items-center gap-3",
        st.balance > 0 ? "bg-emerald-50/70 border-emerald-200" :
        st.balance < 0 ? "bg-orange-50/70 border-orange-200" :
        "nk-card",
      )}>
        <span className={cn(
          "w-11 h-11 rounded-xl grid place-items-center shrink-0",
          st.balance > 0 ? "bg-emerald-100 text-emerald-700" :
          st.balance < 0 ? "bg-orange-100 text-orange-700" :
          "bg-muted text-muted-foreground",
        )}>
          <Banknote className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-extrabold text-muted-foreground">
            {st.balance > 0 ? "مستحق ليك" : st.balance < 0 ? "دفعت زيادة" : "متوازن"}
          </h3>
          <p className={cn(
            "nk-num font-extrabold text-2xl mt-0.5",
            st.balance > 0 ? "text-emerald-700" : st.balance < 0 ? "text-orange-600" : "text-foreground",
          )}>
            {st.balance > 0 ? `${fmtEgp(st.balance)} ج` : st.balance < 0 ? `${fmtEgp(Math.abs(st.balance))} ج` : "0 ج"}
          </p>
        </div>
      </section>

      {/* ملخص */}
      <section className="grid grid-cols-3 gap-2">
        <div className="nk-card rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold text-muted-foreground">الشهر ده</p>
          <p className="nk-num font-extrabold text-base mt-1 text-emerald-700">{fmtEgp(st.thisMonthEarned)} ج</p>
        </div>
        <div className="nk-card rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold text-muted-foreground">إجمالي مكسبك</p>
          <p className="nk-num font-extrabold text-base mt-1">{fmtEgp(st.totalEarned)} ج</p>
        </div>
        <div className="nk-card rounded-2xl p-3 text-center">
          <p className="text-[10px] font-extrabold text-muted-foreground">اتصرف ليك</p>
          <p className="nk-num font-extrabold text-base mt-1">{fmtEgp(st.totalPaid)} ج</p>
        </div>
      </section>

      {/* نصيبك في كل مجموعة */}
      <section className="nk-card rounded-2xl p-4 space-y-2">
        <h3 className="text-xs font-extrabold text-muted-foreground">نصيبك في كل مجموعة</h3>
        {data.groups.length === 0 ? (
          <p className="text-xs font-bold text-muted-foreground">مفيش مجموعات لسه.</p>
        ) : (
          data.groups.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/60 last:border-0">
              <span className="text-sm font-bold min-w-0 truncate">{g.subject} — {g.name}</span>
              <span className="text-[11px] font-extrabold text-muted-foreground nk-num shrink-0">
                {fmtEgp(g.price)} ج × <span className="nk-brand-text">{g.teacherPercent}%</span> ليك
              </span>
            </div>
          ))
        )}
      </section>

      {/* سجل الحركات */}
      <section className="space-y-2">
        <h3 className="text-xs font-extrabold text-muted-foreground px-1">سجل المستحقات والصرف</h3>
        {data.settlements.length === 0 ? (
          <div className="nk-card rounded-2xl p-6 text-center">
            <p className="text-sm font-bold text-muted-foreground">مفيش حركات لسه — أول ما حصة تتقفل هتلاقى نصيبك هنا.</p>
          </div>
        ) : (
          data.settlements.map((s) => {
            const earned = s.type === "EARNED";
            return (
              <div key={s.id} className="nk-card rounded-2xl p-3.5 flex items-center gap-3">
                <span className={cn(
                  "w-9 h-9 rounded-xl grid place-items-center shrink-0",
                  earned ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
                )}>
                  {earned ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold truncate">
                    {earned ? "نصيب حصة" : "صرف / دفعة"}
                    {s.sessionDate && (
                      <span className="text-[10px] font-bold text-muted-foreground ms-1.5">{formatDateAR(s.sessionDate)}</span>
                    )}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground">
                    {formatDateAR(s.date)}
                    {s.sessionTime ? ` · ${s.sessionTime}` : ""}
                    {s.note ? ` · ${s.note}` : ""}
                  </p>
                </div>
                <span className={cn(
                  "nk-num font-extrabold text-sm shrink-0",
                  earned ? "text-emerald-700" : "text-orange-700",
                )}>
                  {earned ? "+" : "−"}{fmtEgp(Math.abs(s.amount))} ج
                </span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

// ============================= Loading =============================

function LoadingBlock() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="nk-anim-shimmer h-24 rounded-2xl" />
      <div className="nk-anim-shimmer h-16 rounded-2xl" />
      <div className="nk-anim-shimmer h-16 rounded-2xl" />
    </div>
  );
}
