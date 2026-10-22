"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ScanLine, Search, CreditCard, Users, CalendarDays, ArrowLeft,
  Wallet, TrendingUp, Receipt, AlertTriangle, GraduationCap, Banknote, DoorClosed,
  LockOpen, Loader2, Zap, Ban, CheckCircle2, LayoutDashboard, CalendarClock, BarChart3,
  QrCode, Keyboard, Fingerprint, Flame, CircleDollarSign, School,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, sessionPhase, userCan, type SessionUser } from "./lib";
import { PageHeader, SectionCard, Loading, EmptyState } from "./shared";
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

type DashData = {
  today: string;
  sessions: SessionCard[];
  plannedSessions?: PlannedSession[];
  role: string;
  /** TEACHER بس: false = الحساب مش مربوط بكيان مدرس → القايمة فاضية عمدًا */
  teacherLinked?: boolean;
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
  insight?: { thisWeek: number; prevWeek: number; changePct: number | null; topDrop: { label: string; changePct: number } | null } | null;
  series?: {
    revenue: { date: string; value: number }[];
    hourly: number[];
    methods: { method: string; count: number }[];
  };
};

/* ============================================================
   عدّاد متحرك (count-up) — نفس إحساس الفيديو: الرقم بيتصاعد لحظة الظهور
============================================================ */
function useCountUp(target: number, duration = 900): number {
  const [v, setV] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/** تنسيق قروش لأرقام كبيرة جوه العدّاد (من غير «ج» — بتتحط في الليبل) */
function fmtNum(piastres: number): string {
  const egp = Math.round(piastres) / 100;
  return egp.toLocaleString("en-EG", { maximumFractionDigits: 0 });
}

const METHOD_META: Record<string, { label: string; icon: typeof QrCode }> = {
  QR_SCAN: { label: "مسح كارت الطالب", icon: QrCode },
  SESSION_QR: { label: "QR الحصة", icon: QrCode },
  MANUAL: { label: "تسجيل يدوي", icon: Keyboard },
  FINGERPRINT: { label: "بصمة", icon: Fingerprint },
  NAME: { label: "بالاسم", icon: Users },
  STATIC_QR: { label: "QR ثابت", icon: QrCode },
  SESSION_START: { label: "فتح حصة", icon: Zap },
};

/* ============================================================
   شريط المتابعة التشغيلية — نسخة داكنة (إيه اللي محتاج انتباه دلوقتي)
============================================================ */
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
      key: "active", label: "حصص شغالة", value: `${active}`, tone: "text-[#34C759]",
      onClick: () => setView("schedule"),
    });
  }
  if (needsClosing.length > 0) {
    items.push({
      key: "closing", label: "محتاجة تقفيل", value: `${needsClosing.length}`, tone: "text-[#FF9F0A] nkops-pulse",
      onClick: () => openSession(needsClosing[0].id),
    });
  }
  if (pending > 0) {
    items.push({
      key: "approvals", label: "محتاجة موافقة", value: `${pending}`, tone: "text-[#0A84FF]",
      onClick: () => setView("approvals"),
    });
  }
  if (paymentIssues.length > 0) {
    items.push({
      key: "pay", label: "ملاحظات دفع", value: `${paymentIssues.length}`, tone: "text-[#FF3B30]",
      onClick: () => setView("payments"),
    });
  }

  if (items.length === 0) {
    return (
      <div className="nkops-card flex items-center gap-2.5" style={{ borderColor: "rgba(52,199,89,.35)" }}>
        <CheckCircle2 className="w-5 h-5 text-[#34C759] shrink-0" />
        <span className="font-extrabold text-sm text-[#34C759]">كل حاجة تمام — مفيش حاجة محتاجة انتباه</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={it.onClick}
          className="nkops-card nkops-card--hover text-start cursor-pointer"
        >
          <div className={cn("text-[26px] font-black nk-num leading-none", it.tone)}>{it.value}</div>
          <div className="nkops-label mt-1.5">{it.label}</div>
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   تابات البيل المتزحلق (Overview → الحصص → التقارير)
============================================================ */
type OpsTab = "overview" | "sessions" | "reports";
const TABS: { id: OpsTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "نظرة عامة", icon: LayoutDashboard },
  { id: "sessions", label: "الحصص", icon: CalendarClock },
  { id: "reports", label: "التقارير", icon: BarChart3 },
];

function OpsTabs({ tab, setTab }: { tab: OpsTab; setTab: (t: OpsTab) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const measure = () => {
    const btn = btnRefs.current[tab];
    if (btn) setPill({ left: btn.offsetLeft, width: btn.offsetWidth });
  };
  useLayoutEffect(measure, [tab]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div ref={wrapRef} className="nkops-tabs" role="tablist" aria-label="أقسام الداشبورد">
      <span className="nkops-tab-pill" style={{ left: pill.left, width: pill.width }} aria-hidden />
      {TABS.map((t) => (
        <button
          key={t.id}
          ref={(el) => { btnRefs.current[t.id] = el; }}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className="nkops-tab flex items-center gap-1.5"
        >
          <t.icon className="w-4 h-4" />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   رسم خطي: تحصيل آخر 14 يوم — بيرسم من الشمال لليمين عند الظهور
============================================================ */
function RevenueChart({ series }: { series: { date: string; value: number }[] }) {
  const pts = series.length ? series : [];
  const W = 100, H = 34, PAD = 2;
  const max = Math.max(...pts.map((p) => p.value), 1);
  const step = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;
  const coords = pts.map((p, i) => ({
    x: PAD + i * step,
    y: H - PAD - (p.value / max) * (H - PAD * 3),
  }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const area = coords.length ? `${line} L${coords[coords.length - 1].x.toFixed(2)},${H - 1} L${coords[0].x.toFixed(2)},${H - 1} Z` : "";
  const last = coords[coords.length - 1];
  const d = (s: string) => `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;

  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28 md:h-32" preserveAspectRatio="none" role="img" aria-label="تحصيل آخر 14 يوم">
        <defs>
          <linearGradient id="ops-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D6FF6C" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#D6FF6C" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke="#2A2A2A" strokeWidth="0.25" />
        ))}
        {area && <path d={area} fill="url(#ops-area)" className="nkops-area" />}
        {line && <path d={line} fill="none" stroke="#D6FF6C" strokeWidth="0.9" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="nkops-line" />}
        {last && <circle cx={last.x} cy={last.y} r="1.1" fill="#D6FF6C" className="nkops-area" />}
      </svg>
      <div className="flex justify-between mt-1.5 nkops-label" style={{ fontSize: 10 }}>
        <span>{pts.length ? d(pts[0].date) : ""}</span>
        <span>{pts.length ? d(pts[pts.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}

/* ============================================================
   خريطة حرارية: حضور النهاردة بالساعة (بتتلاحى خلية خلية)
============================================================ */
function HourHeatmap({ hourly }: { hourly: number[] }) {
  const hours = Array.from({ length: 16 }, (_, i) => i + 8); // 8 ص → 11 م
  const max = Math.max(...hours.map((h) => hourly[h] ?? 0), 1);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
        {hours.map((h, i) => {
          const v = hourly[h] ?? 0;
          const intensity = v / max;
          return (
            <div key={h} className="nkops-heat-row relative rounded-md" style={{
              height: 34,
              animationDelay: `${i * 0.045}s`,
              background: v === 0 ? "#1C1C1E" : `color-mix(in srgb, #D6FF6C ${Math.round(14 + intensity * 74)}%, #1C1C1E)`,
              border: "1px solid #2A2A2A",
            }}>
              {v > 0 && (
                <span className="absolute inset-0 grid place-items-center text-[9.5px] font-extrabold nk-num" style={{ color: intensity > 0.55 ? "#101010" : "#8A8A8A" }}>
                  {v}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid mt-1 nkops-label" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))", fontSize: 8.5 }}>
        {hours.map((h) => (
          <span key={h} className="text-center">{h % 2 === 0 ? String(h).padStart(2, "0") : ""}</span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   الدونات: نسبة الحضور الإلكتروني (مسح QR) — بتتملى clockwise
============================================================ */
function MethodDonut({ methods }: { methods: { method: string; count: number }[] }) {
  const total = methods.reduce((a, m) => a + m.count, 0);
  const qrCount = methods
    .filter((m) => m.method !== "MANUAL")
    .reduce((a, m) => a + m.count, 0);
  const pct = total > 0 ? Math.round((qrCount / total) * 100) : 0;
  const animatedPct = useCountUp(pct, 1100);
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <div
          className="nkops-donut rounded-full"
          style={{ width: 108, height: 108, ["--nkops-donut" as string]: `${pct}%` }}
        />
        <div className="absolute inset-[14px] rounded-full grid place-items-center" style={{ background: "#1C1C1E" }}>
          <span className="nkops-big nk-num nkops-lime" style={{ fontSize: 26 }}>{animatedPct}<span className="text-[13px]">%</span></span>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <p className="nkops-label m-0">نسبة الحضور الإلكتروني — آخر 7 أيام</p>
        {methods.slice(0, 4).map((m) => {
          const meta = METHOD_META[m.method] ?? { label: m.method, icon: QrCode };
          return (
            <div key={m.method} className="flex items-center justify-between gap-2 text-[12px] font-bold">
              <span className="text-[#F5F5F2] flex items-center gap-1.5 min-w-0">
                <meta.icon className="w-3.5 h-3.5 text-[#8A8A8A] shrink-0" />
                <span className="truncate">{meta.label}</span>
              </span>
              <span className="nk-num text-[#8A8A8A] shrink-0">{m.count}</span>
            </div>
          );
        })}
        {total === 0 && <p className="text-[12px] font-bold text-[#5A5A5A] m-0">لسه مفيش حضور الأسبوع ده.</p>}
      </div>
    </div>
  );
}

/* ============================================================
   لوحة الحصص (كانبان): شغالة / جاية / محتاجة تقفيل / خلصت
============================================================ */
function SessionsBoard({
  data, openSession, openLesson, opening, canMark, canStart,
}: {
  data: DashData;
  openSession: (id: string) => void;
  openLesson: (scheduleId: string) => void;
  opening: string | null;
  canMark: boolean;
  canStart: boolean;
}) {
  const now = data.sessions.filter((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "now");
  const upcoming = data.sessions.filter((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "future");
  const closing = data.sessions.filter((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "past");
  const done = data.sessions.filter((s) => s.status === "CLOSED");
  const cancelled = data.sessions.filter((s) => s.status === "CANCELLED");
  const planned = data.plannedSessions ?? [];

  const cols: { key: string; label: string; accent: string; cards: React.ReactNode[] }[] = [
    {
      key: "now", label: "شغالة دلوقتي", accent: "#34C759",
      cards: now.map((s) => <OpsSessionCard key={s.id} s={s} onOpen={() => openSession(s.id)} canMark={canMark} />),
    },
    {
      key: "next", label: "جايان النهاردة", accent: "#0A84FF",
      cards: [
        ...upcoming.map((s) => <OpsSessionCard key={s.id} s={s} onOpen={() => openSession(s.id)} canMark={canMark} />),
        ...planned.map((p) => (
          <button key={`plan-${p.scheduleId}`} onClick={() => canStart && openLesson(p.scheduleId)} disabled={opening === p.scheduleId || !canStart}
            className="nkops-card nkops-card--hover w-full text-start cursor-pointer border-dashed disabled:opacity-60">
            <div className="flex items-center justify-between gap-2">
              <span className="nk-num text-[12.5px] font-extrabold text-[#8A8A8A]" dir="ltr">{formatTime12(p.startTime)}</span>
              {opening === p.scheduleId ? <Loader2 className="w-4 h-4 animate-spin text-[#D6FF6C]" /> : <LockOpen className="w-4 h-4 text-[#8A8A8A]" />}
            </div>
            <p className="font-extrabold text-[13.5px] mt-1 mb-0 truncate">{p.subject} — {p.grade} {p.groupName}</p>
            <p className="text-[11px] font-bold text-[#8A8A8A] mt-0.5 mb-0 truncate">{p.teacher}{p.room ? ` · ${p.room}` : ""} · <span className="nk-num">{p.students}</span> طالب</p>
          </button>
        )),
      ],
    },
    {
      key: "closing", label: "محتاجة تقفيل", accent: "#FF9F0A",
      cards: closing.map((s) => <OpsSessionCard key={s.id} s={s} onOpen={() => openSession(s.id)} canMark={canMark} urgent />),
    },
    {
      key: "done", label: "خلصت النهاردة", accent: "#5A5A5A",
      cards: [
        ...done.map((s) => <OpsSessionCard key={s.id} s={s} onOpen={() => openSession(s.id)} canMark={false} />),
        ...cancelled.map((s) => (
          <div key={s.id} className="nkops-card opacity-60">
            <p className="font-extrabold text-[13.5px] m-0 flex items-center gap-1.5"><Ban className="w-3.5 h-3.5 text-[#FF3B30]" /> {s.subject} — {s.grade} {s.groupName}</p>
            <p className="text-[11px] font-bold text-[#5A5A5A] mt-0.5 m-0 nk-num" dir="ltr">{formatTime12(s.startTime)}</p>
          </div>
        )),
      ],
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cols.map((col) => (
        <div key={col.key} className="nkops-card !p-3 flex flex-col min-h-[180px]">
          <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
            <span className="nkops-label flex items-center gap-1.5">
              <i className="w-[7px] h-[7px] rounded-full not-italic" style={{ background: col.accent, boxShadow: `0 0 8px ${col.accent}` }} />
              {col.label}
            </span>
            {col.cards.length > 0 && (
              <span className="nk-num text-[11px] font-extrabold text-[#5A5A5A]">{col.cards.length}</span>
            )}
          </div>
          <div className="nkops-stagger flex flex-col gap-2">
            {col.cards.length === 0
              ? <p className="text-[11.5px] font-bold text-[#5A5A5A] text-center py-6 m-0">فاضية</p>
              : col.cards}
          </div>
        </div>
      ))}
    </div>
  );
}

function OpsSessionCard({ s, onOpen, canMark, urgent }: { s: SessionCard; onOpen: () => void; canMark: boolean; urgent?: boolean }) {
  const openedAt = s.openedAt ? formatTime12(s.openedAt.slice(11, 16)) : null;
  return (
    <button onClick={onOpen} className="nkops-card nkops-card--hover w-full text-start cursor-pointer">
      <div className="flex items-center justify-between gap-2">
        <span className="nk-num text-[12.5px] font-extrabold" style={{ color: urgent ? "#FF9F0A" : "#F5F5F2" }} dir="ltr">{formatTime12(s.startTime)}</span>
        {urgent && <span className="nkops-pulse text-[10px] font-extrabold text-[#FF9F0A]">متأخرة عن القفل</span>}
      </div>
      <p className="font-extrabold text-[13.5px] mt-1 mb-0 truncate">{s.subject} — {s.grade} {s.groupName}</p>
      <p className="text-[11px] font-bold text-[#8A8A8A] mt-0.5 mb-0 truncate">
        {s.teacher}{s.room ? ` · ${s.room}` : ""}
        {s.status === "CLOSED" && s.closedAggregates
          ? <> · إيراد <span className="nk-num text-[#34C759]">{fmt(s.closedAggregates.totalRevenue)}</span> ج</>
          : <> · حضر <span className="nk-num">{s.presentCount}</span></>}
        {openedAt && s.status === "OPEN" ? ` · اتفتحت ${openedAt}` : ""}
      </p>
      {s.status === "OPEN" && canMark && (
        <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-extrabold nkops-lime">
          <Zap className="w-3.5 h-3.5" /> افتح الحصة
        </span>
      )}
    </button>
  );
}

/* ============================================================
   الداشبورد الرئيسي
============================================================ */
export function DashboardView({ user, setView, openSession, goScanForSession }: { user: SessionUser; setView: (v: ViewId) => void; openSession: (id: string) => void; goScanForSession: (id: string) => void }) {
  const [data, setData] = useState<DashData | null>(null);
  const [opening, setOpening] = useState<string | null>(null); // scheduleId بيفتح دلوقتي
  const [tab, setTab] = useState<OpsTab>("overview");

  // عدادات متحركة — hooks أعلى الكومبوننت (مش شرطية — قاعدة الـ hooks)
  const attCount = useCountUp(data?.stats?.attendanceToday ?? 0, 900);
  const collectedCount = useCountUp(data?.stats?.collectedToday ?? 0, 1100);

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
  const isTeacher = user.role === "TEACHER";
  const canMark = userCan(user, "EDIT_ATTENDANCE");
  const canStart = userCan(user, "START_SESSION");
  const planned = data.plannedSessions ?? [];
  const totalToday = data.sessions.length + planned.length;

  /* ===== TEACHER / RECEPTIONIST — نفس العرض البسيط (الداشبورد التشغيلي للمدير بس) ===== */
  if (!isManager) {
    const nowSession = data.sessions.find((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "now");
    const nextSession = data.sessions.find((s) => s.status !== "CLOSED" && sessionPhase(s.startTime, s.endTime) === "future");
    return (
      <div className="space-y-5 nk-anim-stagger">
        <PageHeader
          title={`${greeting()} ${user.name.split(" ")[0]} 👋`}
          subtitle={`النهاردة ${formatTime12(new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, "0"))} — عندك ${totalToday} حصة`}
        />
        <InstallCard />
        {isTeacher && (
          <div className="grid gap-3">
            <BigAction icon={<CalendarDays className="w-7 h-7" />} label="جدول النهاردة" desc={`${totalToday} حصة — افتح الجدول الكامل`} onClick={() => setView("schedule")} primary />
          </div>
        )}
        {isTeacher && data.role === "TEACHER" && data.teacherLinked === false && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm font-bold dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-200">
            <AlertTriangle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
            <span>حسابك مش مربوط بمدرس في الجدول — كلّم المدير يربطه من إدارة الموظفين عشان تشوف حصصك هنا.</span>
          </div>
        )}
        {!isTeacher && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <BigAction icon={<ScanLine className="w-8 h-8" />} label="امسح QR" desc="تسجيل حضور فوري" onClick={() => setView("scan")} primary />
            <BigAction icon={<Search className="w-7 h-7" />} label="ابحث عن طالب" desc="بالاسم أو الكود" onClick={() => setView("students")} />
            <BigAction icon={<CreditCard className="w-7 h-7" />} label="تسجيل دفع" desc="استلام فلوس" onClick={() => setView("payments")} />
            <BigAction icon={<Users className="w-7 h-7" />} label="الطلاب" desc={`${data.quickStats.students} طالب`} onClick={() => setView("students")} />
            <BigAction icon={<CalendarDays className="w-7 h-7" />} label="جدول النهاردة" desc={`${totalToday} حصة`} onClick={() => setView("schedule")} />
          </div>
        )}
        {(nowSession || nextSession) && (
          <div className="grid md:grid-cols-2 gap-3">
            <SessionHero title="شغالة دلوقتي" session={nowSession ?? undefined} onOpen={openSession} cta="افتح الحصة" />
            <SessionHero title="الميعاد الجاي" session={nextSession ?? (nowSession ? undefined : data.sessions.find((s) => s.status === "OPEN"))} onOpen={openSession} cta="التفاصيل" />
          </div>
        )}
        <SectionCard title="حصص النهاردة" icon={<CalendarDays className="w-4 h-4" />}>
          {data.sessions.length === 0 && planned.length === 0 ? (
            <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش حصص النهاردة" hint="شوف الجدول الأسبوعي أو ضيف حصة جديدة." />
          ) : (
            <SimpleSessionList data={data} planned={planned} openSession={openSession} openLesson={openLesson} opening={opening} canMark={canMark} canStart={canStart} goScanForSession={goScanForSession} />
          )}
        </SectionCard>
      </div>
    );
  }

  /* ===== MANAGER — الداشبورد التشغيلي (فحمي + ليموني — لغة الفيديو) ===== */
  const stats = data.stats;
  const cash = data.cash;
  const qrPct = (() => {
    const total = (data.series?.methods ?? []).reduce((a, m) => a + m.count, 0);
    const qr = (data.series?.methods ?? []).filter((m) => m.method !== "MANUAL").reduce((a, m) => a + m.count, 0);
    return total > 0 ? Math.round((qr / total) * 100) : 0;
  })();
  const insight = data.insight;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting()} ${user.name.split(" ")[0]} 👋`}
        subtitle={`مركز التحكم التشغيلي — ${data.quickStats.students} طالب نشط · ${totalToday} حصة النهاردة`}
      />
      <InstallCard />

      <div className="nkops space-y-4">
        {/* شريط الانتباه */}
        {data.opsSummary && <OpsSummaryStrip summary={data.opsSummary} openSession={openSession} setView={setView} />}

        {/* التابات */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <OpsTabs tab={tab} setTab={setTab} />
          <span className="nkops-label hidden sm:block">
            {new Date().toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })}
          </span>
        </div>

        <div key={tab} className="nkops-view">
          {/* ============ نظرة عامة ============ */}
          {tab === "overview" && stats && (
            <div className="space-y-3">
              {/* KPI كبيرين */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="nkops-card nkops-card--hover">
                  <div className="flex items-start justify-between gap-2">
                    <span className="nkops-label">تحصيل النهاردة</span>
                    <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: "rgba(214,255,108,.12)" }}>
                      <Banknote className="w-4.5 h-4.5 nkops-lime" />
                    </span>
                  </div>
                  <div className="nkops-big nk-num nkops-lime mt-1">
                    {fmtNum(collectedCount)}<span className="text-[16px] font-extrabold text-[#8A8A8A]"> ج</span>
                  </div>
                  <div className="mt-2 -mx-1">
                    {data.series && data.series.revenue.length > 1 && <RevenueChart series={data.series.revenue} />}
                  </div>
                </div>
                <div className="nkops-card nkops-card--hover flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <span className="nkops-label">حضور النهاردة</span>
                    <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: "rgba(10,132,255,.14)" }}>
                      <GraduationCap className="w-4.5 h-4.5 nkops-blue" />
                    </span>
                  </div>
                  <div className="nkops-big nk-num mt-1">{Math.round(attCount)}<span className="text-[16px] font-extrabold text-[#8A8A8A]"> طالب</span></div>
                  <div className="mt-auto pt-3 space-y-2">
                    {insight?.changePct !== null && insight ? (
                      <div className="flex items-center gap-2 text-[12px] font-extrabold">
                        <span className={insight.changePct! >= 0 ? "nkops-green" : "nkops-red"}>
                          {insight.changePct! >= 0 ? "▲" : "▼"} {Math.abs(insight.changePct!)}%
                        </span>
                        <span className="nkops-sub">مقابل الأسبوع اللي فات — <span className="nk-num">{insight.thisWeek}</span> حضور</span>
                      </div>
                    ) : (
                      <div className="text-[12px] font-bold nkops-sub">أول أسبوع للمتابعة — الأسبوع الجاي هيتقارن لوحده</div>
                    )}
                    {insight?.topDrop && (
                      <div className="text-[11px] font-bold text-[#FF9F0A] truncate">أكبر نزول: {insight.topDrop.label} ({insight.topDrop.changePct}%)</div>
                    )}
                    {/* شريط الحضور بالساعة */}
                    <HourHeatmap hourly={data.series?.hourly ?? new Array(24).fill(0)} />
                  </div>
                </div>
              </div>

              {/*Tiles صغيرة */}
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <OpsStat label="إيراد الشهر" value={`${fmt(stats.monthRevenue)} ج`} icon={<TrendingUp className="w-4 h-4" />} tone="lime" />
                <OpsStat label="صافي الشهر" value={`${fmt(stats.monthNet)} ج`} icon={<CircleDollarSign className="w-4 h-4" />} tone={stats.monthNet >= 0 ? "green" : "red"} />
                <OpsStat label="طلاب نشطون" value={`${stats.activeStudents}`} icon={<School className="w-4 h-4" />} tone="blue" />
                <OpsStat label="مستحقات على الطلاب" value={`${fmt(stats.totalOwed)} ج`} icon={<Receipt className="w-4 h-4" />} tone="orange" />
              </div>

              {/* حصص شغالة/جاية سريعة + صندوق */}
              <div className="grid gap-3 md:grid-cols-2">
                <MiniSessions data={data} openSession={openSession} />
                {cash && (
                  <div className="nkops-card">
                    <span className="nkops-label flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> صندوق النهاردة</span>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-3">
                      <OpsKV k="دخل كاش" v={`${fmt(cash.cashIn)} ج`} tone="green" />
                      <OpsKV k="خرج" v={`${fmt(cash.cashOut)} ج`} tone="orange" />
                      <OpsKV k="المتوقع" v={`${fmt(cash.expected)} ج`} tone="lime" />
                      <OpsKV k="الفرق" v={cash.difference === null ? "—" : `${fmt(cash.difference)} ج`} tone={cash.difference === null || cash.difference === 0 ? "mut" : cash.difference < 0 ? "red" : "blue"} />
                    </div>
                  </div>
                )}
              </div>

              {/* تنبيهات */}
              {(data.alerts?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  {data.alerts!.map((a, i) => (
                    <div key={i} className="nkops-card flex items-center gap-2.5 text-[12.5px] font-bold py-3"
                      style={{ borderColor: a.level === "warn" ? "rgba(255,159,10,.4)" : "rgba(10,132,255,.35)" }}>
                      <AlertTriangle className={cn("w-4 h-4 shrink-0", a.level === "warn" ? "nkops-orange" : "nkops-blue")} />
                      <span>{a.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============ الحصص (كانبان) ============ */}
          {tab === "sessions" && (
            <SessionsBoard data={data} openSession={openSession} openLesson={openLesson} opening={opening} canMark={canMark} canStart={canStart} />
          )}

          {/* ============ التقارير ============ */}
          {tab === "reports" && stats && (
            <div className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-3">
                <div className="nkops-card xl:col-span-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="nkops-label flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> التحصيل — آخر 14 يوم</span>
                    <span className="nk-num text-[13px] font-extrabold nkops-lime">{fmt(stats.collectedToday)} ج النهاردة</span>
                  </div>
                  <RevenueChart series={data.series?.revenue ?? []} />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5 mt-4">
                    <OpsKV k="إيراد الشهر" v={`${fmt(stats.monthRevenue)} ج`} tone="lime" />
                    <OpsKV k="نصيب المدرسين" v={`${fmt(stats.monthTeacherShare)} ج`} tone="mut" />
                    <OpsKV k="مصروفات الشهر" v={`${fmt(stats.monthExpenses)} ج`} tone="orange" />
                    <OpsKV k="صافي السنتر" v={`${fmt(stats.monthNet)} ج`} tone={stats.monthNet >= 0 ? "green" : "red"} />
                  </div>
                </div>
                <div className="nkops-card">
                  <span className="nkops-label flex items-center gap-1.5 mb-3"><QrCode className="w-3.5 h-3.5" /> توزيع طرق الحضور</span>
                  <MethodDonut methods={data.series?.methods ?? []} />
                  <div className="mt-4 pt-3 border-t text-[11px] font-bold" style={{ borderColor: "#2A2A2A", color: "#8A8A8A" }}>
                    كل ما نسبة المسح تعلى، كل ما الاستقبال يبقى أسرع — النسبة دلوقتي <span className="nk-num nkops-lime">{qrPct}%</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="nkops-card">
                  <span className="nkops-label flex items-center gap-1.5 mb-2"><Flame className="w-3.5 h-3.5" /> ساعات الذروة النهاردة</span>
                  <HourHeatmap hourly={data.series?.hourly ?? new Array(24).fill(0)} />
                </div>
                <div className="nkops-card">
                  <span className="nkops-label flex items-center gap-1.5 mb-2"><Users className="w-3.5 h-3.5" /> مستحقات المدرسين</span>
                  {(data.teacherPayables?.length ?? 0) === 0 ? (
                    <p className="text-[12px] font-bold m-0" style={{ color: "#5A5A5A" }}>مفيش مستحقات دلوقتي</p>
                  ) : (
                    <ul className="divide-y m-0 p-0 list-none" style={{ borderColor: "#2A2A2A" }}>
                      {data.teacherPayables!.map((t) => (
                        <li key={t.id} className="flex items-center justify-between py-2.5">
                          <span className="font-bold text-[12.5px]">{t.name}</span>
                          <span className={cn("text-[12.5px] font-extrabold nk-num", t.payable > 0 ? "nkops-green" : "text-[#5A5A5A]")}>
                            {t.payable > 0 ? `له ${fmt(t.payable)} ج` : "تم الصرف"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="nkops-card">
                <span className="nkops-label flex items-center gap-1.5 mb-2"><Wallet className="w-3.5 h-3.5" /> الصندوق بالتفصيل</span>
                {cash ? (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-2.5">
                    <OpsKV k="افتتاحي" v={`${fmt(cash.opening)} ج`} tone="mut" />
                    <OpsKV k="دخل كاش" v={`${fmt(cash.cashIn)} ج`} tone="green" />
                    <OpsKV k="خرج" v={`${fmt(cash.cashOut)} ج`} tone="orange" />
                    <OpsKV k="المتوقع" v={`${fmt(cash.expected)} ج`} tone="lime" />
                    <OpsKV k={cash.counted !== null ? "الفرق بعد الجرد" : "الجرد"} v={cash.difference === null ? "لسه مقيرودش" : `${fmt(cash.difference)} ج`} tone={cash.difference === null ? "mut" : cash.difference === 0 ? "green" : cash.difference < 0 ? "red" : "blue"} />
                  </div>
                ) : (
                  <p className="text-[12px] font-bold m-0" style={{ color: "#5A5A5A" }}>مفيش بيانات صندوق.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* وردمارك زي الفيديو — النخبة تحت */}
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="text-[11px] font-extrabold tracking-wide" style={{ color: "#5A5A5A" }}>النخبة سنترز</span>
          <span className="nkops-label" style={{ fontSize: 10 }}>OPS · LIVE</span>
        </div>
      </div>

      {/* وضع التجربة — خارج الجزيرة */}
      <DemoCard user={user} onGoScan={() => setView("scan")} />
    </div>
  );
}

/* ===== كتل صغيرة مشتركة ===== */
function OpsStat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: "lime" | "green" | "red" | "blue" | "orange" }) {
  const color = tone === "lime" ? "#D6FF6C" : tone === "green" ? "#34C759" : tone === "red" ? "#FF3B30" : tone === "blue" ? "#0A84FF" : "#FF9F0A";
  return (
    <div className="nkops-card nkops-card--hover">
      <div className="flex items-center justify-between gap-2">
        <span className="nkops-label">{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="nk-num font-black text-[19px] mt-1.5" style={{ color }}>{value}</div>
    </div>
  );
}

function OpsKV({ k, v, tone }: { k: string; v: string; tone: "lime" | "green" | "red" | "blue" | "orange" | "mut" }) {
  const color = tone === "lime" ? "#D6FF6C" : tone === "green" ? "#34C759" : tone === "red" ? "#FF3B30" : tone === "blue" ? "#0A84FF" : tone === "orange" ? "#FF9F0A" : "#8A8A8A";
  return (
    <div>
      <div className="nkops-label" style={{ fontSize: 10 }}>{k}</div>
      <div className="nk-num font-extrabold text-[13.5px] mt-0.5" style={{ color }}>{v}</div>
    </div>
  );
}

function MiniSessions({ data, openSession }: { data: DashData; openSession: (id: string) => void }) {
  const open = data.sessions.filter((s) => s.status === "OPEN");
  return (
    <div className="nkops-card">
      <span className="nkops-label flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> حصص مفتوحة حاليًا</span>
      {open.length === 0 ? (
        <p className="text-[12px] font-bold m-0 mt-3" style={{ color: "#5A5A5A" }}>مفيش حصة مفتوحة دلوقتي — افتحها من تاب «الحصص».</p>
      ) : (
        <ul className="divide-y m-0 p-0 list-none mt-1.5" style={{ borderColor: "#2A2A2A" }}>
          {open.slice(0, 4).map((s) => (
            <li key={s.id}>
              <button onClick={() => openSession(s.id)} className="w-full flex items-center justify-between gap-2 py-2.5 text-start cursor-pointer group">
                <span className="min-w-0">
                  <b className="block font-extrabold text-[12.5px] truncate">{s.subject} — {s.grade} {s.groupName}</b>
                  <small className="text-[10.5px] font-bold text-[#8A8A8A]">{formatTime12(s.startTime)}{s.room ? ` · ${s.room}` : ""}</small>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="nk-num text-[15px] font-extrabold nkops-green">{s.presentCount}</span>
                  <ArrowLeft className="w-3.5 h-3.5 text-[#5A5A5A] group-hover:text-[#D6FF6C] transition" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** قايمة حصص بسيطة (مدرس/استقبال) — نفس شكل الكود القديم */
function SimpleSessionList({ data, planned, openSession, openLesson, opening, canMark, canStart, goScanForSession }: {
  data: DashData; planned: PlannedSession[]; openSession: (id: string) => void; openLesson: (scheduleId: string) => void;
  opening: string | null; canMark: boolean; canStart: boolean; goScanForSession: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
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
              running ? "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/40 dark:border-emerald-700/60" :
              cancelled ? "border-rose-200 bg-rose-50/40 opacity-75 dark:bg-rose-950/40 dark:border-rose-800/60" :
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
            {isOpen && canMark && (
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
              disabled={opening === p.scheduleId || !canStart}
              className="shrink-0 rounded-xl px-4 py-3 font-extrabold text-sm flex items-center gap-2 active:scale-[0.98] transition shadow border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text disabled:opacity-60"
            >
              {opening === p.scheduleId ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <LockOpen className="w-4.5 h-4.5" />}
              فتح الحصة
            </button>
          </div>
        );
      })}
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

function SessionHero({ title, session, onOpen, cta }: {
  title: string; session?: SessionCard; onOpen: (id: string) => void; cta: string;
}) {
  if (!session) return null;
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
