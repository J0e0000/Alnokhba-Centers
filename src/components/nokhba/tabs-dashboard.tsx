"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays, GraduationCap, DoorOpen, LockOpen, ArrowLeft, Loader2,
  Zap, Ban, DoorClosed, PlayCircle, ClipboardCheck, Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, type SessionUser } from "./lib";
import { PageHeader, MoneyStat, Stat, SectionCard, Loading, EmptyState } from "./shared";
import { InstallCard } from "./pwa";
import { AlertTriangle, CheckCircle2, Wallet } from "lucide-react";
import type { ViewId } from "./shell";

/* ============================================================
   داشبورد النظام الجديد (Tabs Workflow):
   - فوق: 3 كروت KPI بس — حصص النهاردة · طلاب مجدولين · قاعات شغالة
   - بعدهم: بطاقة الحصة الجاية (NEXT SESSION) + زرار افتح الحصة
   - بعدها: كروت حصص النهاردة المختصرة بحالتها
   - تحت (حسب الدور): محتاج انتباه + اختصارات + أرقام مالية محفوظة
============================================================ */

type CompactSession = {
  id: string; scheduleId: string | null;
  kind: "open" | "planned";
  status: "UPCOMING" | "LIVE" | "COMPLETED" | "CANCELLED";
  startTime: string; endTime: string; room: string | null;
  subject: string; grade: string; groupName: string; teacher: string;
  students: number; presentCount: number | null;
};

type TodayData = {
  today: string; now: string;
  kpis: {
    sessions: { total: number; completed: number; upcoming: number; live: number; cancelled: number };
    students: { scheduled: number; groups: number };
    rooms: { inUse: number; total: number; nextRelease: string | null };
  };
  nextSession: CompactSession | null;
  sessions: CompactSession[];
};

export function TabsDashboardView({ user, setView, openSession, goScanForSession }: {
  user: SessionUser;
  setView: (v: ViewId) => void;
  openSession: (id: string) => void;
  goScanForSession: (id: string) => void;
}) {
  const [data, setData] = useState<TodayData | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<TodayData>("/api/today").then((d) => alive && setData(d)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data) return <Loading />;

  const isManager = user.role === "MANAGER";
  const isTeacher = user.role === "TEACHER";
  const k = data.kpis;

  // فتح حصة مخططة من الجدول
  async function openPlanned(scheduleId: string) {
    setOpening(scheduleId);
    try {
      const res = await api<{ session: { id: string } }>("/api/sessions", { method: "POST", body: { scheduleId } });
      toast.success("الحصة فتحت خلاص 🟢 — جاهز للمسح");
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      openSession(res.session.id);
    } catch { /* toast */ } finally { setOpening(null); }
  }

  const next = data.nextSession;

  return (
    <div className="space-y-5 nk-anim-stagger">
      <PageHeader
        title={`${greeting()} ${user.name.split(" ")[0]} 👋`}
        subtitle={`النهاردة ${formatTime12(data.now)} — عندك ${k.sessions.total} حصة`}
      />

      <InstallCard />

      {/* ===== 3 كروت KPI — فوق خالص، مختصرة وقابلة للمسح البصري ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          icon={<CalendarDays className="w-5 h-5" />}
          value={k.sessions.total}
          label="حصص النهاردة"
          detail={
            <>
              {k.sessions.completed} خلصت · {k.sessions.upcoming} جاية
              {k.sessions.live > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · {k.sessions.live} شغالة 🟢</span>}
            </>
          }
          tone="brand"
          onClick={() => setView("today")}
        />
        <KpiCard
          icon={<GraduationCap className="w-5 h-5" />}
          value={k.students.scheduled}
          label="طلاب مجدولين النهاردة"
          detail={`عبر ${k.students.groups} ${k.students.groups === 1 ? "مجموعة" : "مجموعات"}`}
          onClick={() => setView("today")}
        />
        <KpiCard
          icon={<DoorOpen className="w-5 h-5" />}
          value={`${k.rooms.inUse} / ${k.rooms.total}`}
          label="قاعات شغالة"
          detail={k.rooms.nextRelease ? `أقرب تحرير قاعة: ${formatTime12(k.rooms.nextRelease)}` : "مفيش قاعة مشغولة حاليًا"}
          onClick={() => setView("operations")}
        />
      </div>

      {/* ===== الحصة الجاية — أوضح إجراء في التطبيق كله ===== */}
      {next ? (
        <button
          onClick={() => (next.kind === "open" ? openSession(next.id) : openPlanned(next.scheduleId!))}
          className="w-full text-start nk-card nk-anim-lift rounded-3xl p-5 md:p-6 border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] shadow-lg hover:shadow-xl transition active:scale-[0.995] relative overflow-hidden"
        >
          <div className="absolute inset-y-0 start-0 w-1.5 nk-brand-grad" aria-hidden />
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-extrabold nk-brand-text uppercase tracking-wider">
              {next.status === "LIVE" ? "شغالة دلوقتي" : "الحصة الجاية"}
            </span>
            <span className="nk-brand-bg-soft nk-brand-text text-xs font-extrabold rounded-full px-3 py-1 nk-num" dir="ltr">
              {formatTime12(next.startTime)} — {formatTime12(next.endTime)}
            </span>
          </div>
          <h2 className="font-black text-xl md:text-2xl">{next.subject} — {next.grade} {next.groupName}</h2>
          <p className="text-sm text-muted-foreground font-bold mt-1 flex items-center gap-2 flex-wrap">
            <span>{next.teacher}</span>
            {next.room && <span className="nk-brand-text font-extrabold">· {next.room}</span>}
            <span className="nk-num">· {next.students} طالب</span>
          </p>
          <div className="flex items-center gap-2.5 mt-4">
            <span className="rounded-xl nk-brand-grad text-white font-extrabold text-sm px-5 py-3 shadow flex items-center gap-2">
              {next.kind === "planned" ? <LockOpen className="w-4.5 h-4.5" /> : <PlayCircle className="w-4.5 h-4.5" />}
              {next.status === "LIVE" ? "متابعة الحصة" : "افتح الحصة"}
            </span>
            <ArrowLeft className="w-4.5 h-4.5 nk-brand-text" />
          </div>
        </button>
      ) : (
        <div className="rounded-3xl border-2 border-dashed border-border bg-card p-6 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
          <p className="font-extrabold mt-2">خلصت حصص النهاردة 🎉</p>
          <p className="text-xs font-bold text-muted-foreground mt-1">شوف الجدول الأسبوعي لو عايز تفتح حصة يدوي.</p>
        </div>
      )}

      {/* ===== كروت حصص النهاردة — مختصرة ===== */}
      <SectionCard title="حصص النهاردة" icon={<CalendarDays className="w-4 h-4" />}>
        {data.sessions.length === 0 ? (
          <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش حصص النهاردة" hint="افتح تاب اليوم أو الجداول لتحضير الحصص." />
        ) : (
          <div className="grid gap-2.5">
            {data.sessions.map((s) => (
              <TodayMiniCard key={s.id} s={s} onOpen={() => (s.kind === "open" ? openSession(s.id) : openPlanned(s.scheduleId!))} onScan={() => s.kind === "open" && goScanForSession(s.id)} opening={opening === s.scheduleId} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== المدير: محتاج انتباه + أرقام محفوظة من الداشبورد القديم ===== */}
      {isManager && <ManagerExtras setView={setView} openSession={openSession} />}

      {/* ===== المدرس: اختصارات التعليم ===== */}
      {isTeacher && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <BigAction icon={<CalendarDays className="w-6 h-6" />} label="جدول النهاردة" desc={`${k.sessions.total} حصة`} onClick={() => setView("schedule")} />
          <BigAction icon={<Zap className="w-6 h-6" />} label="الكويزات" desc="كويزات سريعة" onClick={() => setView("quizzes")} />
          <BigAction icon={<ClipboardCheck className="w-6 h-6" />} label="الامتحانات" desc="إنشاء ومتابعة" onClick={() => setView("exams")} primary />
          <BigAction icon={<Users className="w-6 h-6" />} label="الواجبات" desc="واجبات إلكترونية" onClick={() => setView("assignments")} />
        </div>
      )}

      {/* ===== الاستقبال: 5 إجراءات أساسية ===== */}
      {!isManager && !isTeacher && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <BigAction icon={<Zap className="w-7 h-7" />} label="امسح QR" desc="تسجيل حضور فوري" onClick={() => setView("scan")} primary />
          <BigAction icon={<GraduationCap className="w-6 h-6" />} label="ابحث عن طالب" desc="بالاسم أو الكود" onClick={() => setView("students")} />
          <BigAction icon={<Wallet className="w-6 h-6" />} label="تسجيل دفع" desc="استلام فلوس" onClick={() => setView("payments")} />
          <BigAction icon={<Users className="w-6 h-6" />} label="الطلاب" onClick={() => setView("students")} />
          <BigAction icon={<CalendarDays className="w-6 h-6" />} label="جدول النهاردة" desc={`${k.sessions.total} حصة`} onClick={() => setView("schedule")} />
        </div>
      )}
    </div>
  );
}

/** أرقام المدير المالية — محفوظة زي ما كانت (مفيش وظيفة اتشالت) */
function ManagerExtras({ setView, openSession }: { setView: (v: ViewId) => void; openSession: (id: string) => void }) {
  const [data, setData] = useState<LegacyDash | null>(null);
  useEffect(() => {
    let alive = true;
    api<LegacyDash>("/api/dashboard").then((d) => alive && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  const summary = data.opsSummary;
  return (
    <div className="space-y-4">
      {/* شريط «محتاج انتباه» — إجابة سؤال: إيه اللي محتاجني دلوقتي */}
      {summary && <OpsSummaryStrip summary={summary} openSession={openSession} setView={setView} />}
      {/* أرقام الشهر + الصندوق + مستحقات — كلها محفوظة */}
      {data.stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          <MoneyStat label="تحصيل النهاردة" piastres={data.stats.collectedToday} tone="brand" icon={<Wallet className="w-4 h-4" />} />
          <Stat label="حضور النهاردة" value={data.stats.attendanceToday} hint="طالب" />
          <MoneyStat label="إيراد الشهر" piastres={data.stats.monthRevenue} />
          <MoneyStat label="صافي الشهر" piastres={data.stats.monthNet} tone={(data.stats.monthNet ?? 0) >= 0 ? "success" : "danger"} />
          <MoneyStat label="مستحقات على الطلاب" piastres={data.stats.totalOwed} tone="warning" />
          <MoneyStat label="أرصدة الطلاب" piastres={data.stats.totalCredit} />
          <MoneyStat label="مصروفات الشهر" piastres={data.stats.monthExpenses} />
          <MoneyStat label="نصيب مدرسين الشهر" piastres={data.stats.monthTeacherShare} />
        </div>
      )}
      {(data.alerts?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {data.alerts!.map((a, i) => (
            <div key={i} className={cn(
              "flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold",
              a.level === "warn" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-sky-50 border-sky-200 text-sky-800"
            )}>
              <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
              {a.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type LegacyDash = {
  opsSummary?: {
    activeSessions: number;
    attention: { id: string; subject: string; groupName: string; endTime: string }[];
    pendingApprovals: number;
    paymentIssues: { id: string }[];
  };
  stats?: { attendanceToday: number; collectedToday: number; monthRevenue: number; monthTeacherShare: number; monthCenterShare: number; monthExpenses: number; monthNet: number; totalOwed: number; totalCredit: number; activeStudents: number };
  alerts?: { level: string; text: string }[];
};

function OpsSummaryStrip({ summary, openSession, setView }: {
  summary: NonNullable<LegacyDash["opsSummary"]>;
  openSession: (id: string) => void;
  setView: (v: ViewId) => void;
}) {
  const needsClosing = summary.attention ?? [];
  const pending = summary.pendingApprovals ?? 0;
  const active = summary.activeSessions ?? 0;
  const items: { key: string; label: string; value: string; tone: string; onClick?: () => void }[] = [];

  if (active > 0) items.push({ key: "active", label: "حصص شغالة", value: `${active}`, tone: "bg-emerald-50 border-emerald-300 text-emerald-700", onClick: () => setView("today") });
  if (needsClosing.length > 0) items.push({ key: "closing", label: "محتاجة تقفيل", value: `${needsClosing.length}`, tone: "bg-amber-50 border-amber-300 text-amber-700", onClick: () => openSession(needsClosing[0].id) });
  if (pending > 0) items.push({ key: "approvals", label: "طلبات محتاجة موافقة", value: `${pending}`, tone: "bg-sky-50 border-sky-300 text-sky-700", onClick: () => setView("approvals") });
  if ((summary.paymentIssues?.length ?? 0) > 0) items.push({ key: "pay", label: "ملاحظات دفع", value: `${summary.paymentIssues.length}`, tone: "bg-rose-50 border-rose-300 text-rose-700", onClick: () => setView("payments") });

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 font-extrabold text-sm">
        <CheckCircle2 className="w-5 h-5" />
        كل حاجة تمام — مفيش حاجة محتاجة انتباه
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
      {items.map((it) => (
        <button key={it.key} onClick={it.onClick} className={cn("rounded-2xl border-2 px-3.5 py-3 text-start transition hover:scale-[1.02] active:scale-95", it.tone)}>
          <div className="text-2xl font-black nk-num leading-none">{it.value}</div>
          <div className="text-[11.5px] font-extrabold mt-1">{it.label}</div>
        </button>
      ))}
    </div>
  );
}

function KpiCard({ icon, value, label, detail, tone, onClick }: {
  icon: React.ReactNode; value: React.ReactNode; label: string; detail: React.ReactNode;
  tone?: "brand"; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className={cn(
      "nk-card rounded-2xl p-4 text-start transition hover:shadow-md active:scale-[0.98] flex items-center gap-3.5",
      tone === "brand" && "border-[color-mix(in_srgb,var(--c-primary)_35%,white)]",
    )}>
      <span className={cn("rounded-xl p-2.5 shrink-0", tone === "brand" ? "nk-brand-grad text-white" : "nk-brand-bg-soft nk-brand-text")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-black nk-num leading-none">{value}</span>
        <span className="block text-[12px] font-extrabold mt-1">{label}</span>
        <span className="block text-[10.5px] font-bold text-muted-foreground mt-0.5 truncate">{detail}</span>
      </span>
    </button>
  );
}

function TodayMiniCard({ s, onOpen, onScan, opening }: {
  s: CompactSession; onOpen: () => void; onScan?: () => void; opening?: boolean;
}) {
  const cancelled = s.status === "CANCELLED";
  const completed = s.status === "COMPLETED";
  const live = s.status === "LIVE";
  return (
    <div className={cn(
      "rounded-2xl border p-3.5 flex items-center gap-3 transition",
      live ? "border-emerald-300 bg-emerald-50/70" :
      cancelled ? "border-rose-200 bg-rose-50/40 opacity-75" :
      completed ? "border-border bg-muted/40 opacity-80" :
      "border-border bg-card",
    )}>
      <button onClick={() => !cancelled && onOpen()} disabled={cancelled} className={cn("flex-1 min-w-0 text-start", cancelled && "cursor-default")}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("nk-num text-center rounded-xl py-1 px-2 text-xs font-extrabold border", live ? "bg-emerald-600 text-white border-transparent" : "bg-card border-border")} dir="ltr">
            {formatTime12(s.startTime)}
          </span>
          <span className="font-extrabold text-sm truncate">{s.subject} — {s.grade} {s.groupName}</span>
          {live && <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300">شغالة 🟢</span>}
          {cancelled && <span className="text-[10px] font-extrabold text-rose-600 dark:text-rose-300 inline-flex items-center gap-1"><Ban className="w-3 h-3" /> ملغاة</span>}
          {completed && <span className="text-[10px] font-bold text-muted-foreground inline-flex items-center gap-1"><DoorClosed className="w-3 h-3" /> مقفولة</span>}
          {s.kind === "planned" && !cancelled && <span className="text-[10px] font-bold text-muted-foreground">لسه متفتحتش</span>}
        </div>
        <p className="text-[11px] font-bold text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <span>{s.teacher}</span>
          {s.room && <span className="nk-brand-text font-extrabold">{s.room}</span>}
          <span className="nk-num">{completed && s.presentCount != null ? `حضر ${s.presentCount}` : `${s.students} طالب`}</span>
        </p>
      </button>
      {live && onScan && (
        <button onClick={onScan} className="shrink-0 rounded-xl px-3.5 py-2.5 font-extrabold text-xs flex items-center gap-1.5 active:scale-[0.98] transition shadow nk-brand-bg text-white">
          <Zap className="w-4 h-4" />
          امسح
        </button>
      )}
      {s.kind === "planned" && !cancelled && (
        <button onClick={onOpen} disabled={opening} className="shrink-0 rounded-xl px-3.5 py-2.5 font-extrabold text-xs flex items-center gap-1.5 active:scale-[0.98] transition border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text disabled:opacity-60">
          {opening ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
          افتح
        </button>
      )}
    </div>
  );
}

function BigAction({ icon, label, desc, onClick, primary }: { icon: React.ReactNode; label: string; desc?: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-2xl border p-4 flex flex-col items-start gap-2 text-start transition active:scale-[0.98] min-h-[100px] justify-between",
        primary ? "nk-brand-grad nk-portal-card text-white border-transparent shadow-lg" : "nk-card hover:shadow-md hover:border-[color-mix(in_srgb,var(--c-primary)_30%,white)]"
      )}
    >
      <span className={cn("rounded-xl p-2.5", primary ? "bg-white/20" : "nk-brand-bg-soft nk-brand-text")}>{icon}</span>
      <span>
        <span className="block font-extrabold text-[15px]">{label}</span>
        {desc && <span className={cn("block text-[11px] font-semibold", primary ? "text-white/95" : "text-muted-foreground")}>{desc}</span>}
      </span>
    </button>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "صباح الخير";
  if (h < 17) return "نهار سعيد";
  return "مساء الخير";
}

// keep fmt referenced for planned price display in future
void fmt;
