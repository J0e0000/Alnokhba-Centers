"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, Loader2, Ban, CheckCircle2, ChevronDown, Zap,
  TrendingUp, TrendingDown, AlertTriangle,
  UserPlus, Wallet, Users, Home,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, formatTime12, type SessionUser } from "./lib";
import { MoneyStat, Stat, SectionCard, Loading } from "./shared";
import { InstallCard } from "./pwa";
import type { ViewId } from "./shell";

/* ============================================================
   الرئيسية — مسار الحصص (نقل workflow المنصة الأساسية Alnokhba):
   • شريط الأيام (DayTimeline): اختيار اليوم بيقود قائمة الحصص — اليوم بتظهر
     اقتراحات الجدول، والأيام التانية حصص محفوظة بس (مراجعة — عمرها ما بتعمل إنشاء).
   • 3 كروت إحصاء بالظبط: حصص اليوم · طلاب اليوم · إجراءات معلقة (زرار بيقفز للحصة).
   • كروت الحصص: شريط تقدم مرصد/إجمالي + شارة الحالة + الحصة القادمة مميزة.
   • تنبيه الرصد: حصص شغالة فيها طلاب لم يُرصدوا + زرار إكمال الرصد.
   • تحتها محتوى السنترز المميز (محفوظ): ملخص تشغيلي للمدير + اختصارات + تنبيهات.
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

/** شريط الأيام — ‹ / 7 أيام (-3..+3) / › + زرار «اليوم ↺» — نفس تجربة المنصة الأساسية */
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
                "rounded-xl py-1.5 px-1 flex flex-col items-center gap-0.5 border-2 transition active:scale-[0.97]",
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

export function PipelineHome({ user, setView, openSession, goScanForSession }: {
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

  // ===== الصف الموحّد: حصص حقيقية + اقتراحات الجدول (اليوم بس) — نفس ترتيب المنصة الأساسية =====
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
      students?: number; cancelled?: boolean;
    };
    const list: Row[] = data.sessions.map((s) => ({
      key: `s-${s.id}`, kind: "session" as const, id: s.id,
      startTime: s.startTime, endTime: s.endTime, room: s.room,
      subject: s.subject, grade: s.grade, groupName: s.groupName, teacher: s.teacher,
      status: s.status, studentSource: s.studentSource,
      attendanceCount: s.attendanceCount, rosterTotal: s.rosterTotal, presentCount: s.presentCount,
      cancelled: s.status === "CANCELLED",
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

  // ===== إحصاءات الـ 3 كروت (نفس حسابات المنصة الأساسية) =====
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

  // أول حصة شغالة فيها رصد ناقص — هدف زرار «إجراءات معلقة» و«إكمال الرصد»
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

  if (!data) return <Loading />;

  return (
    <div className="space-y-5 nk-anim-stagger">
      {/* ===== Hero — مسار الحصص ===== */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black tracking-widest nk-brand-text uppercase">مسار الحصص</div>
          <h1 className="text-xl sm:text-2xl font-black mt-1 mb-1 leading-snug">يومك الدراسي في مسار واحد</h1>
          <p className="text-xs font-bold text-muted-foreground m-0">
            اختر اليوم، افتح الحصة، أنجز المطلوب، وأغلقها بدون التنقل بين شاشات كثيرة.
          </p>
        </div>
      </div>

      <InstallCard />

      {/* ===== شريط الأيام ===== */}
      <DayTimeline value={selectedDay} onChange={setSelectedDay} />

      {/* ===== 3 كروت إحصاء — بالظبط زي المنصة الأساسية ===== */}
      <div className="grid grid-cols-3 gap-3">
        <NkStat small={dayIsToday ? "حصص اليوم" : "حصص اليوم المحدد"} value={stats.sessionsCount} />
        <NkStat small={dayIsToday ? "طلاب اليوم" : "طلاب اليوم المحدد"} value={stats.studentsToday} />
        {dayIsToday && stats.pending > 0 && pendingSession ? (
          <button className="nk-stat-gold text-start cursor-pointer" onClick={() => pendingSession.id && openSession(pendingSession.id)}>
            <small>إجراءات معلقة — متابعة ←</small>
            <strong>{stats.pending}</strong>
          </button>
        ) : (
          <div className="nk-stat-gold">
            <small>إجراءات معلقة</small>
            <strong>{stats.pending}</strong>
          </div>
        )}
      </div>

      {/* ===== حصص اليوم ===== */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-3">
          <h2 className="text-base font-extrabold m-0">{heading}</h2>
          <span className="text-[11px] font-bold text-muted-foreground">اضغط على الحصة لفتح مساحة العمل</span>
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
              const isPlanned = r.kind === "planned";
              const marked = r.attendanceCount ?? 0;
              const total = r.rosterTotal ?? marked;
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
                    <span className="nk-session-icon shrink-0" aria-hidden>
                      {r.status === "CANCELLED" ? <Ban className="w-5 h-5" /> : <Home className="w-5 h-5" />}
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
                          <span className="text-[.66rem] font-bold text-muted-foreground nk-num" dir="ltr">{marked}/{total} مرصد</span>
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
      </div>

      {/* ===== تنبيه الرصد (نفس قاعدة المنصة الأساسية) ===== */}
      {dayIsToday && pendingSession && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3">
          <span className="text-sm font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
            حصص جارية لديها طلاب لم يُرصد حضورهم بعد — أكمل الرصد قبل الإنهاء.
          </span>
          {pendingSession.id && (
            <button
              onClick={() => openSession(pendingSession.id!)}
              className="shrink-0 rounded-xl bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 text-xs font-extrabold shadow active:scale-[0.98] transition"
            >
              إكمال الرصد ←
            </button>
          )}
        </div>
      )}

      {isManager && (legacy?.alerts?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {legacy!.alerts!.map((a, i) => (
            <div key={i} className={cn(
              "flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold",
              a.level === "warn" ? "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200" : "bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200",
            )}>
              <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
              {a.text}
            </div>
          ))}
        </div>
      )}

      {isManager && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <BigAction icon={<Zap className="w-7 h-7" />} label="امسح الحضور" desc="كشف حصة شغالة" onClick={() => setView("scan")} primary />
          <BigAction icon={<Wallet className="w-6 h-6" />} label="تسجيل دفعة" desc="استلام فلوس" onClick={() => setView("payments")} />
          <BigAction icon={<UserPlus className="w-6 h-6" />} label="إضافة طالب" desc="تسجيل طالب جديد" onClick={() => setView("students")} />
        </div>
      )}
      {isTeacher && (
        <div className="grid grid-cols-2 gap-3">
          <BigAction icon={<CalendarDays className="w-6 h-6" />} label="جدول النهاردة" desc={`${stats.sessionsCount} حصة`} onClick={() => setView("schedule")} primary />
          <BigAction icon={<Users className="w-6 h-6" />} label="طلابي" desc="متابعة الطلاب" onClick={() => setView("students")} />
        </div>
      )}
      {!isManager && !isTeacher && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <BigAction icon={<Zap className="w-7 h-7" />} label="امسح QR" desc="تسجيل حضور فوري" onClick={() => setView("scan")} primary />
          <BigAction icon={<Users className="w-6 h-6" />} label="ابحث عن طالب" desc="بالاسم أو الكود" onClick={() => setView("students")} />
          <BigAction icon={<Wallet className="w-6 h-6" />} label="تسجيل دفع" desc="استلام فلوس" onClick={() => setView("payments")} />
          <BigAction icon={<Users className="w-6 h-6" />} label="الطلاب" onClick={() => setView("students")} />
          <BigAction icon={<CalendarDays className="w-6 h-6" />} label="جدول الأسبوع" onClick={() => setView("schedule")} />
        </div>
      )}

      {isManager && legacy?.insight && <InsightCard insight={legacy.insight} setView={setView} />}
      {isManager && <ManagerExtras data={legacy} />}
    </div>
  );
}

// ─── كروت الإحصاء بنمط المنصة الأساسية (nk-stat) ───
function NkStat({ small, value }: { small: string; value: number }) {
  return (
    <div className="rounded-2xl border-2 border-border bg-card px-3.5 py-3">
      <small className="block text-[11px] font-extrabold text-muted-foreground">{small}</small>
      <strong className="block text-2xl font-black nk-num mt-0.5">{value}</strong>
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

// ─── المكوّنات المحفوظة من داشبورد السنترز (نفس السلوك) ───

function ManagerExtras({ data }: { data: LegacyDash | null }) {
  if (!data) return null;
  return (
    <div className="space-y-4">
      {data.stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MoneyStat label="تحصيل النهاردة" piastres={data.stats.collectedToday} tone="brand" icon={<Wallet className="w-4 h-4" />} />
            <Stat label="حضور النهاردة" value={data.stats.attendanceToday} hint="طالب" />
            <MoneyStat label="صافي الشهر" piastres={data.stats.monthNet} tone={(data.stats.monthNet ?? 0) >= 0 ? "success" : "danger"} />
            <MoneyStat label="مستحقات على الطلاب" piastres={data.stats.totalOwed} tone="warning" />
          </div>
          <details className="group rounded-2xl border border-border bg-card">
            <summary className="cursor-pointer select-none list-none px-4 py-3 text-[12.5px] font-extrabold text-muted-foreground flex items-center justify-between hover:text-foreground transition">
              باقي أرقام الشهر — إيراد · مصروفات · أرصدة · نصيب المدرسين
              <ChevronDown className="w-4 h-4 transition group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pb-4">
              <MoneyStat label="إيراد الشهر" piastres={data.stats.monthRevenue} />
              <MoneyStat label="مصروفات الشهر" piastres={data.stats.monthExpenses} />
              <MoneyStat label="أرصدة الطلاب" piastres={data.stats.totalCredit} />
              <MoneyStat label="نصيب مدرسين الشهر" piastres={data.stats.monthTeacherShare} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function InsightCard({ insight, setView }: { insight: NonNullable<LegacyDash["insight"]>; setView: (v: ViewId) => void }) {
  const pct = insight.changePct;
  if (pct === null || insight.prevWeek < 5 || (pct > -8 && pct < 8)) return null;
  const down = pct < 0;
  return (
    <div className={cn(
      "rounded-2xl border-2 p-4 flex items-start gap-3.5",
      down ? "bg-amber-50/70 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800" : "bg-emerald-50/70 border-emerald-300 dark:bg-emerald-950/20 dark:border-emerald-800",
    )}>
      <span className={cn("rounded-xl p-2.5 shrink-0", down ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300")}>
        {down ? <TrendingDown className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold text-sm leading-relaxed">
          الحضور {down ? "نزل" : "زاد"} <span className="nk-num">{Math.abs(pct)}%</span> الأسبوع ده مقارنة بالأسبوع اللي فات
          <span className="text-muted-foreground font-bold"> — <span className="nk-num">{insight.thisWeek}</span> مقابل <span className="nk-num">{insight.prevWeek}</span> تسجيل حضور</span>
        </p>
        {down && insight.topDrop && (
          <p className="text-xs font-bold text-muted-foreground mt-1">
            الأكثر تأثرًا: <span className="text-foreground font-extrabold">{insight.topDrop.label}</span> — يستاهل مراجعة.
          </p>
        )}
      </div>
      <button
        onClick={() => setView("reports")}
        className={cn(
          "shrink-0 rounded-xl px-3.5 py-2 text-xs font-extrabold border-2 active:scale-[0.98] transition",
          down ? "border-amber-300 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-700 dark:hover:bg-amber-900/40" : "border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200 dark:border-emerald-700 dark:hover:bg-emerald-900/40",
        )}
      >
        شوف التقارير
      </button>
    </div>
  );
}

function OpsSummaryStrip({ summary, openSession, setView }: {
  summary: NonNullable<LegacyDash["opsSummary"]>;
  openSession: (id: string, opts?: { tab?: "overview" | "attendance" | "operations" | "review"; qrFullscreen?: boolean }) => void;
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

function BigAction({ icon, label, desc, onClick, primary }: { icon: React.ReactNode; label: string; desc?: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-2xl border p-4 flex flex-col items-start gap-2 text-start transition active:scale-[0.98] min-h-[100px] justify-between",
        primary ? "nk-brand-grad nk-portal-card text-white border-transparent shadow-lg" : "nk-card hover:shadow-md hover:border-[color-mix(in_srgb,var(--c-primary)_30%,white)]",
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

// keep fmt referenced for future price chips on cards
void Ban;
