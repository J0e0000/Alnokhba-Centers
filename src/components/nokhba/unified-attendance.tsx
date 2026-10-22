"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Keyboard, ScanLine, ListChecks, Loader2, Zap, CameraOff, CheckCircle2,
  AlertTriangle, XCircle, Clock3, Undo2, Volume2, VolumeX, Search, Pin, PinOff, LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, normalizeDigits, formatTime12, ATTENDANCE_LABEL, type SessionUser } from "./lib";
import { useCaps } from "./caps";
import { QrCameraScanner } from "./qr-scanner";
import { feedback, unlockAudio, useFeedbackSettings, useWakeLock } from "./feedback";
import { useOnlineStatus } from "./pwa";

/* ============================================================
   طابور الاستقبال — لوحة الحضور الموحدة (نسخة الريسيبشن السريعة)
   ------------------------------------------------------------
   الفكرة: الموظف اللي واقف على الكونتينر يسجل طالب ورا طالب
   في أي مجموعة — من غير خروج ودخول:
   1) «تسجيل فوري»: الكود يتحل → الحضور يتسجل لوحده (من غير زرار)
      وبيظهر إيصال بيرفرف ويختفي — والفوكس يرجع للخانة فورًا.
   2) «مساحة الكشوف»: كل الحصص المفتوحة كشوفها جنبه — ديسكتوب
      أعمدة جنب بعض، وموبايل كاروسيل بيتمرر باللمس بين المجموعات.
   3) «سجل الطابور»: كل تسجيل (كود/اسم/سكان) في سجل واحد بزر
      تراجع لكل سطر — الغلطة بتصلح من مكان واحد.
   الحالات المحتاجة قرار (مش مسجل بالمجموعة / مفيش حصة مفتوحة)
   بتظهر كارت تفاعلي زي ما هي — والتوجيه التلقائي زي ما هو.
============================================================ */

type PanelSess = {
  id: string; startTime: string; endTime: string; status: string; date: string;
  subject: string; groupName: string; grade: string; teacher: string | null;
  groupId: string; price: number; room: string | null; attendanceCount: number;
};

type UARes = {
  status: "GREEN" | "ORANGE" | "RED";
  message?: string;
  student?: {
    id: string; name: string; code: string; phone: string | null; parentName: string | null;
    parentPhone: string | null; grade: string | null; status: string;
    subjects: string[]; groups: { id: string; name: string; subject: string }[];
  };
  session?: PanelSess | null;
  registered?: boolean;
  price?: number;
  balance?: number;
  amountDue?: number | null;
  alreadyAttended?: boolean;
  attendanceStatus?: string | null;
  sessionClosed?: boolean;
  autoHint?: { kind: string; message: string; sessions: { subject: string; groupName: string; grade: string; status: string; startTime: string }[] } | null;
  canRegister?: boolean;
};

type RosterRow = {
  studentId: string; name: string; code: string;
  status: "PRESENT" | "LATE" | "EXCUSED" | null;
  attId: string | null; charged: number | null;
};

/** إيصال الطابور — كل تسجيل بيركب هنا (حتى المسجل بالسكان) بزر تراجع */
type Receipt = {
  id: number;
  kind: "OK" | "LATE" | "DUP" | "WARN" | "ERR";
  name: string; code?: string;
  line: string; warnLine?: string;
  at: string;
  attId?: string | null;
  studentId?: string;
  sessionId?: string;
  undoable: boolean;
  undoing?: boolean;
};

const CAMERA_IDLE_MS = 45_000;
const FLASH_MS = 6500;
const INSTANT_KEY = "nk-ua-instant";

const KIND_CLS: Record<Receipt["kind"], string> = {
  OK: "border-[var(--nk-ok-border)] bg-[var(--nk-ok-bg)] text-[var(--nk-ok-strong)]",
  LATE: "border-[var(--nk-warn-border)] bg-[var(--nk-warn-bg)] text-[var(--nk-warn-strong)]",
  DUP: "border-[var(--nk-warn-border)] bg-[var(--nk-warn-bg)] text-[var(--nk-warn-strong)]",
  WARN: "border-[var(--nk-warn-border)] bg-[var(--nk-warn-bg)] text-[var(--nk-warn-strong)]",
  ERR: "border-[var(--nk-danger-border)] bg-[var(--nk-danger-bg)] text-[var(--nk-danger-strong)]",
};
const KIND_TEXT: Record<Receipt["kind"], string> = {
  OK: "text-[var(--nk-ok-strong)]",
  LATE: "text-[var(--nk-warn-strong)]",
  DUP: "text-[var(--nk-warn-strong)]",
  WARN: "text-[var(--nk-warn-strong)]",
  ERR: "text-[var(--nk-danger-strong)]",
};

function ReceiptIcon({ kind, className }: { kind: Receipt["kind"]; className?: string }) {
  const I = kind === "ERR" ? XCircle : kind === "LATE" ? Clock3 : kind === "WARN" ? AlertTriangle : CheckCircle2;
  return <I className={className} />;
}

export function UnifiedAttendancePanel({ user }: { user: SessionUser }) {
  const caps = useCaps();
  const { sound, vibrateOn, toggleSound, toggleVibrate } = useFeedbackSettings();
  const [mode, setMode] = useState<"code" | "scan" | "name">("code");
  const [sessions, setSessions] = useState<PanelSess[]>([]);
  const [res, setRes] = useState<UARes | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [flash, setFlash] = useState<Receipt | null>(null);
  const [query, setQuery] = useState("");
  const [nameMatches, setNameMatches] = useState<{ id: string; code: string; name: string; grade: string | null }[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [rosters, setRosters] = useState<Record<string, RosterRow[]>>({});
  const [rosterLoading, setRosterLoading] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  const [instant, setInstant] = useState(true);
  const [unpinned, setUnpinned] = useState<Set<string>>(new Set());
  const lastActivityRef = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const receiptIdRef = useRef(0);

  const online = useOnlineStatus();
  const nameCap = caps.name_attendance.enabled; // كتابة كود + ضغطة اسم = NAME
  const qrCap = caps.static_qr.enabled;         // سكان كارت الطالب = STATIC_QR
  const lateCap = caps.late_checkin.enabled;

  // ===== «تسجيل فوري» — محفوظ لكل جهاز (افتراضي: شغال) =====
  useEffect(() => {
    try {
      const v = localStorage.getItem(INSTANT_KEY);
      if (v !== null) setInstant(v === "1");
    } catch { /* ignore */ }
  }, []);
  const toggleInstant = useCallback(() => {
    setInstant((v) => {
      try { localStorage.setItem(INSTANT_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  }, []);

  // ===== تحميل حصص النهاردة (لشريط الشغل + وضع الاسم) =====
  const loadSessions = useCallback(async () => {
    try {
      const d = await api<{ sessions: PanelSess[] }>(`/api/sessions?date=${ymdCairo()}`);
      setSessions(d.sessions.filter((s) => s.status !== "CANCELLED"));
    } catch { /* شاشة بتفضل فاضية بدون كراش */ }
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const reload = () => loadSessions();
    window.addEventListener("nk-sessions-changed", reload);
    window.addEventListener("focus", reload);
    return () => { window.removeEventListener("nk-sessions-changed", reload); window.removeEventListener("focus", reload); };
  }, [loadSessions]);

  const openSessions = useMemo(() => sessions.filter((s) => s.status === "OPEN"), [sessions]);

  // ===== مؤقت سكون الكاميرا =====
  const touchActivity = useCallback(() => { lastActivityRef.current = Date.now(); }, []);
  useEffect(() => {
    if (!camOn) return;
    const iv = setInterval(() => {
      if (Date.now() - lastActivityRef.current > CAMERA_IDLE_MS) {
        setCamOn(false);
        toast.info("الكاميرا اتقفلت تلقائيًا لتوفير البطارية.", { duration: 5000 });
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [camOn]);
  useEffect(() => {
    const on = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); };
  }, []);
  useWakeLock(camOn);

  // ===== فتح audio context عند أول لمسة =====
  useEffect(() => {
    const on = () => unlockAudio();
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); };
  }, []);

  // ===== البحث بالاسم (لغير الـ5 أرقام) =====
  useEffect(() => {
    const raw = query.trim();
    if (!raw || /^\d{5}$/.test(raw)) { setNameMatches([]); setShowSuggest(false); return; }
    const t = setTimeout(async () => {
      try {
        const d = await api<{ students: { id: string; code: string; name: string; grade: string | null }[] }>(`/api/lookup?q=${encodeURIComponent(raw)}`);
        setNameMatches(d.students.slice(0, 20));
        setShowSuggest(true);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // ===== auto-submit: كود 5 أرقام بيتقدم لوحده =====
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const resolveRef = useRef<(q: string) => Promise<void>>(async () => {});
  useEffect(() => {
    const raw = query.trim();
    if (/^\d{5}$/.test(raw) && !busyRef.current) {
      const t = setTimeout(() => resolveRef.current(raw), 150);
      return () => clearTimeout(t);
    }
  }, [query]);

  // ===== الإيصالات — قلب سجل الطابور =====
  const pushReceipt = useCallback((rc: Omit<Receipt, "id" | "at">) => {
    const id = ++receiptIdRef.current;
    const full: Receipt = { ...rc, id, at: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) };
    setReceipts((rs) => [full, ...rs].slice(0, 30));
    setFlash(full);
  }, []);
  // الإيصال الكبير بيختفي لوحده بعد شوية — السجل بيفضل
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash((f) => (f && f.id === flash.id ? null : f)), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // ===== تراجع من سجل الطابور — يصلح الغلطة حتى من غير كشف مفتوح =====
  const undoReceipt = useCallback(async (rc: Receipt) => {
    if (!rc.attId || rc.undoing) return;
    setReceipts((rs) => rs.map((x) => (x.id === rc.id ? { ...x, undoing: true } : x)));
    try {
      await api(`/api/attendance/mark?attendanceId=${rc.attId}`, { method: "DELETE" });
      setReceipts((rs) => rs.filter((x) => x.id !== rc.id));
      setFlash((f) => (f && f.id === rc.id ? null : f));
      // لو كشف الحصة ده محمل — قلب الصف تاني لحظيًا
      if (rc.sessionId) {
        setRosters((rs) => {
          if (!rs[rc.sessionId!]) return rs;
          return { ...rs, [rc.sessionId!]: (rs[rc.sessionId!] ?? []).map((r) => (r.studentId === rc.studentId ? { ...r, status: null, attId: null, charged: null } : r)) };
        });
      }
      feedback("orange");
      loadSessions();
    } catch (e) {
      setReceipts((rs) => rs.map((x) => (x.id === rc.id ? { ...x, undoing: false } : x)));
      toast.error(e instanceof Error ? e.message : "التراجع ماعملش — جرب تاني.");
    }
  }, [loadSessions]);

  // ===== تسجيل حضور (قلب التسجيل للطرق التلاتة) =====
  // OPTIMISTIC: الضغطة بتقلّب الصف في الكشف في نفس اللحظة — الطلب بيمشي للسيرفر في الخلفية
  // ولو فشل الصف بيرجع زي ما كان + رسالة غلط. كل تسجيل بيركب إيصال في سجل الطابور.
  const doMark = useCallback(async (opts: {
    studentId: string; sessionId: string; status?: "PRESENT" | "LATE";
    display: string; sessLabel: string; method?: "MANUAL" | "QR_SCAN";
    rosterSessionId?: string; code?: string;
  }) => {
    const mKey = `${opts.rosterSessionId ?? opts.sessionId}:${opts.studentId}`;
    if (marking[mKey]) return;
    setMarking((m) => ({ ...m, [mKey]: true }));
    const nextStatus = (opts.status ?? "PRESENT") as RosterRow["status"];
    // لحظة الضغطة: قلب الصف فورًا (قبل أي شبكة)
    const prevRow = opts.rosterSessionId
      ? (rosters[opts.rosterSessionId] ?? []).find((r) => r.studentId === opts.studentId)
      : undefined;
    if (opts.rosterSessionId && prevRow && !prevRow.status) {
      setRosters((rs) => ({
        ...rs,
        [opts.rosterSessionId!]: (rs[opts.rosterSessionId!] ?? []).map((r) =>
          r.studentId === opts.studentId ? { ...r, status: nextStatus } : r,
        ),
      }));
    }
    try {
      const m = await api<{ alreadyAttended: boolean; charged: number | null; balance: number; amountDue: number; attendanceId?: string }>("/api/attendance/mark", {
        method: "POST",
        body: { studentId: opts.studentId, sessionId: opts.sessionId, status: opts.status ?? "PRESENT", method: opts.method ?? "MANUAL" },
      });
      const note = m.alreadyAttended
        ? "متسجل من قبل"
        : `${opts.status === "LATE" ? "متأخر" : "حاضر"} · ${opts.sessLabel}${m.charged ? ` · اتحسب ${fmt(m.charged)} ج` : ""}`;
      pushReceipt({
        kind: m.alreadyAttended ? "DUP" : opts.status === "LATE" ? "LATE" : "OK",
        name: opts.display, code: opts.code, line: note,
        warnLine: (m.amountDue ?? 0) > 0 ? `عليه مستحقات ${fmt(m.amountDue)} ج — الرصيد ${fmt(m.balance)} ج` : undefined,
        attId: m.alreadyAttended ? null : (m.attendanceId ?? null),
        studentId: opts.studentId, sessionId: opts.sessionId,
        undoable: !m.alreadyAttended,
      });
      if (!m.alreadyAttended) feedback("green"); else feedback("orange");
      // تحديث الكارت لو هو نفس الطالب — التسجيل نجح فهو بقى «متسجل» في الحالتين
      setRes((cur) => cur?.student?.id === opts.studentId && cur.session?.id === opts.sessionId
        ? { ...cur, alreadyAttended: true, attendanceStatus: opts.status ?? "PRESENT", balance: m.balance, amountDue: m.amountDue }
        : cur);
      // تثبيت الكشف بالبيانات الحقيقية من الرد (المبلغ المتحسب بالظبط)
      if (opts.rosterSessionId) {
        setRosters((rs) => {
          const rows = rs[opts.rosterSessionId!];
          if (!rows) return rs;
          return { ...rs, [opts.rosterSessionId!]: rows.map((r) => r.studentId === opts.studentId ? { ...r, status: nextStatus, charged: m.charged } : r) };
        });
      }
      loadSessions(); // العدادات تتحدث
    } catch (e) {
      // رجوع فوري: الصف يرجع زي ما كان — التسجيل ماعملش
      if (opts.rosterSessionId && prevRow) {
        setRosters((rs) => ({
          ...rs,
          [opts.rosterSessionId!]: (rs[opts.rosterSessionId!] ?? []).map((r) =>
            r.studentId === opts.studentId ? { ...r, status: prevRow.status, attId: prevRow.attId, charged: prevRow.charged } : r,
          ),
        }));
      }
      toast.error(e instanceof Error ? e.message : "التسجيل ماعملش — جرب تاني.");
    } finally {
      setMarking((m) => { const n = { ...m }; delete n[mKey]; return n; });
    }
  }, [marking, loadSessions, rosters, pushReceipt]);

  // ===== حذف رصد من كشف مفتوح (⟲) =====
  const deleteMark = useCallback(async (s: PanelSess, r: RosterRow) => {
    const snapshot = r;
    // OPTIMISTIC: العلامة تختفي فورًا — لو فشل السيرفر بترجع زي ما كانت
    setRosters((rs) => ({ ...rs, [s.id]: (rs[s.id] ?? []).map((x) => (x.studentId === r.studentId ? { ...x, status: null, attId: null, charged: null } : x)) }));
    try {
      await api(`/api/attendance/mark?attendanceId=${r.attId}`, { method: "DELETE" });
      loadSessions();
    } catch (e) {
      setRosters((rs) => ({ ...rs, [s.id]: (rs[s.id] ?? []).map((x) => (x.studentId === snapshot.studentId ? { ...x, status: snapshot.status, attId: snapshot.attId, charged: snapshot.charged } : x)) }));
      toast.error(e instanceof Error ? e.message : "مش كده.");
    }
  }, [loadSessions]);

  // ===== كشف الحصة (تحميل كسول + كاش في الميموري) =====
  const loadRoster = useCallback(async (sid: string) => {
    if (rosters[sid] || rosterLoading[sid]) return;
    setRosterLoading((s) => ({ ...s, [sid]: true }));
    try {
      const d = await api<{ attendance: { id: string; studentId: string | null; name: string; code: string; status: string | null; charged: number | null }[]; absent: { studentId: string; name: string; code: string }[] }>(`/api/sessions/${sid}`);
      const rows: RosterRow[] = [
        ...d.attendance
          .filter((a) => a.studentId)
          .map((a) => ({ studentId: a.studentId!, name: a.name, code: a.code, status: (a.status as RosterRow["status"]) ?? "PRESENT", attId: a.id, charged: a.charged })),
        ...d.absent.map((a) => ({ studentId: a.studentId, name: a.name, code: a.code, status: null, attId: null, charged: null })),
      ];
      setRosters((rs) => ({ ...rs, [sid]: rows }));
    } catch { /* ignore */ }
    finally { setRosterLoading((s) => ({ ...s, [sid]: false })); }
  }, [rosters, rosterLoading]);

  // ===== مساحة الكشوف: أول ما تفتح وضع الاسم — كل الكشوف تتحمل لوحدها =====
  useEffect(() => {
    if (mode !== "name" || !nameCap) return;
    openSessions.forEach((s) => loadRoster(s.id));
  }, [mode, nameCap, openSessions, loadRoster]);

  const togglePin = useCallback((sid: string) => {
    setUnpinned((prev) => {
      const n = new Set(prev);
      if (n.has(sid)) n.delete(sid); else n.add(sid);
      return n;
    });
  }, []);
  const openAllRosters = useCallback(() => {
    setUnpinned(new Set());
    openSessions.forEach((s) => loadRoster(s.id));
  }, [openSessions, loadRoster]);

  // ===== التوجيه + التسجيل الفوري — قلب اللوحة =====
  // «تسجيل فوري» شغال + الطالب راح مجموعته المفتوحة → يتسجل لوحده من غير أي زرار.
  // أي حالة محتاجة قرار → كارت تفاعلي زي ما هو.
  const handleResolved = useCallback(async (r: UARes) => {
    const openSess = r.session && r.session.status === "OPEN" ? r.session : null;
    if (r.student && openSess && r.registered && !r.alreadyAttended) {
      if (instant) {
        setRes(null);
        await doMark({
          studentId: r.student.id, sessionId: openSess.id, status: "PRESENT",
          display: r.student.name, sessLabel: `${openSess.subject} · ${openSess.grade} ${openSess.groupName}`,
          code: r.student.code,
        });
        return;
      }
      feedback("green"); setRes(r); return;
    }
    if (r.student && openSess && r.alreadyAttended) {
      if (instant) {
        setRes(null);
        pushReceipt({
          kind: "DUP", name: r.student.name, code: r.student.code,
          line: `متسجل من قبل · ${openSess.subject} · ${openSess.grade} ${openSess.groupName}`,
          undoable: false,
        });
        feedback("orange");
        return;
      }
      feedback("orange"); setRes(r); return;
    }
    feedback(r.status === "GREEN" ? (r.alreadyAttended ? "orange" : "green") : r.status === "ORANGE" ? "orange" : "red");
    setRes(r);
  }, [instant, doMark, pushReceipt]);

  const resolve = useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    setBusy(true);
    setShowSuggest(false);
    try {
      if (!online) {
        toast.error("أنت أوفلاين — استخدم «وضع الحصة المحددة» تحت لطابور الأوفلاين.");
        feedback("red");
        return;
      }
      const r = await api<UARes>("/api/attendance/scan", {
        method: "POST",
        body: { query: raw, autoRoute: true },
      });
      setQuery("");
      inputRef.current?.focus();
      await handleResolved(r);
    } catch (e) {
      feedback("red");
      toast.error(e instanceof Error ? e.message : "المسح مش معروف — جرب تاني.");
    } finally { setBusy(false); }
  }, [online, handleResolved]);
  useEffect(() => { resolveRef.current = resolve; }, [resolve]);

  // الإيصال/الكارت يظهر مرئي فورًا — بيتتمركز في الشاشة
  useEffect(() => {
    if (res || flash) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [res, flash]);

  // ===== سكان الكاميرا =====
  const onScan = useCallback(async (q: string) => {
    if (!qrCap) return;
    if (!online) { toast.error("أنت أوفلاين — استخدم «وضع الحصة المحددة» تحت."); return; }
    setBusy(true);
    try {
      const r = await api<UARes>("/api/attendance/scan", { method: "POST", body: { query: q, autoRoute: true } });
      await handleResolved(r);
    } catch (e) {
      feedback("red");
      toast.error(e instanceof Error ? e.message : "المسح مش معروف — جرب تاني.");
    } finally { setBusy(false); }
  }, [qrCap, online, handleResolved]);

  const markFromRoster = useCallback((s: PanelSess, r: RosterRow, status: "PRESENT" | "LATE") => {
    doMark({ studentId: r.studentId, sessionId: s.id, status, display: r.name, sessLabel: `${s.subject} ${s.groupName}`, rosterSessionId: s.id, code: r.code });
  }, [doMark]);

  const modeBtns: { k: typeof mode; label: string; icon: typeof Keyboard; ok: boolean; offMsg: string }[] = [
    { k: "code", label: "كتابة كود", icon: Keyboard, ok: nameCap, offMsg: "كتابة الكود مقفولة في المركز — كلّم المدير يفعّل «حضور بالاسم»." },
    { k: "scan", label: "سكان", icon: ScanLine, ok: qrCap, offMsg: "سكان كروت الطلاب مقفول في المركز — كلّم المدير." },
    { k: "name", label: "ضغطة اسم", icon: ListChecks, ok: nameCap, offMsg: "الحضور بالاسم مقفول في المركز — كلّم المدير." },
  ];

  return (
    <div className="nk2-card !p-0 overflow-hidden" data-testid="unified-attendance">
      {/* ===== راس اللوحة: العنوان + التسجيل الفوري + الصوت/الاهتزاز ===== */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-extrabold text-[15px] flex items-center gap-2 nk2-sec-title m-0">
            <span className="w-8 h-8 rounded-xl nk-brand-grad text-white grid place-items-center shrink-0">
              <Zap className="w-4 h-4" />
            </span>
            لوحة الحضور الموحدة
          </h2>
          <p className="text-[11px] font-bold text-muted-foreground mt-1 mb-0 hidden sm:block">
            اكتب الكود أو امسح — والنظام يوصل الطالب لمجموعته لوحده، حتى لو أكتر من حصة شغالة.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" data-testid="ua-instant-toggle" onClick={toggleInstant}
            title={instant ? "التسجيل الفوري شغال — الكود بيتسجل لوحده. دوس تقفله لو حابب تراجع كل حالة قبل التسجيل."
              : "التسجيل الفوري مقفول — كل كود هيظهرلك كارت تأكيد. دوس تشغّله لتسجيل لحظي من غير ضغطة."}
            className={cn("h-9 rounded-xl px-2.5 border inline-flex items-center gap-1.5 text-[11.5px] font-extrabold transition shrink-0",
              instant ? "nk-brand-grad text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:text-foreground")}>
            <Zap className="w-4 h-4" />
            <span className="hidden sm:inline">تسجيل فوري</span>
          </button>
          <button type="button" onClick={toggleSound} title={sound ? "الصوت شغال" : "الصوت مقفول"} aria-label="تبديل الصوت"
            className={cn("w-9 h-9 rounded-xl border grid place-items-center transition",
              sound ? "nk-brand-bg-soft nk-brand-text border-transparent" : "bg-card border-border text-muted-foreground")}>
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 opacity-50" />}
          </button>
          <button type="button" onClick={toggleVibrate} title={vibrateOn ? "الاهتزاز شغال" : "الاهتزاز مقفول"} aria-label="تبديل الاهتزاز"
            className={cn("w-9 h-9 rounded-xl border grid place-items-center transition",
              vibrateOn ? "nk-brand-bg-soft nk-brand-text border-transparent" : "bg-card border-border text-muted-foreground")}>
            <span className={cn("w-3.5 h-3.5 rounded-full border-2", vibrateOn ? "border-current" : "border-muted-foreground/40")} />
          </button>
        </div>
      </div>

      {/* ===== شريط الحصص الشغالة لايف ===== */}
      {openSessions.length > 0 && (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="live-strip">
            {openSessions.map((s) => (
              <div key={s.id} className="rounded-2xl border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,var(--card))] bg-gradient-to-b from-[color-mix(in_srgb,var(--c-primary)_8%,var(--card))] to-card p-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-[13.5px] font-extrabold truncate">{s.subject} · {s.grade} {s.groupName}</b>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#052E2B] text-[#5EEAD4] px-2.5 py-1 text-[10.5px] font-extrabold shrink-0">
                    <i className="w-[7px] h-[7px] rounded-full bg-[#2DD4BF] animate-pulse not-italic" />شغالة
                  </span>
                </div>
                <p className="text-[11px] font-bold text-muted-foreground mt-0.5 mb-2 truncate">
                  {formatTime12(s.startTime)}{s.room ? ` · ${s.room}` : ""}{s.teacher ? ` · ${s.teacher}` : ""}
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[22px] font-extrabold nk-brand-text nk-num leading-none">{s.attendanceCount}</span>
                  <span className="text-[11px] font-bold text-muted-foreground">مسجل حضور</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== التابات الثلاثة ===== */}
      <div className="px-4 pb-4">
        <div className="flex bg-muted rounded-[13px] p-1 gap-0.5 mb-3.5" role="tablist" aria-label="طرق تسجيل الحضور">
          {modeBtns.map((b) => (
            <button key={b.k} role="tab" aria-selected={mode === b.k} data-testid={`ua-mode-${b.k}`}
              onClick={() => { setMode(b.k); setRes(null); setQuery(""); setCamOn(b.k === "scan"); if (!b.ok) toast.info(b.offMsg); }}
              className={cn(
                "flex-1 rounded-[10px] py-2.5 px-1 font-extrabold text-[12.5px] min-h-[44px] inline-flex items-center justify-center gap-1.5 transition",
                mode === b.k ? "bg-card shadow-sm nk-brand-text" : "text-muted-foreground hover:text-foreground",
                !b.ok && "opacity-60",
              )}>
              <b.icon className="w-4 h-4 shrink-0" />
              {b.label}
            </button>
          ))}
        </div>

        {/* ---------- وضع كتابة الكود ---------- */}
        {mode === "code" && (
          <div>
            {!nameCap ? (
              <CapOff msg="كتابة الكود محتاجة تفعيل «حضور بالاسم» من إعدادات المركز." />
            ) : !online ? (
              <CapOff warn msg="أنت أوفلاين — الحضور الموحد محتاج نت. استخدم «وضع الحصة المحددة» تحت (طابور الأوفلاين)." />
            ) : (
              <>
                <div className="relative">
                  <input
                    ref={inputRef}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="·····"
                    data-testid="ua-code-input"
                    className="w-full rounded-2xl border-2 border-border bg-card py-3.5 px-3 text-center text-[25px] font-extrabold tracking-[6px] outline-none nk-num min-w-0 focus:border-[color:var(--c-primary)] focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--c-primary)_12%,transparent)] placeholder:text-muted-foreground/30"
                    value={query}
                    onChange={(e) => setQuery(normalizeDigits(e.target.value))}
                    onKeyDown={(e) => { if (e.key === "Enter") resolve(query); }}
                    aria-label="كود الطالب — ٥ أرقام"
                  />
                  {busy && <Loader2 className="w-5 h-5 animate-spin absolute end-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />}
                  {showSuggest && nameMatches.length > 0 && (
                    <div className="absolute z-30 top-[calc(100%+4px)] inset-x-0 bg-card border border-border rounded-2xl shadow-lg overflow-hidden max-h-72 overflow-y-auto nk-scroll">
                      {nameMatches.map((m) => (
                        <button key={m.id} type="button" onClick={() => { setQuery(m.code); setShowSuggest(false); resolve(m.code); }}
                          className="w-full px-3.5 py-3 text-start hover:bg-muted/60 border-b last:border-0 flex items-center gap-2.5 transition">
                          <span className="w-9 h-9 rounded-lg nk-brand-bg-soft nk-brand-text grid place-items-center font-extrabold text-sm shrink-0">{m.name.trim()[0]}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-extrabold text-sm truncate">{m.name}</p>
                            {m.grade && <p className="text-[11px] text-muted-foreground font-semibold">{m.grade}</p>}
                          </div>
                          <span className="nk-num text-xs font-bold nk-brand-text shrink-0">{m.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11.5px] font-bold text-muted-foreground mt-2.5 mb-0">
                  {instant
                    ? "اكتب الكود وخلاص — بيتسجل لحظيًا في مجموعته. المتأخر أو حالة خاصة؟ الكارت هيظهرلك."
                    : "اكتب كود الطالب واضغط Enter — لو حصته شغالة هيتسجل فورًا، ولو لأ هنقولك حالته."}
                </p>
              </>
            )}
          </div>
        )}

        {/* ---------- وضع السكان ---------- */}
        {mode === "scan" && (
          <div>
            {!qrCap ? (
              <CapOff msg="سكان الكاميرا محتاج تفعيل «كروت الطلاب QR» من إعدادات المركز." />
            ) : !online ? (
              <CapOff warn msg="أنت أوفلاين — الحضور الموحد محتاج نت. استخدم «وضع الحصة المحددة» تحت." />
            ) : camOn ? (
              <>
                <div className="overflow-hidden rounded-2xl border-2 border-dashed border-[color-mix(in_srgb,var(--c-primary)_40%,var(--card))]">
                  <QrCameraScanner active={camOn} onScan={onScan} />
                </div>
                <button type="button" onClick={() => setCamOn(false)}
                  className="mt-2.5 w-full rounded-xl border-2 border-border bg-card text-muted-foreground font-extrabold py-2.5 text-xs inline-flex items-center justify-center gap-1.5 hover:text-foreground transition">
                  <CameraOff className="w-4 h-4" /> اقفل الكاميرا
                </button>
              </>
            ) : (
              <button type="button" onClick={() => { touchActivity(); setCamOn(true); }} data-testid="ua-open-cam"
                className="w-full rounded-2xl border-2 border-dashed border-[color-mix(in_srgb,var(--c-primary)_40%,var(--card))] bg-[color-mix(in_srgb,var(--c-primary)_8%,var(--card))] nk-brand-text rounded-2xl py-6 font-extrabold text-[15px] flex flex-col items-center gap-1.5 justify-center min-h-[110px] transition active:scale-[0.99]">
                <ScanLine className="w-8 h-8" />
                شغّل الكاميرا وامسح كارت الطالب
                <span className="text-[11px] font-bold text-muted-foreground">
                  {instant ? "المسح بيتسجل لحظيًا في مجموعته" : "النظام هيسجله في مجموعته لوحده"}
                </span>
              </button>
            )}
          </div>
        )}

        {/* ---------- وضع الضغطة بالاسم — مساحة كشوف متعددة ---------- */}
        {mode === "name" && (
          <div>
            {!nameCap ? (
              <CapOff msg="الحضور بالاسم محتاج تفعيل «حضور بالاسم» من إعدادات المركز." />
            ) : openSessions.length === 0 ? (
              <CapOff warn msg="مفيش حصة مفتوحة دلوقتي — افتح الحصة من «حصص النهاردة» تحت، وافتح الكشوف هنا فورًا." />
            ) : (
              <div className="grid gap-3">
                {/* شريط التثبيت — كل مجموعة شيب بعداد لايف، ودوس = تثبيت/إزالة من المساحة */}
                <div className="flex items-center gap-1.5 flex-wrap" data-testid="ua-chips">
                  {openSessions.map((s) => {
                    const active = !unpinned.has(s.id);
                    const rows = rosters[s.id];
                    const presentN = rows ? rows.filter((r) => r.status !== null).length : s.attendanceCount;
                    return (
                      <button key={s.id} type="button" data-testid={`ua-chip-${s.id}`} onClick={() => togglePin(s.id)}
                        title={active ? "شيل الكشف ده من المساحة" : "ثبّت الكشف ده في المساحة"}
                        className={cn("rounded-full px-3 py-1.5 text-[11.5px] font-extrabold border inline-flex items-center gap-1.5 transition max-w-[250px] shrink-0",
                          active ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:bg-muted/50")}>
                        {active ? <Pin className="w-3 h-3 shrink-0" /> : <PinOff className="w-3 h-3 opacity-50 shrink-0" />}
                        <span className="truncate">{s.subject} · {s.groupName}</span>
                        <span className={cn("nk-num text-[10px] rounded-full px-1.5 py-px shrink-0", active ? "bg-white/20" : "bg-muted")}>
                          {presentN}{rows ? `/${rows.length}` : ""}
                        </span>
                      </button>
                    );
                  })}
                  <button type="button" data-testid="ua-open-all" onClick={openAllRosters}
                    className="rounded-full border border-dashed border-border nk-brand-text bg-card px-3 py-1.5 text-[11.5px] font-extrabold hover:bg-muted/60 transition inline-flex items-center gap-1.5 shrink-0">
                    <LayoutGrid className="w-3.5 h-3.5" /> افتح كل الكشوف
                  </button>
                </div>

                <p className="text-[11px] font-bold text-muted-foreground lg:hidden m-0">
                  اسحب شمال/يمين بين المجموعات — الكل شغال في نفس الوقت.
                </p>

                {/* المساحة: ديسكتوب أعمدة جنب بعض · موبايل كاروسيل بيتمرر باللمس */}
                <div data-testid="ua-workspace"
                  className="nk-snap-x flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 lg:pb-0 lg:mx-0 lg:px-0 lg:grid lg:grid-cols-2 lg:overflow-visible xl:grid-cols-3">
                  {openSessions.filter((s) => !unpinned.has(s.id)).map((s) => (
                    <RosterCard key={s.id} s={s} rows={rosters[s.id]} loading={!!rosterLoading[s.id]}
                      marking={marking} lateCap={lateCap} onMark={markFromRoster} onDelete={deleteMark} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== الإيصال الفوري — بيرفرف ويتقفل لوحده ===== */}
        <div ref={resultRef}>
          {flash && (
            <div data-testid="ua-receipt" className={cn("nk-receipt mt-3.5 rounded-2xl border-2 p-3.5 flex items-start gap-2.5", KIND_CLS[flash.kind])}>
              <ReceiptIcon kind={flash.kind} className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <b className="block text-[14px] font-extrabold truncate">
                  {flash.name}{flash.code ? <span className="nk-num opacity-70"> · <span dir="ltr">{flash.code}</span></span> : null}
                </b>
                <p className="text-[12px] font-bold opacity-90 mt-0.5 mb-0">{flash.line}</p>
                {flash.warnLine && (
                  <p className="text-[11.5px] font-extrabold mt-1 mb-0 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {flash.warnLine}
                  </p>
                )}
                <p className="text-[10.5px] font-bold opacity-60 mt-0.5 mb-0 nk-num">{flash.at}</p>
              </div>
              {flash.undoable && flash.attId && (
                <button type="button" data-testid="ua-receipt-undo" onClick={() => undoReceipt(flash)}
                  className="shrink-0 rounded-lg border border-black/10 dark:border-white/20 px-2.5 py-1.5 text-[11px] font-extrabold hover:bg-black/5 dark:hover:bg-white/10 transition inline-flex items-center gap-1">
                  <Undo2 className="w-3.5 h-3.5" /> تراجع
                </button>
              )}
              <button type="button" onClick={() => setFlash(null)} className="shrink-0 rounded-lg p-1 opacity-60 hover:opacity-100 transition" aria-label="إغلاق">✕</button>
            </div>
          )}

          {/* ===== كارت النتيجة — للحالات اللي محتاجة قرار ===== */}
          {res && (
            <ResultCardUA
              res={res}
              busy={busy}
              lateCap={lateCap}
              canRegister={!!res.canRegister}
              onMark={(status) => res.student && res.session && doMark({
                studentId: res.student.id, sessionId: res.session.id, status,
                display: res.student.name, sessLabel: `${res.session.subject} ${res.session.groupName}`,
                code: res.student.code,
              })}
              onClose={() => setRes(null)}
              onRetry={(code) => resolve(code)}
            />
          )}
        </div>

        {/* ===== سجل الطابور — كل التسجيلات + تراجع لكل سطر ===== */}
        {receipts.length > 0 && (
          <div className="mt-3.5 rounded-2xl border border-border bg-card p-3" data-testid="ua-log">
            <p className="text-[11px] font-extrabold text-muted-foreground m-0 mb-1.5 flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5" /> سجل الطابور — آخر {receipts.length} تسجيل
              <span className="text-[10px] font-bold opacity-70 normal-case">(الغلطة بتصلح بضغطة «تراجع»)</span>
            </p>
            <ul className="divide-y m-0 p-0 list-none">
              {receipts.slice(0, 8).map((rc) => (
                <li key={rc.id} className="flex items-center gap-2 py-1.5 min-w-0">
                  <ReceiptIcon kind={rc.kind} className={cn("w-4 h-4 shrink-0", KIND_TEXT[rc.kind])} />
                  <span className="font-extrabold text-[12.5px] truncate min-w-0 max-w-[110px]">{rc.name}</span>
                  <span className="text-[11px] text-muted-foreground font-bold truncate min-w-0 flex-1">{rc.line}</span>
                  {rc.undoable && rc.attId && (
                    <button type="button" data-testid={`ua-log-undo-${rc.id}`} disabled={rc.undoing} onClick={() => undoReceipt(rc)}
                      className="shrink-0 rounded-lg border border-border px-2 py-1 text-[10.5px] font-extrabold text-muted-foreground hover:text-foreground transition disabled:opacity-50 inline-flex items-center gap-1">
                      <Undo2 className="w-3 h-3" /> تراجع
                    </button>
                  )}
                  <span className="text-[10px] text-muted-foreground font-bold shrink-0 nk-num">{rc.at}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </div>
  );
}

/* ==================== كشف مجموعة داخل المساحة ==================== */
function RosterCard({ s, rows, loading, marking, lateCap, onMark, onDelete }: {
  s: PanelSess; rows?: RosterRow[]; loading: boolean;
  marking: Record<string, boolean>; lateCap: boolean;
  onMark: (s: PanelSess, r: RosterRow, status: "PRESENT" | "LATE") => void;
  onDelete: (s: PanelSess, r: RosterRow) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!rows) return [];
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(t) || r.code.includes(t));
  }, [rows, q]);
  const presentN = rows ? rows.filter((r) => r.status !== null).length : s.attendanceCount;

  return (
    <div className="nk-snap-item shrink-0 w-[min(88vw,400px)] lg:w-auto rounded-2xl border border-border bg-card overflow-hidden min-w-0 flex flex-col" data-testid={`ua-roster-${s.id}`}>
      {/* راس الكشف */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <b className="text-[13.5px] font-extrabold truncate">{s.subject} · {s.grade} {s.groupName}</b>
          <span className="nk-pill nk-pill-live shrink-0 nk-num">{presentN}{rows ? ` / ${rows.length}` : ""}</span>
        </div>
        <p className="text-[11px] font-bold text-muted-foreground mt-0.5 mb-0 truncate">
          {formatTime12(s.startTime)}{s.room ? ` · ${s.room}` : ""}{s.teacher ? ` · ${s.teacher}` : ""}
        </p>
      </div>

      {/* بحث داخلي — دوّر على الطالب في الكشف فورًا */}
      {rows && rows.length > 0 && (
        <div className="px-2.5 pt-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر في الكشف — اسم أو كود…"
              data-testid={`ua-roster-search-${s.id}`}
              className="w-full rounded-lg border border-border bg-muted/40 ps-8 pe-2 py-1.5 text-[12px] font-bold outline-none focus:border-[color:var(--c-primary)] placeholder:text-muted-foreground/60" />
          </div>
        </div>
      )}

      {/* الصفوف */}
      {!rows ? (
        <div className="p-3 grid gap-1.5" aria-hidden={loading}>
          {[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="grid gap-1 p-1.5 max-h-[340px] lg:max-h-[430px] overflow-y-auto nk-scroll">
          {filtered.map((r) => {
            const isMarking = !!marking[`${s.id}:${r.studentId}`];
            return (
              <div key={r.studentId} className={cn("nk-att-row !py-2", r.status && r.status !== "EXCUSED" && "nk-att-row--present")}>
                <span className="nk-att-row__name">
                  <b className="truncate">{r.name}</b>
                  <small><span className="nk-num" dir="ltr">{r.code}</span>{r.charged ? ` · ${fmt(r.charged)} ج` : ""}{r.status ? ` · ${ATTENDANCE_LABEL[r.status] ?? r.status}` : ""}</small>
                </span>
                {r.status ? (
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className={cn("nk-pill", r.status === "LATE" ? "nk-pill-pending" : "nk-pill-live")}>{ATTENDANCE_LABEL[r.status] ?? r.status}</span>
                    {r.attId && (
                      <button type="button" title="مسح الرصد" disabled={isMarking} onClick={() => onDelete(s, r)}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground transition disabled:opacity-50">
                        <Undo2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 shrink-0">
                    {isMarking ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
                      <>
                        <button type="button" data-testid={`ua-mark-${r.code}`}
                          onClick={() => onMark(s, r, "PRESENT")}
                          className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold bg-[var(--nk-ok-bg)] text-[var(--nk-ok-strong)] border border-[var(--nk-ok-border)] transition active:scale-95">
                          حاضر
                        </button>
                        {lateCap && (
                          <button type="button"
                            onClick={() => onMark(s, r, "LATE")}
                            className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold bg-[var(--nk-warn-bg)] text-[var(--nk-warn-strong)] border border-[var(--nk-warn-border)] transition active:scale-95">
                            متأخر
                          </button>
                        )}
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center py-4 text-xs font-bold text-muted-foreground m-0">
              {rows.length === 0 ? "الكشف فاضي — المجموعة دي مفيهاش طلاب نشطين." : "مفيش حد بالاسم أو الكود ده في الكشف."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== كارت النتيجة — للحالات المحتاجة قرار ==================== */
function ResultCardUA({ res, busy, lateCap, canRegister, onMark, onClose, onRetry }: {
  res: UARes; busy: boolean; lateCap: boolean; canRegister: boolean;
  onMark: (status: "PRESENT" | "LATE") => void;
  onClose: () => void; onRetry: (code: string) => void;
}) {
  if (res.status === "RED" || !res.student) {
    return (
      <div className="mt-3.5 rounded-2xl border-2 border-[var(--nk-danger-border)] bg-[var(--nk-danger-bg)] p-3.5" data-testid="ua-result-red">
        <div className="flex items-start gap-2.5">
          <XCircle className="w-5 h-5 text-[var(--nk-danger-strong)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <b className="block text-[13.5px] font-extrabold text-[var(--nk-danger-strong)]">الكود ده مش معروف</b>
            <p className="text-[12px] font-bold text-[var(--nk-danger-strong)] opacity-85 mt-0.5 mb-0">{res.message ?? "جرب تاني أو امسح الـ QR."}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground" aria-label="إغلاق">✕</button>
        </div>
      </div>
    );
  }

  const s = res.student;
  const sess = res.session;
  const done = res.alreadyAttended;

  return (
    <div
      data-testid="ua-result"
      className={cn(
        "mt-3.5 rounded-2xl border-2 p-3.5",
        sess && !done && "border-[color-mix(in_srgb,var(--c-primary)_45%,var(--card))] bg-gradient-to-b from-[color-mix(in_srgb,var(--c-primary)_8%,var(--card))] to-card",
        (!sess || done) && "border-[var(--nk-warn-border)] bg-[var(--nk-warn-bg)]",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl nk-brand-grad text-white grid place-items-center font-extrabold text-[15px] shrink-0">{s.name.trim()[0]}</span>
        <div className="flex-1 min-w-0">
          <b className="block text-[15px] font-extrabold truncate">{s.name}</b>
          <span className="block text-[11.5px] font-bold text-muted-foreground truncate">
            كود <span className="nk-num" dir="ltr">{s.code}</span>{s.grade ? ` · ${s.grade}` : ""}
          </span>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground" aria-label="إغلاق">✕</button>
      </div>

      {sess && (
        <div className="mt-2.5 rounded-xl bg-[#052E2B] text-[#5EEAD4] dark:bg-[#052E2B] px-3 py-2.5 text-[12.5px] font-extrabold flex items-center gap-2 flex-wrap" data-testid="ua-route">
          <span>🎯 راح مجموعته:</span>
          <span>{sess.subject} — {sess.grade} {sess.groupName}</span>
          <span className="opacity-75">· {sess.teacher ?? "—"} · {formatTime12(sess.startTime)}{sess.room ? ` · ${sess.room}` : ""} · شغالة دلوقتي</span>
        </div>
      )}

      {sess && done && (
        <p className="text-[12.5px] font-extrabold mt-2.5 mb-0 text-[var(--nk-ok-strong)] flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> متسجل في الحصة دي من قبل ✓ — مفيش تكرار.
        </p>
      )}

      {!sess && res.autoHint && (
        <p className={cn("text-[12.5px] font-extrabold mt-2.5 mb-0 flex items-start gap-1.5",
          res.autoHint.kind === "NONE_TODAY" ? "text-[var(--nk-warn-strong)]" : "text-[var(--nk-danger-strong)]")} data-testid="ua-hint">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {res.autoHint.message}
          {res.autoHint.sessions.length > 0 && (
            <span className="block w-full text-[11px] font-bold opacity-80">
              حصصه النهاردة: {res.autoHint.sessions.map((x) => `${x.subject} ${x.grade} ${x.groupName} (${formatTime12(x.startTime)})`).join(" · ")}
            </span>
          )}
        </p>
      )}

      {sess && res.balance != null && (
        <p className="text-[11.5px] font-bold text-muted-foreground mt-2 mb-0">
          رصيده: <span className={cn("nk-num", res.balance < 0 && "text-[var(--nk-danger-strong)] font-extrabold")} dir="ltr">{fmt(res.balance)} ج</span>
          {(res.amountDue ?? 0) > 0 ? <> · المطلوب النهاردة: <b className="nk-num" dir="ltr">{fmt(res.amountDue!)} ج</b></> : ""}
        </p>
      )}

      {sess && !done && (
        <div className="flex gap-2 mt-2.5 flex-wrap">
          <button
            data-testid="ua-mark-present"
            disabled={busy}
            onClick={() => onMark("PRESENT")}
            className="flex-1 min-w-[130px] rounded-xl nk-brand-grad text-white font-extrabold py-3 text-[13.5px] shadow active:scale-[0.98] transition disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
            <CheckCircle2 className="w-4.5 h-4.5" /> سجّل حاضر
          </button>
          {lateCap && (
            <button
              disabled={busy}
              onClick={() => onMark("LATE")}
              className="rounded-xl border-2 border-[var(--nk-warn-border)] bg-card text-[var(--nk-warn-strong)] font-extrabold py-3 px-4 text-[13px] active:scale-[0.98] transition disabled:opacity-60 inline-flex items-center gap-1.5">
              <Clock3 className="w-4 h-4" /> متأخر
            </button>
          )}
        </div>
      )}

      {!sess && res.student && res.student.groups.length > 0 && (
        <p className="text-[11px] font-bold text-muted-foreground mt-2 mb-0">
          مجموعاته: {res.student.groups.map((g) => `${g.subject} ${g.name}`).join(" · ")}
        </p>
      )}
      {sess && !res.registered && canRegister && (
        <p className="text-[11.5px] font-extrabold text-[var(--nk-warn-strong)] mt-2 mb-0">
          الطالب مش مسجل في المجموعة دي — استخدم «وضع الحصة المحددة» تحت لتسجيله في المجموعة.
        </p>
      )}
      {/* زرار إعادة للمستخدم الفضولي — بيفتح نفس الكود تاني */}
      {sess && done && (
        <button onClick={() => onRetry(s.code)} className="mt-2 text-[11px] font-extrabold text-muted-foreground hover:text-foreground underline underline-offset-2">
          اتأكد بكود تاني
        </button>
      )}
    </div>
  );
}

/* ==================== رسالة القفل/الأوفلاين ==================== */
function CapOff({ msg, warn }: { msg: string; warn?: boolean }) {
  return (
    <p className={cn("rounded-xl px-3.5 py-3 text-[12.5px] font-extrabold flex items-start gap-2 m-0",
      warn
        ? "text-amber-800 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300"
        : "text-muted-foreground bg-muted border border-border")}>
      <Zap className="w-4 h-4 shrink-0 mt-0.5" />
      {msg}
    </p>
  );
}

/* ==================== أدوات ==================== */
function ymdCairo(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d);
}
