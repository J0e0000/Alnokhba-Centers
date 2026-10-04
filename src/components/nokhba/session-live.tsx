"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight, Clock, DoorClosed, Lock, LockOpen, Users, UserX, Loader2,
  Banknote, GraduationCap, Wallet, TrendingUp, AlertTriangle, RotateCcw, Printer, CheckCircle2,
  CalendarX, Send, LayoutDashboard, ScanLine, Wrench, ClipboardCheck, ReceiptText, Info, QrCode, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, fmtE, formatTime12, ATTENDANCE_LABEL, userCan, userCanRequest, type SessionUser } from "./lib";
import { PageHeader, Chip, Loading, SectionCard, EmptyState, MoneyStat, Stat } from "./shared";
import { usePrint, PrintableAttendanceSheet } from "./print";
import { feedback } from "./feedback";
import { showSuccess } from "./success-bar";
import { ScanView } from "./scan";
import { SessionQrCard } from "./session-qr-card";
import { useCaps } from "./caps";
import { ActionSquare } from "./action-button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type SessionDetail = {
  session: {
    id: string; date: string; startTime: string; endTime: string; room: string | null; status: string;
    subject: string; grade: string; groupName: string; teacher: string; price: number;
    teacherPercent: number; openedAt: string | null; closedAt: string | null;
    studentSource: string; studentCodeLength: number | null; allowUnregistered: boolean;
  };
  economics: {
    presentCount: number; totalRevenue: number; teacherShare: number; centerShare: number;
    collected: number; outstanding: number;
  };
  attendance: { id: string; studentId: string | null; name: string; code: string; unregistered?: boolean; status: string; charged: number | null; at: string; method?: string; riskScore?: number; riskFlags?: string[] }[];
  absent: { studentId: string; name: string; code: string }[];
};

// محاولات الحضور العام (نجاح/رفض) — مصدر قسم "النشاط المشبوه" (device-locked attendance)
type CheckInAttemptRow = {
  id: string; outcome: string; studentName: string | null; studentCode: string | null;
  riskScore: number; riskFlags: string[]; deviceTail: string | null; ip: string | null; at: string;
};
type AttemptsRes = { attempts: CheckInAttemptRow[]; suspiciousCount: number };

const ATTEMPT_OUTCOME_LABEL: Record<string, string> = {
  ACCEPTED: "اتقبل ✅",
  ALREADY_SAME_STUDENT: "متسجل من قبل",
  ALREADY_ATTENDED: "متسجل من قبل",
  DEVICE_LOCKED: "جهاز متكرر ⛔",
  EXPIRED_TOKEN: "كود منتهي",
  REPLAYED_TOKEN: "كود قديم (سكرين شوت)",
  INVALID_TOKEN: "كود غير صالح",
  CLOSED_SESSION: "الحصة مقفولة",
  CANCELLED_SESSION: "الحصة ملغاة",
  NOT_TODAY: "حصة تانية",
  INVALID_STUDENT: "كود طالب مش معروف",
  INACTIVE_STUDENT: "طالب مش نشط",
  NOT_REGISTERED: "مش مسجل في المجموعة",
  INVALID_NAME: "اسم ناقص/مش صالح",
  INVALID_CODE_LENGTH: "كود بطول غلط",
  CAPABILITY_OFF: "الخدمة مقفولة بالمركز",
  RATE_LIMITED: "محاولات كتير",
  INVALID_REQUEST: "طلب شكله غلط",
};

type SessionPayments = {
  total: number;
  totalPaid: number;
  payments: { id: string; type: string; amount: number; method: string | null; createdAt: string; student: { name: string; code: string } | null; receiptNumber: string | null }[];
};

type TabId = "overview" | "attendance" | "operations" | "review";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "نظرة عامة", icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: "attendance", label: "الحضور", icon: <ScanLine className="w-4 h-4" /> },
  { id: "operations", label: "العمليات", icon: <Wrench className="w-4 h-4" /> },
  { id: "review", label: "المراجعة", icon: <ClipboardCheck className="w-4 h-4" /> },
];

/**
 * مساحة عمل الحصة — خط أنابيب تشغيلي في مكان واحد:
 * نظرة عامة → الحضور → العمليات → المراجعة/القفل.
 * نفس مكان العمل للكل: المدير والاستقبال (الدور بيحدد الأزرار المتاحة).
 * الحفظ ≠ القفل: الحضور بيتسجل لحظيًا، والقفل قرار صريح.
 */
export function SessionLiveView({ user, sessionId, onBack, onGoScan }: {
  user: SessionUser; sessionId: string; onBack: () => void; onGoScan: () => void;
}) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [payments, setPayments] = useState<SessionPayments | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [attempts, setAttempts] = useState<AttemptsRes | null>(null);
  const caps = useCaps();

  const load = useCallback(() => {
    api<SessionDetail>(`/api/sessions/${sessionId}`).then(setData).catch(() => {});
  }, [sessionId]);

  // محاولات الحضور العام — نفس بولينج الحصة (8ث) — بتغذي العداد المشبوه والقائمة
  const loadAttempts = useCallback(() => {
    api<AttemptsRes>(`/api/attendance/public/attempts?sessionId=${sessionId}`).then(setAttempts).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    load(); loadAttempts();
    const t = setInterval(load, 8000);
    const t2 = setInterval(loadAttempts, 8000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, [load, loadAttempts]);

  // مدفوعات الحصة — بتتحمل لما المراجعة تتفتح أو بعد القفل (مش بولينج مستمر)
  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const d = await api<SessionPayments>(`/api/payments?sessionId=${sessionId}&pageSize=50`);
      setPayments(d);
    } catch { /* toast */ } finally { setPaymentsLoading(false); }
  }, [sessionId]);

  useEffect(() => { if (tab === "review") loadPayments(); }, [tab, loadPayments]);

  const printSheet = usePrint();

  function printAttendance() {
    if (!data) return;
    printSheet(
      <PrintableAttendanceSheet
        data={{
          session: {
            subject: data.session.subject, grade: data.session.grade, groupName: data.session.groupName,
            teacher: data.session.teacher, date: data.session.date,
            startTime: data.session.startTime, endTime: data.session.endTime,
            room: data.session.room, price: data.session.price,
          },
          attendance: data.attendance.map((a) => ({
            name: a.name, code: a.code, status: a.status, charged: a.charged,
            at: a.at ? new Date(a.at).toISOString() : null,
          })),
          absent: data.absent,
        }}
        center={user.center}
      />,
      `كشف حضور ${data.session.subject} — ${data.session.date}`,
    );
  }

  if (!data) return <Loading />;
  const s = data.session;
  const e = data.economics;
  const isManager = user.role === "MANAGER";
  const closed = s.status === "CLOSED";
  const cancelled = s.status === "CANCELLED";
  const readOnly = closed || cancelled;
  const isOpenMode = s.studentSource === "OPEN"; // حضور مفتوح — مفيش كشف/غياب/حسابات (spec §15)
  const registered = data.attendance.length + data.absent.length;
  const lateCount = data.attendance.filter((a) => a.status === "LATE").length;
  // إلغاء الحصة: صلاحية مباشرة (CANCEL_SESSION) أو طلب موافقة للمدير
  const canCancelDirect = userCan(user, "CANCEL_SESSION");
  const canCancelRequest = userCanRequest(user, "REQUEST_SESSION_CANCELLATION");
  const canEnd = userCan(user, "END_SESSION");

  // تصدير CSV (spec §11) — بعد القفل بس؛ نفس جلسة الموظف بتنزّل الملف على طول
  function downloadCsv() {
    window.location.href = `/api/sessions/${sessionId}/export`;
  }

  // إلغاء مباشر (صلاحية) أو طلب إلغاء (يروح للمدير) — بيتأكد من السبب قبل الإرسال
  async function submitCancel() {
    if (cancelReason.trim().length < 3) {
      toast.error("اكتب سبب الإلغاء (3 حروف على الأقل) — بيتحفظ في السجل.");
      return;
    }
    setCancelBusy(true);
    try {
      if (canCancelDirect) {
        await api(`/api/sessions/${sessionId}`, {
          method: "POST", body: { action: "cancel", reason: cancelReason },
        });
        toast.success("الحصة اتلغت — والسبب متسجل في سجل العمليات.");
        setCancelOpen(false);
        setCancelReason("");
      } else {
        const res = await api<{ request: { number: string } }>("/api/approvals", {
          method: "POST",
          body: { type: "SESSION_CANCEL", sessionId, reason: cancelReason },
        });
        toast.success(`تم إرسال طلب الإلغاء للمدير (${res.request.number}) — هتوصلك النتيجة بالإشعار.`);
        setCancelOpen(false);
        setCancelReason("");
      }
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      load();
    } catch { /* toast */ } finally { setCancelBusy(false); }
  }

  async function closeSession() {
    setBusy(true);
    try {
      const res = await api<{ economics: SessionDetail["economics"]; mode?: string }>(`/api/sessions/${sessionId}`, {
        method: "POST", body: { action: "close" },
      });
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      setCloseOpen(false);
      setTab("review"); // الملخص التشغيلي بعد القفل
      load();
      loadPayments();
      // شريط النجاح الدائم — حسب وضع الحصة (spec §10)
      if (isOpenMode) {
        showSuccess({
          message: "تم قفل الحصة بنجاح",
          sub: `اتسجل ${res.economics.presentCount} طالب · الحصة دي حضور مفتوح — مفيش كشف ولا غياب`,
          printLabel: "تصدير CSV",
          onPrint: () => downloadCsv(),
        });
      } else {
        showSuccess({
          message: "تم حفظ الحصة بنجاح",
          sub: `نصيب المدرس ${fmt(res.economics.teacherShare)} ج · نصيب السنتر ${fmt(res.economics.centerShare)} ج · حضر ${res.economics.presentCount}`,
          printLabel: "طباعة",
          onPrint: () => printAttendance(),
          undoLabel: "تراجع",
          onUndo: async () => {
            await api(`/api/sessions/${sessionId}`, { method: "POST", body: { action: "reopen", reason: "تراجع من شريط النجاح بعد القفل" } });
            toast.success("رجّعنا الحصة شغالة تاني — الحسابات اتلغت بحركة عكسية.");
            window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
            load();
          },
        });
      }
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function reopen() {
    if (reopenReason.trim().length < 3) {
      toast.error("اكتب سبب إعادة الفتح.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}`, { method: "POST", body: { action: "reopen", reason: reopenReason } });
      toast.success("تم فتح الحصة تاني — الحسابات القديمة اتلغت بحركة عكسية.");
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      setReopenOpen(false);
      setReopenReason("");
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  // التحضير المعكوس: علّم كل المسجلين اللي لسه محضروش دفعة واحدة
  async function bulkMarkAll() {
    setBusy(true);
    try {
      const res = await api<{ marked: number; totalCharge: number }>('/api/attendance/mark', {
        method: "POST",
        body: { bulk: true, sessionId },
      });
      if (res.marked === 0) {
        toast.info("كل المسجلين متسجلين خلاص — مفيش حاجة تتعلّم.");
      } else {
        feedback("success");
        toast.success(`تم تعليم ${res.marked} طالب حاضر — إجمالي قيمة الحصص ${fmt(res.totalCharge)} ج.`);
      }
      setBulkOpen(false);
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  // ===== مؤشرات تقدم الخط التشغيلي =====
  const steps = [
    { key: "opened", label: "فتحت", done: !cancelled },
    { key: "attendance", label: "حضور", done: data.attendance.length > 0 },
    { key: "payments", label: "دفع", done: e.collected > 0 },
    { key: "closed", label: "قفل", done: closed },
  ];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground transition">
        <ChevronRight className="w-4 h-4" /> رجوع
      </button>

      <PageHeader
        title={isOpenMode ? s.subject : `${s.subject} — ${s.grade} ${s.groupName}`}
        subtitle={isOpenMode
          ? `${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}${s.room ? ` · ${s.room}` : ""} · حضور مفتوح`
          : `${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}${s.room ? ` · ${s.room}` : ""} · ${s.teacher}`}
        action={
          cancelled ? (
            <Chip className="bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300"><CalendarX className="w-3.5 h-3.5" /> ملغاة</Chip>
          ) : closed ? (
            isManager ? (
              <button onClick={() => setReopenOpen(true)} className="border border-border bg-card font-bold rounded-xl px-3.5 py-2.5 flex items-center gap-1.5 text-sm">
                <RotateCcw className="w-4 h-4" /> إعادة فتح
              </button>
            ) : (
              <Chip className="bg-muted border-border text-muted-foreground"><DoorClosed className="w-3.5 h-3.5" /> مقفولة</Chip>
            )
          ) : (
            canEnd ? (
              <button onClick={() => setCloseOpen(true)} className="bg-rose-600 text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2 active:scale-[0.98]">
                <Lock className="w-4.5 h-4.5" /> قفل الحصة
              </button>
            ) : (
              <Chip className="bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">🟢 شغالة</Chip>
            )
          )
        }
      />

      {/* ===== داشبورد الحصة الدائم — مختصر وملتصق بالأعلى (موبايل/ديسكتوب) ===== */}
      <div className="nk-card rounded-2xl p-3.5 md:p-4 space-y-2.5 sticky top-[4.6rem] md:top-20 z-30" data-tour="session-dashboard">
        <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
          {cancelled ? (
            <span className="rounded-full bg-rose-600 text-white px-2.5 py-1 inline-flex items-center gap-1"><CalendarX className="w-3.5 h-3.5" /> ملغاة</span>
          ) : closed ? (
            <span className="rounded-full bg-muted text-foreground px-2.5 py-1 inline-flex items-center gap-1"><DoorClosed className="w-3.5 h-3.5" /> مقفولة</span>
          ) : (
            <span className="rounded-full bg-emerald-700 text-white px-2.5 py-1 inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-white/90 animate-pulse" /> شغالة دلوقتي</span>
          )}
          <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="w-3.5 h-3.5" /><span className="nk-num">{formatTime12(s.startTime)} – {formatTime12(s.endTime)}</span></span>
          {s.room && <span className="nk-brand-bg-soft dark:bg-[color-mix(in_srgb,var(--c-primary)_26%,var(--card))] nk-brand-text rounded-full px-2.5 py-1">{s.room}</span>}
          {!isOpenMode && <span className="text-muted-foreground">{s.teacher}</span>}
        </div>
        <div className={cn("grid grid-cols-2 gap-2", !isOpenMode && "sm:grid-cols-5")}>
          {isOpenMode ? (
            // الحضور المفتوح: العدد المسجل هو المهم — مفيش غياب ولا فلوس (spec §9/§15)
            <>
              <MiniStat label="اتسجل" value={data.attendance.length} tone={data.attendance.length > 0 ? "ok" : "muted"} icon={<GraduationCap className="w-3.5 h-3.5" />} />
              <MiniStat label="مشبوه" value={attempts?.suspiciousCount ?? 0} tone={(attempts?.suspiciousCount ?? 0) > 0 ? "warn" : "muted"} icon={<AlertTriangle className="w-3.5 h-3.5" />} />
            </>
          ) : (
            <>
              <MiniStat label="حاضر" value={e.presentCount} tone={e.presentCount > 0 ? "ok" : "muted"} icon={<GraduationCap className="w-3.5 h-3.5" />} />
              <MiniStat label={`غايب من ${registered}`} value={data.absent.length} tone={data.absent.length > 0 ? "warn" : "muted"} icon={<UserX className="w-3.5 h-3.5" />} />
              <MiniStat label="مشبوه" value={attempts?.suspiciousCount ?? 0} tone={(attempts?.suspiciousCount ?? 0) > 0 ? "warn" : "muted"} icon={<AlertTriangle className="w-3.5 h-3.5" />} />
              <MiniStat label="دفع بالحصة" value={payments?.total ?? 0} tone={(payments?.total ?? 0) > 0 ? "ok" : "muted"} icon={<ReceiptText className="w-3.5 h-3.5" />} />
              <MiniStat label="متأخر" value={e.outstanding > 0 ? Math.round(e.outstanding / 100) : 0} tone={e.outstanding > 0 ? "warn" : "muted"} icon={<AlertTriangle className="w-3.5 h-3.5" />} />
            </>
          )}
        </div>
        {/* تقدم الخط التشغيلي */}
        <div className="flex items-center gap-1.5" aria-label="تقدم الحصة">
          {steps.map((st, i) => (
            <div key={st.key} className="flex items-center gap-1.5 flex-1 min-w-0" title={st.label}>
              <span className={cn(
                "flex-1 h-1.5 rounded-full transition",
                st.done ? "nk-brand-grad" : "bg-muted",
              )} />
              <span className={cn("text-[10px] font-extrabold whitespace-nowrap", st.done ? "nk-brand-text" : "text-muted-foreground")}>{st.label}</span>
              {i < steps.length - 1 && <span className="sr-only">ثم</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ===== الخطوة الجاية — إجراء أساسي واحد واضح (تعقيد النظام مش على المستخدم) ===== */}
      {!cancelled && (
        <div className="nk-card rounded-2xl p-3 flex items-center gap-3" data-tour="session-next-action">
          <span className="w-11 h-11 rounded-2xl nk-brand-bg-soft nk-brand-text grid place-items-center shrink-0">
            {!closed && data.attendance.length === 0 ? <ScanLine className="w-5.5 h-5.5" /> : !closed ? <CheckCircle2 className="w-5.5 h-5.5" /> : <ClipboardCheck className="w-5.5 h-5.5" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-sm">
              {!closed && data.attendance.length === 0 ? "الحصة جاهزة — سجّل الحضور" : !closed ? (canEnd ? "الحضور اتحضر — اعتمد وقفل الحصة" : "الحضور اتحضر — راجع قبل القفل") : "الحصة خلصت — راجع النتائج"}
            </p>
            <p className="text-[11px] font-bold text-muted-foreground">
              {!closed && data.attendance.length === 0
                ? (caps.static_qr.enabled || caps.name_attendance.enabled || caps.dynamic_qr.enabled
                    ? "امسح كارت أو استخدم QR الحصة أو علّم بالاسم"
                    : "مفيش طرق حضور مفعّلة في المركز — كلّم المدير")
                : !closed ? "القفل بيثبّت الإجماليات ويقفل الحسابات"
                : "الإجماليات والحضور محفوظين"}
            </p>
          </div>
          <ActionSquare
            icon={!closed && data.attendance.length === 0 ? <ScanLine className="w-6 h-6" /> : !closed ? <CheckCircle2 className="w-6 h-6" /> : <ClipboardCheck className="w-6 h-6" />}
            label={!closed && data.attendance.length === 0 ? "احضر" : !closed ? (canEnd ? "اعتمد وقفل" : "راجع") : "النتائج"}
            variant={!closed && data.attendance.length === 0 ? "primary" : !closed ? (canEnd ? "success" : "secondary") : "secondary"}
            size="lg"
            onClick={() => {
              if (!closed && data.attendance.length === 0) setTab("attendance");
              else if (!closed && canEnd) setCloseOpen(true);
              else setTab("review");
            }}
            tooltip={!closed && data.attendance.length === 0 ? "الخطوة الجاية: تسجيل الحضور" : !closed && canEnd ? "اعتماد الحضور وقفل الحصة" : "مراجعة الحصة"}
          />
        </div>
      )}

      {/* ===== التابات — خط الأنابيب في نفس مساحة العمل ===== */}
      <div className="grid grid-cols-4 gap-1.5 nk-card rounded-2xl p-1.5" role="tablist" aria-label="خطوات الحصة" data-tour="session-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-xl px-2 py-2.5 text-[11px] md:text-xs font-extrabold flex flex-col items-center gap-1 transition active:scale-[0.98] min-h-[3.4rem]",
              tab === t.id
                ? "nk-brand-grad text-white shadow"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              // الحضور والعمليات مالهمش لازمة بعد الإلغاء
              cancelled && (t.id === "attendance" || t.id === "operations") && "hidden",
            )}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* =========================== نظرة عامة =========================== */}
      {tab === "overview" && (
        <div className="space-y-4 nk-anim-view">
          {/* إجراءات سريعة */}
          {!readOnly && (
            <div className="grid grid-cols-2 gap-2.5">
              <button onClick={() => setTab("attendance")} className="nk-brand-grad text-white font-extrabold rounded-2xl px-4 py-4 shadow flex items-center justify-center gap-2 active:scale-[0.99]">
                {isOpenMode ? <><QrCode className="w-5 h-5" /> اعرض كود الحضور</> : <><ScanLine className="w-5 h-5" /> ابدأ تسجيل الحضور</>}
              </button>
              <button onClick={() => setTab("review")} className="border-2 border-border bg-card text-foreground font-extrabold rounded-2xl px-4 py-4 flex items-center justify-center gap-2 active:scale-[0.99] transition hover:bg-muted/50">
                <ClipboardCheck className="w-5 h-5" /> المراجعة قبل القفل
              </button>
            </div>
          )}

          {/* الأرقام */}
          {isOpenMode ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Stat label="اتسجل" value={data.attendance.length} hint={s.studentCodeLength ? `كود ${s.studentCodeLength} أرقام` : "حضور مفتوح"} icon={<GraduationCap className="w-4 h-4" />} tone="brand" />
              <Stat label="محاولات مرفوضة" value={attempts?.suspiciousCount ?? 0} hint="من قفل الجهاز والإعدادات" icon={<AlertTriangle className="w-4 h-4" />} />
              <Stat label="الحالة" value={closed ? "مقفولة" : "شغالة"} hint={s.room ?? undefined} icon={<CheckCircle2 className="w-4 h-4" />} />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="حضر" value={e.presentCount} hint={`من ${registered} مسجل`} icon={<GraduationCap className="w-4 h-4" />} tone="brand" />
              <MoneyStat label="قيمة الحصص" piastres={e.totalRevenue} hint={`سعر الحصة ${fmt(s.price)} ج`} />
              <MoneyStat label="المحصّل" piastres={e.collected} tone="success" icon={<Banknote className="w-4 h-4" />} />
              <MoneyStat label="المتأخر" piastres={e.outstanding} tone={e.outstanding > 0 ? "warning" : "muted"} icon={<AlertTriangle className="w-4 h-4" />} />
            </div>
          )}

          {closed && !isOpenMode && (
            <div className="grid grid-cols-2 gap-3">
              <MoneyStat label="نصيب المدرس" piastres={e.teacherShare} tone="brand" icon={<Wallet className="w-4 h-4" />} hint={`${s.teacherPercent}% متفق عليها`} />
              <MoneyStat label="نصيب السنتر" piastres={e.centerShare} tone="success" icon={<TrendingUp className="w-4 h-4" />} hint={`${100 - s.teacherPercent}%`} />
            </div>
          )}

          {/* تنبيهات الحصة */}
          {!readOnly && (
            <div className="space-y-2">
              {data.absent.length > 0 && e.presentCount > 0 && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
                  {data.absent.length} طالب لسه محضرش — علّمهم فرادى من تاب الحضور أو «علّم الكل» بعد ما يخلصوا يجوا.
                </div>
              )}
              {e.outstanding > 0 && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/50 px-4 py-3 text-sm font-bold text-sky-800 dark:text-sky-200">
                  <Banknote className="w-4.5 h-4.5 shrink-0" />
                  متأخرات على حاضري النهاردة {fmt(e.outstanding)} ج — تقدر تستلمها من كارت الطالب وقت المسح.
                </div>
              )}
            </div>
          )}

          {/* بيانات الحصة */}
          <SectionCard title="بيانات الحصة" icon={<Info className="w-4 h-4" />}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {!isOpenMode && <InfoCell label="المجموعة" value={`${s.grade} ${s.groupName}`} />}
              <InfoCell label={isOpenMode ? "الاسم" : "المادة"} value={s.subject} />
              {!isOpenMode && <InfoCell label="المدرس" value={s.teacher} />}
              <InfoCell label="اليوم" value={s.date} mono />
              <InfoCell label="الميعاد" value={`${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}`} mono />
              <InfoCell label="القاعة" value={s.room ?? "—"} />
              {isOpenMode && <InfoCell label="مصدر الطلاب" value="حضور مفتوح (بدون كشف)" />}
              {isOpenMode && s.studentCodeLength && <InfoCell label="طول الكود" value={`${s.studentCodeLength} أرقام`} mono />}
              {s.openedAt && <InfoCell label="بدأت فعليًا" value={formatTime12(s.openedAt.slice(11, 16))} mono />}
              {lateCount > 0 && <InfoCell label="متأخرين" value={`${lateCount} طالب`} />}
              {!isOpenMode && <InfoCell label="سعر الحصة" value={`${fmt(s.price)} ج`} mono />}
            </div>
          </SectionCard>

          {/* ملخص سريع للحضور الحالي */}
          <AttendanceTable data={data} printAttendance={printAttendance} showPrint />
          <SuspiciousCard attempts={attempts} />
        </div>
      )}

      {/* =========================== الحضور =========================== */}
      {tab === "attendance" && !cancelled && (
        <div className="space-y-4 nk-anim-view">
          {closed ? (
            <>
              <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm font-bold text-muted-foreground">
                <DoorClosed className="w-4.5 h-4.5 shrink-0" />
                الحصة مقفولة — الحضور ده السجل النهائي. تعديله للمدير من ملف الطالب (بسبب مسجل).
              </div>
              <AttendanceTable data={data} printAttendance={printAttendance} showPrint />
            </>
          ) : (
            <>
              {/* الطرق المتاحة للحضور — بتتكيف مع قدرات المركز (المعطّل مش بيظهر خالص)
                  حصص الحضور المفتوح: الـ QR بس — مفيش كشف تتصل به طرق الكارت/الاسم (spec §1B) */}
              {!isOpenMode && (
                <div className="nk-card rounded-2xl p-3 flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold">
                  <span className="text-muted-foreground me-1">طرق تسجيل الحضور:</span>
                  {caps.static_qr.enabled && <span className="rounded-full border border-border bg-card px-2.5 py-1">١ · مسح كارت الطالب</span>}
                  {caps.name_attendance.enabled && <span className="rounded-full border border-border bg-card px-2.5 py-1">٢ · البحث / التحديد اليدوي</span>}
                  {caps.dynamic_qr.enabled && <span className="rounded-full nk-brand-bg text-white px-2.5 py-1 inline-flex items-center gap-1"><QrCode className="w-3 h-3" /> ٣ · QR الحصة المتنقل</span>}
                  {!caps.static_qr.enabled && !caps.name_attendance.enabled && !caps.dynamic_qr.enabled && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-2.5 py-1 inline-flex items-center gap-1">
                      مفيش طرق حضور مفعّلة في المركز — كلّم المدير
                    </span>
                  )}
                </div>
              )}
              {/* المسح المدمج — نفس محرك شاشة الحضور المجرب، بس مربوط بالحصة دي */}
              {!isOpenMode && (caps.static_qr.enabled || caps.name_attendance.enabled) && (
                <ScanView user={user} embedded sessionOverride={sessionId} clearSessionOverride={() => {}} />
              )}
              {caps.dynamic_qr.enabled && <SessionQrCard sessionId={sessionId} />}
              <AttendanceTable data={data} printAttendance={printAttendance} showPrint />
              <SuspiciousCard attempts={attempts} />
              {!isOpenMode && data.absent.length > 0 && caps.name_attendance.enabled && (
                <SectionCard
                  title={`مسجلين ومحضروش (${data.absent.length})`}
                  icon={<UserX className="w-4 h-4" />}
                  action={
                    <button
                      onClick={() => setBulkOpen(true)}
                      className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2 flex items-center gap-1.5 text-xs shadow active:scale-[0.98]"
                    >
                      <CheckCircle2 className="w-4 h-4" /> علّم الكل حاضر ({data.absent.length})
                    </button>
                  }
                >
                  <div className="flex flex-wrap gap-2">
                    {data.absent.map((a) => (
                      <Chip key={a.studentId} className="bg-card border-border">{a.name} · <span className="nk-num">{a.code}</span></Chip>
                    ))}
                  </div>
                  <p className="text-[11px] font-bold text-muted-foreground mt-3 bg-muted/50 rounded-xl px-3 py-2">
                    الطالب اللي حضر متأخر؟ علّمه من المسح فوق. زرار «علّم الكل حاضر» للأولاد اللي حضروا كلهم — الغايبين فعلاً هيفضلوا من غير تحضير.
                  </p>
                </SectionCard>
              )}
            </>
          )}
        </div>
      )}

      {/* =========================== العمليات =========================== */}
      {tab === "operations" && !cancelled && (
        <div className="space-y-4 nk-anim-view">
          <SectionCard title="أدوات الحصة" icon={<Wrench className="w-4 h-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <OpButton
                icon={<Printer className="w-5 h-5" />}
                label="طباعة كشف الحضور"
                desc="ورقة رسمية بالحضور والغياب"
                onClick={printAttendance}
              />
              <OpButton
                icon={<ScanLine className="w-5 h-5" />}
                label="شاشة المسح الكاملة"
                desc="وضع الاستقبال/الكشك المستقل"
                onClick={onGoScan}
              />
            </div>
          </SectionCard>

          <SectionCard title="إدارة الحصة" icon={<DoorClosed className="w-4 h-4" />}>
            <div className="space-y-2.5">
              {(canCancelDirect || canCancelRequest) && !closed && (
                <OpButton
                  icon={canCancelDirect ? <CalendarX className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                  label={canCancelDirect ? "إلغاء الحصة" : "طلب إلغاء الحصة"}
                  desc={canCancelDirect ? "بسبب إجباري بيتسجل في سجل العمليات" : "بيروح للمدير يقرر فيه"}
                  tone="danger"
                  onClick={() => setCancelOpen(true)}
                />
              )}
              {closed && isManager && (
                <OpButton
                  icon={<RotateCcw className="w-5 h-5" />}
                  label="إعادة فتح حصة مقفولة"
                  desc="حركة عكسية على الحسابات — مش مسح"
                  onClick={() => setReopenOpen(true)}
                />
              )}
              {!closed && (
                <div className="text-[11px] font-bold text-muted-foreground bg-muted/50 rounded-xl px-3 py-2 leading-relaxed">
                  تذكير: الحفظ مش قفل — الحضور والمدفوعات بتتسجل لحظيًا وبتفضل محفوظة لو خرجت ورجعت. القفل قرار صريح بيثبّت الحسابات من تاب المراجعة.
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="سجل الحالة" icon={<Clock className="w-4 h-4" />}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoCell label="الحالة الحالية" value={closed ? "مقفولة" : "شغالة (مفتوحة)"} />
              <InfoCell label="فتحت في" value={s.openedAt ? new Date(s.openedAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"} mono />
              <InfoCell label="اتقفلت في" value={s.closedAt ? new Date(s.closedAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"} mono />
              <InfoCell label="عدد المسجلين" value={`${registered} طالب`} mono />
            </div>
          </SectionCard>
        </div>
      )}

      {/* =========================== المراجعة / الملخص =========================== */}
      {tab === "review" && (
        <div className="space-y-4 nk-anim-view">
          {cancelled ? (
            <EmptyState icon={<CalendarX className="w-8 h-8" />} title="الحصة ملغاة" hint="مفيش مراجعة — الحضور المسجل قبل الإلغاء محفوظ زي ما هو." />
          ) : closed && isOpenMode ? (
            /* ===== ملخص ما بعد القفل — حضور مفتوح (spec §10/§15): مفيش كشف ولا غياب ===== */
            <SectionCard title="ملخص الحصة" icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}>
              <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
                <SummaryRow label="الاسم" value={s.subject} />
                <SummaryRow label="الميعاد" value={`${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}`} mono />
                <div className="border-t my-1" />
                <SummaryRow label="إجمالي الحضور المسجل" value={`${data.attendance.length} طالب`} strong highlight />
                <SummaryRow label="نوع الحصة" value="حضور مفتوح — بدون كشف" />
              </div>
              <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2.5 leading-relaxed mt-3">
                مفيش كشف مستهدف اتحدد للحصة دي — عشان كده مفيش غياب ولا نسبة حضور. اللي اتسجل = الحضور الفعلي بس.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={downloadCsv} className="flex-1 min-w-[150px] nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm shadow active:scale-[0.98]">
                  <Download className="w-4.5 h-4.5" /> تصدير CSV (Excel)
                </button>
                <button onClick={onBack} className="flex-1 min-w-[150px] border-2 border-border bg-card font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition hover:bg-muted/50">
                  رجوع للرئيسية
                </button>
              </div>
            </SectionCard>
          ) : closed ? (
            /* ===== ملخص ما بعد القفل ===== */
            <SectionCard title="ملخص الحصة" icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}>
              <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
                <SummaryRow label="المجموعة" value={`${s.grade} ${s.groupName}`} />
                <SummaryRow label="المدرس" value={s.teacher} />
                <SummaryRow label="القاعة" value={s.room ?? "—"} />
                <SummaryRow label="الميعاد" value={`${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}`} mono />
                <div className="border-t my-1" />
                <SummaryRow label="حضر" value={`${e.presentCount} طالب`} strong />
                <SummaryRow label="غاب" value={`${data.absent.length} طالب`} />
                <SummaryRow label="مدفوعات مسجلة بالحصة" value={`${payments?.total ?? 0}`} strong />
                <SummaryRow label="قيمة الحصص" value={fmtE(e.totalRevenue)} />
                <SummaryRow label="المحصّل" value={fmtE(e.collected)} />
                <SummaryRow label="المتأخر" value={fmtE(e.outstanding)} />
                <div className="border-t my-1" />
                <SummaryRow label={`نصيب المدرس (${s.teacherPercent}%)`} value={fmtE(e.teacherShare)} strong highlight />
                <SummaryRow label={`نصيب السنتر (${100 - s.teacherPercent}%)`} value={fmtE(e.centerShare)} strong highlight />
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {isOpenMode && (
                  <button onClick={downloadCsv} className="flex-1 min-w-[150px] border-2 border-border bg-card nk-brand-text font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition hover:bg-muted/50">
                    <Download className="w-4.5 h-4.5" /> تصدير CSV
                  </button>
                )}
                <button onClick={printAttendance} className="flex-1 min-w-[150px] border-2 border-border bg-card font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition hover:bg-muted/50">
                  <Printer className="w-4.5 h-4.5" /> طباعة كشف الحضور
                </button>
                <button onClick={onBack} className="flex-1 min-w-[150px] nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm shadow active:scale-[0.98]">
                  رجوع للرئيسية
                </button>
              </div>
            </SectionCard>
          ) : (
            /* ===== مراجعة قبل القفل ===== */
            <>
              <SectionCard title="مراجعة قبل قفل الحصة" icon={<ClipboardCheck className="w-4 h-4" />}>
                <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
                  {isOpenMode ? (
                    <SummaryRow label="الحضور المسجل" value={`${data.attendance.length} طالب`} strong />
                  ) : (
                    <SummaryRow label="الحضور" value={`${e.presentCount} حاضر · ${data.absent.length} غايب`} strong />
                  )}
                  {lateCount > 0 && <SummaryRow label="منهم متأخرين" value={`${lateCount} طالب`} />}
                  {!isOpenMode && <SummaryRow label="مدفوعات مسجلة بالحصة" value={`${payments?.total ?? (paymentsLoading ? "…" : 0)}`} strong />}
                  {!isOpenMode && <SummaryRow label="قيمة الحصص" value={fmtE(e.totalRevenue)} />}
                  {!isOpenMode && <SummaryRow label="المحصّل" value={fmtE(e.collected)} />}
                  {!isOpenMode && <SummaryRow label="المتأخر على الطلاب" value={fmtE(e.outstanding)} />}
                </div>

                {/* بنود محتاجة انتباه */}
                <div className="mt-3 space-y-2">
                  {isOpenMode ? (
                    data.attendance.length === 0
                      ? <ReviewFlag tone="warn" text="لسه محدش سجّل حضور — اتأكد إن الكود معروض للطلاب قبل القفل." />
                      : <ReviewFlag tone="ok" text={`الحصة دي حضور مفتوح — هيتقفل بـ${data.attendance.length} تسجيل، ومفيش غياب لأن مفيش كشف.`} />
                  ) : (
                    <>
                      {data.absent.length > 0 && (
                        <ReviewFlag tone="warn" text={`${data.absent.length} طالب مسجل ومحضرش — لو الحصة خلصت خلاص، ده طبيعي. بس راجع إن مفيش حد اتسجل بالغلط.`} />
                      )}
                      {e.presentCount === 0 && (
                        <ReviewFlag tone="warn" text="مفيش أي حضور مسجل — لو الحصة فعلًا اتعملت، سجّل الحضور الأول قبل القفل." />
                      )}
                    </>
                  )}
                  {!isOpenMode && e.outstanding > 0 && (
                    <ReviewFlag tone="info" text={`متأخرات ${fmt(e.outstanding)} ج على حاضري الحصة — تقدر تقفل براحتك، المتأخرات بتفضل على حساب الطالب.`} />
                  )}
                  {!isOpenMode && data.absent.length === 0 && e.presentCount > 0 && e.outstanding === 0 && (
                    <ReviewFlag tone="ok" text="كل حاجة مكتملة — كل المسجلين اتحدد وضعهم ومفيش متأخرات." />
                  )}
                </div>

                <p className="text-[11px] font-bold text-muted-foreground mt-3 leading-relaxed">
                  القفل بيثبّت الإيراد ومستحق المدرس وبيقفل استقبال حضور جديد. بعد القفل التعديل للمدير بس وبسبب مسجل.
                </p>

                {canEnd && (
                  <button onClick={() => setCloseOpen(true)} className="w-full mt-3 bg-rose-600 text-white font-extrabold rounded-xl px-4 py-4 shadow flex items-center justify-center gap-2 active:scale-[0.99]">
                    <Lock className="w-5 h-5" /> قفل الحصة دلوقتي
                  </button>
                )}
              </SectionCard>

              {/* مدفوعات الحصة */}
              <SectionCard title={`مدفوعات الحصة (${payments?.total ?? 0})`} icon={<ReceiptText className="w-4 h-4" />}>
                {paymentsLoading ? (
                  <div className="h-10 rounded-xl bg-muted animate-pulse" />
                ) : !payments || payments.payments.length === 0 ? (
                  <p className="text-sm font-bold text-muted-foreground py-2">مفيش مدفوعات اتسجلت في الحصة دي — الدفع بيتم من كارت الطالب وقت المسح أو شاشة الدفع.</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {payments.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="font-bold truncate">{p.student?.name ?? "—"}</p>
                          <p className="text-[11px] text-muted-foreground font-semibold">
                            <span className="nk-num">{p.receiptNumber ?? "—"}</span> · {p.createdAt ? new Date(p.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </p>
                        </div>
                        <span className={cn("nk-num font-extrabold whitespace-nowrap", p.type === "PAYMENT" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")} dir="ltr">
                          {p.type === "PAYMENT" ? "+" : "−"}{fmt(Math.abs(p.amount))} ج
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
        </div>
      )}

      {/* ===== bulk confirm ===== */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" /> تعليم كل المحضروشين حاضر</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
              <SummaryRow label="المجموعة" value={`${s.grade} ${s.groupName}`} />
              <SummaryRow label="هيتعلموا حاضر" value={String(data.absent.length)} strong />
              <SummaryRow label="سعر الحصة للطالب" value={fmtE(s.price)} />
              <SummaryRow label="إجمالي الخصم من أرصدة الطلاب" value={fmtE(s.price * data.absent.length)} strong highlight />
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed">
              كل طالب من دول هيُخصم من رصيده سعر الحصة تلقائيًا. لو في طالب غايب فعلًا ومش عايز تعلّمه — ألغِ وعلم الباقي بالمسح الفردي.
            </p>
            <div className="flex gap-2">
              <button onClick={bulkMarkAll} disabled={busy}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                تأكيد — علّم الكل ({data.absent.length})
              </button>
              <button onClick={() => setBulkOpen(false)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== close confirmation ===== */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-rose-600" /> قفل الحصة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
              {isOpenMode ? (
                // حصص الحضور المفتوح — ملخص مختلف تمامًا (spec §10): العدد المسجل + توضيح مفيش كشف
                <>
                  <SummaryRow label="الحصة" value={s.subject} />
                  <SummaryRow label="إجمالي الحضور المسجل" value={String(data.attendance.length)} strong highlight />
                  <SummaryRow label="نوع الحصة" value="حضور مفتوح — بدون كشف" />
                </>
              ) : (
                <>
                  <SummaryRow label="الحصة" value={s.subject} />
                  <SummaryRow label="المجموعة" value={`${s.grade} ${s.groupName}`} />
                  <SummaryRow label="الحضور" value={String(e.presentCount)} strong />
                  <SummaryRow label="قيمة الحصة" value={fmtE(s.price)} />
                  <SummaryRow label="إجمالي قيمة الحصص" value={fmtE(e.totalRevenue)} strong />
                  <SummaryRow label="المحصّل" value={fmtE(e.collected)} />
                  <SummaryRow label="المتأخر على الطلاب" value={fmtE(e.outstanding)} />
                  <div className="border-t my-1" />
                  <SummaryRow label={`نصيب المدرس (${s.teacherPercent}%)`} value={fmtE(e.teacherShare)} strong highlight />
                  <SummaryRow label={`نصيب السنتر (${100 - s.teacherPercent}%)`} value={fmtE(e.centerShare)} strong highlight />
                </>
              )}
            </div>
            {isOpenMode ? (
              <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 leading-relaxed">
                مفيش كشف مستهدف للحصة دي — فمفيش غياب ولا حسابات. بعد القفل تقدر تصدّر CSV بالأسماء المسجلة.
              </p>
            ) : (
              <>
                {data.absent.length > 0 && (
                  <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 leading-relaxed">
                    في {data.absent.length} طالب محضرش — الغايبين بيتحسبوا غياب تلقائي من الكشف بعد القفل، ومفيش محتاج تعلّم حد غايب بإيدك.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground font-semibold">
                  بعد القفل: الإيراد ومستحق المدرس بيتسجلوا، والحضور بيتثبت. التعديل بعدها للمدير بس وبسبب مسجل.
                </p>
              </>
            )}
            <div className="flex gap-2">
              <button onClick={closeSession} disabled={busy}
                className="flex-1 bg-rose-600 text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Lock className="w-5 h-5" />}
                تأكيد قفل الحصة
              </button>
              <button onClick={() => setCloseOpen(false)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== cancel session ===== */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {canCancelDirect
                ? <><CalendarX className="w-5 h-5 text-rose-600" /> إلغاء الحصة</>
                : <><Send className="w-5 h-5 nk-brand-text" /> طلب إلغاء الحصة</>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
              <SummaryRow label="الحصة" value={s.subject} />
              <SummaryRow label="المجموعة" value={`${s.grade} ${s.groupName}`} />
              <SummaryRow label="الميعاد" value={`${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}`} />
              <SummaryRow label={"حضر لحد دلوقتي"} value={String(e.presentCount)} strong />
            </div>
            <p className="text-[11px] font-bold text-muted-foreground leading-relaxed bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 text-amber-800 dark:text-amber-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {canCancelDirect
                ? "الحصة مش هتقبل حضور بعد الإلغاء. الحضور والخصومات اللي اتسجلت قبل كده هتفضل زي ما هي — مفيش حاجة بتتمسح."
                : "الطلب بيروح للمدير يقرر فيه. لحد ما يرد، الحصة شغالة عادي. لو قفل الحصة قبل القرار، الطلب بيتقفل من غير تنفيذ."}
            </p>
            <div className="space-y-1.5">
              <label htmlFor="cancel-reason" className="text-sm font-bold">سبب الإلغاء (إجباري)</label>
              <textarea id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                className="w-full min-h-[70px] rounded-xl border-2 border-input bg-card px-3.5 py-2.5 font-semibold text-sm resize-none"
                placeholder={canCancelDirect ? "مثلاً: المدرس معذر والمجموعة هتتعوض السبت" : "مثلاً: القاعة فيها مشكلة والجلسة عايزين نلغيها"} />
            </div>
            <div className="flex gap-2">
              <button onClick={submitCancel} disabled={cancelBusy}
                className="flex-1 bg-rose-600 text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {cancelBusy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : canCancelDirect ? <CalendarX className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                {canCancelDirect ? "تأكيد إلغاء الحصة" : "إرسال الطلب للمدير"}
              </button>
              <button onClick={() => { setCancelOpen(false); setCancelReason(""); }} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== reopen ===== */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><LockOpen className="w-5 h-5 nk-brand-text" /> إعادة فتح حصة مقفولة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-bold bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3.5 py-2.5 text-amber-800 dark:text-amber-200 flex gap-2">
              <AlertTriangle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
              إعادة الفتح بتعمل حركة عكسية على الحسابات (مش مسح) — محتاجين سبب واضح.
            </p>
            <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)}
              className="w-full min-h-[70px] rounded-xl border-2 border-input bg-card px-3.5 py-2.5 font-semibold text-sm resize-none"
              placeholder="مثلاً: في طالب اتحسب عليه حضور بالغلط وعايزين نصححه" />
            <div className="flex gap-2">
              <button onClick={reopen} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">
                {busy ? "جاري..." : "فتح تاني"}
              </button>
              <button onClick={() => setReopenOpen(false)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================= عناصر مساعدة ============================= */

function MiniStat({ label, value, tone, icon }: { label: string; value: number; tone: "ok" | "warn" | "muted"; icon: React.ReactNode }) {
  return (
    <div className={cn(
      "rounded-xl border px-2.5 py-2 flex items-center gap-2 min-w-0",
      tone === "ok" ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900"
        : tone === "warn" ? "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900"
        : "bg-muted/50 border-border",
    )}>
      <span className={cn(
        "shrink-0",
        tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : tone === "warn" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
      )}>{icon}</span>
      <div className="min-w-0">
        <span className={cn("nk-num block font-extrabold text-sm leading-none", tone === "muted" && "text-muted-foreground")}>{value}</span>
        <span className="block text-[10px] font-bold text-muted-foreground mt-0.5 truncate">{label}</span>
      </div>
    </div>
  );
}

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border px-3 py-2">
      <span className="block text-[10px] font-bold text-muted-foreground">{label}</span>
      <span className={cn("block font-extrabold text-sm mt-0.5", mono && "nk-num")}>{value}</span>
    </div>
  );
}

function OpButton({ icon, label, desc, onClick, tone }: {
  icon: React.ReactNode; label: string; desc: string; onClick: () => void; tone?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-2xl border-2 p-3.5 flex items-center gap-3 text-start transition active:scale-[0.98] min-h-[4.2rem]",
        tone === "danger"
          ? "border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-950/70"
          : "border-border bg-card hover:bg-muted/50",
      )}
    >
      <span className={cn(
        "w-10 h-10 rounded-xl grid place-items-center shrink-0",
        tone === "danger" ? "bg-rose-600 text-white" : "nk-brand-bg-soft dark:bg-[color-mix(in_srgb,var(--c-primary)_26%,var(--card))] nk-brand-text",
      )}>{icon}</span>
      <span className="min-w-0">
        <span className="block font-extrabold text-sm">{label}</span>
        <span className="block text-[11px] font-semibold text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

function ReviewFlag({ tone, text }: { tone: "ok" | "warn" | "info"; text: string }) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-bold leading-relaxed",
      tone === "ok" ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200"
        : tone === "warn" ? "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200"
        : "bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-900 text-sky-800 dark:text-sky-200",
    )}>
      {tone === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
      {text}
    </div>
  );
}

function AttendanceTable({ data, printAttendance, showPrint }: {
  data: SessionDetail; printAttendance: () => void; showPrint?: boolean;
}) {
  return (
    <SectionCard
      title={`حضور الحصة (${data.attendance.length})`}
      icon={<Users className="w-4 h-4" />}
      action={
        showPrint ? (
          <button onClick={printAttendance}
            className="border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] dark:border-[color-mix(in_srgb,var(--c-primary)_57%,#0d1420)] bg-card nk-brand-text font-extrabold rounded-xl px-3.5 py-2 flex items-center gap-1.5 text-xs active:scale-[0.98]">
            <Printer className="w-4 h-4" />طباعة كشف الحضور
          </button>
        ) : undefined
      }
    >
      {data.attendance.length === 0 ? (
        <EmptyState title="لسه محدش حضر" hint="سجّل الحضور من تاب الحضور فوق." />
      ) : (
        <div className="overflow-x-auto nk-scroll -mx-1 px-1">
          <table className="w-full text-sm min-w-[560px] border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-3 py-2.5 text-start font-extrabold text-xs whitespace-nowrap">الطالب</th>
                <th className="px-3 py-2.5 text-start font-extrabold text-xs whitespace-nowrap">الكود</th>
                <th className="px-3 py-2.5 text-start font-extrabold text-xs whitespace-nowrap">الطريقة</th>
                <th className="px-3 py-2.5 text-end font-extrabold text-xs whitespace-nowrap nk-num">المبلغ</th>
                <th className="px-3 py-2.5 text-center font-extrabold text-xs whitespace-nowrap">الحالة</th>
                <th className="px-3 py-2.5 text-end font-extrabold text-xs whitespace-nowrap">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {data.attendance.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg nk-brand-bg-soft dark:bg-[color-mix(in_srgb,var(--c-primary)_26%,var(--card))] nk-brand-text grid place-items-center font-extrabold text-xs shrink-0">{a.name.trim()[0]}</span>
                      <span className="font-bold text-sm truncate">{a.name}</span>
                      {(a.riskScore ?? 0) > 0 && (
                        <span
                          title={`⚠️ ${a.riskFlags?.join(" + ") ?? ""}`}
                          className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-black"
                        >
                          ⚠️ {a.riskScore}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="nk-num font-bold text-sm" dir="ltr">{a.code}</span>
                    {a.unregistered && (
                      <span className="ms-1.5 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[9.5px] font-black whitespace-nowrap">غير مسجل</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap">
                      {a.method === "SESSION_QR" ? "QR الحصة" : a.method === "QR_SCAN" ? "مسح كارت" : a.method === "MANUAL" ? "يدوي" : a.method ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end nk-num font-extrabold whitespace-nowrap" dir="ltr">
                    {a.charged == null ? <span className="text-muted-foreground text-[10px]">بدون خصم</span> : <>{fmt(a.charged)} <span className="text-muted-foreground text-[10px]">ج</span></>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={cn(
                      "text-[11px] font-bold rounded-full border px-2 py-0.5 inline-flex items-center gap-1 whitespace-nowrap",
                      a.status === "PRESENT" ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300" :
                      a.status === "LATE" ? "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300" : "bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-900 text-sky-700 dark:text-sky-300"
                    )}>{ATTENDANCE_LABEL[a.status]}</span>
                  </td>
                  <td className="px-3 py-2.5 text-end text-xs text-muted-foreground font-semibold whitespace-nowrap" dir="ltr">
                    {a.at ? (() => {
                      const d = new Date(a.at);
                      return formatTime12(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
                    })() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ============================================================
   النشاط المشبوه (spec §16) — المحاولات المرفوضة/المعلمة من محرك المخاطر
   المدرّس بي شوف ملخص بسيط؛ التفاصيل التقنية بيتفتحها عند الطلب.
   مفيش لوائح تقنية مكدسة — علامات بالعربي + وقت + كود.
============================================================ */
function SuspiciousCard({ attempts }: { attempts: AttemptsRes | null }) {
  const [open, setOpen] = useState(false);
  if (!attempts) return null;
  const suspicious = attempts.attempts.filter(
    (a) => !["ACCEPTED", "ALREADY_SAME_STUDENT", "ALREADY_ATTENDED"].includes(a.outcome) || a.riskScore > 0,
  );
  if (suspicious.length === 0) return null;

  return (
    <SectionCard
      title={`⚠️ النشاط المشبوه (${suspicious.length})`}
      icon={<AlertTriangle className="w-4 h-4" />}
      action={
        <button
          onClick={() => setOpen((v) => !v)}
          className="border-2 border-border bg-card font-extrabold rounded-xl px-3.5 py-2 flex items-center gap-1.5 text-xs active:scale-[0.98] hover:bg-muted/50"
          aria-expanded={open}
        >
          {open ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-90")} />
        </button>
      }
    >
      <p className="text-xs font-bold text-muted-foreground bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2.5 leading-relaxed">
        محاولات حضور رفضها النظام أو عليها إشارات غير عادية — إدارة الحضور بتراجعها بنفسها. النظام مش بيتهم حد، بيصعّد الشك بس.
      </p>
      {open && (
        <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto nk-scroll">
          {suspicious.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={cn(
                "font-black whitespace-nowrap",
                a.outcome === "DEVICE_LOCKED" ? "text-rose-700 dark:text-rose-300"
                  : a.outcome.startsWith("ALREADY") || a.outcome === "ACCEPTED" ? "text-amber-700 dark:text-amber-300"
                  : "text-muted-foreground",
              )}>
                {ATTEMPT_OUTCOME_LABEL[a.outcome] ?? a.outcome}
              </span>
              {a.studentName && <span className="font-bold">{a.studentName}</span>}
              {a.studentCode && <span className="nk-num text-muted-foreground" dir="ltr">كود {a.studentCode}</span>}
              <span className="nk-num text-muted-foreground" dir="ltr">
                {new Date(a.at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              {a.riskFlags.length > 0 && (
                <span className="text-amber-700 dark:text-amber-300 font-bold">⚠️ {a.riskFlags.join(" + ")}</span>
              )}
              {(a.deviceTail || a.ip) && (
                <span className="text-[10px] text-muted-foreground/80 nk-num" dir="ltr" title="إشارات تقنية للمراجعة (مش هوية)">
                  [{a.deviceTail ? `dev …${a.deviceTail}` : ""}{a.deviceTail && a.ip ? " · " : ""}{a.ip ? `ip ${a.ip}` : ""}]
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SummaryRow({ label, value, strong, highlight, mono }: { label: string; value: string; strong?: boolean; highlight?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground font-semibold">{label}</span>
      <span className={cn("nk-num", strong ? "font-extrabold" : "font-bold", highlight && "text-lg")}>{value}</span>
    </div>
  );
}
