"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown, Clock, DoorClosed, Lock, LockOpen, Users, UserX, Loader2,
  AlertTriangle, RotateCcw, Printer, CheckCircle2,
  CalendarX, Send, ScanLine, ClipboardCheck, ReceiptText, Download, EllipsisVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, fmtE, formatTime12, ATTENDANCE_LABEL, userCan, userCanRequest, type SessionUser } from "./lib";
import { Chip, Loading, SectionCard, EmptyState } from "./shared";
import { usePrint, PrintableAttendanceSheet } from "./print";
import { feedback } from "./feedback";
import { showSuccess } from "./success-bar";
import { ScanView } from "./scan";
import { SessionQrCard } from "./session-qr-card";
import { useCaps } from "./caps";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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

type StepId = "attendance" | "review";

/**
 * مساحة عمل الحصة — خط أنابيب من خطوتين بس:
 * ① سجّل الحضور (الشغل الأساسي — بيفتح عليه مباشرة) → ② راجع وقفل.
 * بعد القفل الخط بيتحول لملخص نهائي جاهز للطباعة/التصدير.
 * نفس مكان العمل للكل: المدير والاستقبال (الدور بيحدد الأزرار المتاحة).
 * الحفظ ≠ القفل: الحضور بيتسجل لحظيًا، والقفل قرار صريح.
 */
export function SessionLiveView({ user, sessionId, onBack, onGoScan, initialTab, qrFullscreen }: {
  user: SessionUser; sessionId: string; onBack: () => void; onGoScan: () => void;
  initialTab?: "overview" | "attendance" | "operations" | "review"; qrFullscreen?: boolean;
}) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const [step, setStep] = useState<StepId>(initialTab === "review" ? "review" : "attendance");
  // اختيار الخطوة تلقائيًا مرة واحدة لما الداتا توصل — إلا لو مكان مدفوع صراحة من نقطة الدخول
  const stepChosen = useRef(initialTab === "attendance" || initialTab === "review");
  // فتح الكود بحجم الشاشة فورًا (workflow: الحصة المفتوحة = الكود هو الشغل)
  const [autoFullQr, setAutoFullQr] = useState<boolean>(qrFullscreen === true);
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
  const [logOpen, setLogOpen] = useState(false);
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

  // حصة مقفولة/ملغاة والمدفوع مش محدد؟ افتح على الملخص مباشرة — ده اللي جاي له
  useEffect(() => {
    if (data && !stepChosen.current) {
      stepChosen.current = true;
      const st = data.session.status;
      if (st === "CLOSED" || st === "CANCELLED") setStep("review");
    }
  }, [data]);

  // مدفوعات الحصة — بتتحمل لما المراجعة تتفتح أو بعد القفل (مش بولينج مستمر)
  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const d = await api<SessionPayments>(`/api/payments?sessionId=${sessionId}&pageSize=50`);
      setPayments(d);
    } catch { /* toast */ } finally { setPaymentsLoading(false); }
  }, [sessionId]);

  useEffect(() => { if (step === "review") loadPayments(); }, [step, loadPayments]);

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
      setStep("review"); // الملخص التشغيلي بعد القفل
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

  const step1Active = step === "attendance";
  const step2Active = step === "review";

  return (
    <div className="space-y-3.5">
      {/* ===== ١ · كارت الحصة المضغوط — الاسم والحالة والميعاد في نظرة واحدة ===== */}
      <div className="nk-card rounded-2xl p-3.5 md:p-4" data-tour="session-dashboard">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {cancelled ? (
                <span className="rounded-full bg-rose-600 text-white px-2.5 py-1 inline-flex items-center gap-1 text-[11px] font-extrabold shrink-0"><CalendarX className="w-3.5 h-3.5" /> ملغاة</span>
              ) : closed ? (
                <span className="rounded-full bg-muted text-foreground border border-border px-2.5 py-1 inline-flex items-center gap-1 text-[11px] font-extrabold shrink-0"><DoorClosed className="w-3.5 h-3.5" /> مقفولة</span>
              ) : (
                <span className="rounded-full bg-emerald-700 text-white px-2.5 py-1 inline-flex items-center gap-1 text-[11px] font-extrabold shrink-0"><span className="w-2 h-2 rounded-full bg-white/90 animate-pulse" /> شغالة دلوقتي</span>
              )}
              <h1 className="font-extrabold text-base md:text-lg leading-snug min-w-0 truncate">
                {isOpenMode ? s.subject : `${s.subject} — ${s.grade} ${s.groupName}`}
              </h1>
            </div>
            <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="nk-num">{formatTime12(s.startTime)} – {formatTime12(s.endTime)}</span>
              {s.room && <span>· {s.room}</span>}
              {!isOpenMode && <span>· {s.teacher}</span>}
              {isOpenMode && <span className="nk-brand-text">· حضور مفتوح</span>}
            </p>
          </div>

          {/* الأدوات النادرة — قائمة واحدة مرتبة بدل تاب كامل */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-9 h-9 rounded-xl border border-border bg-card grid place-items-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition active:scale-95"
                aria-label="أدوات إضافية"
              >
                <EllipsisVertical className="w-4.5 h-4.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={printAttendance}>
                <Printer className="w-4 h-4" /> طباعة كشف الحضور
              </DropdownMenuItem>
              {!cancelled && (
                <DropdownMenuItem onClick={onGoScan}>
                  <ScanLine className="w-4 h-4" /> شاشة المسح الكاملة
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setLogOpen(true)}>
                <Clock className="w-4 h-4" /> سجل الحالة والبيانات
              </DropdownMenuItem>
              {!closed && !cancelled && (canCancelDirect || canCancelRequest) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setCancelOpen(true)} className="text-rose-600 focus:text-rose-600">
                    {canCancelDirect ? <CalendarX className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    {canCancelDirect ? "إلغاء الحصة" : "طلب إلغاء الحصة"}
                  </DropdownMenuItem>
                </>
              )}
              {closed && isManager && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setReopenOpen(true)}>
                    <RotateCcw className="w-4 h-4" /> إعادة فتح الحصة
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ===== ٢ · الخط التشغيلي — خطوتين واضحين بدل ٤ تابات وداشبورد ===== */}
      {cancelled ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-bold text-rose-800 dark:text-rose-200">
          <CalendarX className="w-4.5 h-4.5 shrink-0" />
          الحصة ملغاة — الحضور اللي اتسجل قبل الإلغاء محفوظ زي ما هو تحت.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 nk-card rounded-2xl p-1.5" role="tablist" aria-label="خطوات الحصة" data-tour="session-tabs">
          {/* الخطوة ١ — سجّل الحضور */}
          <button
            role="tab"
            aria-selected={step1Active}
            onClick={() => setStep("attendance")}
            className={cn(
              "rounded-xl px-3 py-2.5 text-start flex items-center gap-2.5 transition active:scale-[0.98] min-h-[3.6rem]",
              step1Active ? "nk-brand-grad text-white shadow" : "text-foreground hover:bg-muted/60",
            )}
          >
            <span className={cn(
              "w-7 h-7 rounded-lg grid place-items-center text-xs font-black shrink-0",
              step1Active ? "bg-white/20 text-white" : closed ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
            )}>
              {closed ? <CheckCircle2 className="w-4 h-4" /> : "١"}
            </span>
            <span className="min-w-0">
              <span className="block font-extrabold text-xs md:text-[13px] leading-tight">سجّل الحضور</span>
              <span className={cn("block text-[10px] font-bold leading-tight mt-0.5 truncate", step1Active ? "text-white/80" : "text-muted-foreground")}>
                {isOpenMode
                  ? `${data.attendance.length} اتسجل`
                  : `${e.presentCount} حاضر · ${data.absent.length} غايب`}
              </span>
            </span>
          </button>
          {/* الخطوة ٢ — راجع وقفل */}
          <button
            role="tab"
            aria-selected={step2Active}
            onClick={() => setStep("review")}
            className={cn(
              "rounded-xl px-3 py-2.5 text-start flex items-center gap-2.5 transition active:scale-[0.98] min-h-[3.6rem]",
              step2Active ? "nk-brand-grad text-white shadow" : "text-foreground hover:bg-muted/60",
            )}
          >
            <span className={cn(
              "w-7 h-7 rounded-lg grid place-items-center text-xs font-black shrink-0",
              step2Active ? "bg-white/20 text-white" : closed ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
            )}>
              {closed ? <CheckCircle2 className="w-4 h-4" /> : "٢"}
            </span>
            <span className="min-w-0">
              <span className="block font-extrabold text-xs md:text-[13px] leading-tight">راجع وقفل</span>
              <span className={cn("block text-[10px] font-bold leading-tight mt-0.5 truncate", step2Active ? "text-white/80" : "text-muted-foreground")}>
                {closed ? "الملخص النهائي" : isOpenMode ? "قفل وتصدير CSV" : canEnd ? "راجع الأرقام واقفل" : "مراجعة قبل قفل المدير"}
              </span>
            </span>
          </button>
        </div>
      )}

      {/* =========================== الخطوة ١ · سجّل الحضور =========================== */}
      {step === "attendance" && !cancelled && (
        <div className="space-y-3.5 nk-anim-view">
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
              {/* مفيش صف أرقام هنا — العدادات عايشة في عنوان الخطوة وترويسات الأقسام المطوية نفسها */}

              {/* تنبيه لو مفيش طرق حضور مفعّلة في المركز */}
              {!isOpenMode && !caps.static_qr.enabled && !caps.name_attendance.enabled && !caps.dynamic_qr.enabled && (
                <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
                  مفيش طرق حضور مفعّلة في المركز — كلّم المدير يفعّلها من الإعدادات.
                </div>
              )}

              {/* كود الحصة المتنقل — حصص الحضور المفتوح: ده هو الشغل كله */}
              {caps.dynamic_qr.enabled && <SessionQrCard sessionId={sessionId} autoFullscreen={autoFullQr} onFullscreenHandled={() => setAutoFullQr(false)} />}

              {/* المسح المدمج — نفس محرك شاشة الحضور المجرب، بس مربوط بالحصة دي */}
              {!isOpenMode && (caps.static_qr.enabled || caps.name_attendance.enabled) && (
                <ScanView user={user} embedded sessionOverride={sessionId} clearSessionOverride={() => {}} />
              )}

              {/* المسجلين ومحضروش — الزرار الأساسي ظاهر دايمًا في السطر، وأسماء الغايبين مطوية تحته */}
              {!isOpenMode && data.absent.length > 0 && caps.name_attendance.enabled && (
                <FoldSection
                  title={`مسجلين ومحضروش (${data.absent.length})`}
                  icon={<UserX className="w-4 h-4" />}
                  collapsedSummary={
                    <span className="text-[11px] font-bold text-muted-foreground truncate hidden sm:block">أسماء الغايبين مطوية — اضغط للعرض</span>
                  }
                  action={
                    <button
                      onClick={(e) => { e.stopPropagation(); setBulkOpen(true); }}
                      className="nk-brand-bg text-white font-extrabold rounded-xl px-3 py-1.5 flex items-center gap-1.5 text-xs shadow active:scale-[0.98] shrink-0"
                    >
                      <CheckCircle2 className="w-4 h-4" /> علّم الكل ({data.absent.length})
                    </button>
                  }
                >
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto nk-scroll">
                    {data.absent.map((a) => (
                      <Chip key={a.studentId} className="bg-card border-border">{a.name} · <span className="nk-num">{a.code}</span></Chip>
                    ))}
                  </div>
                  <p className="text-[11px] font-bold text-muted-foreground mt-3 bg-muted/50 rounded-xl px-3 py-2">
                    الطالب اللي حضر متأخر؟ علّمه من المسح فوق. زرار «علّم الكل» للأولاد اللي حضروا كلهم — الغايبين فعلاً هيفضلوا من غير تحضير.
                  </p>
                </FoldSection>
              )}

              <AttendanceTable data={data} printAttendance={printAttendance} showPrint />
              <SuspiciousCard attempts={attempts} />
            </>
          )}
        </div>
      )}

      {/* =========================== الخطوة ٢ · راجع وقفل =========================== */}
      {step === "review" && !cancelled && (
        <div className="space-y-3.5 nk-anim-view">
          {closed && isOpenMode ? (
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
                {/* بيانات الحصة في عمودين — نص الارتفاع، نفس المعلومات */}
                <div className="grid grid-cols-2 gap-x-5">
                  <SummaryRow label="المجموعة" value={`${s.grade} ${s.groupName}`} />
                  <SummaryRow label="المدرس" value={s.teacher} />
                  <SummaryRow label="القاعة" value={s.room ?? "—"} />
                  <SummaryRow label="الميعاد" value={`${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}`} mono />
                </div>
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

              {/* مدفوعات الحصة — مطوية: العدد قدام العنوان دايمًا، والدفعات عند الطلب */}
              <FoldSection
                title="مدفوعات الحصة"
                icon={<ReceiptText className="w-4 h-4" />}
                badge={
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-extrabold nk-num shrink-0">
                    {paymentsLoading ? "…" : payments?.total ?? 0}
                  </span>
                }
                collapsedSummary={
                  payments && payments.payments.length > 0
                    ? <span className="text-[11px] font-bold text-muted-foreground truncate hidden sm:block">اضغط لعرض الدفعات</span>
                    : undefined
                }
              >
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
              </FoldSection>
            </>
          )}
        </div>
      )}

      {/* =========================== الحصة الملغاة — السجل المحفوظ =========================== */}
      {cancelled && (
        <div className="space-y-3.5 nk-anim-view">
          <AttendanceTable data={data} printAttendance={printAttendance} showPrint />
          <SuspiciousCard attempts={attempts} />
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

      {/* ===== سجل الحالة والبيانات — كل تفاصيل الحصة في حوار واحد ===== */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock className="w-5 h-5 nk-brand-text" /> سجل الحالة والبيانات</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <InfoCell label="الحالة الحالية" value={cancelled ? "ملغاة" : closed ? "مقفولة" : "شغالة (مفتوحة)"} />
              <InfoCell label="اليوم" value={s.date} mono />
              <InfoCell label="فتحت في" value={s.openedAt ? new Date(s.openedAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"} mono />
              <InfoCell label="اتقفلت في" value={s.closedAt ? new Date(s.closedAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"} mono />
              <InfoCell label="عدد المسجلين" value={`${registered} طالب`} mono />
              {lateCount > 0 && <InfoCell label="متأخرين" value={`${lateCount} طالب`} />}
              {!isOpenMode && <InfoCell label="سعر الحصة" value={`${fmt(s.price)} ج`} mono />}
              {isOpenMode && <InfoCell label="مصدر الطلاب" value="حضور مفتوح (بدون كشف)" />}
              {isOpenMode && s.studentCodeLength && <InfoCell label="طول الكود" value={`${s.studentCodeLength} أرقام`} mono />}
            </div>
            <p className="text-[11px] font-bold text-muted-foreground bg-muted/50 rounded-xl px-3 py-2 leading-relaxed">
              الحفظ مش قفل — الحضور والمدفوعات بتتسجل لحظيًا وبتفضل محفوظة لو خرجت ورجعت. القفل بيتعمل من خطوة «راجع وقفل».
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================= عناصر مساعدة ============================= */

/* قسم قابل للطي — سرّ الصفحة القصيرة: العنوان والملخص والعدّاد ظاهرين دايمًا في سطر واحد،
   والتفاصيل بتفتح بالضغط. أي معلومة مش شغل مباشر بتعيش جواه. */
function FoldSection({ title, icon, badge, collapsedSummary, defaultOpen = false, action, children }: {
  title: React.ReactNode; icon?: React.ReactNode; badge?: React.ReactNode;
  collapsedSummary?: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="nk-card rounded-2xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none nk-brand-bg-soft hover:brightness-[0.985] active:brightness-[0.97] transition"
      >
        {icon}
        <span className="font-bold text-sm md:text-[15px] flex-1 min-w-0 truncate">{title}</span>
        {badge}
        {!open && collapsedSummary}
        {action}
        <ChevronDown className={cn("w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </div>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

/* صف أفاتار مضغوط — ملخص الكشف المطوي: أول ٥ حروف + «+N» بدل جدول طويل */
function AvatarStack({ names }: { names: string[] }) {
  const shown = names.slice(0, 5);
  return (
    <span className="hidden sm:flex items-center shrink-0" dir="ltr">
      {shown.map((n, i) => (
        <span
          key={`${n}-${i}`}
          className="w-6 h-6 rounded-lg nk-brand-bg-soft dark:bg-[color-mix(in_srgb,var(--c-primary)_26%,var(--card))] nk-brand-text grid place-items-center text-[10px] font-extrabold border-2 border-[var(--card)] -ml-1.5 first:ml-0"
        >
          {n.trim()[0]}
        </span>
      ))}
      {names.length > 5 && (
        <span className="w-6 h-6 rounded-lg bg-muted text-muted-foreground grid place-items-center text-[10px] font-extrabold border-2 border-[var(--card)] -ml-1.5">
          +{names.length - 5}
        </span>
      )}
    </span>
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
  const count = data.attendance.length;
  return (
    <FoldSection
      title={`حضور الحصة (${count})`}
      icon={<Users className="w-4 h-4" />}
      /* كشوف صغيرة تفتح لوحدها — الكبيرة تفضل مطوية على سطر واحد (أفاتار + عدّاد) */
      defaultOpen={count > 0 && count <= 8}
      action={
        showPrint ? (
          <button
            onClick={(e) => { e.stopPropagation(); printAttendance(); }}
            className="border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] dark:border-[color-mix(in_srgb,var(--c-primary)_57%,#0d1420)] bg-card nk-brand-text font-extrabold rounded-xl px-3 py-1.5 flex items-center gap-1.5 text-xs active:scale-[0.98] shrink-0"
          >
            <Printer className="w-4 h-4" />طباعة
          </button>
        ) : undefined
      }
      collapsedSummary={
        count > 0 ? <AvatarStack names={data.attendance.map((a) => a.name)} />
          : <span className="text-[11px] font-bold text-muted-foreground hidden sm:block">لسه محدش حضر</span>
      }
    >
      {count === 0 ? (
        <EmptyState title="لسه محدش حضر" hint="سجّل الحضور من أدوات المسح والكود اللي فوق." />
      ) : (
        <div className="overflow-y-auto nk-scroll max-h-[55vh] -mx-1 px-1">
          <table className="w-full text-sm min-w-[560px] border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-3 py-2 text-start font-extrabold text-xs whitespace-nowrap">الطالب</th>
                <th className="px-3 py-2 text-start font-extrabold text-xs whitespace-nowrap">الكود</th>
                <th className="px-3 py-2 text-start font-extrabold text-xs whitespace-nowrap">الطريقة</th>
                <th className="px-3 py-2 text-end font-extrabold text-xs whitespace-nowrap nk-num">المبلغ</th>
                <th className="px-3 py-2 text-center font-extrabold text-xs whitespace-nowrap">الحالة</th>
                <th className="px-3 py-2 text-end font-extrabold text-xs whitespace-nowrap">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {data.attendance.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30 transition">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-7 h-7 rounded-lg nk-brand-bg-soft dark:bg-[color-mix(in_srgb,var(--c-primary)_26%,var(--card))] nk-brand-text grid place-items-center font-extrabold text-xs shrink-0">{a.name.trim()[0]}</span>
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
                  <td className="px-3 py-2">
                    <span className="nk-num font-bold text-sm" dir="ltr">{a.code}</span>
                    {a.unregistered && (
                      <span className="ms-1.5 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[9.5px] font-black whitespace-nowrap">غير مسجل</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[11px] font-bold text-muted-foreground whitespace-nowrap">
                      {a.method === "SESSION_QR" ? "QR الحصة" : a.method === "QR_SCAN" ? "مسح كارت" : a.method === "MANUAL" ? "يدوي" : a.method ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-end nk-num font-extrabold whitespace-nowrap" dir="ltr">
                    {a.charged == null ? <span className="text-muted-foreground text-[10px]">بدون خصم</span> : <>{fmt(a.charged)} <span className="text-muted-foreground text-[10px]">ج</span></>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={cn(
                      "text-[11px] font-bold rounded-full border px-2 py-0.5 inline-flex items-center gap-1 whitespace-nowrap",
                      a.status === "PRESENT" ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300" :
                      a.status === "LATE" ? "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300" : "bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-900 text-sky-700 dark:text-sky-300"
                    )}>{ATTENDANCE_LABEL[a.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-end text-xs text-muted-foreground font-semibold whitespace-nowrap" dir="ltr">
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
    </FoldSection>
  );
}

/* ============================================================
   النشاط المشبوه (spec §16) — المحاولات المرفوضة/المعلمة من محرك المخاطر
   الكارت كله مطوي على سطر واحد بعداد — التفاصيل تفتح بالضغط.
============================================================ */
function SuspiciousCard({ attempts }: { attempts: AttemptsRes | null }) {
  if (!attempts) return null;
  const suspicious = attempts.attempts.filter(
    (a) => !["ACCEPTED", "ALREADY_SAME_STUDENT", "ALREADY_ATTENDED"].includes(a.outcome) || a.riskScore > 0,
  );
  if (suspicious.length === 0) return null;

  return (
    <FoldSection
      title={`النشاط المشبوه (${suspicious.length})`}
      icon={<AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
      badge={
        <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-[10px] font-black shrink-0">مراجعة</span>
      }
      collapsedSummary={
        <span className="text-[11px] font-bold text-muted-foreground truncate hidden sm:block">محاولات رفضها النظام أو عليها إشارات — اضغط للتفاصيل</span>
      }
    >
      <p className="text-xs font-bold text-muted-foreground bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2.5 leading-relaxed">
        محاولات حضور رفضها النظام أو عليها إشارات غير عادية — إدارة الحضور بتراجعها بنفسها. النظام مش بيتهم حد، بيصعّد الشك بس.
      </p>
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
    </FoldSection>
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
