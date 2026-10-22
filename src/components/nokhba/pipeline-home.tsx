"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, Loader2, Ban, Zap, TrendingUp, TrendingDown, AlertTriangle,
  UserPlus, Wallet, Users, ScanLine, BarChart3, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, type SessionUser } from "./lib";
import { Loading } from "./shared";
import { AlertsCard } from "./alerts-card";
import { InstallCard } from "./pwa";
import { OnboardingQuest } from "./onboarding";
import type { ViewId } from "./shell";

/* ============================================================
   الرئيسية — «يومك في شاشة واحدة» (تصميم 2026 المبسّط):
   • سطر ترحيب هادئ بدل الـ hero الضخم.
   • شريط الأيام (DayTimeline): اختيار اليوم بيقود قائمة الحصص.
   • شريط أرقام واحد أنيق (كارت واحد بخلايا مفصولة) بدل تايلز متدرجة ثقيلة.
   • حصص اليوم: صفوف نظيفة + شارة «ناقص رصد» على الصف نفسه (بدل بانر منفصل).
   • إجراءات سريعة: شريط أزرار compact بدل كروت ضخمة.
   • للمدير: التنبيهات الذكية + أرقام الشهر في details قابل للطي.
   محفوظ من التصميم السابق: التنبيهات الذكية (المرحلة 6) + كارت التثبيت + رحلة البداية.
============================================================ */

// ─── أنواع البيانات (GET /api/sessions?date=) ───
type DaySession = {
  id: string;
  startTime: string; endTime: string; room: string | null; status: "OPEN" | "CLOSED" | "CANCELLED";
  subject: string; grade: string; groupName: string; teacher: string; teacherId: string | null;
  price: number; teacherPercent: number;
  studentSource: "ROSTER" | "OPEN"; studentCodeLength: number | null; allowUnregistered: boolean;
  openedAt: string | null; attendanceCount: number; rosterTotal: number | null;
  presentCount: number; closed: boolean;
  aggregates: { totalRevenue: number; teacherShare: number; centerShare: number; presentCount: number } | null;
};
type Suggestion = {
  scheduleId: string; startTime: string; endTime: string; room: string | null;
  subject: string; grade: string; groupName: string; teacher: string;
  price: number; teacherPercent: number; students: number;
};
type SessionsRes = { date: string; sessions: DaySession[]; suggestions: Suggestion[] };

type LegacyDash = {
  opsSummary?: {
    activeSessions: number;
    attention: { id: string; subject: string; groupName: string; endTime: string }[];
    pendingApprovals: number;
    paymentIssues: { id: string }[];
  };
  stats?: { attendanceToday: number; collectedToday: number; monthRevenue: number; monthTeacherShare: number; monthCenterShare: number; monthExpenses: number; monthNet: number; totalOwed: number; totalCredit: number; activeStudents: number };
  alerts?: { level: string; text: string }[];
  insight?: { thisWeek: number; prevWeek: number; changePct: number | null; topDrop: { label: string; changePct: number } | null } | null;
};

// ─── أدوات التاريخ (نفس منطق DayTimeline في المنصة الأساسية) ───
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const AR_WD = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const AR_WD_FULL = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** شريط الأيام — ‹ / 7 أيام (-3..+3) / › + زرار «اليوم ↺» */
function DayTimeline({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const days = useMemo(() => [-3, -2, -1, 0, 1, 2, 3].map((n) => addDaysISO(value, n)), [value]);
  const today = todayISO();
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="اختيار اليوم">
      <button
        type="button" onClick={() => onChange(addDaysISO(value, -1))}
        className="w-9 h-11 shrink-0 rounded-xl border border-border bg-card grid place-items-center text-lg font-black text-muted-foreground hover:text-foreground active:scale-95 transition"
        aria-label="اليوم السابق"
      >‹</button>
      <div className="flex-1 grid grid-cols-7 gap-1.5" role="listbox" aria-label="أيام الأسبوع">
        {days.map((iso) => {
          const selected = iso === value;
          const isT = iso === today;
          const wd = AR_WD[new Date(`${iso}T00:00:00`).getDay()];
          return (
            <button
              key={iso} type="button" role="option" aria-selected={selected}
              onClick={() => onChange(iso)}
              className={cn(
                "rounded-xl py-1.5 px-1 flex flex-col items-center gap-0.5 border transition active:scale-[0.97]",
                selected
                  ? "nk-brand-grad text-white border-transparent shadow"
                  : "border-border bg-card hover:border-[color-mix(in_srgb,var(--c-primary)_35%,white)]",
                isT && !selected && "border-[color-mix(in_srgb,var(--c-primary)_45%,white)]",
              )}
            >
              <small className={cn("text-[10px] font-extrabold leading-none", selected ? "text-white/90" : "text-muted-foreground")}>
                {isT ? "اليوم" : wd}
              </small>
              <b className={cn("text-[15px] nk-num leading-none", selected ? "text-white" : "")}>{Number(iso.slice(8, 10))}</b>
            </button>
          );
        })}
      </div>
      <button
        type="button" onClick={() => onChange(addDaysISO(value, 1))}
        className="w-9 h-11 shrink-0 rounded-xl border border-border bg-card grid place-items-center text-lg font-black text-muted-foreground hover:text-foreground active:scale-95 transition"
        aria-label="اليوم التالي"
      >›</button>
      {value !== today && (
        <button
          type="button" onClick={() => onChange(today)}
          className="shrink-0 rounded-xl px-3 h-11 text-xs font-extrabold nk-brand-text nk-brand-bg-soft active:scale-95 transition"
        >
          اليوم ↺
        </button>
      )}
    </div>
  );
}

// ─── خلية رقم واحدة في شريط الأرقام ───
function NumCell({ label, value, suffix, tone, onClick }: {
  label: string; value: string | number; suffix?: string;
  tone?: "amber" | "brand" | "mut"; onClick?: () => void;
}) {
  const Tag = (onClick ? "button" : "div") as "button";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "px-2 sm:px-4 py-3.5 text-center min-w-0 transition",
        onClick && "cursor-pointer active:scale-[0.98] hover:bg-amber-500/[.06]",
      )}
    >
      <small className="block text-[10px] sm:text-[10.5px] font-bold text-muted-foreground truncate">{label}</small>
      <strong className={cn(
        "block text-[1.3rem] sm:text-[1.45rem] font-black leading-tight mt-0.5 nk-num",
        tone === "amber" && "text-amber-600 dark:text-amber-400",
        tone === "brand" && "nk-brand-text",
        tone === "mut" && "text-muted-foreground",
      )}>
        {value}{suffix && <span className="text-[11px] font-extrabold text-muted-foreground ms-1">{suffix}</span>}
      </strong>
    </Tag>
  );
}

// ─── زرار الإجراءات السريعة ───
function QuickBtn({ icon: Icon, label, onClick, primary }: {
  icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl h-11 px-4 text-[13px] font-extrabold transition active:scale-[0.97] whitespace-nowrap",
        primary
          ? "nk-brand-bg text-white shadow"
          : "border border-border bg-card hover:border-[color-mix(in_srgb,var(--c-primary)_35%,white)] hover:shadow-sm",
      )}
    >
      <Icon className={cn("w-4 h-4", !primary && "nk-brand-text")} />
      {label}
    </button>
  );
}

// ─── رقم صغير داخل details أرقام الشهر ───
function MiniNum({ label, value, tone }: { label: string; value: string; tone?: "amber" | "ok" }) {
  return (
    <div className="py-1.5 min-w-0">
      <small className="block text-[10px] font-bold text-muted-foreground truncate">{label}</small>
      <b className={cn(
        "block text-[14px] font-black nk-num mt-0.5 truncate",
        tone === "amber" && "text-amber-600 dark:text-amber-400",
        tone === "ok" && "text-emerald-600 dark:text-emerald-400",
      )}>{value}</b>
    </div>
  );
}

export function PipelineHome({ user, setView, openSession }: {
  user: SessionUser;
  setView: (v: ViewId) => void;
  openSession: (id: string, opts?: { tab?: "overview" | "attendance" | "operations" | "review"; qrFullscreen?: boolean }) => void;
  goScanForSession: (id: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState(todayISO);
  const dayIsToday = selectedDay === todayISO();
  const [data, setData] = useState<SessionsRes | null>(null);
  const [legacy, setLegacy] = useState<LegacyDash | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const isManager = user.role === "MANAGER";
  const isTeacher = user.role === "TEACHER";

  // حصص اليوم المحدد — البولينج 25ث زي ما كان + تحديث فوري بعد أي عملية فتح
  const load = useCallback(() => {
    api<SessionsRes>(`/api/sessions?date=${selectedDay}`)
      .then((d) => setData(d))
      .catch(() => {});
  }, [selectedDay]);
  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const onChange = () => load();
    window.addEventListener("nk-sessions-changed", onChange);
    return () => { clearInterval(t); window.removeEventListener("nk-sessions-changed", onChange); };
  }, [load]);

  useEffect(() => {
    if (!isManager) return;
    let alive = true;
    const loadDash = () => api<LegacyDash>("/api/dashboard", { silent: true }).then((d) => alive && setLegacy(d)).catch(() => {});
    loadDash();
    const t = setInterval(loadDash, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [isManager]);

  // ===== الصف الموحّد: حصص حقيقية + اقتراحات الجدول (اليوم بس) =====
  const rows = useMemo(() => {
    if (!data) return [];
    type Row = {
      key: string; kind: "session" | "planned";
      id?: string; scheduleId?: string;
      startTime: string; endTime: string; room: string | null;
      subject: string; grade: string; groupName: string; teacher: string;
      status: "OPEN" | "CLOSED" | "CANCELLED" | "PLANNED";
      studentSource?: "ROSTER" | "OPEN";
      attendanceCount?: number; rosterTotal?: number | null; presentCount?: number;
      students?: number;
    };
    const list: Row[] = data.sessions.map((s) => ({
      key: `s-${s.id}`, kind: "session" as const, id: s.id,
      startTime: s.startTime, endTime: s.endTime, room: s.room,
      subject: s.subject, grade: s.grade, groupName: s.groupName, teacher: s.teacher,
      status: s.status, studentSource: s.studentSource,
      attendanceCount: s.attendanceCount, rosterTotal: s.rosterTotal, presentCount: s.presentCount,
    }));
    // الأيام غير النهاردة: مفيش اقتراحات — حصص محفوظة بس (المراجعة عمرها ما بتنشئ حصة)
    if (dayIsToday) {
      for (const p of data.suggestions) {
        list.push({
          key: `p-${p.scheduleId}`, kind: "planned" as const, scheduleId: p.scheduleId,
          startTime: p.startTime, endTime: p.endTime, room: p.room,
          subject: p.subject, grade: p.grade, groupName: p.groupName, teacher: p.teacher,
          status: "PLANNED", students: p.students,
        });
      }
    }
    const order: Record<string, number> = { OPEN: 0, PLANNED: 1, CLOSED: 2, CANCELLED: 3 };
    return list.sort((a, b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.startTime.localeCompare(b.startTime);
    });
  }, [data, dayIsToday]);

  // ===== إحصاءات شريط الأرقام =====
  const stats = useMemo(() => {
    const sessionsCount = rows.length;
    let studentsToday = 0;
    let pending = 0;
    for (const r of rows) {
      if (r.status === "CANCELLED") continue;
      const total = r.kind === "planned" ? (r.students ?? 0)
        : r.studentSource === "OPEN" ? (r.attendanceCount ?? 0)
        : (r.rosterTotal ?? r.attendanceCount ?? 0);
      studentsToday += total;
      if (r.status === "OPEN") {
        const marked = r.attendanceCount ?? 0;
        const tot = r.rosterTotal ?? marked;
        pending += Math.max(0, tot - marked);
      } else if (r.status === "PLANNED") {
        pending += r.students ?? 0;
      }
    }
    return { sessionsCount, studentsToday, pending };
  }, [rows]);

  // أول حصة شغالة فيها رصد ناقص — هدف خلية «معلقات»
  const pendingSession = rows.find((r) => r.status === "OPEN" && (r.rosterTotal ?? 0) > (r.attendanceCount ?? 0));
  // الحصة القادمة = أول غير منتهية (شغالة ثم مخططة) — بتاخد التمييز البصري
  const nextKey = rows.length && (rows[0].status === "OPEN" || rows[0].status === "PLANNED") ? rows[0].key : null;

  async function openPlanned(scheduleId: string) {
    setOpening(scheduleId);
    try {
      const res = await api<{ session: { id: string } }>("/api/sessions", { method: "POST", body: { scheduleId } });
      toast.success("اتفتحت الحصة — سجّل الحضور وابعط لحد ما تقفلها.");
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      openSession(res.session.id);
    } catch { /* toast */ } finally { setOpening(null); }
  }

  function openRow(r: (typeof rows)[number]) {
    if (r.kind === "planned" && dayIsToday) void openPlanned(r.scheduleId!);
    else if (r.kind === "session" && r.id) openSession(r.id);
  }

  const heading = dayIsToday ? "حصص اليوم" : `حصص يوم ${AR_WD_FULL[new Date(`${selectedDay}T00:00:00`).getDay()]}`;
  const h = new Date().getHours();
  const greeting = h < 12 ? "صباح الخير" : h < 17 ? "نهار سعيد" : "مساء الخير";
  const dateLabel = new Date().toLocaleDateString("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

  if (!data) return <Loading />;

  return (
    <div className="space-y-4 nk-anim-stagger">
      {/* ===== 1. سطر ترحيب هادئ — سطر واحد بدل hero ضخم ===== */}
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[1.15rem] sm:text-xl font-black m-0 leading-snug">
          {greeting}، {user.name.split(" ")[0]} <span aria-hidden className="align-middle">👋</span>
        </h1>
        <span className="hidden sm:block text-[11.5px] font-extrabold text-muted-foreground whitespace-nowrap">
          {dateLabel}
        </span>
      </div>

      {/* ===== 2. شريط الأيام ===== */}
      <DayTimeline value={selectedDay} onChange={setSelectedDay} />

      {/* ===== 3. شريط الأرقام — كارت واحد بخلايا مفصولة بدل تايلز ثقيلة ===== */}
      <div className={cn(
        "grid rounded-2xl border border-border bg-card overflow-hidden divide-x divide-border",
        isManager ? "grid-cols-4" : "grid-cols-3",
      )}>
        <NumCell label={dayIsToday ? "حصص اليوم" : "الحصص"} value={stats.sessionsCount} />
        <NumCell label={dayIsToday ? "طلاب اليوم" : "الطلاب"} value={stats.studentsToday} tone="brand" />
        {dayIsToday && stats.pending > 0 && pendingSession?.id ? (
          <NumCell label="رصد معلّق" value={stats.pending} tone="amber" onClick={() => openSession(pendingSession.id!)} />
        ) : (
          <NumCell label="رصد معلّق" value={stats.pending} tone={stats.pending > 0 ? "amber" : "mut"} />
        )}
        {isManager && legacy?.stats && (
          <NumCell label="تحصيل اليوم" value={fmt(legacy.stats.collectedToday)} suffix="ج" />
        )}
      </div>

      {/* ===== 4. حصص اليوم ===== */}
      <section className="nk2-card">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-3">
          <h2 className="nk2-sec-title">
            {heading}
            {rows.length > 0 && <span className="ms-2 text-[11px] font-extrabold text-muted-foreground nk-num">({rows.length})</span>}
          </h2>
          <span className="nk2-sec-sub">اضغط على الحصة لفتح مساحة العمل</span>
        </div>

        {rows.length === 0 ? (
          <div className="nk-card rounded-2xl text-center py-10 px-4">
            <CalendarDays className="w-9 h-9 mx-auto text-muted-foreground/60" />
            <p className="font-extrabold mb-1 mt-2">
              {dayIsToday ? "لا توجد حصص مجدولة اليوم" : "لا توجد حصص في هذا اليوم"}
            </p>
            <p className="text-xs font-bold text-muted-foreground m-0">
              {dayIsToday ? "أضف مواعيد المجموعات من الجدول الأسبوعي." : "اختر يومًا آخر من الشريط الزمني بالأعلى."}
            </p>
            {dayIsToday && (
              <button
                onClick={() => setView("schedule")}
                className="mt-4 rounded-xl nk-brand-bg text-white px-4 py-2.5 text-[13px] font-extrabold shadow active:scale-[0.98] transition inline-flex items-center gap-2"
              >
                ＋ إضافة مواعيد المجموعات
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-2.5">
            {rows.map((r) => {
              const isNext = dayIsToday && r.key === nextKey;
              const clickable = r.status === "OPEN" || r.status === "CLOSED" || (r.status === "PLANNED" && dayIsToday);
              const marked = r.attendanceCount ?? 0;
              const total = r.rosterTotal ?? marked;
              const unmarked = r.status === "OPEN" && r.studentSource !== "OPEN" ? Math.max(0, total - marked) : 0;
              const showProgress = r.status === "OPEN" && r.studentSource !== "OPEN" && (r.rosterTotal ?? 0) > 0;
              return (
                <button
                  key={r.key}
                  className={cn(
                    "nk-session-card text-start",
                    isNext && "nk-session-card-next",
                    !clickable && "cursor-default",
                  )}
                  style={!clickable ? { opacity: 0.6 } : undefined}
                  onClick={() => clickable && openRow(r)}
                  aria-label={`فتح ${r.subject}`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="nk2-av shrink-0" aria-hidden>
                      {r.status === "CANCELLED" ? <Ban className="w-5 h-5" /> : (r.subject?.trim()?.[0] ?? "•")}
                    </span>
                    <span className="min-w-0">
                      {isNext && (
                        <span className="nk-next-badge mb-1.5">
                          {r.status === "OPEN" ? "▶ أكمل هذه الحصة الآن" : "★ الحصة القادمة"}
                        </span>
                      )}
                      <b className="block text-[.9rem] truncate">{sessionTitle(r)}</b>
                      <small className="block text-[.72rem] text-muted-foreground font-bold mt-1 truncate">
                        {r.grade !== "—" ? `${r.grade} · ` : ""}
                        <span className="nk-num">{formatTime12(r.startTime)}</span>
                        {r.room ? ` · ${r.room}` : ""}
                        {r.status === "PLANNED"
                          ? ` · ${r.students ?? 0} طالب`
                          : r.studentSource === "OPEN"
                            ? ` · حضور مفتوح · اتسجل ${marked}`
                            : ` · ${total} طالب`}
                      </small>
                      {showProgress && (
                        <span className="flex items-center gap-2 mt-1.5">
                          <span className="nk-bar w-24"><span style={{ width: `${total ? Math.round((marked / total) * 100) : 0}%` }} /></span>
                          <span className="text-[.66rem] font-bold text-muted-foreground nk-num" dir="ltr">{marked}/{total}</span>
                          {unmarked > 0 && (
                            <span className="rounded-full bg-amber-500/12 border border-amber-500/35 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[.62rem] font-black whitespace-nowrap">
                              ناقص {unmarked} رصد
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusPill status={r.status} />
                    <span className="text-[.68rem] font-extrabold nk-brand-text whitespace-nowrap">
                      {r.status === "CANCELLED"
                        ? "—"
                        : r.status === "PLANNED"
                          ? (opening === r.scheduleId ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "فتح الحصة ←")
                          : r.status === "OPEN"
                            ? "متابعة ←"
                            : (dayIsToday ? "عرض ←" : "مراجعة ←")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== 5. إجراءات سريعة — شريط واحد compact بدل كروت ضخمة ===== */}
      <div>
        <p className="text-[11px] font-extrabold text-muted-foreground mb-2 mt-0">إجراءات سريعة</p>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <>
              <QuickBtn icon={Zap} label="امسح الحضور" onClick={() => setView("scan")} primary />
              <QuickBtn icon={Wallet} label="تسجيل دفعة" onClick={() => setView("payments")} />
              <QuickBtn icon={UserPlus} label="إضافة طالب" onClick={() => setView("students")} />
              <QuickBtn icon={BarChart3} label="التقارير" onClick={() => setView("reports")} />
            </>
          )}
          {isTeacher && (
            <>
              <QuickBtn icon={CalendarDays} label="جدولي" onClick={() => setView("schedule")} primary />
              <QuickBtn icon={Users} label="طلابي" onClick={() => setView("students")} />
            </>
          )}
          {!isManager && !isTeacher && (
            <>
              <QuickBtn icon={ScanLine} label="امسح QR" onClick={() => setView("scan")} primary />
              <QuickBtn icon={Wallet} label="تسجيل دفعة" onClick={() => setView("payments")} />
              <QuickBtn icon={UserPlus} label="إضافة طالب" onClick={() => setView("students")} />
              <QuickBtn icon={Users} label="الطلاب" onClick={() => setView("students")} />
              <QuickBtn icon={CalendarDays} label="الجدول الأسبوعي" onClick={() => setView("schedule")} />
            </>
          )}
        </div>
      </div>

      {/* ===== 6. للمدير: تنبيهات الاشتراك/الصندوق (chips خفيفة) + التنبيهات الذكية ===== */}
      {isManager && (legacy?.alerts?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          {legacy!.alerts!.map((a, i) => (
            <span key={i} className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-extrabold",
              a.level === "warn"
                ? "border-amber-300 text-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200"
                : "border-sky-300 text-sky-800 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200",
            )}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {a.text}
            </span>
          ))}
        </div>
      )}
      {isManager && <AlertsCard />}

      {/* ===== 7. للمدير: تغيّر الحضور الأسبوعي (يظهر بس لما يكون فيه تغير ملحوظ) ===== */}
      {isManager && legacy?.insight && <InsightCard insight={legacy.insight} setView={setView} />}

      {/* ===== 8. للمدير: أرقام الشهر — سطر واحد + details للتفاصيل ===== */}
      {isManager && legacy?.stats && <MonthLine stats={legacy.stats} />}

      {/* ===== غير اليومي تحت — تثبيت التطبيق + رحلة البداية (بيخفوا لوحدهم) ===== */}
      <InstallCard />
      <OnboardingQuest user={user} setView={setView} />
    </div>
  );
}

function StatusPill({ status }: { status: "OPEN" | "CLOSED" | "CANCELLED" | "PLANNED" }) {
  if (status === "OPEN") return <span className="nk-pill-live">● شغالة الآن</span>;
  if (status === "CLOSED") return <span className="nk-pill-done">✓ منتهية</span>;
  if (status === "CANCELLED") return <span className="nk-pill-muted"><Ban className="w-3 h-3 inline" /> ملغاة</span>;
  return <span className="nk-pill-pending">○ لم تبدأ</span>;
}

/** عنوان حصة من غير «— — —» */
function sessionTitle(r: { subject: string; grade: string; groupName: string }) {
  const tail = [r.grade, r.groupName].filter((x) => x && x.trim() && x.trim() !== "—");
  return tail.length ? `${r.subject} — ${tail.join(" ")}` : r.subject;
}

// ─── للمدير: أرقام الشهر — ملخص مطوي أنيق ───
function MonthLine({ stats }: { stats: NonNullable<LegacyDash["stats"]> }) {
  const net = stats.monthNet;
  return (
    <details className="group rounded-2xl border border-border bg-card overflow-hidden">
      <summary className="cursor-pointer list-none select-none px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-muted/40 transition">
        <span className="text-[12.5px] font-extrabold text-muted-foreground">أرقام الشهر</span>
        <span className="flex items-center gap-2 text-[12.5px] min-w-0">
          <span className="font-bold text-muted-foreground whitespace-nowrap">صافي السنتر</span>
          <b className={cn("nk-num font-black whitespace-nowrap", net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {fmt(net)} ج
          </b>
          <ChevronDown className="w-4 h-4 text-muted-foreground transition group-open:rotate-180 shrink-0" />
        </span>
      </summary>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-x-3 px-4 pb-4 pt-2 border-t border-border">
        <MiniNum label="إيراد الشهر" value={`${fmt(stats.monthRevenue)} ج`} />
        <MiniNum label="مصروفات الشهر" value={`${fmt(stats.monthExpenses)} ج`} />
        <MiniNum label="مستحقات على الطلاب" value={`${fmt(stats.totalOwed)} ج`} tone="amber" />
        <MiniNum label="أرصدة الطلاب" value={`${fmt(stats.totalCredit)} ج`} tone="ok" />
        <MiniNum label="نصيب المدرسين" value={`${fmt(stats.monthTeacherShare)} ج`} />
      </div>
    </details>
  );
}

// ─── للمدير: تغيّر الحضور الأسبوعي — يظهر بس لما يكون فيه تغير ملحوظ ───
function InsightCard({ insight, setView }: { insight: NonNullable<LegacyDash["insight"]>; setView: (v: ViewId) => void }) {
  const pct = insight.changePct;
  if (pct === null || insight.prevWeek < 5 || (pct > -8 && pct < 8)) return null;
  const down = pct < 0;
  return (
    <div className={cn(
      "rounded-2xl border p-4 flex items-start gap-3.5",
      down ? "bg-amber-50/70 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800" : "bg-emerald-50/70 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800",
    )}>
      <span className={cn("rounded-xl p-2.5 shrink-0", down ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300")}>
        {down ? <TrendingDown className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-sm leading-relaxed m-0">
          الحضور {down ? "نزل" : "زاد"} <span className="nk-num">{Math.abs(pct)}%</span> الأسبوع ده مقارنة بالأسبوع اللي فات
          <span className="text-muted-foreground font-bold"> — <span className="nk-num">{insight.thisWeek}</span> مقابل <span className="nk-num">{insight.prevWeek}</span> تسجيل حضور</span>
        </p>
        {down && insight.topDrop && (
          <p className="text-xs font-bold text-muted-foreground mt-1 m-0">
            الأكثر تأثرًا: <span className="text-foreground font-extrabold">{insight.topDrop.label}</span> — يستاهل مراجعة.
          </p>
        )}
      </div>
      <button
        onClick={() => setView("reports")}
        className={cn(
          "shrink-0 rounded-xl px-3.5 py-2 text-xs font-extrabold border active:scale-[0.98] transition",
          down ? "border-amber-300 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-700 dark:hover:bg-amber-900/40" : "border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:border-emerald-700 dark:hover:bg-emerald-900/40",
        )}
      >
        شوف التقارير
      </button>
    </div>
  );
}
