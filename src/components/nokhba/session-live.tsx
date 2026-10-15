"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown, Clock, DoorClosed, Lock, LockOpen, Users, UserX, Loader2,
  AlertTriangle, RotateCcw, Printer, CheckCircle2, ClipboardCheck, ClipboardList,
  CalendarX, Send, ScanLine, ReceiptText, Download, EllipsisVertical, Home, Search,
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
import { RecipientPickerModal, SendQueueModal, buildReportMessage, recipientPhone, type ReportStudent, type ReportContext } from "./session-report";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* ============================================================
   مساحة عمل الحصة — خط الأنابيب بخمس مراحل (نقل من المنصة الأساسية):
   ① الحضور  ② التفاعل والواجب  ③ الامتحانات  ④ المراجعة  ⑤ التقرير
   الخط مش معالج خطوات (wizard) — التنقل حر بين المراحل، والشغل بيتحفظ
   لحظيًا، والقفل قرار صريح (الحفظ ≠ الإنهاء).
   محفوظ من السنترز: المسح والـ QR، الحسابات (تحميل/نصيب مدرس)،
   المدفوعات، الاعتمادات (إلغاء/إعادة فتح)، الطباعة والتصدير، مضادات الغش.
============================================================ */

type SessionDetail = {
  session: {
    id: string; date: string; startTime: string; endTime: string; room: string | null; status: string;
    subject: string; grade: string; groupName: string; teacher: string; price: number;
    teacherPercent: number; openedAt: string | null; closedAt: string | null;
    studentSource: string; studentCodeLength: number | null; allowUnregistered: boolean;
    lessonTopic: string; homeworkText: string; videoLink: string;
  };
  economics: {
    presentCount: number; totalRevenue: number; teacherShare: number; centerShare: number;
    collected: number; outstanding: number;
  };
  attendance: {
    id: string; studentId: string | null; name: string; code: string; unregistered: boolean;
    status: "PRESENT" | "LATE" | "EXCUSED"; charged: number | null; at: string | null;
    method: string; phone: string | null; parentPhone: string | null;
    homeworkStatus: string | null; interactionPlus: number; interactionMinus: number;
    riskScore: number; riskFlags: string[];
  }[];
  absent: { studentId: string; name: string; code: string; phone: string | null; parentPhone: string | null }[];
  exam: { id: string; title: string; maxScore: number } | null;
  examScores: { studentId: string; score: number | null }[];
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

// ===== مراحل الخط — نفس مراحل المنصة الأساسية =====
type TabKey = "attendance" | "interaction" | "exams" | "review" | "report";
const TABS: { key: TabKey; n: number; title: string; sub: string }[] = [
  { key: "attendance", n: 1, title: "الحضور", sub: "سجّل حاضر وغائب" },
  { key: "interaction", n: 2, title: "التفاعل والواجب", sub: "للحاضرين فقط" },
  { key: "exams", n: 3, title: "الامتحانات", sub: "الدرجات والتصحيح" },
  { key: "review", n: 4, title: "المراجعة", sub: "راجع قبل الإغلاق" },
  { key: "report", n: 5, title: "التقرير", sub: "التقرير وإنهاء الحصة" },
];

const HW_LABEL: Record<string, string> = { DONE: "✓ مكتمل", PARTIAL: "◐ ناقص", MISSING: "○ لم يتم" };

// ===== حالة المراحل الصريحة (نقل useStageState): إنجاز المرحلة قرار مدرس مش نسبة =====
function readStage(sid: string): { attendanceComplete: boolean; tab: TabKey | null } {
  try {
    const raw = localStorage.getItem(`nk_stage_v1_${sid}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { attendanceComplete: false, tab: null };
}
function writeStage(sid: string, patch: Partial<{ attendanceComplete: boolean; tab: TabKey }>) {
  try {
    const next = { ...readStage(sid), ...patch };
    localStorage.setItem(`nk_stage_v1_${sid}`, JSON.stringify(next));
  } catch { /* ignore */ }
}

/** صف الكشف الموحّد: حاضر (له صف حضور) أو لم يُرصد (من الكشف) أو غائب (بعد القفل) */
type RosterRow = {
  studentId: string; name: string; code: string;
  phone: string | null; parentPhone: string | null;
  attId: string | null; status: "PRESENT" | "LATE" | "EXCUSED" | null; charged: number | null;
  homeworkStatus: string | null; interactionPlus: number; interactionMinus: number;
};

/**
 * مساحة عمل الحصة — خط أنابيب 5 مراحل.
 * نفس مكان العمل للكل: المدير والاستقبال (الدور بيحدد الأزرار المتاحة).
 */
export function SessionLiveView({ user, sessionId, onBack, onGoScan, initialTab, qrFullscreen }: {
  user: SessionUser; sessionId: string; onBack: () => void; onGoScan: () => void;
  initialTab?: "overview" | "attendance" | "operations" | "review"; qrFullscreen?: boolean;
}) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const caps = useCaps();
  // المرحلة الافتتاحية: من initialTab أو آخر مرحلة محفوظة (استرجاع بعد الريفرش)
  const [tab, setTabState] = useState<TabKey>(() => {
    if (initialTab === "review") return "review";
    return readStage(sessionId).tab ?? "attendance";
  });
  const setTab = useCallback((k: TabKey) => {
    setTabState(k);
    writeStage(sessionId, { tab: k });
  }, [sessionId]);
  // وضع تعديل حصة قديمة (نقل من المنصة الأساسية): مقفولة + صلاحية → الواجب/التفاعل/الامتحان/البيانات تتعدل
  const [editPast, setEditPast] = useState(false);
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
  // تنبيهات محلية لكل طالب (تم الحفظ) — نفس إحساس المنصة الأساسية
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({});
  const flashTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // قفزة «عرض الغائبين» من التقرير → الحضور مفلتر على الغايبين
  const [absentIntent, setAbsentIntent] = useState(0);

  const load = useCallback(() => {
    api<SessionDetail>(`/api/sessions/${sessionId}`).then(setData).catch(() => {});
  }, [sessionId]);

  const loadAttempts = useCallback(() => {
    api<AttemptsRes>(`/api/attendance/public/attempts?sessionId=${sessionId}`).then(setAttempts).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    load(); loadAttempts();
    const t = setInterval(load, 8000);
    const t2 = setInterval(loadAttempts, 8000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, [load, loadAttempts]);

  // حصة مقفولة/ملغاة والمرحلة مش محددة؟ افتح على التقرير مباشرة — ده اللي جاي له
  const stepChosen = useRef(!!initialTab);
  useEffect(() => {
    if (data && !stepChosen.current) {
      stepChosen.current = true;
      const st = data.session.status;
      if (st === "CLOSED" || st === "CANCELLED") setTab("report");
    }
  }, [data, setTab]);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const d = await api<SessionPayments>(`/api/payments?sessionId=${sessionId}&pageSize=50`);
      setPayments(d);
    } catch { /* toast */ } finally { setPaymentsLoading(false); }
  }, [sessionId]);

  useEffect(() => { if (tab === "report") loadPayments(); }, [tab, loadPayments]);

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

  // ===== مشتقات الكشف والحسابات =====
  const s = data?.session;
  const e = data?.economics;
  const isManager = user.role === "MANAGER";
  const closed = s?.status === "CLOSED";
  const cancelled = s?.status === "CANCELLED";
  const isOpenMode = s?.studentSource === "OPEN";
  // editable = الحصة مفتوحة، أو مقفولة مع وضع التعديل + صلاحية (نقل من المنصة الأساسية)
  const editAllowed = isManager || userCan(user, "EDIT_ATTENDANCE");
  const editPastOrOpen = (!closed && !cancelled) || (closed && editAllowed && editPast);
  const canEditRecords = editPastOrOpen;

  // صفوف الكشف الموحدة (ROSTER): الحاضرين (صفوف حقيقية) + غير المرصد/الغايبين من الكشف
  const roster: RosterRow[] = useMemo(() => {
    if (!data || isOpenMode) return [];
    const present: RosterRow[] = data.attendance
      .filter((a) => a.studentId !== null)
      .map((a) => ({
        studentId: a.studentId as string, name: a.name, code: a.code,
        phone: a.phone, parentPhone: a.parentPhone,
        attId: a.id, status: a.status, charged: a.charged,
        homeworkStatus: a.homeworkStatus, interactionPlus: a.interactionPlus, interactionMinus: a.interactionMinus,
      }));
    const byId = new Set(present.map((p) => p.studentId));
    const rest: RosterRow[] = (data.absent ?? []).filter((x) => !byId.has(x.studentId)).map((x) => ({
      studentId: x.studentId, name: x.name, code: x.code,
      phone: x.phone, parentPhone: x.parentPhone,
      attId: null, status: null, charged: null,
      homeworkStatus: null, interactionPlus: 0, interactionMinus: 0,
    }));
    return [...present, ...rest];
  }, [data, isOpenMode]);

  const rosterTotal = roster.length;
  const presentCount = roster.filter((r) => r.status !== null && r.status !== "EXCUSED").length;
  const lateCount = roster.filter((r) => r.status === "LATE").length;
  const unmarked = roster.filter((r) => r.status === null).length;
  // الواجب: للحاضرين بس (زي المنصة الأساسية — الغايب مش applicable)
  const hwApplicable = roster.filter((r) => r.status !== null).length;
  const hwDone = roster.filter((r) => r.status !== null && r.homeworkStatus === "DONE").length;
  const interactionCount = roster.filter((r) => r.status !== null && (r.interactionPlus > 0 || r.interactionMinus > 0)).length;
  const gradedCount = data?.examScores?.filter((sc) => sc.score != null).length ?? 0;

  function flashSaved(studentId: string) {
    setSavedFlash((m) => ({ ...m, [studentId]: true }));
    clearTimeout(flashTimer.current[studentId]);
    flashTimer.current[studentId] = setTimeout(() => {
      setSavedFlash((m) => ({ ...m, [studentId]: false }));
    }, 1400);
  }

  // ===== أفعال الحضور =====
  async function markPresent(studentId: string, status: "PRESENT" | "LATE") {
    try {
      await api("/api/attendance/mark", { method: "POST", body: { studentId, sessionId, status } });
      feedback("success");
      flashSaved(studentId);
      load();
    } catch { /* toast */ }
  }

  async function unmark(attId: string, studentId: string) {
    try {
      await api(`/api/attendance/mark?attendanceId=${attId}`, { method: "DELETE" });
      feedback("success");
      flashSaved(studentId);
      load();
    } catch { /* toast */ }
  }

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

  // ===== أفعال التفاعل والواجب =====
  async function saveRecord(studentId: string, payload: { homeworkStatus?: "DONE" | "PARTIAL" | "MISSING" | null; interaction?: "plus" | "minus" }) {
    try {
      await api(`/api/sessions/${sessionId}/records`, { method: "POST", body: { studentId, ...payload } });
      flashSaved(studentId);
      load();
    } catch { /* toast */ }
  }

  // ===== أفعال الحصة =====
  function downloadCsv() {
    window.location.href = `/api/sessions/${sessionId}/export`;
  }

  async function submitCancel() {
    if (cancelReason.trim().length < 3) {
      toast.error("اكتب سبب الإلغاء (3 حروف على الأقل) — بيتحفظ في السجل.");
      return;
    }
    setCancelBusy(true);
    try {
      const canCancelDirect = userCan(user, "CANCEL_SESSION");
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
      setTab("report"); // التقرير بعد القفل
      load();
      loadPayments();
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
      toast.error("اكتب سبب إعادة فتح الحصة.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}`, { method: "POST", body: { action: "reopen", reason: reopenReason } });
      toast.success("تم فتح الحصة تاني — الحسابات القديمة اتلغت بحركة عكسية.");
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      setReopenOpen(false);
      setReopenReason("");
      setEditPast(false);
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  // ===== حالة كل مرحلة (نفس حسابات المنصة الأساسية: ✓ مكتمل / ! محتاج انتباه / ● نشطة / رقم) =====
  const stepStateOf = useCallback((key: TabKey): "done" | "attention" | "active" => {
    if (cancelled) return "active";
    if (closed) {
      if (key === "attendance" || key === "report") return "done";
      if (key === "interaction") return "done";
      if (key === "exams") return (data?.exam ? "done" : "active");
      return "active";
    }
    if (key === "attendance") {
      if (readStage(sessionId).attendanceComplete) return "done";
      if (isOpenMode) return (data?.attendance.length ?? 0) > 0 ? "done" : "active";
      if (unmarked > 0 && presentCount > 0) return "attention";
      if (unmarked === 0 && rosterTotal > 0) return "done";
      return "active";
    }
    if (key === "interaction") {
      if (isOpenMode) return "active";
      if (hwApplicable === 0) return "active";
      if (hwDone >= hwApplicable) return "done";
      if (hwDone > 0) return "attention";
      return "active";
    }
    if (key === "exams") return data?.exam ? "done" : "active";
    if (key === "review") return "active";
    return closed ? "done" : "active";
  }, [cancelled, closed, data?.exam, isOpenMode, presentCount, rosterTotal, sessionId, unmarked, hwApplicable, hwDone, data?.attendance.length]);

  const completeAttendanceStage = useCallback(() => {
    writeStage(sessionId, { attendanceComplete: true });
    setTab(presentCount > 0 && !isOpenMode ? "interaction" : closed ? "report" : "review");
  }, [sessionId, presentCount, isOpenMode, closed, setTab]);

  const viewAbsentFromReport = useCallback(() => {
    setAbsentIntent((n) => n + 1);
    setTab("attendance");
  }, [setTab]);

  if (!data || !s || !e) return <Loading />;

  const isOpenSession = isOpenMode; // حضور مفتوح — مفيش كشف/تفاعل/واجب/درجات
  const canCancelDirect = userCan(user, "CANCEL_SESSION");
  const canCancelRequest = userCanRequest(user, "REQUEST_SESSION_CANCELLATION");
  const canEnd = userCan(user, "END_SESSION");
  // المراحل المعروضة: الحضور المفتوح = 3 مراحل بس (مفيش كشف)
  const visibleTabs: TabKey[] = isOpenSession
    ? ["attendance", "review", "report"]
    : ["attendance", "interaction", "exams", "review", "report"];
  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="space-y-3.5">
      {/* ===== ١ · كارت الحصة المضغوط ===== */}
      <div className="nk-ws-head" data-tour="session-dashboard">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {cancelled ? (
                <span className="nk-pill-danger"><CalendarX className="w-3.5 h-3.5" /> ملغاة</span>
              ) : closed ? (
                <span className="nk-pill-done"><DoorClosed className="w-3.5 h-3.5" /> منتهية · محفوظة في السجل</span>
              ) : (
                <span className="nk-pill-live"><span className="w-2 h-2 rounded-full bg-current animate-pulse" /> جارية الآن</span>
              )}
              <span className="text-[10px] font-black tracking-widest opacity-70">SESSION WORKSPACE</span>
            </div>
            <h1 className="font-black text-base md:text-lg leading-snug min-w-0 truncate mt-1">
              {isOpenSession ? s.subject : `${s.subject} — ${s.grade} ${s.groupName}`}
            </h1>
            <p className="text-xs font-bold nk-ws-muted mt-1 flex items-center gap-1.5 flex-wrap">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="nk-num">{formatTime12(s.startTime)} – {formatTime12(s.endTime)}</span>
              {s.room && <span>· {s.room}</span>}
              {!isOpenSession && <span>· {s.teacher}</span>}
              {isOpenSession && <span>· حضور مفتوح</span>}
            </p>
          </div>

          {/* الأدوات النادرة */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 grid place-items-center shrink-0 text-white/90 hover:bg-white/15 transition active:scale-95"
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

        {/* وضع تعديل حصة قديمة (نقل من المنصة الأساسية) */}
        {closed && !cancelled && editAllowed && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={cn("rounded-xl px-4 py-2 text-[.72rem] font-extrabold transition",
                editPast ? "bg-white text-[var(--c-primary)]" : "bg-white/10 border border-white/25 text-white hover:bg-white/15")}
              aria-pressed={editPast}
              onClick={() => setEditPast((v) => !v)}
            >
              {editPast ? "✓ إنهاء التعديل" : "✎ تعديل بيانات هذه الحصة"}
            </button>
          </div>
        )}
        {closed && editPast && (
          <p className="nk-notice mt-3 !bg-white/10 !border-white/25 !text-white/90">
            وضع التعديل مفعّل — عدّل الواجب والتفاعل والدرجات وبيانات الحصة من المراحل فوق، وكل تغيير بيتحفظ فورًا.
            تعديل الحضور نفسه للمدير بيتم بإعادة فتح الحصة (عشان الحسابات).
          </p>
        )}

        {/* الملخص المصغر الدائم — عمره ما بيختفي مع تنقل المراحل */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-4">
          <div className="nk-mini"><small>{isOpenSession ? "المسجلين" : "الطلاب"}</small><b dir="ltr" className="text-end">{isOpenSession ? data.attendance.length : rosterTotal}</b></div>
          <div className="nk-mini nk-mini--ok"><small>الحضور</small><b dir="ltr" className="text-end">{isOpenSession ? data.attendance.length : `${presentCount} / ${rosterTotal}`}</b></div>
          {!isOpenSession && <div className="nk-mini"><small>لم يُرصد</small><b dir="ltr" className="text-end">{unmarked}</b></div>}
          {!isOpenSession && <div className="nk-mini nk-mini--gold"><small>الواجب</small><b dir="ltr" className="text-end">{hwDone} / {hwApplicable}</b></div>}
          {!isOpenSession && <div className="nk-mini nk-mini--info"><small>الدرجات</small><b dir="ltr" className="text-end">{data.exam ? `${gradedCount} / ${presentCount}` : "—"}</b></div>}
        </div>
      </div>

      {/* ===== ٢ · خط المراحل — تنقل حر (مش معالج خطوات) ===== */}
      {!cancelled && (
        <div className="nk-timeline" role="tablist" aria-label="مراحل الحصة" data-tour="session-tabs">
          {visibleTabs.map((k, i) => {
            const t = TABS.find((x) => x.key === k)!;
            const state = k === tab ? "active" : stepStateOf(k);
            const mark = state === "done" ? "✓" : state === "attention" ? "!" : k === tab ? "●" : String(i + 1);
            const cls = k === tab ? "nk-timeline__step--active" : state === "done" ? "nk-timeline__step--done" : state === "attention" ? "nk-timeline__step--attention" : "";
            return (
              <div key={k} className="flex items-start gap-0.2 flex-1">
                {i > 0 && <span className={cn("nk-timeline__link", state === "done" && "nk-timeline__link--done")} aria-hidden />}
                <button role="tab" aria-selected={k === tab} className={cn("nk-timeline__step", cls)} onClick={() => setTab(k)}>
                  <span className="nk-timeline__dot" aria-hidden>{mark}</span>
                  <small className="nk-timeline__label">{t.title}</small>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* عنوان المرحلة */}
      {!cancelled && (
        <div>
          <h2 className="text-base font-extrabold m-0">{activeTab.title}</h2>
          <p className="text-xs font-bold text-muted-foreground mt-0.5">{activeTab.sub}</p>
        </div>
      )}

      {/* =========================== ① الحضور =========================== */}
      {tab === "attendance" && !cancelled && (
        <AttendanceStage
          data={data} user={user} caps={caps} sessionId={sessionId}
          roster={roster} isOpenSession={isOpenSession} closed={closed}
          editable={!closed && !cancelled}
          attempts={attempts}
          absentIntent={absentIntent}
          savedFlash={savedFlash}
          onCompleteStage={completeAttendanceStage}
          onMarkPresent={markPresent}
          onUnmark={unmark}
          onBulkOpen={() => setBulkOpen(true)}
          autoFullQr={autoFullQr}
          onFullscreenHandled={() => setAutoFullQr(false)}
          printAttendance={printAttendance}
        />
      )}

      {/* =========================== ② التفاعل والواجب =========================== */}
      {tab === "interaction" && !cancelled && !isOpenSession && (
        <InteractionStage
          data={data} roster={roster} editable={canEditRecords}
          onRecord={saveRecord} savedFlash={savedFlash}
          hwDone={hwDone} hwApplicable={hwApplicable}
          onGoNext={() => setTab("exams")}
        />
      )}

      {/* =========================== ③ الامتحانات =========================== */}
      {tab === "exams" && !cancelled && !isOpenSession && (
        <ExamsStage
          data={data} sessionId={sessionId} roster={roster}
          editable={canEditRecords}
          onGoNext={() => setTab("review")}
          onSaved={load}
        />
      )}

      {/* =========================== ④ المراجعة =========================== */}
      {tab === "review" && !cancelled && (
        <ReviewStage
          isOpenSession={isOpenSession} closed={closed}
          rosterTotal={rosterTotal} presentCount={presentCount} unmarked={unmarked}
          interactionCount={interactionCount}
          hwDone={hwDone} hwApplicable={hwApplicable}
          hasExam={!!data.exam} gradedCount={gradedCount}
          issues={buildIssues(isOpenSession, closed, unmarked, presentCount, hwDone, hwApplicable, !!data.exam, gradedCount)}
          onGoTo={setTab}
        />
      )}

      {/* =========================== ⑤ التقرير =========================== */}
      {tab === "report" && !cancelled && (
        <ReportStage
          data={data} user={user} sessionId={sessionId}
          isOpenSession={isOpenSession} closed={closed}
          roster={roster} presentCount={presentCount}
          unmarked={unmarked} hwDone={hwDone} hwApplicable={hwApplicable}
          payments={payments} paymentsLoading={paymentsLoading}
          editable={canEditRecords}
          canEnd={canEnd}
          onCloseOpen={() => setCloseOpen(true)}
          closeBusy={busy}
          printAttendance={printAttendance}
          downloadCsv={downloadCsv}
          onViewAbsent={viewAbsentFromReport}
          onBack={onBack}
        />
      )}

      {/* الحصة الملغاة — السجل المحفوظ */}
      {cancelled && (
        <div className="space-y-3.5 nk-anim-view">
          <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm font-bold text-rose-800 dark:text-rose-200">
            <CalendarX className="w-4.5 h-4.5 shrink-0" />
            الحصة ملغاة — الحضور اللي اتسجل قبل الإلغاء محفوظ زي ما هو تحت.
          </div>
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
              <SummaryRow label="هيتعلموا حاضر" value={String(unmarked)} strong />
              <SummaryRow label="سعر الحصة للطالب" value={fmtE(s.price)} />
              <SummaryRow label="إجمالي الخصم من أرصدة الطلاب" value={fmtE(s.price * unmarked)} strong highlight />
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed">
              كل طالب من دول هيُخصم من رصيده سعر الحصة تلقائيًا. لو في طالب غايب فعلًا ومش عايز تعلّمه — ألغِ وعلم الباقي بالمسح الفردي.
            </p>
            <div className="flex gap-2">
              <button onClick={bulkMarkAll} disabled={busy}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                تأكيد — علّم الكل ({unmarked})
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
            <DialogTitle className="flex items-center gap-2"><Lock className="w-5 h-5 text-rose-600" /> إنهاء الحصة</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
              {isOpenSession ? (
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
            {isOpenSession ? (
              <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 leading-relaxed">
                مفيش كشف مستهدف للحصة دي — فمفيش غياب ولا حسابات. بعد الإنهاء تقدر تصدّر CSV بالأسماء المسجلة.
              </p>
            ) : (
              <>
                {unmarked > 0 && (
                  <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 leading-relaxed">
                    في {unmarked} طالب لم يُرصد — الإنهاء بيحوّل غير المرصد إلى غائب تلقائي (زي المنصة الأساسية)، ومفيش محتاج تعلّم حد غايب بإيدك.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground font-semibold">
                  بعد الإنهاء: الإيراد ومستحق المدرس بيتسجلوا، الحضور بيتثبت، وتقارير الواتساب بتتفعّل في تاب التقرير.
                </p>
              </>
            )}
            <div className="flex gap-2">
              <button onClick={closeSession} disabled={busy}
                className="flex-1 bg-rose-600 text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Lock className="w-5 h-5" />}
                تأكيد إنهاء الحصة
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
              <SummaryRow label="حضر لحد دلوقتي" value={String(e.presentCount)} strong />
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

      {/* ===== سجل الحالة والبيانات ===== */}
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
              <InfoCell label="عدد المسجلين" value={`${isOpenSession ? data.attendance.length : rosterTotal} طالب`} mono />
              {lateCount > 0 && <InfoCell label="متأخرين" value={`${lateCount} طالب`} />}
              {!isOpenSession && <InfoCell label="سعر الحصة" value={`${fmt(s.price)} ج`} mono />}
              {isOpenSession && <InfoCell label="مصدر الطلاب" value="حضور مفتوح (بدون كشف)" />}
              {isOpenSession && s.studentCodeLength && <InfoCell label="طول الكود" value={`${s.studentCodeLength} أرقام`} mono />}
            </div>
            <p className="text-[11px] font-bold text-muted-foreground bg-muted/50 rounded-xl px-3 py-2 leading-relaxed">
              الحفظ مش إنهاء — الحضور والتفاعل والواجب والدرجات بتتسجل لحظيًا وبتفضل محفوظة لو خرجت ورجعت. الإنهاء بيتعمل من مرحلة «التقرير».
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildIssues(
  isOpenSession: boolean, closed: boolean, unmarked: number, presentCount: number,
  hwDone: number, hwApplicable: number, hasExam: boolean, gradedCount: number,
): string[] {
  if (isOpenSession || closed) return [];
  const list: string[] = [];
  if (unmarked > 0 && presentCount > 0) list.push(`${unmarked} طالب لم يُرصد حضورهم`);
  if (unmarked > 0 && presentCount === 0) list.push("مفيش أي حضور مسجل لسه");
  if (hwApplicable > hwDone) list.push(`الواجب مكتمل لـ ${hwDone} من ${hwApplicable}`);
  if (!hasExam) list.push("لا يوجد امتحان مرتبط بهذه الحصة (اختياري)");
  else if (gradedCount < presentCount) list.push(`الدرجات مرصودة لـ ${gradedCount} من ${presentCount}`);
  return list;
}

/* ============================================================
   ① مرحلة الحضور — الكشف التفاعلي (من المنصة الأساسية) + أدوات السنترز:
      قائمة الكشف بضغطة واحدة لكل طالب (حاضر/متأخر/⟲ مسح) + بحث وفلاتر
      وعلّم الكل، وتحتها أدوات المسح (كود الحصة + المسح المدمج) محفوظة.
============================================================ */
function AttendanceStage({ data, user, caps, sessionId, roster, isOpenSession, closed, editable, attempts, absentIntent, savedFlash, onCompleteStage, onMarkPresent, onUnmark, onBulkOpen, autoFullQr, onFullscreenHandled, printAttendance }: {
  data: SessionDetail; user: SessionUser;
  caps: { dynamic_qr: { enabled: boolean }; static_qr: { enabled: boolean }; name_attendance: { enabled: boolean }; late_checkin: { enabled: boolean } };
  sessionId: string; roster: RosterRow[]; isOpenSession: boolean; closed: boolean; editable: boolean;
  attempts: AttemptsRes | null; absentIntent: number; savedFlash: Record<string, boolean>;
  onCompleteStage: () => void;
  onMarkPresent: (studentId: string, status: "PRESENT" | "LATE") => void;
  onUnmark: (attId: string, studentId: string) => void;
  onBulkOpen: () => void; autoFullQr: boolean; onFullscreenHandled: () => void;
  printAttendance: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unmarked" | "present" | "absent">("all");

  // قفزة «عرض الغائبين» من التقرير — تعديل وقت الرندر (نمط React الرسمي بدل effect)
  const [appliedIntent, setAppliedIntent] = useState(0);
  if (absentIntent !== appliedIntent) {
    setAppliedIntent(absentIntent);
    if (absentIntent) {
      setFilter("absent");
      setSearch("");
    }
  }

  const unmarkedCount = roster.filter((r) => r.status === null).length;
  const presentN = roster.filter((r) => r.status !== null && r.status !== "EXCUSED").length;
  const absentN = closed ? unmarkedCount : 0;

  const visible = useMemo(() => {
    const q = search.trim();
    return roster.filter((r) => {
      const st = r.status;
      if (filter === "present" && (st === null || st === "EXCUSED")) return false;
      if (filter === "unmarked" && st !== null) return false;
      if (filter === "absent" && st !== null) return false;
      if (!q) return true;
      return [r.name, r.code].join(" ").includes(q);
    });
  }, [roster, search, filter]);

  return (
    <div className="space-y-3 nk-anim-view">
      {/* زرار إتمام المرحلة — أعلى التاب (نفس مكان المنصة الأساسية) */}
      {!closed && !isOpenSession && (
        <div className="flex justify-end">
          <button
            className="rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem] shadow active:scale-[0.98] transition nk-brand-grad text-white"
            onClick={onCompleteStage}
          >
            ✓ إتمام الحضور والمتابعة ←
          </button>
        </div>
      )}
      {closed && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm font-bold text-muted-foreground">
          <DoorClosed className="w-4.5 h-4.5 shrink-0" />
          الحصة منتهية — الحضور ده السجل النهائي. تعديله للمدير (إعادة فتح).
        </div>
      )}

      {/* أدوات البحث والفلاتر — زي المنصة الأساسية */}
      {!isOpenSession && (
        <>
          <div className="nk-att-tools">
            <input
              className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold flex-1 min-w-0"
              placeholder="🔍 اكتب اسم الطالب..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
              aria-label="بحث سريع عن طالب"
            />
          </div>
          <div className="nk-att-chips" role="group" aria-label="فلترة القائمة">
            {([
              ["all", `الكل (${roster.length})`],
              ["unmarked", `لم يُرصد (${unmarkedCount})`],
              ["present", `حاضر (${presentN})`],
              ...(closed ? ([["absent", `غائب (${absentN})`]] as [string, string][]) : []),
            ] as [string, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key as typeof filter)}
                aria-pressed={filter === key}
                className={filter === key ? "nk-att-chip nk-att-chip--on" : "nk-att-chip"}
              >
                {label}
              </button>
            ))}
            {!closed && (
              <button className="nk-att-chip shrink-0" onClick={onBulkOpen} title="رصد كل الطلاب حاضر دفعة واحدة">
                ✓ الكل حاضر
              </button>
            )}
          </div>
        </>
      )}

      {/* ===== الكشف التفاعلي — ضغطة واحدة لكل طالب (نقل من المنصة الأساسية) ===== */}
      {!isOpenSession && (
        <div className="grid gap-1.5 nk-att-list">
          {visible.map((r) => {
            const isPresent = r.status !== null;
            const rowCls = r.status === "EXCUSED" ? "" : r.status ? "nk-att-row--present" : closed ? "nk-att-row--absent" : "";
            return (
              <div key={r.studentId} className={cn("nk-att-row", rowCls)}>
                <span className="nk-att-row__name">
                  <b className="truncate">
                    {r.name}
                    {savedFlash[r.studentId] && <span className="ms-1.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-300">✓ تم الحفظ</span>}
                    {r.status === "EXCUSED" && <span className="ms-1.5 nk-pill-neutral !text-[.58rem]">بعذر</span>}
                  </b>
                  <small>
                    {savedFlash[r.studentId] ? "✓ تم الحفظ" : (
                      <>
                        <span className="nk-num" dir="ltr">{r.code}</span>
                        {r.charged != null && r.charged > 0 ? ` · ${fmt(r.charged)} ج` : ""}
                        {r.status ? ` · ${ATTENDANCE_LABEL[r.status]}` : closed ? " · غائب" : ""}
                      </>
                    )}
                  </small>
                </span>
                {!closed && editable && (
                  <span className="nk-seg nk-seg--att" role="group" aria-label={`${r.name} attendance`}>
                    <button
                      className={r.status === "PRESENT" ? "nk-on-present" : ""}
                      aria-pressed={r.status === "PRESENT"}
                      onClick={() => (r.status ? onUnmark(r.attId!, r.studentId) : onMarkPresent(r.studentId, "PRESENT"))}
                    >
                      حاضر
                    </button>
                    {caps.late_checkin.enabled && (
                      <button
                        className={r.status === "LATE" ? "nk-on-hw-partial" : ""}
                        aria-pressed={r.status === "LATE"}
                        onClick={() => (r.status === "LATE" ? onUnmark(r.attId!, r.studentId) : onMarkPresent(r.studentId, "LATE"))}
                      >
                        متأخر
                      </button>
                    )}
                    <button
                      className={r.status ? "" : "nk-on-neutral"}
                      title="مسح الرصد"
                      disabled={!r.status}
                      onClick={() => r.attId && onUnmark(r.attId, r.studentId)}
                    >
                      ⟲
                    </button>
                  </span>
                )}
                {closed && (
                  <span className={cn("nk-pill", r.status ? "nk-pill-live" : "nk-pill-danger")}>
                    {r.status ? ATTENDANCE_LABEL[r.status] : "غائب"}
                  </span>
                )}
              </div>
            );
          })}
          {visible.length === 0 && (
            <p className="text-center py-6 text-sm text-muted-foreground font-bold">
              {roster.length === 0 ? "مفيش طلاب في كشف المجموعة" : "لا نتائج مطابقة"}
            </p>
          )}
        </div>
      )}

      {/* ===== أدوات السنترز المحفوظة — كود الحصة + المسح + النشاط المشبوه ===== */}
      {!closed && caps.dynamic_qr.enabled && (
        <SessionQrCard sessionId={sessionId} autoFullscreen={autoFullQr} onFullscreenHandled={onFullscreenHandled} />
      )}
      {!closed && !isOpenSession && (caps.static_qr.enabled || caps.name_attendance.enabled) && (
        <FoldSection
          title="المسح المدمج"
          icon={<ScanLine className="w-4 h-4" />}
          collapsedSummary={<span className="text-[11px] font-bold text-muted-foreground hidden sm:block">كشف الحصة — نفس محرك شاشة الحضور</span>}
        >
          <ScanView user={user} embedded sessionOverride={sessionId} clearSessionOverride={() => {}} />
        </FoldSection>
      )}
      {!closed && isOpenSession && (caps.static_qr.enabled || caps.name_attendance.enabled) && (
        <ScanView user={user} embedded sessionOverride={sessionId} clearSessionOverride={() => {}} />
      )}

      <AttendanceTable data={data} printAttendance={printAttendance} showPrint />
      <SuspiciousCard attempts={attempts} />
    </div>
  );
}

/* ============================================================
   ② مرحلة التفاعل والواجب — للحاضرين بس (نقل من المنصة الأساسية):
      ＋ تفاعل / − مخالفة (عدّاد ضغطات) + واجب 3 حالات — كل ضغطة بتتحفظ فورًا.
============================================================ */
function InteractionStage({ data, roster, editable, onRecord, savedFlash, hwDone, hwApplicable, onGoNext }: {
  data: SessionDetail; roster: RosterRow[]; editable: boolean;
  onRecord: (studentId: string, payload: { homeworkStatus?: "DONE" | "PARTIAL" | "MISSING" | null; interaction?: "plus" | "minus" }) => void;
  savedFlash: Record<string, boolean>;
  hwDone: number; hwApplicable: number; onGoNext: () => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"present" | "all">("present");

  const rows = useMemo(() => {
    const q = search.trim();
    return roster.filter((r) => {
      if (filter === "present" && r.status === null) return false;
      if (!q) return true;
      return [r.name, r.code].join(" ").includes(q);
    });
  }, [roster, search, filter]);

  return (
    <div className="space-y-3 nk-anim-view">
      <div className="flex justify-end">
        <button
          className="rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem] shadow active:scale-[0.98] transition nk-brand-grad text-white"
          onClick={onGoNext}
        >
          التالي — الامتحانات ←
        </button>
      </div>
      <div className="nk-notice">
        {editable
          ? "التفاعل والواجب يظهران للحاضرين — غير المرصد مستثنى تلقائيًا. كل ضغطة تُحفظ فورًا."
          : "الحصة مقفولة — العرض للقراءة فقط. اضغط «✎ تعديل بيانات هذه الحصة» فوق للتعديل."}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold flex-1 min-w-[180px]"
          placeholder="🔍 بحث بالاسم أو الكود..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="بحث"
        />
        <div className="flex rounded-xl overflow-hidden border border-border">
          {([["present", "الحاضرون"], ["all", "الكل"]] as [typeof filter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn("px-3 py-2 text-xs font-extrabold", filter === key ? "nk-brand-bg text-white" : "bg-card text-muted-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="nk-pill-pending">الواجب: <span dir="ltr" className="nk-num">{hwDone} / {hwApplicable}</span></span>
      </div>

      <div className="grid gap-2">
        {rows.map((r) => {
          const isUnmarked = r.status === null;
          return (
            <div key={r.studentId} className="nk-card rounded-2xl p-3.5 space-y-2.5" style={{ opacity: isUnmarked ? 0.65 : 1 }}>
              <div className="flex items-center justify-between gap-2 w-full min-w-0">
                <span className="min-w-0">
                  <b className="text-sm truncate block">{r.name}</b>
                  <small className="text-[11px] font-bold text-muted-foreground">
                    <span className="nk-num" dir="ltr">{r.code}</span> · الحضور: {r.status ? ATTENDANCE_LABEL[r.status] : "لم يُرصد"}
                    {savedFlash[r.studentId] && <span className="ms-1.5 text-emerald-600 dark:text-emerald-300">✓ تم الحفظ</span>}
                  </small>
                </span>
                {isUnmarked && <span className="nk-pill-neutral shrink-0">غير مرصد — غير applicable</span>}
              </div>

              {!isUnmarked && (
                <div className="flex flex-wrap items-center gap-2 w-full">
                  {/* عدّادات التفاعل */}
                  <span className="nk-seg">
                    <button
                      disabled={!editable}
                      onClick={() => onRecord(r.studentId, { interaction: "plus" })}
                      title="إجابة وتفاعل"
                    >
                      ＋ تفاعل{r.interactionPlus > 0 && <span className="ms-1 nk-num">({r.interactionPlus})</span>}
                    </button>
                    <button
                      disabled={!editable}
                      onClick={() => onRecord(r.studentId, { interaction: "minus" })}
                      title="مخالفة سلوكية"
                    >
                      − مخالفة{r.interactionMinus > 0 && <span className="ms-1 nk-num">({r.interactionMinus})</span>}
                    </button>
                  </span>
                  {/* الواجب — 3 حالات */}
                  <span className="nk-seg ms-auto" role="group" aria-label={`${r.name} homework`}>
                    {(["DONE", "PARTIAL", "MISSING"] as const).map((v) => (
                      <button
                        key={v}
                        className={r.homeworkStatus === v ? (v === "DONE" ? "nk-on-hw-done" : v === "PARTIAL" ? "nk-on-hw-partial" : "nk-on-hw-missing") : ""}
                        aria-pressed={r.homeworkStatus === v}
                        disabled={!editable}
                        onClick={() => onRecord(r.studentId, { homeworkStatus: r.homeworkStatus === v ? null : v })}
                      >
                        {HW_LABEL[v]}
                      </button>
                    ))}
                  </span>
                </div>
              )}
              {isUnmarked && editable && (
                <small className="text-[11px] font-bold text-muted-foreground">سجّل حضوره الأول من مرحلة الحضور ليظهر هنا.</small>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground font-bold">
            {filter === "present" && hwApplicable === 0
              ? "سجّل الحضور أولاً ليظهروا هنا"
              : "لا نتائج مطابقة"}
          </p>
        )}
      </div>
    </div>
  );
}

// keep unused imports referenced
void Chip;
void EmptyState;
void SectionCard;
void Home;
void Search;
void UserX;
void Users;
void ClipboardList;
void ClipboardCheck;
void ReceiptText;
void Download;

/* ============================================================
   ③ مرحلة الامتحانات — إعداد + رصد (نقل من المنصة الأساسية):
      امتحان واحد لكل حصة: عنوان + درجة نهائية، وشبكة رصد للحاضرين.
      مسودة الدرجات بتتحفظ في الجهاز (نفس عقد المنصة الأساسية) — لو الجلسة
      قفلت بنص الرصد بترجع كاملة. الغايب مش بياخد درجة.
============================================================ */
const examDraftKey = (sid: string) => `nk_exam_draft_v1_${sid || "none"}`;

function ExamsStage({ data, sessionId, roster, editable, onGoNext, onSaved }: {
  data: SessionDetail; sessionId: string; roster: RosterRow[]; editable: boolean;
  onGoNext: () => void; onSaved: () => void;
}) {
  const [view, setView] = useState<"list" | "setup" | "grade">("list");
  const [setup, setSetup] = useState<{ title: string; max: number }>(() => {
    try {
      const raw = localStorage.getItem(examDraftKey(sessionId));
      if (raw) { const d = JSON.parse(raw); if (d?.setup) return d.setup; }
    } catch { /* ignore */ }
    return { title: `امتحان ${new Date().toLocaleDateString("ar-EG")}`, max: 20 };
  });
  const [rows, setRows] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(examDraftKey(sessionId));
      if (raw) { const d = JSON.parse(raw); if (d?.rows) return d.rows; }
    } catch { /* ignore */ }
    return {};
  });
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMax, setEditMax] = useState<string | null>(null);

  const present = roster.filter((r) => r.status !== null);
  const exam = data.exam;
  const scoreMap = new Map((data.examScores ?? []).map((s) => [s.studentId, s.score]));

  // استرجاع المسودة عند الدخول
  useEffect(() => {
    try {
      const raw = localStorage.getItem(examDraftKey(sessionId));
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.rows && Object.keys(d.rows).length) { setRestored(true); setView("grade"); }
      }
    } catch { /* ignore */ }
     
  }, []);

  function writeDraft(nextSetup: { title: string; max: number } | null, nextRows: Record<string, string> | null) {
    try {
      localStorage.setItem(examDraftKey(sessionId), JSON.stringify({ setup: nextSetup ?? setup, rows: nextRows ?? rows, savedAt: new Date().toISOString() }));
    } catch { /* ignore */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(examDraftKey(sessionId)); } catch { /* ignore */ }
  }

  async function saveExam() {
    setSaving(true);
    try {
      const clean = Object.entries(rows)
        .map(([studentId, v]) => ({ studentId, score: v.trim() === "" ? null : Number(v) }))
        .filter((r): r is { studentId: string; score: number } => r.score !== null && Number.isFinite(r.score));
      if (!setup.title.trim()) { toast.error("اكتب عنوان الامتحان."); return; }
      const max = Number(setup.max);
      if (!Number.isFinite(max) || max <= 0) { toast.error("الدرجة النهائية غير صحيحة."); return; }
      for (const r of clean) {
        if ((r.score as number) > max) { toast.error(`فيه درجة أكبر من النهائي (${max}) — راجع الشبكة.`); return; }
      }
      await api(`/api/sessions/${sessionId}/exam`, { method: "POST", body: { title: setup.title.trim(), maxScore: max } });
      await api(`/api/sessions/${sessionId}/exam`, { method: "POST", body: { scores: clean.map((r) => ({ studentId: r.studentId, score: r.score })) } });
      toast.success(`الامتحان اتسجل — ${clean.length} درجة.`);
      clearDraft();
      setRows({});
      setView("list");
      onSaved();
    } catch { /* toast */ } finally { setSaving(false); }
  }

  async function saveSingleScore(studentId: string, value: string) {
    const max = exam?.maxScore ?? Number(setup.max);
    const n = Number(value);
    if (value.trim() === "") {
      try {
        await api(`/api/sessions/${sessionId}/exam`, { method: "POST", body: { scores: [{ studentId, score: null }] } });
        toast.success("الدرجة اتمسحت.");
        onSaved();
      } catch { /* toast */ }
      return;
    }
    if (!Number.isFinite(n) || n < 0) { toast.error("الدرجة لازم تكون رقم."); return; }
    if (n > max) { toast.error(`الدرجة أكبر من النهائي (${max}).`); return; }
    try {
      await api(`/api/sessions/${sessionId}/exam`, { method: "POST", body: { scores: [{ studentId, score: n }] } });
      flashRow(studentId);
      onSaved();
    } catch { /* toast */ }
  }

  async function saveMax(newMax: string) {
    const n = Number(newMax);
    if (!Number.isFinite(n) || n <= 0) { toast.error("الدرجة النهائية غير صحيحة."); return; }
    try {
      await api(`/api/sessions/${sessionId}/exam`, { method: "POST", body: { title: exam?.title ?? setup.title, maxScore: n } });
      toast.success("الدرجة النهائية اتعدلت — درجات الطلاب زي ما هي (نفس قاعدة المنصة الأساسية).");
      setEditMax(null);
      onSaved();
    } catch { /* toast */ }
  }

  const [flash, setFlash] = useState<Record<string, boolean>>({});
  function flashRow(studentId: string) {
    setFlash((m) => ({ ...m, [studentId]: true }));
    setTimeout(() => setFlash((m) => ({ ...m, [studentId]: false })), 1400);
  }

  // ===== شبكة الرصد (امتحان جديد أو مسودة مسترجعة) =====
  if (view === "grade") {
    return (
      <div className="space-y-3 nk-anim-view">
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <b className="text-sm">{setup.title} · النهائي: <span className="nk-num">{setup.max}</span></b>
          <button className="nk-wf-ghost" onClick={() => { setSetup({ title: exam?.title ?? setup.title, max: exam?.maxScore ?? setup.max }); setView("setup"); }}>✎ تعديل الإعداد</button>
        </div>
        {restored && (
          <div className="nk-notice">
            ↺ تم استرجاع الدرجات المُدخلة قبل انقطاع الجلسة — كمّل رصد واضغط حفظ.
          </div>
        )}
        <div className="grid gap-1.5">
          {present.map((r) => (
            <div key={r.studentId} className="nk-att-row">
              <span className="nk-att-row__name">
                <b className="truncate">{r.name}</b>
                <small><span className="nk-num" dir="ltr">{r.code}</span>{flash[r.studentId] ? " · ✓ تم الحفظ" : ""}</small>
              </span>
              <input
                type="number" min={0} max={setup.max} step="0.5"
                inputMode="decimal"
                value={rows[r.studentId] ?? ""}
                disabled={!editable}
                onChange={(ev) => { setRows((m) => ({ ...m, [r.studentId]: ev.target.value })); writeDraft(null, { ...rows, [r.studentId]: ev.target.value }); }}
                onKeyDown={(ev) => { if (ev.key === "Enter") { const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('.nk-exam-input')); const i = inputs.indexOf(ev.currentTarget); inputs[i + 1]?.focus(); } }}
                className="nk-exam-input w-24 rounded-xl border-2 border-input bg-card px-3 py-2 text-sm font-extrabold nk-num text-center"
                placeholder="—"
                aria-label={`درجة ${r.name}`}
              />
            </div>
          ))}
          {present.length === 0 && (
            <p className="text-center py-6 text-sm text-muted-foreground font-bold">سجّل الحضور الأول — الغايب مش بياخد درجة.</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={saveExam}
            disabled={saving || !editable || present.length === 0}
            className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : "💾"} حفظ الامتحان
          </button>
          <button onClick={() => setView("list")} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
        </div>
      </div>
    );
  }

  // ===== إعداد امتحان جديد =====
  if (view === "setup") {
    return (
      <div className="space-y-3 nk-anim-view max-w-xl">
        <label className="block">
          <span className="block text-xs font-extrabold mb-1.5">عنوان الامتحان</span>
          <input className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold" value={setup.title} onChange={(ev) => setSetup({ ...setup, title: ev.target.value })} />
        </label>
        <label className="block max-w-[220px]">
          <span className="block text-xs font-extrabold mb-1.5">الدرجة النهائية</span>
          <input type="number" min={1} className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold nk-num" value={setup.max} onChange={(ev) => setSetup({ ...setup, max: Number(ev.target.value) })} />
        </label>
        <div className="flex gap-2">
          <button
            className="nk-brand-bg text-white font-extrabold rounded-xl px-5 py-3 text-sm shadow active:scale-[0.98] flex items-center gap-2"
            onClick={() => { if (!setup.title.trim() || !(Number(setup.max) > 0)) { toast.error("أكمل العنوان والدرجة النهائية."); return; } writeDraft(setup, {}); setRestored(false); setView("grade"); }}
          >
            التالي — رصد الدرجات ←
          </button>
          <button onClick={() => setView("list")} className="rounded-xl border border-border bg-card font-bold px-5 text-sm">إلغاء</button>
        </div>
      </div>
    );
  }

  // ===== قائمة الامتحان المحفوظ =====
  return (
    <div className="space-y-3 nk-anim-view">
      <div className="flex justify-end">
        <button className="rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem] shadow active:scale-[0.98] transition nk-brand-grad text-white" onClick={onGoNext}>
          التالي — المراجعة ←
        </button>
      </div>
      {!closed && (
        <button
          className="w-full nk-brand-grad text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] flex items-center justify-center gap-2"
          onClick={() => { setSetup({ title: `امتحان ${new Date().toLocaleDateString("ar-EG")}`, max: 20 }); setView("setup"); }}
        >
          ＋ امتحان جديد
        </button>
      )}
      {!closed && !exam && (
        <p className="text-center text-sm text-muted-foreground font-bold py-2">
          لا يوجد امتحان مرتبط بهذه الحصة (اختياري).
        </p>
      )}
      {closed && !exam && (
        <div className="nk-notice">الحصة منتهية — تقدر تضيف امتحان وترصد درجاته بوضع التعديل (اختياري).</div>
      )}
      {exam && (
        <SectionCard title={exam.title} icon={<ClipboardList className="w-4 h-4" />}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="nk-pill-pending">النهائي: <span className="nk-num">{exam.maxScore}</span></span>
            <span className="nk-pill-live">المرصدون: <span className="nk-num">{data.examScores.filter((x) => x.score != null).length}/{present.length}</span></span>
            {editMax === null ? (
              editable && <button className="nk-wf-ghost" onClick={() => setEditMax(String(exam.maxScore))}>أ · تعديل الدرجة النهائية</button>
            ) : (
              <span className="flex items-center gap-1.5">
                <input
                  type="number" min={1} value={editMax}
                  onChange={(ev) => setEditMax(ev.target.value)}
                  className="w-20 rounded-xl border-2 border-input bg-card px-2 py-1.5 text-sm font-extrabold nk-num text-center"
                />
                <button className="nk-wf-ghost" onClick={() => saveMax(editMax)}>حفظ</button>
                <button className="nk-wf-ghost" onClick={() => setEditMax(null)}>إلغاء</button>
              </span>
            )}
          </div>
          <p className="text-[11px] font-bold text-muted-foreground mb-2">
            تعديل الدرجة النهائية **مش** بيغير درجات الطلاب — 32 بتفضل 32 لو النهائي بقى 40.
          </p>
          <div className="grid gap-1.5">
            {present.map((r) => {
              const val = scoreMap.get(r.studentId);
              return (
                <div key={r.studentId} className="nk-att-row">
                  <span className="nk-att-row__name">
                    <b className="truncate">{r.name}</b>
                    <small><span className="nk-num" dir="ltr">{r.code}</span></small>
                  </span>
                  <span className="flex items-center gap-2">
                    {val != null && (
                      <span className={cn("nk-num text-xs font-extrabold", (val / exam.maxScore) >= 0.5 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
                        {Math.round((val / exam.maxScore) * 100)}%
                      </span>
                    )}
                    <input
                      type="number" min={0} max={exam.maxScore} step="0.5" inputMode="decimal"
                      defaultValue={val ?? ""}
                      key={`${r.studentId}-${val ?? "empty"}`}
                      disabled={!editable}
                      onBlur={(ev) => { const v = ev.target.value; if (v !== (val != null ? String(val) : "")) saveSingleScore(r.studentId, v); }}
                      className="w-20 rounded-xl border-2 border-input bg-card px-2 py-1.5 text-sm font-extrabold nk-num text-center"
                      placeholder="—"
                      aria-label={`درجة ${r.name}`}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ============================================================
   ④ مرحلة المراجعة — فحص خفيف قبل الإنهاء (نقل من المنصة الأساسية):
      كشف المراحل بنسبها + ملاحظات قبل الإنهاء — مش بيمنع الإنهاء.
============================================================ */
function ReviewStage({ isOpenSession, closed, rosterTotal, presentCount, unmarked, interactionCount, hwDone, hwApplicable, hasExam, gradedCount, issues, onGoTo }: {
  isOpenSession: boolean; closed: boolean; rosterTotal: number; presentCount: number; unmarked: number;
  interactionCount: number; hwDone: number; hwApplicable: number; hasExam: boolean; gradedCount: number;
  issues: string[]; onGoTo: (k: TabKey) => void;
}) {
  const rows = [
    {
      key: "attendance" as TabKey, label: "الحضور",
      value: `${presentCount} حاضر · ${closed ? unmarked + " غائب" : unmarked + " لم يُرصد"}`,
      progress: rosterTotal ? (presentCount + (closed ? unmarked : 0)) / rosterTotal : 0,
      ok: closed ? true : unmarked === 0,
    },
    ...(!isOpenSession ? [{
      key: "interaction" as TabKey, label: "التفاعل",
      value: `${interactionCount} / ${presentCount}`,
      progress: presentCount ? interactionCount / presentCount : 0,
      ok: interactionCount > 0,
    }, {
      key: "interaction2" as TabKey, label: "الواجب",
      value: `${hwDone} / ${hwApplicable}`,
      progress: hwApplicable ? hwDone / hwApplicable : 0,
      ok: hwDone >= hwApplicable,
      jump: "interaction" as TabKey,
    }, {
      key: "exams" as TabKey, label: "الامتحانات",
      value: hasExam ? `${gradedCount} / ${presentCount}` : "لا يوجد",
      progress: hasExam && presentCount ? gradedCount / presentCount : 0,
      ok: hasExam ? gradedCount >= presentCount : true,
    }] : []),
  ];

  return (
    <div className="space-y-3 nk-anim-view">
      <div className="flex justify-end">
        <button className="rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem] shadow active:scale-[0.98] transition nk-brand-grad text-white" onClick={() => onGoTo("report")}>
          التالي — التقرير والإنهاء ←
        </button>
      </div>
      <div className="grid gap-2.5">
        {rows.map((r) => (
          <button key={r.key} className="nk-card rounded-2xl p-3.5 w-full text-start" onClick={() => onGoTo((r as { jump?: TabKey }).jump ?? r.key)}>
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1">
                <b className="block text-sm truncate">{r.label}</b>
                <small className="block text-[11px] font-bold text-muted-foreground">{r.value}</small>
                <span className="nk-bar w-full mt-1.5"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>
              </span>
              <span className={r.ok ? "nk-pill-live" : "nk-pill-pending"}>{r.ok ? "✓ مكتمل" : "! ناقص"}</span>
            </span>
          </button>
        ))}
      </div>

      {issues.length > 0 && (
        <div className="nk-notice">
          <b className="block mb-1">ملاحظات قبل الإنهاء</b>
          <ul className="list-disc ps-5 m-0">
            {issues.map((issue, i) => <li key={i}>{issue}</li>)}
          </ul>
        </div>
      )}

      <div className="rounded-2xl p-3.5 text-sm bg-muted/50 border border-border">
        <b className="block mb-1.5 text-sm">حالة الحصة</b>
        <span className={closed ? "nk-pill-done" : "nk-pill-live"}>
          {closed ? "✓ منتهية ومحفوظة" : "● قيد التنفيذ — التقرير هو مكان الإنهاء"}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   ⑤ مرحلة التقرير — نهاية الخط (نقل من المنصة الأساسية + حسابات السنترز):
      ملخص الحصة + بيانات الحصة (حفظ ≠ إنهاء — autosave 900ms + مرآة محلية)
      + تقارير أولياء الأمور (واتساب — للحصص المنتهية) + الحسابات والمدفوعات
      + إنهاء الحصة + شريط الغائبين.
============================================================ */
const reportDraftKey = (sid: string) => `nk_report_draft_v1_${sid || "none"}`;

function ReportStage({ data, user, sessionId, isOpenSession, closed, roster, presentCount, unmarked, hwDone, hwApplicable, payments, paymentsLoading, editable, canEnd, onCloseOpen, closeBusy, printAttendance, downloadCsv, onViewAbsent, onBack }: {
  data: SessionDetail; user: SessionUser; sessionId: string;
  isOpenSession: boolean; closed: boolean; roster: RosterRow[];
  presentCount: number; unmarked: number; hwDone: number; hwApplicable: number;
  payments: SessionPayments | null; paymentsLoading: boolean;
  editable: boolean; canEnd: boolean;
  onCloseOpen: () => void; closeBusy: boolean;
  printAttendance: () => void; downloadCsv: () => void;
  onViewAbsent: () => void; onBack: () => void;
}) {
  const s = data.session;
  // بيانات الحصة — autosave بمرآة محلية (نفس عقد المنصة الأساسية: المحلي بيكسب لو أحدث)
  const [draft, setDraft] = useState(() => {
    const base = { lessonTopic: s.lessonTopic ?? "", homeworkText: s.homeworkText ?? "", videoLink: s.videoLink ?? "" };
    try {
      const raw = localStorage.getItem(reportDraftKey(sessionId));
      if (raw) {
        const stored = JSON.parse(raw);
        const serverAt = s.openedAt ? new Date(s.openedAt).getTime() : 0;
        if (stored?.draft && stored?.savedAt && new Date(stored.savedAt).getTime() > serverAt) return { ...base, ...stored.draft };
      }
    } catch { /* ignore */ }
    return base;
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<{ candidates: ReportStudent[]; title: string; subtitle: string; preselect: "absent" | "present" | "all" | "manual" } | null>(null);
  const [queue, setQueue] = useState<ReportStudent[] | null>(null);

  const updateDraft = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setDirty(true);
    try { localStorage.setItem(reportDraftKey(sessionId), JSON.stringify({ draft: next, savedAt: new Date().toISOString() })); } catch { /* ignore */ }
  };

  const saveDetails = useCallback(async () => {
    setSaving(true);
    try {
      await api(`/api/sessions/${sessionId}`, { method: "POST", body: { action: "save-details", ...draft } });
      setDirty(false);
      try { localStorage.removeItem(reportDraftKey(sessionId)); } catch { /* ignore */ }
    } catch { /* toast */ } finally { setSaving(false); }
  }, [sessionId, draft]);

  // autosave بتأخير 900ms — نفس قيمة المنصة الأساسية
  useEffect(() => {
    if (!dirty || !editable) return undefined;
    const t = setTimeout(() => { void saveDetails(); }, 900);
    return () => clearTimeout(t);
  }, [draft, dirty, editable, saveDetails]);

  // ===== بناء مرشحي التقارير (نفس بنية المنصة الأساسية) =====
  const exam = data.exam;
  const ctx: ReportContext = {
    centerName: user.center?.name ?? "السنتر",
    subject: s.subject, groupName: s.groupName, grade: s.grade, date: s.date,
    lessonTopic: draft.lessonTopic ?? "", homeworkText: draft.homeworkText ?? "", videoLink: draft.videoLink ?? "",
    examTitle: exam?.title ?? null, examMaxScore: exam?.maxScore ?? null,
  };
  const scoreMap = new Map((data.examScores ?? []).map((x) => [x.studentId, x.score]));

  const candidates: ReportStudent[] = roster.map((r) => {
    const statusType = r.status ? "present" : closed ? "absent" : "unmarked";
    return {
      studentId: r.studentId, name: r.name, code: r.code,
      statusType,
      statusLabel: r.status ? ATTENDANCE_LABEL[r.status] : closed ? "غائب" : "لم يُرصد",
      phone: r.phone ?? r.parentPhone,
      homeworkStatus: r.homeworkStatus,
      examScore: scoreMap.get(r.studentId) ?? null,
      interactionPlus: r.interactionPlus, interactionMinus: r.interactionMinus,
    };
  });

  const openQueue = (scope: "absent" | "present" | "all" | "manual") => {
    setMenuOpen(false);
    const pool = scope === "absent" ? candidates.filter((c) => c.statusType === "absent")
      : scope === "present" ? candidates.filter((c) => c.statusType === "present")
      : candidates;
    if (!pool.some((c) => recipientPhone(c))) {
      toast.error("لا يوجد طلاب لديهم أرقام صحيحة");
      return;
    }
    const titles = {
      absent: `تقرير الغياب — ${pool.length} غائب`,
      present: `تقرير الحضور — ${pool.length} حاضر`,
      all: `تقرير الحصة — ${pool.length} طالب`,
      manual: "تقرير الحصة — تحديد يدوي",
    };
    const subtitles = {
      absent: "المقترح: الغائبون فقط. عدّل التحديد إن أردت — لن يُرسل شيء حتى تضغط متابعة.",
      present: "المقترح: الحاضرون فقط. عدّل التحديد إن أردت — لن يُرسل شيء حتى تضغط متابعة.",
      all: "المقترح: كل الطلاب. عدّل التحديد إن أردت — لن يُرسل شيء حتى تضغط متابعة.",
      manual: "اختر المستلمين يدويًا — لن يُرسل شيء حتى تضغط متابعة.",
    };
    setPicker({ candidates: pool, title: titles[scope], subtitle: subtitles[scope], preselect: scope });
  };

  const absentNow = roster.filter((r) => !r.status);

  return (
    <div className="space-y-3.5 nk-anim-view">
      {/* زرار الإنهاء — أعلى التاب (نفس مكان المنصة الأساسية) */}
      <div className="flex justify-end gap-2">
        {closed ? (
          <button className="rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem] shadow active:scale-[0.98] transition nk-brand-grad text-white" onClick={onBack}>
            العودة للرئيسية ←
          </button>
        ) : canEnd ? (
          <button className="rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold !min-h-[2.75rem] shadow active:scale-[0.98] transition nk-brand-grad text-white" disabled={closeBusy} onClick={onCloseOpen}>
            ✓ إنهاء الحصة
          </button>
        ) : null}
      </div>

      {/* ملخص الحصة */}
      <div className="rounded-2xl p-4 bg-muted/50 border border-border">
        <b className="block mb-2 text-sm">ملخص الحصة</b>
        <div className="flex flex-wrap gap-1.5">
          <span className="nk-pill-neutral">{isOpenSession ? "المسجلين" : "الطلاب"}: {isOpenSession ? data.attendance.length : roster.length}</span>
          <span className="nk-pill-live">حاضر: {isOpenSession ? data.attendance.length : presentCount}</span>
          {!isOpenSession && <span className="nk-pill-danger">{closed ? "غائب" : "لم يُرصد"}: {unmarked}</span>}
          {!isOpenSession && <span className="nk-pill-pending">الواجب مكتمل: {hwDone}/{hwApplicable}</span>}
        </div>
      </div>

      {/* بيانات الحصة — SAVE ≠ FINISH */}
      {editable ? (
        <div className="grid gap-3">
          <label className="block">
            <span className="block text-xs font-extrabold mb-1.5">درس اليوم</span>
            <input className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold" value={draft.lessonTopic} onChange={(ev) => updateDraft({ lessonTopic: ev.target.value })} placeholder="موضوع الحصة..." />
          </label>
          <label className="block">
            <span className="block text-xs font-extrabold mb-1.5">تفاصيل الواجب</span>
            <textarea className="w-full min-h-[64px] rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold resize-none" value={draft.homeworkText} onChange={(ev) => updateDraft({ homeworkText: ev.target.value })} placeholder="الواجب المطلوب..." />
          </label>
          <label className="block">
            <span className="block text-xs font-extrabold mb-1.5">رابط فيديو الشرح</span>
            <input dir="ltr" className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-semibold" value={draft.videoLink} onChange={(ev) => updateDraft({ videoLink: ev.target.value })} placeholder="https://..." />
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            <button className="nk-btn nk-btn-brand" disabled={saving || !dirty} onClick={() => void saveDetails()}>
              💾 {saving ? "جاري الحفظ..." : "حفظ بيانات الحصة"}
            </button>
            {dirty && <span className="text-[11px] font-extrabold text-amber-600 dark:text-amber-300">بيتحفظ تلقائيًا…</span>}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-3.5 text-sm bg-muted/50 border border-border">
          <b className="block">درس اليوم</b>
          <p className="m-0 text-muted-foreground font-semibold">{draft.lessonTopic || "—"}</p>
          <b className="block mt-2">الواجب</b>
          <p className="m-0 text-muted-foreground font-semibold">{draft.homeworkText || "لا يوجد"}</p>
          {draft.videoLink && (
            <>
              <b className="block mt-2">الفيديو</b>
              <a dir="ltr" href={draft.videoLink} target="_blank" rel="noreferrer" className="text-xs underline nk-brand-text break-all">{draft.videoLink}</a>
            </>
          )}
          <p className="m-0 mt-2 text-[11px] font-bold text-muted-foreground">لتعديل البيانات دي اضغط «✎ تعديل بيانات هذه الحصة» فوق.</p>
        </div>
      )}

      {/* تقارير أولياء الأمور (واتساب) — للحصص المنتهية (نفس قاعدة المنصة الأساسية) */}
      <div className="rounded-2xl p-4 bg-muted/50 border border-border">
        <b className="block mb-1 text-sm">تقارير أولياء الأمور (WhatsApp)</b>
        <p className="text-[11px] font-bold text-muted-foreground m-0 mb-3">
          {closed
            ? "اختر المستلمين — رسالة الحاضر تختلف عن رسالة الغائب، ودرجة امتحان الحصة بتتحط تلقائيًا."
            : "أنهِ الحصة أولًا لتفعيل التقارير (قاعدة النظام)."}
        </p>
        <div className="nk-menu-wrap">
          <button
            className="w-full nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow flex items-center justify-center gap-2 disabled:opacity-50"
            disabled={!closed || candidates.length === 0}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            ↗ إرسال التقرير ▼
          </button>
          {menuOpen && closed && (
            <>
              <div className="nk-menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="nk-menu-sheet" role="menu" aria-label="مستلمو التقرير">
                <b className="nk-menu-sheet__title">اختر المستلمين</b>
                <button role="menuitem" className={candidates.filter((c) => c.statusType === "absent").length === 0 ? "opacity-40" : ""} disabled={candidates.filter((c) => c.statusType === "absent").length === 0} onClick={() => openQueue("absent")}>
                  <span>✗ الغائبون فقط</span>
                  <small>{candidates.filter((c) => c.statusType === "absent").length} · رسالة الغياب</small>
                </button>
                <button role="menuitem" className={candidates.filter((c) => c.statusType === "present").length === 0 ? "opacity-40" : ""} disabled={candidates.filter((c) => c.statusType === "present").length === 0} onClick={() => openQueue("present")}>
                  <span>✓ الحاضرون فقط</span>
                  <small>{candidates.filter((c) => c.statusType === "present").length} · رسالة الحضور</small>
                </button>
                <button role="menuitem" disabled={candidates.length === 0} onClick={() => openQueue("all")}>
                  <span>◉ كل الطلاب</span>
                  <small>{candidates.length} · رسالة حسب حالة كل طالب</small>
                </button>
                <button role="menuitem" disabled={candidates.length === 0} onClick={() => openQueue("manual")}>
                  <span>☰ تحديد يدوي</span>
                  <small>اخترهم واحدًا واحدًا</small>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* الحسابات والمدفوعات — ميزة السنترز المحفوظة */}
      {!isOpenSession && (
        <SectionCard title="الحسابات والمدفوعات" icon={<ReceiptText className="w-4 h-4" />}>
          <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
            <SummaryRow label="قيمة الحصص" value={fmtE(data.economics.totalRevenue)} />
            <SummaryRow label="المحصّل" value={fmtE(data.economics.collected)} />
            <SummaryRow label="المتأخر على الطلاب" value={fmtE(data.economics.outstanding)} />
            <div className="border-t my-1" />
            <SummaryRow label={`نصيب المدرس (${s.teacherPercent}%)`} value={fmtE(data.economics.teacherShare)} strong highlight />
            <SummaryRow label={`نصيب السنتر (${100 - s.teacherPercent}%)`} value={fmtE(data.economics.centerShare)} strong highlight />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={printAttendance} className="nk-wf-ghost flex items-center gap-1.5"><Printer className="w-4 h-4" /> طباعة كشف الحضور</button>
            {closed && <button onClick={downloadCsv} className="nk-wf-ghost flex items-center gap-1.5"><Download className="w-4 h-4" /> تصدير CSV</button>}
          </div>
          <div className="mt-3">
            <FoldSection
              title="مدفوعات الحصة"
              icon={<ReceiptText className="w-4 h-4" />}
              badge={<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-extrabold nk-num shrink-0">{paymentsLoading ? "…" : payments?.total ?? 0}</span>}
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
          </div>
        </SectionCard>
      )}

      {isOpenSession && closed && (
        <SectionCard title="ملخص الحصة" icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}>
          <div className="rounded-2xl bg-muted/60 border p-4 space-y-1.5 text-sm">
            <SummaryRow label="الاسم" value={s.subject} />
            <SummaryRow label="الميعاد" value={`${formatTime12(s.startTime)} — ${formatTime12(s.endTime)}`} mono />
            <div className="border-t my-1" />
            <SummaryRow label="إجمالي الحضور المسجل" value={`${data.attendance.length} طالب`} strong highlight />
            <SummaryRow label="نوع الحصة" value="حضور مفتوح — بدون كشف" />
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={downloadCsv} className="flex-1 min-w-[150px] nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm shadow active:scale-[0.98]">
              <Download className="w-4.5 h-4.5" /> تصدير CSV (Excel)
            </button>
            <button onClick={onBack} className="flex-1 min-w-[150px] border-2 border-border bg-card font-extrabold rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm active:scale-[0.98] transition hover:bg-muted/50">
              رجوع للرئيسية
            </button>
          </div>
        </SectionCard>
      )}

      {/* إنهاء الحصة — الكارت التوضيحي (قاعدة: SAVE ≠ FINISH) */}
      {!closed && !isOpenSession && (
        <div className="rounded-2xl p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
          <b className="block mb-1 text-sm text-emerald-800 dark:text-emerald-200">إنهاء الحصة</b>
          <p className="text-xs m-0 font-bold text-emerald-800 dark:text-emerald-200 leading-relaxed">
            الإنهاء يحوّل غير المرصد إلى غائب، يغلق الحصة، ويسجّل الحسابات، ويفعّل تقارير الواتساب. الحفظ شيء والإنهاء شيء آخر — زر الإنهاء في أعلى الشاشة.
          </p>
          {canEnd && (
            <button onClick={onCloseOpen} className="w-full mt-3 bg-rose-600 text-white font-extrabold rounded-xl px-4 py-3.5 shadow flex items-center justify-center gap-2 active:scale-[0.99]">
              <Lock className="w-5 h-5" /> إنهاء الحصة دلوقتي
            </button>
          )}
        </div>
      )}
      {closed && (
        <div className="rounded-2xl p-4 text-center bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900">
          <p className="m-0 text-sm font-extrabold text-sky-800 dark:text-sky-200">
            ✓ الحصة منتهية ومحفوظة في السجل — التقرير متاح للطباعة والتصدير والواتساب.
          </p>
        </div>
      )}

      {/* شريط الغائبين — آخر التقارير (نفس مكان المنصة الأساسية) */}
      {!isOpenSession && absentNow.length > 0 && (
        <div className="nk-att-absent">
          <span className="nk-att-absent__text">
            <b className="text-sm">الغائبون في هذه الحصة: {absentNow.length}</b>
            <small className="truncate">{absentNow.slice(0, 6).map((x) => x.name).join(" · ")}{absentNow.length > 6 ? " …" : ""}</small>
          </span>
          <span className="nk-att-absent__actions">
            <button className="nk-wf-ghost" onClick={onViewAbsent}>عرض الغائبين</button>
            {closed && (
              <button className="nk-wf-ghost" onClick={() => openQueue("absent")}>↗ تقارير الغياب</button>
            )}
          </span>
        </div>
      )}

      {/* اختيار المستلمين + طابور الإرسال */}
      {picker && (
        <RecipientPickerModal
          candidates={picker.candidates}
          title={picker.title}
          subtitle={picker.subtitle}
          preselect={picker.preselect}
          examMax={exam?.maxScore ?? null}
          onClose={() => setPicker(null)}
          onStart={(items) => { setPicker(null); setQueue(items); }}
        />
      )}
      {queue && (
        <SendQueueModal
          items={queue}
          ctx={ctx}
          onClose={() => { setQueue(null); }}
        />
      )}
    </div>
  );
}

/* ============================= عناصر مساعدة (محفوظة من السنترز) ============================= */

/* قسم قابل للطي — العنوان والملخص والعدّاد ظاهرين دايمًا في سطر واحد */
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

/* صف أفاتار مضغوط — ملخص الكشف المطوي */
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

function AttendanceTable({ data, printAttendance, showPrint }: {
  data: SessionDetail; printAttendance: () => void; showPrint?: boolean;
}) {
  const count = data.attendance.length;
  return (
    <FoldSection
      title={`حضور الحصة (${count})`}
      icon={<Users className="w-4 h-4" />}
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
        <EmptyState title="لسه محدش حضر" hint="سجّل الحضور من قائمة الكشف أو أدوات المسح اللي فوق." />
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

/* النشاط المشبوه — المحاولات المرفوضة/المعلّمة من محرك المخاطر */
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
