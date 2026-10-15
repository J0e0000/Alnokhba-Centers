"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Home, CalendarDays, Users, LogOut, LogIn, UserRound, Smartphone,
  Clock, MapPin, GraduationCap, BadgeCheck, Loader2, RefreshCw, Send,
  KeyRound, MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeDigits, formatTime12, formatDateAR } from "@/lib/normalize";
import { applyCenterBranding } from "../lib";
import { AlNokhbaMark } from "../shared";
import { Tour } from "../tour";
import { HelpButton } from "../help";
import { TEACHER_TOUR } from "../help-content";

// ============================= API =============================

async function tapi<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; silent?: boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    // الشبكة وقعت (نت مقطوع/سيرفر بيحمّل) — دي غلطة مؤقتة، مش خروج — بنوسمها status=0
    const err = new Error("مفيش اتصال بالسيرفر دلوقتي — جرب تاني.") as Error & { status?: number };
    err.status = 0;
    if (!opts.silent) toast.error(err.message);
    throw err;
  }
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
  stats: { groups: number; students: number };
};

type ScheduleData = {
  teacher: { name: string; center: CenterInfo } | null;
  today: string;
  week: {
    dow: number; dayName: string; isToday: boolean;
    lessons: {
      subject: string; groupName: string; gradeName: string;
      room: string | null; startTime: string; endTime: string; isPast: boolean; isNow: boolean;
      students: number;
    }[];
  }[];
  subjects: string[];
  empty: boolean;
};

type TabId = "home" | "schedule" | "message";

// ============================= Helpers =============================

// ============================= App =============================

export function TeacherPortalApp() {
  const [boot, setBoot] = useState<"loading" | "login" | "app" | "offline">("loading");
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
      if (d.teacher) applyCenterBranding(d.teacher.center ?? null); // هوية السنتر — كانت ناقصة خالص في بورتال المدرس
      // أول دخول للمدرس ده → افتح الجولة بعد ما الشاشة تهدى
      if (d.teacher) {
        try {
          if (!localStorage.getItem(`nk-tour-teacher-${d.teacher.id}`)) setTimeout(() => setTourOpen(true), 800);
        } catch { /* ignore */ }
      }
    } catch (e) {
      // انقطاع نت لحظي ≠ تسجيل خروج — نعرض شاشة أوفلاين بدل شاشة الدخول
      setBoot((e as Error & { status?: number })?.status === 0 ? "offline" : "login");
    }
  }, []);

  useEffect(() => { void refreshHome(); }, [refreshHome]);

  if (boot === "loading") {
    return (
      <main className="light-locked min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <AlNokhbaMark size={52} />
          <span className="w-7 h-7 rounded-full border-[3px] border-[var(--c-primary)] border-t-transparent animate-spin" />
        </div>
      </main>
    );
  }

  if (boot === "offline") {
    return (
      <main className="light-locked min-h-screen grid place-items-center bg-background p-6">
        <div className="nk-card rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
          <AlNokhbaMark size={44} />
          <h1 className="text-lg font-extrabold nk-brand-text">النت واقع مؤقتًا</h1>
          <p className="text-sm text-muted-foreground font-semibold leading-relaxed">
            مش قدرنا نوصل للسيرفر دلوقتي — بياناتك محفوظة ولسه مسجّل داخل.
            اتصلك رجع؟ دوس «جرب تاني».
          </p>
          <button
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            className="nk-btn-brand w-full h-12 rounded-xl font-extrabold flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" /> جرب تاني
          </button>
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
    <div className="light-locked min-h-screen flex flex-col bg-background nk-safe-top">
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
                <img src="/logo.png?v=2" alt="" className="w-full h-full object-contain p-[6%]" draggable={false} />
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
          {tab === "message" && <TeacherMessage teacherName={t.name} />}
        </div>
      </main>

      {/* ===== bottom nav — 3 تابات: الرئيسية / جدولي / رسالة ===== */}
      <nav className="fixed bottom-0 inset-x-0 z-40 nk-portal-nav border-t" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 4px)" }} aria-label="تنقل المدرس">
        <div className="mx-auto max-w-lg grid grid-cols-3 h-16">
          {([
            { id: "home", label: "الرئيسية", icon: <Home className="w-5 h-5" /> },
            { id: "schedule", label: "جدولي", icon: <CalendarDays className="w-5 h-5" /> },
            { id: "message", label: "رسالة", icon: <MessageSquareText className="w-5 h-5" /> },
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
    <main className="light-locked min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden nk-safe-top">
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
          <GraduationCap className="w-3.5 h-3.5" /> جوا بتشوف جدولك وعدد طلابك وتبعت رسالة للإدارة
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

      {/* stats — عدد المجموعات والطلاب */}
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
                  <span className="text-[10px] font-extrabold rounded-full px-2 py-0.5 bg-muted text-muted-foreground shrink-0 nk-num">
                    {l.students} طالب
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

// ============================= Message (رسالة للإدارة) =============================

function TeacherMessage({ teacherName }: { teacherName: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentCount, setSentCount] = useState(0);

  async function send() {
    const t = text.trim();
    if (t.length < 3) {
      toast.error("اكتب الرسالة الأول (3 حروف على الأقل).");
      return;
    }
    setBusy(true);
    try {
      await tapi("/api/teacher-portal/message", { method: "POST", body: { text: t } });
      toast.success("وصلت الرسالة للإدارة ✅");
      setText("");
      setSentCount((n) => n + 1);
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 nk-anim-view">
      <div>
        <h2 className="text-lg font-extrabold px-1">رسالة للإدارة</h2>
        <p className="text-[11px] font-bold text-muted-foreground px-1 mt-0.5">
          من {teacherName} — الرسالة بتوصل للمدير والاستقبال فورًا مع إشعار.
        </p>
      </div>

      <section className="nk-card rounded-2xl p-4 space-y-3">
        <textarea
          className="w-full min-h-[140px] rounded-xl border border-border bg-card px-3.5 py-3 text-sm font-semibold resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="اكتب رسالتك هنا... (مثال: الحصة بتاعة بكرة معداة ساعة، أو محتاج تأجيل حصة المجموعة A)"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-muted-foreground nk-num">{text.length}/1000</span>
          <button
            onClick={send}
            disabled={busy || text.trim().length < 3}
            className="nk-btn-brand h-11 rounded-xl font-extrabold px-6 flex items-center justify-center gap-2 shadow active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
            {busy ? "جاري الإرسال..." : "إرسال الرسالة"}
          </button>
        </div>
      </section>

      {sentCount > 0 && (
        <p className="text-[11px] font-bold text-emerald-700 text-center">
          بعت {sentCount} رسالة النهاردة — الإدارة هترد عليك لو في رد.
        </p>
      )}
      <p className="text-[10px] font-bold text-muted-foreground text-center px-4 leading-relaxed">
        الرسائل دي للإدارة — لو عايز تبلغ أولياء الأمور بحاجة، كلّم الإدارة وهي هتبلغهم من الرسائل الرسمية.
      </p>
    </div>
  );
}

// ============================= Loading =============================
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
