"use client";

import { useEffect, useState } from "react";
import {
  ScanLine, Search, CreditCard, Users, CalendarDays, Clock, ArrowLeft,
  Wallet, TrendingUp, Receipt, AlertTriangle, GraduationCap, Banknote, Scale, DoorClosed,
  LockOpen, Loader2, Zap, Ban, CheckCircle2, ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, fmt, fmtE, formatTime12, sessionPhase, type SessionUser } from "./lib";
import { PageHeader, Stat, MoneyStat, SectionCard, Loading, EmptyState } from "./shared";
import { DemoCard } from "./demo-card";
import { InstallCard } from "./pwa";
import type { ViewId } from "./shell";

type SessionCard = {
  id: string; startTime: string; endTime: string; room: string | null; status: string;
  subject: string; grade: string; groupName: string; teacher: string; price: number;
  presentCount: number;
  /** وقت البداية الفعلي (لحظة الفتح) — null لو ملغاة */
  openedAt: string | null;
  closedAggregates: { totalRevenue: number; teacherShare: number; centerShare: number; presentCount: number } | null;
};

type PlannedSession = {
  scheduleId: string; startTime: string; endTime: string; room: string | null;
  subject: string; grade: string; groupName: string; teacher: string; price: number;
  students: number;
};

/** شريط المتابعة التشغيلية للمدير — إيه اللي محتاج انتباه دلوقتي (كله قابل للضغط) */
function OpsSummaryStrip({
  summary, openSession, setView,
}: {
  summary: NonNullable<DashData["opsSummary"]>;
  openSession: (id: string) => void;
  setView: (v: ViewId) => void;
}) {
  const needsClosing = summary.attention ?? [];
  const paymentIssues = summary.paymentIssues ?? [];
  const pending = summary.pendingApprovals ?? 0;
  const active = summary.activeSessions ?? 0;
  const items: { key: string; label: string; value: string; tone: string; onClick?: () => void }[] = [];

  if (active > 0) {
    items.push({
      key: "active", label: "حصص شغالة", value: `${active}`, tone: "bg-emerald-50 border-emerald-300 text-emerald-700",
      onClick: () => setView("schedule"),
    });
  }
  if (needsClosing.length > 0) {
    items.push({
      key: "closing", label: "محتاجة تقفيل", value: `${needsClosing.length}`, tone: "bg-amber-50 border-amber-300 text-amber-700",
      onClick: () => openSession(needsClosing[0].id),
    });
  }
  if (pending > 0) {
    items.push({
      key: "approvals", label: "طلبات محتاجة موافقة", value: `${pending}`, tone: "bg-sky-50 border-sky-300 text-sky-700",
      onClick: () => setView("approvals"),
    });
  }
  if (paymentIssues.length > 0) {
    items.push({
      key: "pay", label: "ملاحظات دفع", value: `${paymentIssues.length}`, tone: "bg-rose-50 border-rose-300 text-rose-700",
      onClick: () => setView("payments"),
    });
  }

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
        <button
          key={it.key}
          onClick={it.onClick}
          className={cn("rounded-2xl border-2 px-3.5 py-3 text-start transition hover:scale-[1.02] active:scale-95", it.tone)}
        >
          <div className="text-2xl font-black nk-num leading-none">{it.value}</div>
          <div className="text-[11.5px] font-extrabold mt-1">{it.label}</div>
        </button>
      ))}
    </div>
  );
}

type DashData = {
  today: string;
  sessions: SessionCard[];
  plannedSessions?: PlannedSession[];
  role: string;
  quickStats: { students: number };
  opsSummary?: {
    activeSessions: number;
    attention: { id: string; subject: string; groupName: string; endTime: string }[];
    pendingApprovals: number;
    paymentIssues: { id: string; subject: string; groupName: string; outstanding: number }[];
  };
  stats?: {
    attendanceToday: number; collectedToday: number; monthRevenue: number; monthTeacherShare: number;
    monthCenterShare: number; monthExpenses: number; monthNet: number; totalOwed: number; totalCredit: number;
    activeStudents: number;
  };
  cash?: { opening: number; cashIn: number; cashOut: number; expected: number; status: string; counted: number | null; difference: number | null };
  teacherPayables?: { id: string; name: string; payable: number }[];
  subscription?: { plan: string; status: string; renewalDate: string; pricePerStudent: number } | null;
  alerts?: { level: string; text: string }[];
};

export function DashboardView({ user, setView, openSession, goScanForSession }: { user: SessionUser; setView: (v: ViewId) => void; openSession: (id: string) => void; goScanForSession: (id: string) => void }) {
  const [data, setData] = useState<DashData | null>(null);
  const [opening, setOpening] = useState<string | null>(null); // scheduleId بيفتح دلوقتي

  useEffect(() => {
    let alive = true;
    api<DashData>("/api/dashboard").then((d) => alive && setData(d)).catch(() => {});
    const t = setInterval(() => api<DashData>("/api/dashboard").then((d) => alive && setData(d)).catch(() => {}), 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data) return <Loading />;

  // فتح حصة من الجدول: المادة دي اتقررت — المستخدم بيدوس [فتح الحصة] بنفسه
  async function openLesson(scheduleId: string) {
    setOpening(scheduleId);
    try {
      const res = await api<{ session: { id: string } }>("/api/sessions", {
        method: "POST",
        body: { scheduleId },
      });
      toast.success("الحصة فتحت خلاص 🟢 — جاهز للمسح");
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      openSession(res.session.id);
    } catch { /* toast */ } finally {
      setOpening(null);
    }
  }

  const isManager = user.role === "MANAGER";
  const planned = data.plannedSessions ?? [];
  const totalToday = data.sessions.length + planned.length;
  const nowSession = data.sessions.find((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "now");
  const nextSession = data.sessions.find((s) => s.status !== "CLOSED" && sessionPhase(s.startTime, s.endTime) === "future");

  return (
    <div className="space-y-5 nk-anim-stagger">
      <PageHeader
        title={`${greeting()} ${user.name.split(" ")[0]} 👋`}
        subtitle={`النهاردة ${formatTime12(new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, "0"))} — عندك ${totalToday} حصة`}
      />

      {/* تثبيت التطبيق على الجهاز (بتختفي بعد التثبيت) */}
      <InstallCard />

      {/* ===== مركز التحكم التشغيلي للمدير: إيه اللي محتاج انتباه دلوقتي ===== */}
      {isManager && data.opsSummary && (
        <OpsSummaryStrip summary={data.opsSummary} openSession={openSession} setView={setView} />
      )}

      {/* ===== Receptionist: 5 primary actions ===== */}
      {!isManager && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 nk-anim-stagger">
          <BigAction icon={<ScanLine className="w-8 h-8" />} label="امسح QR" desc="تسجيل حضور فوري" onClick={() => setView("scan")} primary />
          <BigAction icon={<Search className="w-7 h-7" />} label="ابحث عن طالب" desc="بالاسم أو الكود" onClick={() => setView("students")} />
          <BigAction icon={<CreditCard className="w-7 h-7" />} label="تسجيل دفع" desc="استلام فلوس" onClick={() => setView("payments")} />
          <BigAction icon={<Users className="w-7 h-7" />} label="الطلاب" desc={`${data.quickStats.students} طالب`} onClick={() => setView("students")} />
          <BigAction icon={<CalendarDays className="w-7 h-7" />} label="جدول النهاردة" desc={`${totalToday} حصة`} onClick={() => setView("schedule")} />
        </div>
      )}

      {/* ===== Manager stats ===== */}
      {isManager && data.stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 nk-anim-stagger">
          <MoneyStat label="تحصيل النهاردة" piastres={data.stats.collectedToday} tone="brand" icon={<Banknote className="w-4 h-4" />} />
          <Stat label="حضور النهاردة" value={data.stats.attendanceToday} hint="طالب" icon={<GraduationCap className="w-4 h-4" />} />
          <MoneyStat label="إيراد الشهر" piastres={data.stats.monthRevenue} icon={<TrendingUp className="w-4 h-4" />} />
          <MoneyStat label="صافي الشهر" piastres={data.stats.monthNet} tone={(data.stats.monthNet ?? 0) >= 0 ? "success" : "danger"} hint="نصيب السنتر بعد المصروفات" />
          <MoneyStat label="مستحقات على الطلاب" piastres={data.stats.totalOwed} tone="warning" icon={<Receipt className="w-4 h-4" />} />
          <MoneyStat label="أرصدة الطلاب" piastres={data.stats.totalCredit} hint="اللي دفعوا زيادة" />
          <MoneyStat label="مصروفات الشهر" piastres={data.stats.monthExpenses} />
          <MoneyStat label="نصيب مدرسين الشهر" piastres={data.stats.monthTeacherShare} />
        </div>
      )}

      {/* ===== Alerts ===== */}
      {isManager && (data.alerts?.length ?? 0) > 0 && (
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

      {/* ===== Manager: demo mode card ===== */}
      {isManager && <DemoCard user={user} onGoScan={() => setView("scan")} />}

      {/* ===== Now / next quick banner ===== */}
      {(nowSession || nextSession) && (
        <div className="grid md:grid-cols-2 gap-3">
          <SessionHero title="شغالة دلوقتي" session={nowSession ?? undefined} emptyText="مفيش حصة شغالة حالياً" onOpen={openSession} cta="افتح الحصة" />
          <SessionHero title="الميعاد الجاي" session={nextSession ?? (nowSession ? undefined : data.sessions.find((s) => s.status === "OPEN"))} emptyText="خلصت حصص النهاردة 🎉" onOpen={openSession} cta="التفاصيل" />
        </div>
      )}

      {/* ===== Today's lessons — كروت واضحة ===== */}
      <SectionCard title="حصص النهاردة" icon={<CalendarDays className="w-4 h-4" />}>
        {data.sessions.length === 0 && planned.length === 0 ? (
          <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش حصص النهاردة" hint="شوف الجدول الأسبوعي أو ضيف حصة جديدة." />
        ) : (
          <div className="space-y-3">
            {/* الحصص المفتوحة/المقفولة فعليًا */}
            {data.sessions.map((s) => {
              const phase = sessionPhase(s.startTime, s.endTime);
              const isOpen = s.status === "OPEN";
              const cancelled = s.status === "CANCELLED";
              const running = isOpen && phase === "now";
              const openedAt = s.openedAt ? formatTime12(s.openedAt.slice(11, 16)) : null;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "rounded-2xl border p-4 flex items-center gap-3.5 transition",
                    running ? "border-emerald-300 bg-emerald-50/70" :
                    cancelled ? "border-rose-200 bg-rose-50/40 opacity-75" :
                    isOpen ? "border-[color-mix(in_srgb,var(--c-primary)_30%,white)] bg-card" :
                    "border-border bg-muted/40 opacity-80",
                  )}
                >
                  <button onClick={() => !cancelled && openSession(s.id)} disabled={cancelled} className={cn("flex-1 min-w-0 text-start", cancelled && "cursor-default")}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        "nk-num text-center rounded-xl py-1.5 px-2.5 text-sm font-extrabold border",
                        running ? "bg-emerald-600 text-white border-transparent" : "bg-card border-border",
                      )} dir="ltr">
                        {formatTime12(s.startTime)}
                      </span>
                      <span className="font-extrabold text-[15px]">{s.subject} — {s.grade} {s.groupName}</span>
                      {running && <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">🟢 الحصة شغالة{openedAt && openedAt !== formatTime12(s.startTime) ? ` من ${openedAt}` : ""}</span>}
                      {cancelled && <span className="text-[11px] font-extrabold text-rose-600 dark:text-rose-300 inline-flex items-center gap-1"><Ban className="w-3.5 h-3.5" /> ملغاة</span>}
                      {s.status === "CLOSED" && <span className="text-[11px] font-bold text-muted-foreground inline-flex items-center gap-1"><DoorClosed className="w-3.5 h-3.5" /> مقفولة</span>}
                    </div>
                    <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      <span>{s.teacher}</span>
                      {s.room && <span className="nk-brand-text font-extrabold">{s.room}</span>}
                      {!cancelled && <span className="nk-num">{fmt(s.price)} ج · حضر {s.presentCount}</span>}
                      {s.status === "CLOSED" && s.closedAggregates && (
                        <span className="nk-num text-emerald-700 dark:text-emerald-300 font-extrabold">إيراد {fmt(s.closedAggregates.totalRevenue)} ج</span>
                      )}
                    </p>
                  </button>
                  {isOpen && (
                    <button
                      onClick={() => goScanForSession(s.id)}
                      className="shrink-0 rounded-xl px-4 py-3 font-extrabold text-sm flex items-center gap-2 active:scale-[0.98] transition shadow nk-brand-bg text-white"
                    >
                      <Zap className="w-4.5 h-4.5" />
                      امسح الحضور
                    </button>
                  )}
                </div>
              );
            })}

            {/* حصص مخططة من الجدول — لسه مش مفتوحة */}
            {planned.map((p) => {
              const phase = sessionPhase(p.startTime, p.endTime);
              return (
                <div key={`plan-${p.scheduleId}`} className="rounded-2xl border-2 border-dashed border-border bg-card p-4 flex items-center gap-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="nk-num text-center rounded-xl py-1.5 px-2.5 text-sm font-extrabold border border-dashed bg-muted/60 text-muted-foreground" dir="ltr">
                        {formatTime12(p.startTime)}
                      </span>
                      <span className="font-extrabold text-[15px]">{p.subject} — {p.grade} {p.groupName}</span>
                      {phase === "now" && <span className="text-[11px] font-extrabold text-amber-600 dark:text-amber-300">الوقت شغال</span>}
                    </div>
                    <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      <span>{p.teacher}</span>
                      {p.room && <span className="nk-brand-text font-extrabold">{p.room}</span>}
                      <span className="nk-num">{fmt(p.price)} ج · {p.students} طالب</span>
                    </p>
                  </div>
                  <button
                    onClick={() => openLesson(p.scheduleId)}
                    disabled={opening === p.scheduleId}
                    className="shrink-0 rounded-xl px-4 py-3 font-extrabold text-sm flex items-center gap-2 active:scale-[0.98] transition shadow border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text disabled:opacity-60"
                  >
                    {opening === p.scheduleId ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <LockOpen className="w-4.5 h-4.5" />}
                    فتح الحصة
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ===== Manager: cash + teachers ===== */}
      {isManager && data.cash && (
        <div className="grid md:grid-cols-2 gap-4">
          <SectionCard title="صندوق النهاردة" icon={<Wallet className="w-4 h-4" />}>
            <div className="grid grid-cols-2 gap-3">
              <MoneyStat label="افتتاحي الصندوق" piastres={data.cash.opening} tone="muted" />
              <MoneyStat label="دخل (كاش)" piastres={data.cash.cashIn} tone="success" />
              <MoneyStat label="خرج" piastres={data.cash.cashOut} tone="warning" />
              <MoneyStat label="المتوقع في الصندوق" piastres={data.cash.expected} tone="brand" />
            </div>
            {data.cash.difference !== null && (
              <div className={cn(
                "mt-3 rounded-xl border px-4 py-3 font-bold text-sm",
                data.cash.difference === 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                data.cash.difference > 0 ? "bg-sky-50 border-sky-200 text-sky-700" :
                "bg-rose-50 border-rose-200 text-rose-700"
              )}>
                <Scale className="w-4 h-4 inline me-1.5" />
                فرق الصندوق: {fmt(data.cash.difference)} جنيه {data.cash.difference < 0 ? "(ناقص)" : data.cash.difference > 0 ? "(زيادة)" : "(مظبوط)"}
              </div>
            )}
          </SectionCard>

          <SectionCard title="مستحقات المدرسين" icon={<Users className="w-4 h-4" />}>
            {(data.teacherPayables?.length ?? 0) === 0 ? (
              <EmptyState title="مفيش مستحقات دلوقتي" />
            ) : (
              <ul className="divide-y">
                {data.teacherPayables!.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2.5">
                    <span className="font-bold text-sm">{t.name}</span>
                    <span className={cn("text-sm font-extrabold nk-num", t.payable > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                      {t.payable > 0 ? `له ${fmtE(t.payable)}` : "تم الصرف"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function BigAction({ icon, label, desc, onClick, primary }: { icon: React.ReactNode; label: string; desc: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-2xl border p-4 flex flex-col items-start gap-2 text-start transition active:scale-[0.98] min-h-[110px] justify-between",
        primary ? "nk-brand-grad nk-portal-card text-white border-transparent shadow-lg" : "nk-card hover:shadow-md hover:border-[color-mix(in_srgb,var(--c-primary)_30%,white)]"
      )}
    >
      <span className={cn("rounded-xl p-2.5", primary ? "bg-white/20" : "nk-brand-bg-soft nk-brand-text")}>{icon}</span>
      <span>
        <span className="block font-extrabold text-[15px]">{label}</span>
        <span className={cn("block text-[11px] font-semibold", primary ? "text-white/95" : "text-muted-foreground")}>{desc}</span>
      </span>
    </button>
  );
}

function SessionHero({ title, session, emptyText, onOpen, cta }: {
  title: string; session?: SessionCard; emptyText: string; onOpen: (id: string) => void; cta: string;
}) {
  if (!session) {
    void emptyText;
    return null;
  }
  return (
    <button onClick={() => onOpen(session.id)} className="nk-card nk-anim-lift rounded-2xl p-5 w-full text-start hover:shadow-md transition active:scale-[0.99]">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-bold text-muted-foreground">{title}</span>
        <span className="nk-brand-bg-soft nk-brand-text text-[11px] font-extrabold rounded-full px-2.5 py-1">{formatTime12(session.startTime)} — {formatTime12(session.endTime)}</span>
      </div>
      <h3 className="font-extrabold text-lg">{session.subject} — {session.grade} {session.groupName}</h3>
      <p className="text-sm text-muted-foreground font-semibold mt-0.5">{session.teacher}{session.room ? ` · ${session.room}` : ""}</p>
      <div className="flex items-center gap-2 mt-3">
        <span className="nk-brand-text font-extrabold text-sm">{cta}</span>
        <ArrowLeft className="w-4 h-4 nk-brand-text" />
      </div>
    </button>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "صباح الخير";
  if (h < 17) return "نهار سعيد";
  return "مساء الخير";
}
