"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Home, CalendarDays, MessageSquareText, LogOut, LogIn, QrCode, ChevronLeft,
  Clock, MapPin, UserRound, Smartphone, CheckCheck, Loader2, BellRing, Wallet, X, RefreshCw,
  ClipboardList, GraduationCap, TrendingUp, FileCheck2, NotebookPen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeDigits, formatTime12, dayNameAR, formatDateAR } from "@/lib/normalize";
import { AlNokhbaMark } from "../shared";
import { Tour } from "../tour";
import { HelpButton } from "../help";
import { STUDENT_TOUR } from "../help-content";
import { PortalExams } from "./exams";
import { PortalAssignments } from "./assignments";
import { PortalScanSheet, PortalScanFab } from "./scan";

// ============================= API =============================

export type { PapiError } from "./portal-api";
import { papi } from "./portal-api";

// ============================= Types =============================

type CenterInfo = {
  id: string; name: string; logo: string | null; slug: string;
  primaryColor: string; secondaryColor: string; accentColor: string | null;
  phone: string | null; whatsapp: string | null; slogan: string | null;
};

type NextLesson = {
  date: string; dayName: string; startTime: string; endTime: string;
  subject: string; groupName: string; gradeName: string;
  teacher: string | null; room: string | null; isToday: boolean; isNow: boolean;
};

type HomeData = {
  student: {
    id: string; name: string; code: string; qrDataUrl: string; gradeName: string | null;
    center: CenterInfo;
  } | null;
  today: string;
  unread: number;
  balance: number;
  nextLesson: NextLesson | null;
  lastAnnouncement: { id: string; title: string; body: string; createdAt: string } | null;
  progress?: {
    sessionsAttended: number; sessionsTotal: number;
    attendanceRate: number | null; quizAvg: number | null; quizzesGraded: number;
  } | null;
};

type WeekData = {
  student: { name: string; code: string; gradeName: string | null } | null;
  today: string;
  week: {
    dow: number; dayName: string; isToday: boolean;
    lessons: {
      subject: string; groupName: string; gradeName: string; teacher: string | null;
      room: string | null; startTime: string; endTime: string; isPast: boolean; isNow: boolean;
    }[];
  }[];
  nextLesson: NextLesson | null;
  subjects: string[];
  empty: boolean;
};

type MessagesData = {
  unread: number;
  notifications: {
    id: string; type: string; typeMeta: { icon: string; label: string };
    title: string; body: string; read: boolean; createdAt: string;
    announcement: { audienceName: string; senderName: string } | null;
  }[];
};

type TabId = "home" | "schedule" | "quizzes" | "exams" | "assignments" | "messages";

/** بوب-أب الرسايل الجديدة — نمط فيسبوك/إنستجرام */
type ToastMsg = {
  key: string;
  title: string;
  body: string;
  icon: string;
  closing: boolean;
};

// ============================= الصوت (دينج-دينج بدون ملفات) =============================

let audioCtx: AudioContext | null = null;

/** فتح قناة الصوت — لازم لمسة من المستخدم الأول (سياسة المتصفحات) */
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
  } catch { /* المتصفح مش داعم — مفيش مشكلة */ }
}

/** نغمة وصول رسالة — دينج-دينج قصيرة وهادية (Web Audio — من غير أي ملف صوت) */
function playChime() {
  try {
    if (!audioCtx || audioCtx.state !== "running") return; // لسه مفيش لمسة → البانر لوحده كفاية
    const now = audioCtx.currentTime;
    const tone = (freq: number, at: number, dur: number, vol: number) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(vol, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.05);
    };
    tone(987.77, 0, 0.16, 0.18); // B5
    tone(1318.51, 0.11, 0.22, 0.14); // E6
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch { /* ignore */ }
}

// ============================= Main =============================

export function PortalApp() {
  const [boot, setBoot] = useState<"loading" | "login" | "app" | "offline">("loading");
  const [home, setHome] = useState<HomeData | null>(null);
  // deep-link: /portal?tab=exams|assignments|quizzes|schedule|messages — بتفتح التاب المطلوب على طول
  const [tab, setTab] = useState<TabId>(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "schedule" || t === "quizzes" || t === "exams" || t === "assignments" || t === "messages") return t;
    } catch { /* ignore */ }
    return "home";
  });
  const [unread, setUnread] = useState(0);
  const [homeRefreshing, setHomeRefreshing] = useState(false);

  // سكان الحضور: زرار عائم في كل الشاشات + ديب-لينك /portal?scan=1 يفتحه على طول
  const [scanOpen, setScanOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("scan") === "1"; } catch { return false; }
  });

  // push/notificationclick بيوّجّه لتاب معين — نقرأ التاب من url الإشعار نفسه
  const navigateFromUrl = useCallback((url?: string) => {
    try {
      const t = url ? new URL(url, window.location.origin).searchParams.get("tab") : null;
      if (t === "schedule" || t === "quizzes" || t === "exams" || t === "assignments" || t === "messages") setTab(t);
      else setTab("messages");
    } catch { setTab("messages"); }
    window.dispatchEvent(new CustomEvent("nk-portal-refresh"));
  }, []);

  // تحديث بيانات الرئيسية (الرصيد + الجدول + الإعلانات) — بيتطلب من زرار التحديث ومن إشعار جديد
  const refreshHome = useCallback(async () => {
    setHomeRefreshing(true);
    try {
      const d = await papi<HomeData>("/api/portal", { silent: true });
      if (d.student) {
        setHome(d);
        setUnread(d.unread);
      }
    } catch { /* silent */ } finally { setHomeRefreshing(false); }
  }, []);

  // إشعار جديد وصل (دفع/رسالة) → حدّث الرصيد فورًا من غير ما الطالب يعمل حاجة
  useEffect(() => {
    if (boot !== "app") return;
    const onEvt = () => { void refreshHome(); };
    window.addEventListener("nk-portal-refresh", onEvt);
    return () => window.removeEventListener("nk-portal-refresh", onEvt);
  }, [boot, refreshHome]);

  // ===== بوب-أب الرسايل الجديدة + صوت =====
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const dismissToast = useCallback((key: string) => {
    setToasts((t) => t.map((x) => (x.key === key ? { ...x, closing: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 260);
  }, []);

  const pushToast = useCallback((title: string, body: string, icon = "🔔") => {
    const key = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((t) => [...t.slice(-2), { key, title, body, icon, closing: false }]);
    playChime();
    setTimeout(() => dismissToast(key), 6000);
  }, [dismissToast]);

  // قناة الصوت بتفتح مع أول لمسة/كبسة (زي أي تطبيق اجتماعي)
  useEffect(() => {
    if (boot !== "app") return;
    const opts = { once: true, passive: true } as AddEventListenerOptions;
    window.addEventListener("pointerdown", unlockAudio, opts);
    window.addEventListener("keydown", unlockAudio, opts);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [boot]);

  // رسايل الـ SW: push وصل والصفحة ظاهرة → بانر + صوت (بدل إشعار النظام)
  useEffect(() => {
    if (boot !== "app") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: { title?: string; body?: string }; url?: string } | null;
      if (!d) return;
      if (d.type === "nk-push" && d.payload?.title) {
        pushToast(d.payload.title, d.payload.body ?? "", "🔔");
        setUnread((u) => u + 1);
        window.dispatchEvent(new CustomEvent("nk-portal-refresh"));
      } else if (d.type === "nk-navigate") {
        // الإشعار ممكن يكون امتحان/واجب → افتح التاب الصح من url الإشعار
        navigateFromUrl(d.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [boot, pushToast, navigateFromUrl]);

  // فحص دوري كل 12 ثانية (بس والصفحة ظاهرة) — أي رسالة جديدة → بانر + صوت + تحديث البادج
  // (كان 30 ثانية — بقى 12 عشان الإشعار يوصل بسرعة)
  useEffect(() => {
    if (boot !== "app") return;
    let alive = true;
    const prime = papi<MessagesData>("/api/portal/notifications", { silent: true })
      .then((d) => {
        if (!alive) return;
        d.notifications.forEach((n) => seenIds.current.add(n.id));
        primed.current = true;
      })
      .catch(() => { primed.current = true; });
    const poll = async () => {
      if (document.visibilityState !== "visible" || !primed.current) return;
      try {
        const d = await papi<MessagesData>("/api/portal/notifications", { silent: true });
        if (!alive || !primed.current) return;
        const fresh = d.notifications.filter((n) => !seenIds.current.has(n.id));
        d.notifications.forEach((n) => seenIds.current.add(n.id));
        setUnread(d.unread);
        // البوش بيدي بانر لوحده — مفيش داعي نتكرر
        if (fresh.length > 0 && document.visibilityState === "visible") {
          for (const n of fresh.slice(0, 3)) {
            pushToast(n.title, n.body, n.typeMeta.icon);
          }
          window.dispatchEvent(new CustomEvent("nk-portal-refresh"));
        }
      } catch { /* silent */ }
    };
    const t = setInterval(poll, 12_000);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      void prime;
    };
  }, [boot, pushToast]);

  // ===== الجولة التعليمية: أول دخول للطالب + إعادة من زرار المساعدة =====
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    const onStart = () => setTourOpen(true);
    window.addEventListener("nk-start-tour", onStart);
    return () => window.removeEventListener("nk-start-tour", onStart);
  }, []);
  const finishTour = () => {
    setTourOpen(false);
    try { localStorage.setItem(`nk-tour-portal-${home?.student?.id ?? "x"}`, "1"); } catch { /* ignore */ }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await papi<HomeData>("/api/portal", { silent: true });
        if (!alive) return;
        if (!d.student) {
          setBoot("login");
          return;
        }
        setHome(d);
        setUnread(d.unread);
        setBoot("app");
        applyBrand(d.student.center);
        // أول دخول للطالب ده؟ → افتح الجولة التعليمية بعد ما الشاشة تهدى
        try {
          if (!localStorage.getItem(`nk-tour-portal-${d.student.id}`)) {
            setTimeout(() => setTourOpen(true), 800);
          }
        } catch { /* ignore */ }
      } catch {
        if (alive) setBoot("login");
      }
    })();
    return () => { alive = false; };
  }, []);

  // إعادة محاولة الإقلاع بعد انقطاع النت — إعادة تحميل بسيطة وآمنة
  const retryBoot = useCallback(() => {
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  if (boot === "loading") {
    return (
      <div className="light-locked min-h-screen grid place-items-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <AlNokhbaMark size={52} />
          <span className="w-7 h-7 rounded-full border-[3px] border-[var(--c-primary)] border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  // النت واقع مؤقتًا — الجلسة محفوظة على الجهاز، مفيش تسجيل خروج
  if (boot === "offline") {
    return (
      <div className="light-locked min-h-screen grid place-items-center bg-background p-6">
        <div className="nk-card rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
          <AlNokhbaMark size={44} />
          <h1 className="text-lg font-extrabold nk-brand-text">النت واقع مؤقتًا</h1>
          <p className="text-sm text-muted-foreground font-semibold leading-relaxed">
            مش قدرنا نوصل للسيرفر دلوقتي — بس حسابك محفوظ على الجهاز ومش هتخرج من نفسك.
            اتصلك رجع؟ دوس «جرب تاني».
          </p>
          <button
            onClick={retryBoot}
            className="nk-btn-brand w-full h-12 rounded-xl font-extrabold flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" /> جرب تاني
          </button>
        </div>
      </div>
    );
  }

  if (boot === "login" || !home) {
    return <PortalLogin onSuccess={() => window.location.reload()} />;
  }

  const s = home.student!;

  async function logout() {
    try { await papi("/api/portal", { method: "POST", body: { action: "logout" }, silent: true }); } catch { /* ignore */ }
    window.location.href = "/portal";
  }

  return (
    <div className="light-locked min-h-screen flex flex-col bg-background nk-safe-top">
      {/* ===== بوب-أب الرسايل الجديدة (زي فيسبوك/إنستجرام) ===== */}
      {toasts.length > 0 && (
        <div className="fixed top-3 inset-x-3 z-[60] mx-auto max-w-lg flex flex-col gap-2 pointer-events-none" dir="rtl" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.key}
              role="button"
              tabIndex={0}
              onClick={() => { setTab("messages"); dismissToast(t.key); }}
              onKeyDown={(e) => { if (e.key === "Enter") { setTab("messages"); dismissToast(t.key); } }}
              className={cn(
                "nk-toast-banner pointer-events-auto rounded-2xl border border-border bg-white/95 backdrop-blur-md shadow-2xl px-4 py-3.5 flex items-start gap-3 cursor-pointer",
                t.closing && "closing",
              )}
            >
              <span className="text-xl leading-none mt-0.5 shrink-0">{t.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold text-sm">{t.title}</span>
                {t.body && <span className="block text-xs font-semibold text-muted-foreground mt-0.5 line-clamp-1">{t.body}</span>}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); dismissToast(t.key); }}
                aria-label="إغلاق"
                className="text-muted-foreground hover:text-foreground shrink-0 -mt-0.5 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ===== header ===== */}
      <header className="nk-glass-bar sticky top-0 z-40">
        <div className="mx-auto max-w-lg px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {s.center.logo ? (
              <img src={s.center.logo} alt={s.center.name} className="w-9 h-9 rounded-xl object-cover border border-border bg-card" />
            ) : (
              /* لوجو النظام الأساسي */
              <span className="w-9 h-9 rounded-xl bg-card border border-border grid place-items-center shrink-0 overflow-hidden" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" className="w-full h-full object-contain p-[6%]" draggable={false} />
              </span>
            )}
            <div className="min-w-0 leading-tight">
              <h1 className="font-extrabold text-sm truncate">{s.center.name}</h1>
              <p className="text-[10px] text-muted-foreground font-bold">بورتال الطالب</p>
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
        {/* حركة دخول لكل تابة — المفتاح بيعيد التشغيل مع كل تنقل */}
        <div key={tab} className="nk-anim-view">
          {tab === "home" && <PortalHome data={home} onGoTab={setTab} onRefresh={refreshHome} refreshing={homeRefreshing} />}
          {tab === "schedule" && <PortalSchedule />}
          {tab === "quizzes" && <PortalQuizzes />}
          {tab === "exams" && <PortalExams />}
          {tab === "assignments" && <PortalAssignments />}
          {tab === "messages" && <PortalMessages onUnread={setUnread} />}
        </div>
      </main>

      {/* ===== bottom nav — تابات: الرئيسية / جدولي / كويزات / امتحانات / واجبات / رسائل ===== */}
      <nav className="fixed bottom-0 inset-x-0 z-40 nk-portal-nav border-t" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 4px)" }} aria-label="تنقل الطالب">
        <div className="mx-auto max-w-lg grid grid-cols-6 h-16">
          {([
              { id: "home", label: "الرئيسية", icon: <Home className="w-5 h-5" /> },
              { id: "schedule", label: "جدولي", icon: <CalendarDays className="w-5 h-5" /> },
              { id: "quizzes", label: "كويزات", icon: <ClipboardList className="w-5 h-5" /> },
              { id: "exams", label: "امتحانات", icon: <FileCheck2 className="w-5 h-5" /> },
              { id: "assignments", label: "واجبات", icon: <NotebookPen className="w-5 h-5" /> },
              { id: "messages", label: "الرسائل", icon: <MessageSquareText className="w-5 h-5" />, badge: unread },
            ] as { id: TabId; label: string; icon: React.ReactNode; badge?: number }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition",
                tab === t.id ? "nk-brand-text" : "text-muted-foreground",
              )}
            >
              <span key={tab === t.id ? `${t.id}-on` : `${t.id}-off`} className={cn("grid place-items-center", tab === t.id && "nk-anim-tab")}>
                {t.icon}
              </span>
              <span>{t.label}</span>
              {t.badge ? t.badge > 0 && (
                <span className="absolute top-1.5 start-1/2 -translate-x-1/2 ms-3.5 min-w-[18px] h-[18px] rounded-full bg-rose-600 text-white text-[10px] font-extrabold grid place-items-center px-1 nk-num">
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {/* ===== زرار سكان الحضور العائم + الشيت ===== */}
      <PortalScanFab onClick={() => setScanOpen(true)} />
      <PortalScanSheet
        open={scanOpen}
        onOpenChange={setScanOpen}
        onDone={() => { void refreshHome(); }}
      />

      {/* ===== الجولة التعليمية (أول دخول) + زرار المساعدة ===== */}
      <Tour steps={STUDENT_TOUR} open={tourOpen} onClose={finishTour} onFinish={finishTour} onNavigate={(v) => setTab(v as TabId)} />
      <HelpButton view="student-portal" viewLabel="بورتال الطالب" />
    </div>
  );
}

// ============================= Login =============================

function PortalLogin({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const c = normalizeDigits(code).replace(/\D/g, "");
    const p = normalizeDigits(phone).replace(/\D/g, "");
    if (c.length !== 5) {
      toast.error("اكتب كود الطالب — 5 أرقام (من كارته أو من الاستقبال).");
      return;
    }
    if (p.length < 10) {
      toast.error("اكتب رقم الموبايل المتسجّل عند السنتر (بتاع الطالب أو ولي الأمر).");
      return;
    }
    setBusy(true);
    try {
      await papi("/api/portal", { method: "POST", body: { action: "login", code: c, phone: p } });
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
            <h1 className="text-2xl font-extrabold mt-1">بورتال الطالب</h1>
            <p className="text-sm text-muted-foreground mt-1">كودك + رقم موبايلك — وبيتفتح على طول</p>
          </div>
        </div>

        <form onSubmit={submit} className="nk-glass rounded-3xl p-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pcode" className="text-sm font-bold flex items-center gap-1.5">
              <UserRound className="w-4 h-4 text-muted-foreground" /> كود الطالب
            </label>
            <input
              id="pcode"
              dir="ltr"
              inputMode="numeric"
              maxLength={5}
              className="flex h-12 w-full rounded-xl border border-input bg-card px-4 text-center text-lg font-extrabold tracking-[0.3em] nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="00000"
              value={code}
              autoComplete="off"
              onChange={(e) => setCode(normalizeDigits(e.target.value).replace(/\D/g, "").slice(0, 5))}
              disabled={busy}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pphone" className="text-sm font-bold flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-muted-foreground" /> رقم الموبايل
            </label>
            <input
              id="pphone"
              dir="ltr"
              inputMode="numeric"
              className="flex h-12 w-full rounded-xl border border-input bg-card px-4 text-start font-semibold nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="01xxxxxxxxx"
              value={phone}
              autoComplete="off"
              onChange={(e) => setPhone(normalizeDigits(e.target.value).replace(/\D/g, "").slice(0, 13))}
              disabled={busy}
            />
            <p className="text-[10px] font-bold text-muted-foreground">رقم الطالب أو ولي الأمر المتسجّل عند السنتر.</p>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="nk-brand-bg w-full h-12 rounded-xl text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <LogIn className="w-5 h-5" />}
            {busy ? "جاري الدخول..." : "دخول"}
          </button>
        </form>

        <p className="text-center text-[11px] text-muted-foreground mt-5 flex items-center justify-center gap-1.5">
          <QrCode className="w-3.5 h-3.5" /> هتلاقي كودك وQR بتاعك جوه البورتال
        </p>
      </div>
    </main>
  );
}

// ============================= Home =============================

function PortalHome({ data, onGoTab, onRefresh, refreshing }: {
  data: HomeData; onGoTab: (t: TabId) => void; onRefresh: () => void; refreshing: boolean;
}) {
  const s = data.student!;
  const first = s.name.split(" ")[0];
  const nl = data.nextLesson;
  // الرصيد من الداتابيز بالقروش (100 قرش = جنيه) — بنحوّله جنيه للعرض
  const bal = Math.round(data.balance) / 100;
  const balText = bal > 0 ? `${fmtEgp(bal)} ج` : bal < 0 ? `${fmtEgp(Math.abs(bal))} ج` : "0 ج";

  return (
    <div className="space-y-4 nk-anim-stagger">
      {/* greeting */}
      <div>
        <h2 className="text-2xl font-extrabold">أهلاً يا <span className="nk-brand-text">{first}</span> 👋</h2>
        {s.gradeName && <p className="text-sm text-muted-foreground font-bold mt-0.5">{s.gradeName}</p>}
      </div>

      {/* رصيد الطالب */}
      <section data-tour="portal-balance" className={cn(
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
          <Wallet className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-extrabold text-muted-foreground">رصيدك في السنتر</h3>
          <p
            key={Math.round(data.balance)}
            className={cn(
              "nk-num font-extrabold text-xl mt-0.5 nk-anim-num",
              bal > 0 ? "text-emerald-700" : bal < 0 ? "text-orange-600" : "text-foreground",
            )}
          >
            {balText}
            <span className={cn(
              "text-[10px] font-bold ms-2 align-middle",
              bal > 0 ? "text-emerald-700" : bal < 0 ? "text-orange-700" : "text-muted-foreground",
            )}>
              {bal > 0 ? "رصيد ليك" : bal < 0 ? "مستحق عليك" : "متوازن"}
            </span>
          </p>
          <p className="text-[10px] font-bold text-muted-foreground mt-1 leading-relaxed">
            {bal > 0 ? "بيتخصم تلقائيًا من سعر الحصص." :
             bal < 0 ? "سدّده في الاستقبال وقت دخولك." :
             "بيتحسب تلقائيًا من الدفعات والحصص."}
          </p>
        </div>
        {/* زرار التحديث — يجيب الرصيد الحالي من السنتر علطول */}
        <button
          onClick={() => onRefresh()}
          disabled={refreshing}
          aria-label="تحديث الرصيد"
          title="حدّث الرصيد"
          className={cn(
            "shrink-0 w-10 h-10 rounded-xl grid place-items-center border transition active:scale-90 disabled:opacity-60",
            bal > 0 ? "border-emerald-200 bg-white/80 text-emerald-700" :
            bal < 0 ? "border-orange-200 bg-white/80 text-orange-700" :
            "border-border bg-white/80 text-muted-foreground hover:text-foreground",
          )}
        >
          <RefreshCw className={cn("w-4.5 h-4.5", refreshing && "animate-spin")} />
        </button>
      </section>

      {/* نظرة التقدم — حضور + كويزات (spec §1) */}
      {data.progress && (data.progress.attendanceRate != null || data.progress.quizAvg != null) && (
        <section className="nk-card nk-anim-lift rounded-2xl p-4">
          <h3 className="text-xs font-extrabold text-muted-foreground mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 nk-brand-text" /> تقدمك آخر 30 يوم
          </h3>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
              <p className="nk-num font-black text-2xl nk-brand-text">{data.progress.attendanceRate ?? "—"}<span className="text-sm">%</span></p>
              <p className="text-[10px] font-bold text-muted-foreground mt-0.5">نسبة الحضور</p>
              <p className="text-[10px] font-bold text-muted-foreground/70">
                {data.progress.sessionsAttended} من {data.progress.sessionsTotal} حصة
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
              <p className="nk-num font-black text-2xl nk-brand-text">{data.progress.quizAvg != null ? `${data.progress.quizAvg}%` : "—"}</p>
              <p className="text-[10px] font-bold text-muted-foreground mt-0.5">متوسط الكويزات</p>
              <p className="text-[10px] font-bold text-muted-foreground/70">{data.progress.quizzesGraded} كويز مصحح</p>
            </div>
          </div>
        </section>
      )}

      {/* next lesson */}
      <section className="nk-card nk-anim-lift rounded-2xl p-4">
        <h3 className="text-xs font-extrabold text-muted-foreground mb-2">أقرب حصة</h3>
        {nl ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-lg">{nl.subject}</span>
              <span className={cn(
                "text-[11px] font-extrabold rounded-full px-2.5 py-1",
                nl.isNow ? "nk-brand-bg text-white" : nl.isToday ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-muted text-muted-foreground",
              )}>
                {nl.isNow ? "شغالة دلوقتي" : nl.isToday ? "النهاردة" : nl.dayName}
              </span>
            </div>
            <p className="text-sm text-muted-foreground font-bold mt-1">
              {formatDateAR(nl.date)} · {nl.dayName} · {formatTime12(nl.startTime)} — {formatTime12(nl.endTime)}
            </p>
            <p className="text-xs text-muted-foreground font-semibold mt-1 flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatTime12(nl.startTime)}</span>
              {nl.teacher && <span>· مستر {nl.teacher.split(" ")[0]}</span>}
              {nl.room && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {nl.room}</span>}
            </p>
          </>
        ) : (
          <p className="text-sm font-bold text-muted-foreground py-2">مفيش حصص في جدولك حاليًا — راجع الاستقبال.</p>
        )}
      </section>

      {/* QR — دايمًا في المتناول */}
      <section data-tour="portal-qr" className="nk-card nk-anim-lift rounded-2xl p-5 text-center relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-16 -end-16 w-40 h-40 rounded-full opacity-[0.08] nk-brand-bg blur-2xl" />
        <h3 className="font-extrabold text-base mb-1">كود الطالب</h3>
        <p className="text-[11px] text-muted-foreground font-bold mb-3">ورّي الـ QR ده عند دخول السنتر</p>
        <div className="mx-auto w-44 h-44 rounded-2xl border-2 border-border bg-card p-2 shadow-sm">
          <img src={s.qrDataUrl} alt={`QR ${s.code}`} className="w-full h-full object-contain" />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="text-sm font-bold text-muted-foreground">الكود:</span>
          <span className="nk-num text-2xl font-extrabold tracking-[0.25em]" dir="ltr">{s.code}</span>
        </div>
      </section>

      {/* messages shortcut */}
      <button
        onClick={() => onGoTab("messages")}
        className={cn(
          "w-full rounded-2xl border p-4 flex items-center justify-between gap-2 transition active:scale-[0.99]",
          data.unread > 0 ? "bg-amber-50 border-amber-200" : "nk-card",
        )}
      >
        <span className="flex items-center gap-2.5 font-extrabold text-sm">
          <MessageSquareText className={cn("w-5 h-5", data.unread > 0 ? "text-amber-600" : "text-muted-foreground")} />
          {data.unread > 0 ? `${data.unread} رسائل جديدة` : "الرسائل"}
        </span>
        <ChevronLeft className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* last announcement */}
      <section className="nk-card nk-anim-lift rounded-2xl p-4">
        <h3 className="text-xs font-extrabold text-muted-foreground mb-2">آخر إعلان</h3>
        {data.lastAnnouncement ? (
          <button onClick={() => onGoTab("messages")} className="text-start w-full">
            <p className="font-extrabold text-sm">📢 {data.lastAnnouncement.title}</p>
            <p className="text-xs text-muted-foreground font-semibold mt-1 line-clamp-2 leading-relaxed">{data.lastAnnouncement.body}</p>
          </button>
        ) : (
          <p className="text-sm font-bold text-muted-foreground">مفيش إعلانات جديدة.</p>
        )}
      </section>
    </div>
  );
}

// ============================= Schedule (جدولي) =============================

const SUBJECT_TINTS = [
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-sky-50 text-sky-700 border-sky-200",
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-orange-50 text-orange-700 border-orange-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-teal-50 text-teal-700 border-teal-200",
];
function subjectTint(subject: string): string {
  let h = 0;
  for (const ch of subject) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return SUBJECT_TINTS[h % SUBJECT_TINTS.length];
}

function PortalSchedule() {
  const [data, setData] = useState<WeekData | null>(null);

  useEffect(() => {
    papi<WeekData>("/api/portal/schedule", { silent: true }).then(setData).catch(() => {});
  }, []);

  if (!data) return <CenterSpinner />;

  const nextMap = new Set<string>();
  if (data.nextLesson) {
    const nl = data.nextLesson;
    for (const d of data.week) {
      for (const l of d.lessons) {
        if (l.subject === nl.subject && l.startTime === nl.startTime && (nl.isToday ? d.isToday : d.dayName === nl.dayName)) {
          nextMap.add(`${d.dow}-${l.startTime}-${l.subject}`);
        }
      }
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-extrabold">جدولي</h2>

      {data.empty ? (
        <div className="nk-card rounded-2xl p-6 text-center">
          <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="font-bold text-sm">لسه مفيش جدول — بمجرد ما الاستقبال يسجلك في مجموعة، الجدول هيظهر هنا تلقائيًا.</p>
        </div>
      ) : (
        <>
          {data.nextLesson && (
            <p className="text-[11px] font-bold text-muted-foreground bg-muted/60 border border-border rounded-xl px-3 py-2">
              جدولك بيتحدث تلقائيًا من مجموعاتك — {data.subjects.join("، ")}
            </p>
          )}
          {data.week.map((d) => (
            <section key={d.dow} className={cn(
              "rounded-2xl border p-3.5",
              d.isToday ? "nk-brand-bg-soft border-[color-mix(in_srgb,var(--c-primary)_30%,white)]" : "nk-card",
            )}>
              <div className="flex items-center justify-between mb-2">
                <h3 className={cn("font-extrabold text-sm", d.isToday && "nk-brand-text")}>{d.dayName}</h3>
                {d.isToday && <span className="nk-brand-bg text-white text-[10px] font-extrabold rounded-full px-2 py-0.5">النهاردة</span>}
              </div>
              {d.lessons.length === 0 ? (
                <p className="text-xs font-bold text-muted-foreground py-1">لا توجد حصة</p>
              ) : (
                <div className="space-y-2">
                  {d.lessons.map((l, i) => {
                    const isNext = nextMap.has(`${d.dow}-${l.startTime}-${l.subject}`);
                    return (
                      <div
                        key={i}
                        className={cn(
                          "rounded-xl border p-3 flex items-center gap-3",
                          subjectTint(l.subject),
                          l.isPast && "opacity-50",
                          isNext && "ring-2 ring-[color:var(--c-primary)]",
                        )}
                      >
                        <span className="nk-num font-extrabold text-sm whitespace-nowrap" dir="ltr">{formatTime12(l.startTime)}</span>
                        <span className="text-2xl leading-none">{["📘", "📗", "📕", "📙", "📔", "📗"][i % 6]}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-extrabold text-sm truncate">{l.subject}</p>
                          <p className="text-[10px] font-bold opacity-75 truncate">
                            {l.teacher ? `مستر ${l.teacher.split(" ")[0]}` : l.groupName}
                            {l.room ? ` · ${l.room}` : ""}
                          </p>
                        </div>
                        {l.isNow && <span className="nk-brand-bg text-white text-[9px] font-extrabold rounded-full px-1.5 py-0.5 shrink-0">دلوقتي</span>}
                        {isNext && <span className="nk-brand-bg text-white text-[9px] font-extrabold rounded-full px-1.5 py-0.5 shrink-0">الجاية</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

// ============================= Messages (الرسائل — إعلانات + إشعارات في مكان واحد) =============================

// آيفون؟ (الآيباد بيتنكر إنه ماك — بنكشفه باللمس)
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
// شغال كتطبيق مثبت (الشاشة الرئيسية)؟
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function PortalMessages({ onUnread }: { onUnread: (n: number) => void }) {
  const [data, setData] = useState<MessagesData | null>(null);
  const [pushOn, setPushOn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await papi<MessagesData>("/api/portal/notifications", { silent: true });
      setData(d);
      onUnread(d.unread);
    } catch { /* ignore */ }
  }, [onUnread]);

  useEffect(() => { load(); }, [load]);
  // رسالة جديدة وصلت (push أو فحص دوري) → حدّث الفيد فورًا
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener("nk-portal-refresh", onRefresh);
    return () => window.removeEventListener("nk-portal-refresh", onRefresh);
  }, [load]);
  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setPushOn(Notification.permission === "granted");
    }
  }, []);

  async function markAll() {
    try {
      await papi("/api/portal/notifications", { method: "POST", body: { action: "readAll" } });
      load();
    } catch { /* toast */ }
  }

  async function openMessage(id: string) {
    try {
      await papi("/api/portal/notifications", { method: "POST", body: { action: "read", id }, silent: true });
      load();
    } catch { /* ignore */ }
  }

  /** تفعيل التنبيهات — اختياري تمامًا، الرفض مش بيأثر على أي حاجة */
  async function enablePush() {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
      // آيفون سفاري جوّه المتصفح: التنبيهات محتاجة تضاف للشاشة الرئيسية الأول (iOS 16.4+)
      if (isIOS() && !isStandalone()) {
        toast.info("على الآيفون: دوس زرار المشاركة ⬆️ ← «إضافة إلى الشاشة الرئيسية» ← افتح التطبيق من الأيقونة ← فعّل التنبيهات من هنا.", { duration: 8000 });
        return;
      }
      toast.info("المتصفح ده مش بيدعم التنبيهات — البورتال شغال من غيرها عادي.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.info("تمام — البورتال هيشتغل عادي، والرسايل هتفضل جوّه التطبيق بس.");
        setPushOn(false);
        return;
      }
      const keys = await papi<{ publicKey: string | null }>("/api/portal/push", { silent: true });
      if (!keys.publicKey) throw new Error("no key");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keys.publicKey) as unknown as BufferSource,
      });
      await papi("/api/portal/push", { method: "POST", body: { subscription: sub.toJSON() } });
      setPushOn(true);
      toast.success("تم تفعيل التنبيهات 🔔");
    } catch {
      toast.error("حصلت مشكلة في تفعيل التنبيهات — جرب تاني بعدين.");
    }
  }

  if (!data) return <CenterSpinner />;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayItems = data.notifications.filter((n) => n.createdAt.slice(0, 10) === todayStr);
  const olderItems = data.notifications.filter((n) => n.createdAt.slice(0, 10) !== todayStr);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-extrabold">الرسائل</h2>
        {data.unread > 0 && (
          <button
            onClick={markAll}
            className="text-xs font-extrabold nk-brand-text border border-[color-mix(in_srgb,var(--c-primary)_35%,white)] rounded-full px-3 py-1.5 bg-card flex items-center gap-1.5 active:scale-[0.98]"
          >
            <CheckCheck className="w-3.5 h-3.5" /> تحديد الكل كمقروء
          </button>
        )}
      </div>

      {/* push enable — اختياري */}
      {pushOn === false && (
        <>
          <button
            onClick={enablePush}
            className="w-full rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--c-primary)_40%,white)] bg-card p-4 flex items-center gap-3 text-start active:scale-[0.99] transition"
          >
            <span className="w-10 h-10 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center shrink-0">
              <BellRing className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-extrabold text-sm">فعّل تنبيهات الموبايل</span>
              <span className="block text-[11px] font-semibold text-muted-foreground">إشعار بصوت يوصلك حتى لو الموقع مقفول — الدفعات والإعلانات وتغييرات المواعيد فورًا.</span>
            </span>
            <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
          {/* آيفون جوّه سفاري: التنبيهات محتاجة التطبيق يتضاف للشاشة الرئيسية الأول */}
          {isIOS() && !isStandalone() && (
            <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] font-semibold text-amber-800 leading-relaxed">
              على الآيفون: التنبيهات بتشتغل لما تضيف التطبيق للشاشة الرئيسية — دوس زرار المشاركة ⬆️ فوق في سفاري ← «إضافة إلى الشاشة الرئيسية»، وبعدين افتح التطبيق من الأيقونة وفعّل التنبيهات.
            </p>
          )}
        </>
      )}

      {data.notifications.length === 0 ? (
        <div className="nk-card rounded-2xl p-6 text-center">
          <MessageSquareText className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="font-bold text-sm">مفيش رسايل لسه — كل إعلانات السنتر هتظهر هنا.</p>
        </div>
      ) : (
        <>
          {todayItems.length > 0 && (
            <Section title="اليوم">
              {todayItems.map((n) => (
                <MessageCard key={n.id} n={n} onOpen={openMessage} />
              ))}
            </Section>
          )}
          {olderItems.length > 0 && (
            <Section title="سابقًا">
              {olderItems.map((n) => (
                <MessageCard key={n.id} n={n} onOpen={openMessage} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * كارت الرسالة — نفس شكل الإعلان اللي المدير/الاستقبال بينشروه:
 * عنوان بارز + نص + سطر ميتا (الجمهور · المرسل · الوقت) + نقطة جديد
 */
function MessageCard({ n, onOpen }: { n: MessagesData["notifications"][number]; onOpen: (id: string) => void }) {
  const isAnn = n.type === "ANNOUNCEMENT";
  return (
    <button
      onClick={() => onOpen(n.id)}
      className={cn(
        "w-full text-start rounded-2xl border p-4 flex items-start gap-3 transition active:scale-[0.99]",
        n.read ? "nk-card" : "bg-amber-50/70 border-amber-200",
      )}
    >
      <span className="text-xl leading-none mt-0.5 shrink-0">{n.typeMeta.icon}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-sm">{isAnn ? `📢 ${n.title}` : n.title}</span>
          {!n.read && <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" aria-label="جديد" />}
        </span>
        <span className="block text-sm font-semibold text-foreground/80 mt-1.5 leading-relaxed whitespace-pre-line">{n.body}</span>
        <span className="block text-[10px] font-bold text-muted-foreground mt-2.5 flex items-center gap-1.5 flex-wrap">
          {isAnn && n.announcement && (
            <>
              <span className="nk-brand-bg-soft nk-brand-text rounded-full px-2 py-0.5">{n.announcement.audienceName}</span>
              <span>· من {n.announcement.senderName}</span>
            </>
          )}
          {!isAnn && <span className="nk-brand-bg-soft nk-brand-text rounded-full px-2 py-0.5">{n.typeMeta.label}</span>}
          <span>· {timeAgo(n.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-extrabold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

// ============================= helpers =============================

/** جنيه → نص مرتب: 5 / 12.5 / 1,250 */
function fmtEgp(n: number): string {
  return n.toLocaleString("en-EG", { maximumFractionDigits: 2 });
}

/** جمع عربي مع الأعداد: ١ دقيقة / دقيقتين / ٥ دقايق / ١٥ دقيقة */
function unitAR(n: number, one: string, two: string, few: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${one}`;
}

function CenterSpinner() {
  return (
    <div className="py-10 space-y-3" aria-busy="true" aria-label="جاري التحميل">
      {/* سكيلتون شايمر — المكان بيتملأ بدل سبينر مركزي بارد */}
      <div className="nk-anim-shimmer h-24 rounded-2xl" />
      <div className="nk-anim-shimmer h-16 rounded-2xl" />
      <div className="nk-anim-shimmer h-40 rounded-2xl" />
      <div className="py-2 grid place-items-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function timeAgo(date: string): string {
  const d = new Date(date);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "الآن";
  if (diff < 3600) return `من ${unitAR(Math.floor(diff / 60), "دقيقة", "دقيقتين", "دقايق")}`;
  if (diff < 86400) return `من ${unitAR(Math.floor(diff / 3600), "ساعة", "ساعتين", "ساعات")}`;
  return formatDateAR(date.slice(0, 10));
}

function applyBrand(center: CenterInfo) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const primary = center?.primaryColor || "#0E9F6E";
  const secondary = center?.secondaryColor || "#0F766E";
  root.style.setProperty("--c-primary", primary);
  root.style.setProperty("--c-secondary", secondary);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", primary);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ============================= الكويزات (spec §1) =============================

type PortalQuizRow = {
  id: string; title: string; description: string | null;
  subject: string; groupName: string; status: string; durationMin: number | null;
  open: boolean; closedReason: string | null; done: boolean;
  score: number | null | undefined; maxScore?: number; pendingGrading?: boolean;
};

type PortalQuizDetail = {
  quiz: {
    id: string; title: string; description: string | null; durationMin: number | null;
    closesAt: string | null;
    questions: { id: string; order: number; text: string; type: string; options: string[] | null; points: number }[];
    attempt: { id: string } | null;
  };
  done?: boolean;
  attempt?: { status: string; score: number | null; maxScore: number };
};

function PortalQuizzes() {
  const [rows, setRows] = useState<PortalQuizRow[] | null>(null);
  const [taking, setTaking] = useState<PortalQuizDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number | null; maxScore: number; status: string } | null>(null);

  const load = useCallback(() => {
    papi<{ quizzes: PortalQuizRow[] }>("/api/portal/quizzes", { silent: true })
      .then((d) => setRows(d.quizzes))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openQuiz(id: string) {
    try {
      const d = await papi<PortalQuizDetail>(`/api/portal/quizzes?quizId=${id}`);
      if (d.done && d.attempt) {
        setResult({ score: d.attempt.score, maxScore: d.attempt.maxScore, status: d.attempt.status });
        setTaking(null);
        return;
      }
      setTaking(d);
      setAnswers({});
      setResult(null);
    } catch { /* toast */ }
  }

  // ديب-لينك من زرار المشاركة: /portal?tab=quizzes&open=<id> — يفتح الكويز على طول
  useEffect(() => {
    try {
      const open = new URLSearchParams(window.location.search).get("open");
      if (open) {
        void openQuiz(open);
        window.history.replaceState(null, "", "/portal?tab=quizzes");
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!taking || submitting) return;
    setSubmitting(true);
    try {
      const res = await papi<{ attempt: { status: string; score: number | null; maxScore: number; pendingGrading: boolean } }>(
        "/api/portal/quizzes",
        { method: "POST", body: { quizId: taking.quiz.id, answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer })) } },
      );
      setResult(res.attempt);
      setTaking(null);
      load();
    } catch { /* toast */ } finally { setSubmitting(false); }
  }

  // ============================= شاشة الحل =============================
  if (taking) {
    const qz = taking.quiz;
    return (
      <div className="space-y-4">
        <button onClick={() => { setTaking(null); load(); }} className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
          <ChevronLeft className="w-4 h-4" /> رجوع للكويزات
        </button>
        <div className="nk-card rounded-2xl p-4">
          <h2 className="font-black text-lg">{qz.title}</h2>
          {qz.description && <p className="text-xs font-bold text-muted-foreground mt-1">{qz.description}</p>}
          <p className="text-[11px] font-bold text-muted-foreground mt-2">
            {qz.questions.length} سؤال{qz.durationMin ? ` · المدة ${qz.durationMin} دقيقة` : ""} — جاوب كل السؤال وسلّم مرة واحدة.
          </p>
        </div>

        {qz.questions.map((q, i) => (
          <div key={q.id} className="nk-card rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-extrabold text-sm leading-relaxed">{i + 1}. {q.text}</h3>
              <span className="text-[10px] font-black text-muted-foreground shrink-0 nk-num">{q.points} ن</span>
            </div>
            {q.type === "MCQ" && q.options && (
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: String(oi) }))}
                    className={cn(
                      "w-full text-start rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition active:scale-[0.99]",
                      answers[q.id] === String(oi)
                        ? "nk-brand-border nk-brand-bg-soft nk-brand-text"
                        : "border-border bg-card",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {q.type === "TRUE_FALSE" && (
              <div className="grid grid-cols-2 gap-2">
                {[{ v: "true", l: "صح ✔️" }, { v: "false", l: "غلط ✖️" }].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: o.v }))}
                    className={cn(
                      "rounded-xl border-2 px-3 py-2.5 text-sm font-extrabold transition active:scale-[0.98]",
                      answers[q.id] === o.v ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card",
                    )}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            )}
            {q.type === "WRITTEN" && (
              <textarea
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value.slice(0, 500) }))}
                rows={3}
                placeholder="اكتب إجابتك هنا…"
                className="w-full rounded-xl border-2 border-input bg-card px-3 py-2.5 text-sm font-bold resize-none"
              />
            )}
          </div>
        ))}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full h-13 py-3.5 rounded-2xl nk-brand-bg text-white font-extrabold shadow active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60 sticky bottom-20"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCheck className="w-5 h-5" />}
          تسليم الكويز
        </button>
      </div>
    );
  }

  // ============================= نتيجة بعد التسليم =============================
  if (result) {
    const pct = result.maxScore > 0 && result.score != null ? Math.round((result.score / result.maxScore) * 100) : null;
    return (
      <div className="space-y-4">
        <div className="nk-card rounded-3xl p-8 text-center space-y-3">
          <GraduationCap className="w-14 h-14 nk-brand-text mx-auto" />
          {result.status === "GRADED" && result.score != null ? (
            <>
              <p className="text-3xl font-black nk-num nk-brand-text">{pct}%</p>
              <p className="font-extrabold">درجتك: <span className="nk-num">{result.score}</span> من <span className="nk-num">{result.maxScore}</span></p>
              <p className="text-xs font-bold text-muted-foreground">
                {pct != null && pct >= 85 ? "ممتاز — كمّل بنفس المستوى 🔥" : pct != null && pct >= 60 ? "كويس — راجع الأخطاء وتقدر تحسن." : "محتاج مراجعة الدروس — وفيك تصحى."}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-black">اتسلّم ✅</p>
              <p className="text-xs font-bold text-muted-foreground">فيه أسئلة مكتوبة بتتصحح من المدرس — نتيجتك هتظهر هنا بعد التصحيح.</p>
            </>
          )}
        </div>
        <button onClick={() => { setResult(null); load(); }} className="w-full h-12 rounded-2xl border-2 border-border bg-card font-extrabold">
          رجوع للكويزات
        </button>
      </div>
    );
  }

  // ============================= القائمة =============================
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-lg flex items-center gap-2"><ClipboardList className="w-5 h-5 nk-brand-text" /> الكويزات</h2>
        <button onClick={load} aria-label="تحديث" className="w-9 h-9 rounded-xl border border-border bg-card grid place-items-center">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!rows ? (
        <div className="nk-card rounded-2xl p-8 text-center text-sm font-bold text-muted-foreground">جاري التحميل…</div>
      ) : rows.length === 0 ? (
        <div className="nk-card rounded-2xl p-8 text-center space-y-2">
          <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground/50" />
          <p className="font-extrabold">مفيش كويزات دلوقتي</p>
          <p className="text-xs font-bold text-muted-foreground">لما المدرس ينزل كويز هيظهر هنا فورًا.</p>
        </div>
      ) : (
        rows.map((q) => (
          <button
            key={q.id}
            onClick={() => q.open && openQuiz(q.id)}
            disabled={!q.open}
            className={cn(
              "w-full nk-card rounded-2xl p-4 text-start space-y-2 transition",
              q.open ? "hover:shadow-md active:scale-[0.99]" : "opacity-75",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-extrabold text-sm truncate">{q.title}</h3>
                <p className="text-[11px] font-bold text-muted-foreground">{q.subject} — {q.groupName}</p>
              </div>
              {q.done && !q.pendingGrading && q.score != null ? (
                <span className="rounded-full bg-emerald-600 text-white text-[11px] font-black px-2.5 py-1 nk-num shrink-0">
                  {q.score}/{q.maxScore ?? 0}
                </span>
              ) : q.pendingGrading ? (
                <span className="rounded-full bg-amber-500 text-white text-[10px] font-black px-2.5 py-1 shrink-0">بنتصحح</span>
              ) : q.open ? (
                <span className="rounded-full nk-brand-bg text-white text-[10px] font-black px-2.5 py-1 shrink-0">افتح الكويز</span>
              ) : (
                <span className="rounded-full bg-muted text-muted-foreground text-[10px] font-black px-2.5 py-1 shrink-0">مقفول</span>
              )}
            </div>
            {!q.open && !q.done && q.closedReason && (
              <p className="text-[10px] font-bold text-muted-foreground">{q.closedReason}</p>
            )}
            {q.durationMin && <p className="text-[10px] font-bold text-muted-foreground">المدة: {q.durationMin} دقيقة</p>}
          </button>
        ))
      )}
    </div>
  );
}
