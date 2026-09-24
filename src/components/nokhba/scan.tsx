"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ScanLine, Camera, CameraOff, CheckCircle2, XCircle, AlertTriangle,
  Banknote, Keyboard, UserPlus, RefreshCcw, BadgeCheck, DoorClosed, ArrowLeft,
  Wallet, Smartphone, Coins, Volume2, VolumeX, Vibrate, VibrateOff, Monitor, Zap,
  CalendarDays, CalendarPlus, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, normalizeDigits, formatTime12, sessionPhase, nowHM, ATTENDANCE_LABEL, type SessionUser } from "./lib";
import { PageHeader, SectionCard, Loading, Chip, ChipsSkeleton } from "./shared";
import { useAcademics, Field, inputCls } from "./students";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrCameraScanner } from "./qr-scanner";
import { ReceiptActions, PrintSettingsButton } from "./receipt-actions";
import { WhatsAppHandoffButton } from "./whatsapp-button";
import { OfflineStatusBar, useOnlineStatus, queueScan } from "./pwa";
import { feedback, unlockAudio, useFeedbackSettings, useWakeLock } from "./feedback";
import { usePrint, PrintableReceiptA4, PrintableReceiptThermal, type ReceiptData } from "./print";

type ScanSession = {
  id: string; startTime: string; endTime: string; status: string; date: string;
  subject: string; groupName: string; grade: string; teacher: string | null;
  groupId: string; price: number; room: string | null;
};

type ScanResult = {
  status: "GREEN" | "ORANGE" | "RED";
  message: string;
  hint?: string;
  student?: {
    id: string; name: string; code: string; phone: string | null; parentName: string | null;
    parentPhone: string | null; grade: string | null; status: string;
    subjects: string[]; groups: { id: string; name: string; subject: string }[];
  };
  session?: ScanSession | null;
  registered?: boolean;
  price?: number;
  balance?: number;
  amountDue?: number | null;
  alreadyAttended?: boolean;
  attendanceStatus?: string | null;
  sessionClosed?: boolean;
  canRegister?: boolean;
};

const CAMERA_IDLE_MS = 45_000; // الكاميرا بتقفل لو مفيش نشاط 45 ثانية

/** تاريخ اليوم بتوقيت القاهرة بصيغة YYYY-MM-DD (نفس منطق السيرفر) */
function ymdCairo(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** اسم اليوم اللي بيتعرض دلوقتي — النهاردة/بكرة/امبارح أو اسم اليوم والتاريخ */
function dayLabel(d: string): string {
  if (d === ymdCairo(0)) return "النهاردة";
  if (d === ymdCairo(1)) return "بكرة";
  if (d === ymdCairo(-1)) return "امبارح";
  try {
    return new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Cairo" })
      .format(new Date(`${d}T12:00:00`));
  } catch { return d; }
}

/** حالة الحصة في الشريحة — بتاخد اليوم المعروض في الاعتبار */
function phaseChipLabel(s: ScanSession, viewDate: string): string {
  if (s.status === "CLOSED") return "مقفولة";
  const today = ymdCairo(0);
  if (viewDate === today) {
    const p = sessionPhase(s.startTime, s.endTime);
    return p === "now" ? "شغالة" : p === "past" ? "خلصت" : "جاية";
  }
  return viewDate < today ? "فاتت" : "جاية";
}

export function ScanView({ user, sessionOverride, clearSessionOverride, embedded }: {
  user: SessionUser;
  sessionOverride?: string | null;
  clearSessionOverride: () => void;
  embedded?: boolean;
}) {
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [suggestions, setSuggestions] = useState<{ scheduleId: string; subject: string; grade: string; groupName: string; startTime: string }[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [log, setLog] = useState<{ name: string; note: string; at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameMatches, setNameMatches] = useState<{ id: string; code: string; name: string; grade: string | null }[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showAdhoc, setShowAdhoc] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [viewDate, setViewDate] = useState<string>(ymdCairo(0));
  const wantedRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionsRef = useRef<HTMLDivElement>(null);
  const online = useOnlineStatus();
  const { sound, vibrateOn, toggleSound, toggleVibrate } = useFeedbackSettings();

  // «اختار مجموعة أخرى» من كارت الطالب → دوّس على اختيار الحصة
  useEffect(() => {
    const onFocus = () => {
      sessionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRef.current?.focus();
    };
    window.addEventListener("nk-focus-sessions", onFocus);
    return () => window.removeEventListener("nk-focus-sessions", onFocus);
  }, []);

  // Wake lock: الشاشة مبتقفلش طول ما الكاميرا شغالة أو وضع الكشك مفتوح
  useWakeLock(cameraOn || kiosk);

  // فتح الـ audio context عند أول لمسة — المتصفحات بتمنع الصوت من غير تفاعل
  useEffect(() => {
    const on = () => unlockAudio();
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, []);

  const loadSessions = useCallback(async (date?: string) => {
    const d0 = date ?? viewDate;
    const isToday = d0 === ymdCairo(0);
    try {
      const d = await api<{ sessions: (ScanSession & { attendanceCount: number })[]; suggestions: typeof suggestions }>(`/api/sessions?date=${d0}`);
      // الملغاة مالهاش لازمة في شاشة المسح — بتلخبط الاختيار بس
      let live = d.sessions.filter((s) => s.status !== "CANCELLED");
      setSessions(live);
      setSuggestions(d.suggestions);
      setLoading(false);
      // pick best default: open session happening now → next → first open
      setActiveSessionId((prev) => {
        if (prev && live.some((s) => s.id === prev)) return prev;
        const now = live.find((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "now");
        const nextOpen = live.find((s) => s.status === "OPEN");
        return now?.id ?? nextOpen?.id ?? live[0]?.id ?? null;
      });
      // مفيش حصة OPEN شغالة دلوقتي + الجدول فيه حصة مجدولة جارية → افتحها تلقائياً
      // (الموظف واقف على الكاشير — الحصة لازم تكون جاهزة من غير ضغطات زيادة)
      // الفتح التلقائي بيحصل بس ونحنا بنعرض النهاردة — الأيام التانية بنستنى اختيار الموظف
      const hasNowOpen = live.some((s) => s.status === "OPEN" && sessionPhase(s.startTime, s.endTime) === "now");
      if (!embedded && isToday && !hasNowOpen && d.suggestions.length > 0) {
        const ref = nowHM();
        const [rh, rm] = ref.split(":").map(Number);
        const nowMin = rh * 60 + rm;
        const openNow = d.suggestions.find((s) => {
          // حصة مجدولة جارية دلوقتي (تقدير مدتها 90 دقيقة)
          const [h, m] = s.startTime.split(":").map(Number);
          const startMin = h * 60 + m;
          return startMin <= nowMin && nowMin <= startMin + 90;
        });
        if (openNow) {
          try {
            await api("/api/sessions", { method: "POST", body: { scheduleId: openNow.scheduleId, date: d0 } });
            const d2 = await api<{ sessions: (ScanSession & { attendanceCount: number })[]; suggestions: typeof suggestions }>(`/api/sessions?date=${d0}`);
            const live2 = d2.sessions.filter((s) => s.status !== "CANCELLED");
            setSessions(live2);
            setSuggestions(d2.suggestions);
            setActiveSessionId((prev) =>
              prev && live2.some((s) => s.id === prev) ? prev : (live2.find((s) => s.status === "OPEN")?.id ?? live2[0]?.id ?? null),
            );
          } catch { /* fallback: الزراير اليدوية موجودة */ }
        }
      }
    } catch { setLoading(false); }
  }, [embedded, viewDate]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // تبديل اليوم المعروض — بيمسح النتيجة ويحمّل حصص اليوم الجديد
  function changeDate(d: string) {
    if (d === viewDate) return;
    setViewDate(d);
    setResult(null);
    setLoading(true);
  }

  // أي فتح/قفل/إلغاء حصة من أي شاشة تانية → أعد تحميل الحصص فورًا
  // (المدير لغى الحصة المختارة مثلاً → الاختيار ينضف هنا بدل رسالة «الحصة ملغاة»)
  useEffect(() => {
    const reload = () => loadSessions();
    window.addEventListener("nk-sessions-changed", reload);
    return () => window.removeEventListener("nk-sessions-changed", reload);
  }, [loadSessions]);

  useEffect(() => {
    if (sessionOverride) {
      wantedRef.current = sessionOverride;
      setActiveSessionId(sessionOverride);
      // في الوضع المدمج الحصة بتفضل مثبتة — الوضع العادي بيتصرف زي ما هو
      if (!embedded) clearSessionOverride();
    }
  }, [sessionOverride, clearSessionOverride, embedded]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // focus input whenever result clears
  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [result]);

  const doScan = useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    setShowSuggest(false);
    setBusy(true);
    try {
      // أوفلاين: نطابق الكود/الـQR الخام في الطابور المحلي ونتزامن أول ما النت يرجع
      if (!online) {
        const cleaned = normalizeDigits(raw).trim();
        const isToken = cleaned.length >= 16 && /^[0-9a-f]+$/i.test(cleaned);
        const isCode = cleaned.length === 5 && /^\d+$/.test(cleaned);
        if ((isToken || isCode) && activeSessionId) {
          const deviceTime = new Date().toISOString();
          queueScan({
            idemKey: `${activeSessionId}:${cleaned}:${deviceTime}`,
            sessionId: activeSessionId,
            query: cleaned,
            label: isCode ? cleaned : "QR",
            deviceTime,
          });
          setQuery("");
          feedback("orange");
          toast.success("اتسجل محليًا على الجهاز — هيتزامن أول ما النت يرجع.", { duration: 4000 });
        } else if (!activeSessionId) {
          toast.error("اختار الحصة الأول — الحضور أوفلاين محتاج حصة محددة.");
        } else {
          toast.error("الكود ده مش شكله كود طالب (5 أرقام أو QR).");
        }
        return;
      }
      const res = await api<ScanResult>("/api/attendance/scan", {
        method: "POST",
        body: { query: raw, sessionId: activeSessionId },
      });
      setResult(res); // scanning a new student replaces the open card — ready for the queue
      setQuery("");
      // صوت + اهتزاز حسب النتيجة — الموظف مش محتاج يبص للشاشة
      feedback(res.status === "GREEN" ? "green" : res.status === "ORANGE" ? "orange" : "red");
    } catch {
      feedback("red");
    } finally { setBusy(false); }
  }, [activeSessionId, online]);

  // أحدث نسخة من doScan للـ auto-submit (من غير stale closure)
  const doScanRef = useRef(doScan);
  useEffect(() => { doScanRef.current = doScan; }, [doScan]);
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // ===== auto-submit: كود 5 أرقام بيتقدم لوحده من غير Enter =====
  // (قارئ QR الخارجي بيكتب زي الكيبورد — مسحة واحدة = كارت كامل)
  useEffect(() => {
    const raw = query.trim();
    if (/^\d{5}$/.test(raw)) {
      if (busyRef.current) return;
      const t = setTimeout(() => doScanRef.current(raw), 150);
      return () => clearTimeout(t);
    }
  }, [query]);

  // Name/code search: when query is non-numeric or longer/shorter than 5 digits → fetch /api/lookup
  // When exactly 5 digits → no need to search, the scan endpoint will resolve it directly
  useEffect(() => {
    const raw = query.trim();
    if (!raw) { setNameMatches([]); setShowSuggest(false); return; }
    if (/^\d{5}$/.test(raw)) { setNameMatches([]); setShowSuggest(false); return; } // pure 5-digit code → skip
    const t = setTimeout(async () => {
      try {
        const d = await api<{ students: { id: string; code: string; name: string; grade: string | null }[] }>(`/api/lookup?q=${encodeURIComponent(raw)}`);
        setNameMatches(d.students.slice(0, 20));
        setShowSuggest(true);
      } catch { /* toast */ }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // ===== الكاميرا الذكية: تقفل لوحدها بعد 45 ثانية سكون (بطارية) =====
  const lastActivityRef = useRef(Date.now());
  const touchActivity = useCallback(() => { lastActivityRef.current = Date.now(); }, []);
  useEffect(() => {
    if (!cameraOn) return;
    const iv = setInterval(() => {
      if (Date.now() - lastActivityRef.current > CAMERA_IDLE_MS) {
        setCameraOn(false);
        toast.info("الكاميرا اتقفلت تلقائيًا لتوفير البطارية — دوس زرار الكاميرا تاني.", { duration: 5000 });
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [cameraOn]);
  useEffect(() => {
    // أي نشاط في الشاشة بيرجّع المؤقت — حتى لو الكاميرا شغالة
    const on = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, []);

  async function pickMatch(code: string) {
    setQuery(code);
    setShowSuggest(false);
    await doScan(code);
  }

  /**
   * One call that finishes the whole post-scan flow:
   * optional payment + attendance (+ optional group registration).
   * Returns the final outcome for the success card + payment txnId (receipt).
   */
  const completeFlow = useCallback(async (opts: {
    amountEGP: number; method: string; register: boolean; fromBalance?: boolean;
  }): Promise<{ msg: string | null; txnId: string | null } | null> => {
    const r = result;
    if (!r?.student || !activeSessionId) return null;
    setBusy(true);
    try {
      let attended = r.alreadyAttended ?? false;
      let balance = r.balance ?? 0;

      // 1) attendance first (charge happens here) unless already marked
      if (!attended) {
        const m = await api<{ alreadyAttended: boolean; charged: number; balance: number; amountDue: number; status: string }>("/api/attendance/mark", {
          method: "POST",
          body: { studentId: r.student.id, sessionId: activeSessionId, status: "PRESENT", registerGroup: opts.register },
        });
        attended = m.alreadyAttended;
        balance = m.balance;
      }

      // 2) payment (if any)
      let payMsg: string | null = null;
      let txnId: string | null = null;
      if (opts.amountEGP > 0) {
        const p = await api<{ message: string; balance: number; amountDue: number; txn: { id: string } }>('/api/payments', {
          method: "POST",
          body: {
            studentId: r.student.id, amount: opts.amountEGP, method: opts.method,
            sessionId: activeSessionId, type: "PAYMENT",
          },
        });
        payMsg = p.message;
        balance = p.balance;
        txnId = p.txn?.id ?? null;
      }

      const amountDue = Math.max(-balance, 0);
      setResult((cur) => cur ? {
        ...cur,
        status: opts.register ? "GREEN" : cur.status,
        registered: opts.register ? true : cur.registered,
        alreadyAttended: attended,
        attendanceStatus: attended ? (cur.attendanceStatus ?? "PRESENT") : null,
        balance, amountDue,
      } : cur);

      // activity log line
      const parts: string[] = [];
      if (!r.alreadyAttended && attended) parts.push("حضور");
      if (opts.fromBalance) parts.push("خصم من الرصيد");
      else if (opts.amountEGP > 0) parts.push(`دفع ${fmt(Math.round(opts.amountEGP * 100))} ج`);
      if (parts.length) {
        setLog((l) => [{ name: r.student!.name, note: parts.join(" · "), at: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) }, ...l].slice(0, 8));
      }

      let msg = payMsg;
      if (!msg) {
        if (opts.fromBalance) {
          msg = balance >= 0
            ? `حضور + اتخصم سعر الحصة من رصيده — باقٍ له ${fmt(balance)} ج`
            : `حضور + استخدمنا رصيده — الباقي عليه ${fmt(-balance)} ج`;
        } else if (attended && !r.alreadyAttended) {
          msg = `تم تسجيل حضور ${r.student.name}`;
        }
      }
      return { msg, txnId };
    } catch { /* toast shown */ return null; }
    finally { setBusy(false); }
  }, [result, activeSessionId]);

  async function openSuggestion(scheduleId: string) {
    setBusy(true);
    try {
      await api("/api/sessions", { method: "POST", body: { scheduleId, date: viewDate } });
      toast.success("تم فتح الحصة.");
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      await loadSessions(viewDate);
    } catch { /* toast */ } finally { setBusy(false); }
  }

  const canRegister = user.role === "MANAGER" || (user.role === "RECEPTIONIST" && user.canAddStudents);

  if (loading) {
    return (
      <div className="space-y-4">
        {!embedded && <PageHeader title="الحضور" subtitle="ابحث بالاسم أو امسح QR أو اكتب الكود — سؤال واحد بس وخلاص" />}
        {!embedded && (
          <SectionCard title="حصة النهاردة" icon={<ScanLine className="w-4 h-4" />}>
            <ChipsSkeleton count={3} />
          </SectionCard>
        )}
        <SectionCard>
          <div className="h-14 rounded-2xl bg-muted animate-pulse" />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!embedded && <PageHeader title="الحضور" subtitle="ابحث بالاسم أو امسح QR أو اكتب الكود — سؤال واحد بس وخلاص" />}

      {/* حالة الاتصال + طابور الحضور الأوفلاين */}
      <OfflineStatusBar />

      {/* ===== Session picker (مخفي في الوضع المدمج — الحصة مثبتة من مساحة العمل) ===== */}
      {!embedded && (
      <div ref={sessionsRef}>
        <SectionCard title={`حصص ${dayLabel(viewDate)}`} icon={<ScanLine className="w-4 h-4" />}>
        {/* ===== شريط الأيام — عشان تفتح أي حصة في أي يوم ===== */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {[
            { d: ymdCairo(0), label: "النهاردة" },
            { d: ymdCairo(-1), label: "امبارح" },
            { d: ymdCairo(1), label: "بكرة" },
          ].map((it) => (
            <button
              key={it.d}
              onClick={() => changeDate(it.d)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                viewDate === it.d ? "nk-brand-bg text-white shadow" : "bg-card border border-border text-muted-foreground hover:bg-muted/50"
              )}
            >
              {it.label}
            </button>
          ))}
          <label
            className={cn(
              "rounded-full px-3 py-1 text-xs font-bold border flex items-center gap-1.5 transition cursor-pointer",
              viewDate !== ymdCairo(0) && viewDate !== ymdCairo(-1) && viewDate !== ymdCairo(1)
                ? "nk-brand-bg text-white border-transparent shadow"
                : "bg-card border-border text-muted-foreground hover:bg-muted/50"
            )}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            <input
              type="date"
              value={viewDate}
              max="2100-12-31"
              onChange={(e) => { if (e.target.value) changeDate(e.target.value); }}
              className="bg-transparent outline-none w-[7.4rem] text-inherit cursor-pointer nk-num"
              aria-label="اختار أي يوم"
            />
          </label>
          <button
            onClick={() => setShowAdhoc(true)}
            className="ms-auto rounded-full border border-dashed border-border nk-brand-text bg-card px-3.5 py-1.5 text-xs font-bold hover:bg-muted/60 transition flex items-center gap-1.5"
          >
            <CalendarPlus className="w-3.5 h-3.5" /> فتح حصة يدوي
          </button>
        </div>
        {sessions.length === 0 && suggestions.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm font-bold text-muted-foreground">مفيش حصص {dayLabel(viewDate)} في الجدول.</p>
            <button onClick={() => setShowAdhoc(true)} className="mt-2 text-xs font-extrabold nk-brand-text hover:underline">
              افتح حصة يدوي لأي مجموعة →
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto nk-scroll pb-1 -mx-1 px-1">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setActiveSessionId(s.id); setResult(null); }}
                  className={cn(
                    "shrink-0 rounded-2xl border px-3.5 py-2.5 text-start transition min-w-[150px]",
                    activeSessionId === s.id ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border hover:border-[color-mix(in_srgb,var(--c-primary)_40%,white)]"
                  )}
                >
                  <span className="block text-xs font-bold opacity-80">{formatTime12(s.startTime)} {s.room ? `· ${s.room}` : ""} · {phaseChipLabel(s, viewDate)}</span>
                  <span className="block font-extrabold text-sm mt-0.5">{s.subject} {s.grade} {s.groupName}</span>
                </button>
              ))}
            </div>
            {suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.scheduleId}
                    onClick={() => openSuggestion(s.scheduleId)}
                    disabled={busy}
                    className="rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-muted/60 transition"
                  >
                    + افتح {s.subject} {s.grade} {s.groupName} ({formatTime12(s.startTime)})
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        </SectionCard>
      </div>
      )}

      {/* ===== Scan input ===== */}
      <SectionCard>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 nk-brand-text" />
              {embedded
                ? "امسح QR أو اكتب كود 5 أرقام — بيتقدم لوحده."
                : "اكتب كود 5 أرقام → بيتقدم لوحده. الصوت والاهتزاز بيفرقوا وقت الزحمة."}
            </p>
            {/* أزرار الصوت والاهتزاز والطباعة التلقائية */}
            <div className="flex items-center gap-1.5">
              <PrintSettingsButton user={user} />
              <button
                type="button"
                onClick={toggleSound}
                title={sound ? "الصوت شغال — اضغط للإسكات" : "الصوت مقفول — اضغط للتشغيل"}
                aria-label="تبديل الصوت"
                className={cn(
                  "w-9 h-9 rounded-xl border grid place-items-center transition",
                  sound ? "nk-brand-bg-soft nk-brand-text border-transparent" : "bg-card border-border text-muted-foreground"
                )}
              >
                {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={toggleVibrate}
                title={vibrateOn ? "الاهتزاز شغال — اضغط لإيقافه" : "الاهتزاز مقفول — اضغط للتشغيل"}
                aria-label="تبديل الاهتزاز"
                className={cn(
                  "w-9 h-9 rounded-xl border grid place-items-center transition",
                  vibrateOn ? "nk-brand-bg-soft nk-brand-text border-transparent" : "bg-card border-border text-muted-foreground"
                )}
              >
                {vibrateOn ? <Vibrate className="w-4 h-4" /> : <VibrateOff className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              // if not a 5-digit code AND there's exactly one match → scan that
              if (query.trim().length !== 5 && nameMatches.length === 1) {
                pickMatch(nameMatches[0].code);
                return;
              }
              doScan(query);
            }}
            className="flex gap-2"
            autoComplete="off"
          >
            <div className="relative flex-1">
              <Keyboard className="absolute start-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
              <input
                ref={inputRef}
                dir="ltr"
                inputMode="text"
                placeholder="ابحث بالاسم أو اكتب الكود — ٥ أرقام"
                className="w-full h-14 rounded-2xl border-2 border-input bg-card ps-11 pe-4 text-start text-lg font-extrabold tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring nk-num focus:border-[color:var(--c-primary)]"
                value={query}
                onChange={(e) => setQuery(normalizeDigits(e.target.value))}
                disabled={!activeSession}
                data-testid="scan-input"
                data-tour="scan-search"
              />
              {showSuggest && nameMatches.length > 0 && (
                <div className="absolute z-30 top-[calc(100%+4px)] inset-x-0 bg-card border border-border rounded-2xl shadow-lg overflow-hidden max-h-72 overflow-y-auto nk-scroll nk-animate-pop">
                  {nameMatches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pickMatch(m.code)}
                      className="w-full px-3.5 py-3 text-start hover:bg-muted/60 border-b last:border-0 flex items-center gap-2.5 transition"
                    >
                      <span className="w-9 h-9 rounded-lg nk-brand-bg-soft nk-brand-text grid place-items-center font-extrabold text-sm shrink-0">
                        {m.name.trim()[0]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-sm truncate">{m.name}</p>
                        {m.grade && <p className="text-[11px] text-muted-foreground font-semibold">{m.grade}</p>}
                      </div>
                      <span className="nk-num text-xs font-bold nk-brand-text shrink-0">{m.code}</span>
                    </button>
                  ))}
                </div>
              )}
              {showSuggest && nameMatches.length === 0 && query.trim().length !== 5 && (
                <div className="absolute z-30 top-[calc(100%+4px)] inset-x-0 bg-card border border-border rounded-2xl shadow-lg overflow-hidden px-3.5 py-2.5 text-sm font-bold text-muted-foreground">
                  مفيش طالب بالاسم ده.
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { touchActivity(); setCameraOn((c) => !c); }}
              className={cn(
                "h-14 w-14 shrink-0 rounded-2xl border-2 grid place-items-center transition",
                cameraOn ? "nk-brand-bg text-white border-transparent" : "border-input bg-card text-muted-foreground hover:text-foreground"
              )}
              aria-label={cameraOn ? "اقفل الكاميرا" : "شغل الكاميرا"}
            >
              {cameraOn ? <CameraOff className="w-6 h-6" /> : <Camera className="w-6 h-6" />}
            </button>
          </form>

          {/* مفيش حصة مفتوحة → قول للموظف يعمل إيه بدل خانة معطّلة من غير تفسير */}
          {!activeSession && (
            <p className="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2">
              <Zap className="w-4 h-4 shrink-0" />
              {suggestions.length > 0
                ? "افتح الحصة من الجدول فوق الأول — بعد كده اكتب الكود عادي."
                : "مفيش حصص النهاردة في الجدول — ضيف حصة من صفحة الجداول."}
            </p>
          )}

          {cameraOn && <QrCameraScanner active={cameraOn} onScan={doScan} />}

          {/* أزرار الوضع المتقدم: كشك ذاتي + تسجيل سريع */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setKiosk(true)}
              className="flex-1 min-w-[160px] rounded-xl border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold px-3 py-2.5 text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition"
            >
              <Monitor className="w-4 h-4" /> وضع الكشك الذاتي (تابلت الباب)
            </button>
            {canRegister && (
              <button
                type="button"
                onClick={() => setShowQuickAdd(true)}
                className="flex-1 min-w-[160px] rounded-xl border-2 border-border bg-card text-foreground font-extrabold px-3 py-2.5 text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition hover:bg-muted/50"
              >
                <UserPlus className="w-4 h-4" /> تسجيل طالب جديد (سريع)
              </button>
            )}
          </div>

          {!activeSession && (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              اختار حصة أول عشان نسجل الحضور صح.
            </p>
          )}
          {activeSession?.status === "CLOSED" && (
            <p className="text-xs font-bold text-muted-foreground bg-muted border border-border rounded-xl px-3 py-2 flex items-center gap-1.5">
              <DoorClosed className="w-4 h-4" /> الحصة دي مقفولة — تقدر تشوف تفاصيلها بس.
            </p>
          )}
        </div>
      </SectionCard>

      {/* ===== Result card (simplified 1-step wizard) ===== */}
      {result && (
        <ResultCard
          key={result.student?.id ?? "red"}
          result={result}
          onClose={() => setResult(null)}
          onComplete={completeFlow}
          busy={busy}
          user={user}
        />
      )}

      {/* ===== Recent activity ===== */}
      {log.length > 0 && (
        <SectionCard title="آخر العمليات" icon={<RefreshCcw className="w-4 h-4" />}>
          <ul className="divide-y text-sm">
            {log.map((l, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="font-bold">{l.name}</span>
                <span className="text-xs text-muted-foreground font-semibold">{l.note} · {l.at}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* ===== تسجيل سريع من غير ما تخرج من شاشة الحضور ===== */}
      {showQuickAdd && (
        <QuickRegisterDialog
          onClose={() => setShowQuickAdd(false)}
          onCreated={async (st) => {
            setShowQuickAdd(false);
            toast.success(`تم تسجيل ${st.name} — كوده ${st.code}. جاري فتح كارته...`);
            await doScan(st.code);
          }}
        />
      )}

      {/* ===== فتح حصة يدوي — أي مجموعة في أي يوم (مش في الوضع المدمج) ===== */}
      {!embedded && (
        <AdhocSessionDialog
          open={showAdhoc}
          onClose={() => setShowAdhoc(false)}
          defaultDate={viewDate}
          onOpened={(d) => {
            setShowAdhoc(false);
            if (d !== viewDate) changeDate(d);
            else loadSessions(viewDate);
          }}
        />
      )}

      {/* ===== وضع الكشك الذاتي ===== */}
      {kiosk && (
        <KioskMode
          sessions={sessions}
          activeSessionId={activeSessionId}
          online={online}
          onExit={() => setKiosk(false)}
        />
      )}
    </div>
  );
}

// =====================================================================

/** فتح حصة يدوي — أي مجموعة في أي يوم بأي وقت
 *  (الحصص الإضافية والمعوّضة مش دايمًا في الجدول الأسبوعي) */
function AdhocSessionDialog({ open, onClose, defaultDate, onOpened }: {
  open: boolean; onClose: () => void; defaultDate: string; onOpened: (date: string) => void;
}) {
  const academics = useAcademics();
  const [form, setForm] = useState({ groupId: "", date: defaultDate, startTime: "", endTime: "", room: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ groupId: "", date: defaultDate, startTime: "", endTime: "", room: "" });
      setError("");
    }
  }, [open, defaultDate]);

  const group = academics?.groups.find((g) => g.id === form.groupId);

  async function submit() {
    if (!form.groupId) { setError("اختار المجموعة."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setError("اختار اليوم."); return; }
    if (!/^\d{2}:\d{2}$/.test(form.startTime) || !/^\d{2}:\d{2}$/.test(form.endTime)) { setError("حدد وقت البداية والنهاية."); return; }
    if (form.endTime <= form.startTime) { setError("وقت النهاية لازم يكون بعد وقت البداية."); return; }
    setBusy(true);
    try {
      await api("/api/sessions", {
        method: "POST",
        body: { groupId: form.groupId, date: form.date, startTime: form.startTime, endTime: form.endTime, room: form.room.trim() || null },
      });
      toast.success(`تم فتح حصة ${group?.subject ?? ""} يوم ${dayLabel(form.date)} — اختارها من الشريط فوق.`);
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      onOpened(form.date);
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="w-5 h-5 nk-brand-text" /> فتح حصة يدوي
          </DialogTitle>
        </DialogHeader>

        {!academics ? <Loading label="جاري تحميل المجموعات..." /> : (
          <div className="space-y-3.5">
            <Field label="المجموعة" required>
              <select
                className={inputCls(false)}
                value={form.groupId}
                onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
              >
                <option value="">اختار المجموعة...</option>
                {academics.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.subject} — {g.grade} {g.name}{g.teacher ? ` · ${g.teacher}` : ""}
                  </option>
                ))}
              </select>
              {group && (
                <p className="text-[11px] text-muted-foreground font-semibold mt-1.5">
                  الحصة {fmt(group.price)} ج · نصيب المدرس {group.teacherPercent}%
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="اليوم" required>
                <input type="date" className={inputCls(false)} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </Field>
              <Field label="القاعة (اختياري)">
                <input className={inputCls(false)} value={form.room} placeholder="القاعة الرئيسية"
                  onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="من" required>
                <input type="time" className={cn(inputCls(false), "nk-num")} value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
              </Field>
              <Field label="إلى" required>
                <input type="time" className={cn(inputCls(false), "nk-num")} value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </Field>
            </div>

            {error && (
              <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={submit} disabled={busy}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2">
                {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
                افتح الحصة
              </button>
              <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultCard({ result, onClose, onComplete, busy, user }: {
  result: ScanResult;
  onClose: () => void;
  onComplete: (opts: { amountEGP: number; method: string; register: boolean; fromBalance?: boolean }) => Promise<{ msg: string | null; txnId: string | null } | null>;
  busy: boolean;
  user: SessionUser;
}) {
  const [step, setStep] = useState<"form" | "done">("form");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [paidTxnId, setPaidTxnId] = useState<string | null>(null);
  const print = usePrint();

  const due = result.amountDue ?? 0; // piastres
  const price = result.price ?? 0; // piastres
  const balPi = result.balance ?? 0; // piastres
  const green = result.status === "GREEN";
  const wizardOpen = green && !!result.session && !result.sessionClosed;
  const attendancePending = wizardOpen && !result.alreadyAttended;
  const hasCredit = balPi > 0; // الطالب ليه رصيد → ينفع ندفع منه

  // auto-close the success card → ready for the next student in the queue
  // (paused when a receipt/whatsapp action is open so the staff can finish)
  const [holdOpen, setHoldOpen] = useState(false);
  useEffect(() => {
    if (step !== "done" || holdOpen) return;
    const t = setTimeout(onClose, 2600);
    return () => clearTimeout(t);
  }, [step, onClose, holdOpen]);

  const amountEGP = parseFloat(normalizeDigits(amount).replace(/,/g, ""));
  const amountPi = isFinite(amountEGP) && amountEGP > 0 ? Math.round(amountEGP * 100) : 0;

  // الجملة الواحدة — اللي واقف على الكاشير يفهم وضع الطالب في ثانية
  const oneLiner = (() => {
    const parts: string[] = [];
    if (balPi < 0) parts.push(`الطالب عليه ${fmt(-balPi)} ج`);
    else if (balPi > 0) parts.push(`الطالب ليه رصيد ${fmt(balPi)} ج`);
    else parts.push("الطالب سدّد كل حاجة");
    if (price > 0) parts.push(`الحصة دي بـ ${fmt(price)} ج`);
    return parts.join(" · ");
  })();

  // remaining = due − paid (after this session's charge is included in `due`)
  const remaining = due - amountPi;

  // فئات جاهزة: سعر الحصة + الفئات الثابتة — دوسة واحدة وخلاص
  const quickAmounts: { label: string; pi: number; primary?: boolean }[] = [];
  if (price > 0) quickAmounts.push({ label: `سعر الحصة ${fmt(price)}`, pi: price, primary: true });
  for (const v of [50, 100, 150, 200]) {
    const pi = v * 100;
    if (pi !== price) quickAmounts.push({ label: String(v), pi });
  }

  // ===== الدوال (معرّفة قبل مستمع الكيبورد — من غير refs) =====
  // طباعة تلقائية للإيصال بعد الدفع (لو مفعّلة في إعدادات المستخدم)
  async function autoPrintReceipt(txnId: string) {
    try {
      const data = await api<ReceiptData>(`/api/receipts?txnId=${txnId}`, { silent: true });
      const fmtMode = user.receiptFormat === "A4" ? "a4" : "thermal";
      print(
        fmtMode === "a4"
          ? <PrintableReceiptA4 data={data} center={user.center} />
          : <PrintableReceiptThermal data={data} center={user.center} />,
        `إيصال ${data.receipt.number} — ${data.center.name}`,
      );
      toast.success("الإيصال جهز للطباعة تلقائيًا 🖨️", { duration: 2500 });
    } catch { /* silent — الزراير اليدوية موجودة تحت */ }
  }

  async function confirm() {
    if (amountPi <= 0) {
      toast.error("اكتب المبلغ اللي الطالب دفعه، أو اختار «مش هيدفع دلوقتي».");
      return;
    }
    const res = await onComplete({
      amountEGP: amountPi / 100,
      method,
      register: false,
    });
    setDoneMsg(res?.msg ?? "تم");
    setPaidTxnId(res?.txnId ?? null);
    setStep("done");
    if (res?.txnId && user.autoPrintReceipt) autoPrintReceipt(res.txnId);
  }

  async function noPayNow() {
    const res = await onComplete({ amountEGP: 0, method: "CASH", register: false });
    setDoneMsg(res?.msg ?? "تم");
    setPaidTxnId(null);
    setStep("done");
  }

  // رجّع الباقي: الطالب دفع أكتر من المطلوب — نرجع له الفرق كاش ونسجل بس المطلوب
  async function returnChange() {
    if (due <= 0) return;
    const res = await onComplete({ amountEGP: due / 100, method, register: false });
    setDoneMsg(res?.msg ?? "تم");
    setPaidTxnId(res?.txnId ?? null);
    setStep("done");
    if (res?.txnId && user.autoPrintReceipt) autoPrintReceipt(res.txnId);
  }

  // دفع من الرصيد: الطالب ليه رصيد → سعر الحصة بيتخصم منه من غير كاش
  async function payFromBalance() {
    const res = await onComplete({ amountEGP: 0, method: "BALANCE", register: false, fromBalance: true });
    setDoneMsg(res?.msg ?? "تم");
    setPaidTxnId(null);
    setStep("done");
  }

  async function registerAndAttend() {
    const res = await onComplete({ amountEGP: 0, method: "CASH", register: true });
    if (res === null) return; // failed — stay on the card
    // registered + attended → continue straight to the payment question
    toast.success(res.msg ?? "تم");
    setAmount("");
    setStep("form");
  }

  // ===== كيبورد سريع في الويزارد =====
  // أرقام 1-9 = الاختصارات الجاهزة (لما مش بيكتب في خانة المبلغ)
  // Enter = تأكيد · Escape = قفل البطاقة (أول مرة بتطلع من الخانة)
  useEffect(() => {
    if (step !== "form" || !wizardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (typing) (el as HTMLInputElement).blur();
        else onClose();
        return;
      }
      if (typing || busy) return;
      if (/^[1-9]$/.test(e.key)) {
        const chip = quickAmounts[parseInt(e.key, 10) - 1];
        if (chip) { e.preventDefault(); setAmount(String(chip.pi / 100)); feedback("tap"); }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (amountPi > 0) confirm();
        else noPayNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (result.status === "RED") {
    return (
      <div className="nk-red rounded-3xl p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl bg-rose-500 text-white grid place-items-center shrink-0"><XCircle className="w-7 h-7" /></span>
          <div>
            <h3 className="font-extrabold text-lg text-rose-700">{result.message}</h3>
            {result.hint && <p className="text-sm text-rose-600 dark:text-rose-300 font-semibold">{result.hint}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          {result.message.includes("النظام") && (user.role === "MANAGER" || user.canAddStudents) && (
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent("nk-navigate", { detail: { view: "students", addNew: true } })); onClose(); }}
              className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 flex items-center gap-2 shadow"
            >
              <UserPlus className="w-5 h-5" /> إضافة طالب
            </button>
          )}
          <button onClick={onClose} className="border border-border bg-card font-bold rounded-xl px-4 py-3">إلغاء</button>
        </div>
      </div>
    );
  }

  const s = result.student!;

  return (
    <div className={cn("rounded-3xl p-5 space-y-4", green ? "nk-green" : "nk-orange")}>
      {/* ===== header ===== */}
      <div className="flex items-start gap-3">
        <span className={cn("w-12 h-12 rounded-2xl grid place-items-center shrink-0 text-white", green ? "bg-emerald-700" : "bg-orange-700")}>
          {green ? <BadgeCheck className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <h3 className="font-extrabold text-lg">{s.name}</h3>
            <Chip className="bg-card border-border">كود <span className="nk-num">{s.code}</span></Chip>
            {s.grade && <Chip className="bg-card border-border">{s.grade}</Chip>}
          </div>
          {result.session && (
            <p className="text-xs text-muted-foreground font-semibold mt-1">
              {result.session.subject} — {result.session.grade} {result.session.groupName}
              {result.session.room ? ` · ${result.session.room}` : ""} · {formatTime12(result.session.startTime)}
            </p>
          )}
        </div>
        <button onClick={onClose} className="rounded-full hover:bg-black/5 p-1.5 text-muted-foreground" aria-label="إغلاق">
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      {result.alreadyAttended && step !== "done" && (
        <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-4.5 h-4.5" /> سجّل حضوره خلاص ({ATTENDANCE_LABEL[result.attendanceStatus ?? "PRESENT"]})
        </p>
      )}

      {/* ===== success card ===== */}
      {step === "done" ? (
        <div className="space-y-3">
          <div className="rounded-2xl bg-white/85 border border-emerald-200 p-4 text-center space-y-1.5">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="font-extrabold text-emerald-700">{doneMsg ?? "تم"}</p>
            <p className="text-sm font-bold text-muted-foreground">
              {result.balance != null && result.balance < 0
                ? `الباقي عليه: ${fmt(-result.balance)} ج`
                : result.balance != null && result.balance > 0
                  ? `له رصيد: ${fmt(result.balance)} ج`
                  : "سدّد كل حاجة"}
            </p>
          </div>

          {/* receipt + whatsapp — after a successful payment */}
          {paidTxnId && (
            <div className="flex gap-2 items-stretch">
              <div className="flex-1 min-w-0" onPointerDown={() => setHoldOpen(true)} onClick={() => setHoldOpen(true)}>
                <ReceiptActions txnId={paidTxnId} center={user.center} size="lg" />
              </div>
              {s.parentPhone && (
                <WhatsAppHandoffButton
                  studentId={s.id}
                  txnId={paidTxnId}
                  template="payment_confirm"
                  onOpen={() => setHoldOpen(true)}
                />
              )}
            </div>
          )}

          <button
            onClick={onClose}
            className="w-full nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] flex items-center justify-center gap-2"
          >
            جاهز للطالب الجاي <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
      ) : green && wizardOpen ? (
        <div className="rounded-2xl bg-white/85 border border-border p-4 space-y-3">
          {/* ===== الجملة الواحدة — وضع الطالب في سطر واحد ===== */}
          <div className={cn(
            "rounded-xl px-3.5 py-3 text-sm font-extrabold border flex items-center gap-2 leading-relaxed",
            balPi < 0
              ? "bg-orange-50 border-orange-200 text-orange-700"
              : balPi > 0
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-muted/60 border-border text-muted-foreground"
          )}>
            <Banknote className="w-4.5 h-4.5 shrink-0" />
            {oneLiner}
          </div>

          {/* ===== title ===== */}
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 nk-brand-text shrink-0" />
            <h4 className="font-extrabold text-base">{attendancePending ? "دفع كام؟ (سعر الحصة دي بس)" : "دفع كام دلوقتي؟"}</h4>
          </div>

          {/* ===== amount input + quick chips ===== */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                dir="ltr"
                inputMode="decimal"
                placeholder="0"
                className="flex-1 h-14 rounded-xl border-2 border-input bg-card px-4 text-2xl font-extrabold text-center nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus:border-[color:var(--c-primary)]"
                value={amount}
                onChange={(e) => setAmount(normalizeDigits(e.target.value).replace(/[^\d.]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
                disabled={busy}
              />
              <span className="font-extrabold text-muted-foreground text-lg">ج</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {quickAmounts.map((q, i) => (
                <QuickChip
                  key={`${q.pi}-${i}`}
                  label={q.label}
                  hotkey={i < 9 ? i + 1 : undefined}
                  onClick={() => setAmount(String(q.pi / 100))}
                  active={amountPi === q.pi}
                  primary={q.primary}
                />
              ))}
            </div>
            <p className="hidden md:block text-[10px] font-bold text-muted-foreground">
              كيبورد سريع: أرقام ١-٥ = الفئات · Enter = تأكيد · Esc = إغلاق
            </p>
          </div>

          {/* ===== طريقة الدفع ===== */}
          <div className="flex rounded-xl border border-input overflow-hidden bg-card h-11">
            {[
              { id: "CASH", label: "كاش", icon: <Banknote className="w-3.5 h-3.5" /> },
              { id: "VODAFONE", label: "فودافون كاش", icon: <Smartphone className="w-3.5 h-3.5" /> },
              { id: "INSTAPAY", label: "انستاباي", icon: <Wallet className="w-3.5 h-3.5" /> },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                className={cn(
                  "flex-1 px-2 text-xs font-extrabold flex items-center justify-center gap-1 transition",
                  method === m.id ? "nk-brand-bg text-white" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          {/* ===== شريط الباقي + الأزرار — ثابت أسفل الشاشة ===== */}
          {/* الأزرار بقت sticky: الكارت طويل → من غير سكرول، مصير الباقي دايمًا قدام الموظف */}
          <div className="sticky bottom-3 z-20 -mx-1 rounded-2xl bg-white/97 backdrop-blur border border-border shadow-[0_-6px_20px_rgba(0,0,0,0.10)] p-2.5 space-y-2 nk-sticky-actions">
            {/* سطر الباقي */}
            {amountPi > 0 && (
              <div className={cn(
                "rounded-xl px-3.5 py-2.5 text-sm font-bold border",
                remaining > 0
                  ? "bg-orange-50 border-orange-200 text-orange-700"
                  : remaining === 0
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-sky-50 border-sky-200 text-sky-700"
              )}>
                {remaining > 0 ? (
                  <>هيخصم اللي دفعه — <b>الباقي عليه {fmt(remaining)} ج</b></>
                ) : remaining === 0 ? (
                  "هيسدّد كل حاجة بالظبط"
                ) : due > 0 ? (
                  <>الطالب دفع {fmt(amountPi)} ج · المطلوب {fmt(due)} ج — <b>الباقي {fmt(-remaining)} ج</b></>
                ) : (
                  <>هيدفع زيادة — <b>هيضاف له رصيد {fmt(-remaining)} ج</b></>
                )}
              </div>
            )}

            {/* actions — لو دفع أكتر: اختار مصير الباقي */}
            <div className="flex flex-col sm:flex-row gap-2">
              {amountPi > due && due > 0 ? (
                <>
                  <button
                    onClick={confirm}
                    disabled={busy}
                    className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <Wallet className="w-5 h-5" />}
                    أضف الباقي للمحفظة ({fmt(amountPi - due)} ج)
                  </button>
                  <button
                    onClick={returnChange}
                    disabled={busy}
                    className="sm:max-w-[220px] border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <Banknote className="w-5 h-5" />
                    رجّع الباقي ({fmt(amountPi - due)} ج)
                  </button>
                </>
              ) : (
                <button
                  onClick={confirm}
                  disabled={busy || amountPi <= 0}
                  className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  {attendancePending ? `حضور + دفع ${fmt(amountPi)} ج` : `تأكيد دفع ${fmt(amountPi)} ج`}
                </button>
              )}
              {hasCredit ? (
                <button
                  onClick={payFromBalance}
                  disabled={busy}
                  className="sm:max-w-[260px] bg-sky-500 text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <Coins className="w-5 h-5" />
                  دفع من رصيده ({fmt(balPi)} ج)
                </button>
              ) : (
                <button
                  onClick={noPayNow}
                  disabled={busy}
                  className="sm:max-w-[200px] border border-border bg-card font-bold rounded-xl px-4 py-3.5 disabled:opacity-60 text-muted-foreground"
                >
                  مش هيدفع دلوقتي
                </button>
              )}
            </div>
          </div>
        </div>
      ) : green && result.session && result.sessionClosed ? (
        <p className="text-xs font-bold text-muted-foreground bg-muted border border-border rounded-xl px-3 py-2 flex items-center gap-1.5">
          <DoorClosed className="w-4 h-4" /> الحصة مقفولة — مفيش تسجيل.
        </p>
      ) : !green ? (
        <div className="space-y-2">
          <div className="rounded-xl bg-white/70 border-2 border-orange-200 px-3.5 py-2.5 text-sm space-y-1">
            <p className="font-extrabold text-orange-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
              الطالب غير مسجل في المجموعة دي.
            </p>
            <p className="font-bold">الطالب مسجل في: {s.subjects.length ? s.subjects.join("، ") : "مفيش مواد"}</p>
            <p className="text-muted-foreground text-xs font-semibold">
              الحصة المطلوبة: {result.session ? `${result.session.subject} — ${result.session.grade} ${result.session.groupName}` : "—"}
            </p>
          </div>
          {result.canRegister && !result.sessionClosed && !result.alreadyAttended && (
            <button
              onClick={registerAndAttend}
              disabled={busy}
              className="w-full bg-orange-700 hover:bg-orange-800 text-white font-extrabold rounded-xl px-4 py-3.5 shadow flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
            >
              <UserPlus className="w-5 h-5" /> سجّله في المجموعة دي + حضور
            </button>
          )}
          <button
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("nk-focus-sessions")); }}
            className="w-full border border-border bg-card font-bold rounded-xl px-4 py-3 text-muted-foreground active:scale-[0.99] transition"
          >
            اختار مجموعة أخرى
          </button>
        </div>
      ) : null}
    </div>
  );
}

function QuickChip({ label, onClick, active, primary, hotkey }: { label: string; onClick: () => void; active?: boolean; primary?: boolean; hotkey?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-bold transition nk-num inline-flex items-center gap-1.5",
        active
          ? "nk-brand-bg text-white border-transparent shadow"
          : primary
            ? "border-[color-mix(in_srgb,var(--c-primary)_50%,white)] bg-[color-mix(in_srgb,var(--c-primary)_10%,white)] nk-brand-text hover:bg-[color-mix(in_srgb,var(--c-primary)_18%,white)]"
            : "border-border bg-card hover:bg-muted"
      )}
    >
      {hotkey && <span className="hidden md:inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-extrabold bg-black/5 text-current leading-none">{hotkey}</span>}
      {label}
    </button>
  );
}

// =====================================================================
// وضع الكشك الذاتي — تابلت على باب السنتر، الطالب يمسح كارته بنفسه
// حضور تلقائي بدون أسئلة دفع (الدفع بيتظبط في الاستقبال)
// =====================================================================

function KioskMode({ sessions, activeSessionId, online, onExit }: {
  sessions: ScanSession[];
  activeSessionId: string | null;
  online: boolean;
  onExit: () => void;
}) {
  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{
    tone: "green" | "orange" | "red";
    title: string;
    sub?: string;
    big?: string;
  } | null>(null);

  // الشاشة مبتقفلش طول ما الكشك شغال
  useWakeLock(true);

  // auto-close النتيجة → جاهز للطالب الجاي
  useEffect(() => {
    if (!card) return;
    const t = setTimeout(() => setCard(null), 3200);
    return () => clearTimeout(t);
  }, [card]);

  async function submit(raw: string) {
    if (!raw.trim() || busy) return;
    if (!session) {
      setCard({ tone: "red", title: "مفيش حصة مفتوحة دلوقتي", sub: "روح للاستقبال" });
      feedback("red");
      return;
    }
    setBusy(true);
    try {
      const res = await api<ScanResult>("/api/attendance/scan", {
        method: "POST",
        body: { query: raw, sessionId: session.id },
      });
      setCode("");
      if (res.status === "RED") {
        feedback("red");
        setCard({ tone: "red", title: res.message, sub: res.hint ?? "روح للاستقبال" });
        return;
      }
      if (res.status === "ORANGE") {
        feedback("orange");
        setCard({
          tone: "orange",
          title: `أهلاً ${res.student?.name ?? ""}`,
          sub: "مش مسجل في المجموعة دي — روح للاستقبال يسجلو",
          big: res.student?.code,
        });
        return;
      }
      // GREEN: سجّل حضور لو لسه
      if (res.alreadyAttended) {
        feedback("orange");
        setCard({ tone: "orange", title: `اتسجل حضورك خلاص ✌️`, sub: res.student?.name, big: res.student?.code });
        return;
      }
      const m = await api<{ balance: number }>("/api/attendance/mark", {
        method: "POST",
        body: { studentId: res.student!.id, sessionId: session!.id, status: "PRESENT" },
      });
      feedback("green");
      setCard({
        tone: "green",
        title: `أهلاً ${res.student?.name} 👋`,
        sub: m.balance < 0 ? `الباقي عليك ${fmt(-m.balance)} ج — ظبّطها في الاستقبال` : "حضورك اتسجل — يوم سعيد!",
        big: res.student?.code,
      });
    } catch {
      feedback("red");
      setCard({ tone: "red", title: "حصل خطأ — جرّب تاني", sub: "لو المشكلة مستمرة روح للاستقبال" });
    } finally {
      setBusy(false);
    }
  }

  // كيبورد رقمي كبير على الشاشة
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"];

  return (
    <div className="fixed inset-0 z-[60] bg-card flex flex-col nk-safe-top" dir="rtl" data-testid="kiosk-mode">
      {/* هيدر الكشك */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b">
        <div className="min-w-0">
          <h2 className="font-extrabold text-lg truncate">مسح كارتك بنفسك</h2>
          <p className="text-xs font-bold text-muted-foreground truncate">
            {session
              ? `${session.subject} — ${session.grade} ${session.groupName} · ${formatTime12(session.startTime)}`
              : "مفيش حصة مختارة"}
          </p>
        </div>
        <button
          onClick={onExit}
          className="shrink-0 rounded-xl border-2 border-border bg-card font-extrabold text-xs px-4 py-2.5 text-muted-foreground hover:text-foreground transition"
        >
          خروج (للموظفين)
        </button>
      </div>

      {!online && (
        <p className="mx-5 mt-4 text-sm font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-center">
          الكشك محتاج نت — استخدم شاشة الاستقبال العادية.
        </p>
      )}

      {/* منطقة الكاميرا */}
      <div className="px-5 pt-4">
        <QrCameraScanner active={online} onScan={submit} />
      </div>

      {/* النتيجة الكبيرة */}
      {card ? (
        <div
          className={cn(
            "nk-kiosk-result flex-1 mx-5 my-4 rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-3 border-2",
            card.tone === "green" && "bg-emerald-50 border-emerald-300",
            card.tone === "orange" && "bg-orange-50 border-orange-300",
            card.tone === "red" && "bg-rose-50 border-rose-300",
          )}
        >
          {card.big && <p className="nk-num font-extrabold text-5xl tracking-widest" dir="ltr">{card.big}</p>}
          <p className={cn(
            "font-extrabold text-2xl md:text-3xl leading-relaxed",
            card.tone === "green" && "text-emerald-700",
            card.tone === "orange" && "text-orange-700",
            card.tone === "red" && "text-rose-700",
          )}>
            {card.title}
          </p>
          {card.sub && <p className="font-bold text-base text-muted-foreground">{card.sub}</p>}
        </div>
      ) : (
        /* إدخال الكود بالكيبورد الرقمي */
        <div className="flex-1 flex flex-col items-center justify-center px-5 gap-4">
          <div
            className={cn(
              "w-full max-w-xs h-16 rounded-2xl border-2 grid place-items-center font-extrabold text-3xl tracking-[0.4em] nk-num",
              code ? "border-[color:var(--c-primary)] text-foreground" : "border-dashed border-border text-muted-foreground",
            )}
            dir="ltr"
          >
            {code || "•••••"}
          </div>
          <div className="grid grid-cols-3 gap-2.5 w-full max-w-xs">
            {keys.map((k) => (
              <button
                key={k}
                disabled={!online || busy}
                onClick={() => {
                  feedback("tap");
                  if (k === "back") setCode((c) => c.slice(0, -1));
                  else if (k === "ok") submit(code);
                  else if (code.length < 5) {
                    const next = code + k;
                    setCode(next);
                    // كود 5 أرقام كامل → إرسال تلقائي
                    if (next.length === 5) setTimeout(() => submit(next), 250);
                  }
                }}
                className={cn(
                  "h-16 rounded-2xl font-extrabold text-2xl transition active:scale-95 disabled:opacity-40",
                  k === "ok"
                    ? "nk-brand-bg text-white shadow"
                    : k === "back"
                      ? "bg-muted text-muted-foreground"
                      : "bg-card border-2 border-border text-foreground hover:bg-muted/50",
                )}
                aria-label={k === "ok" ? "تأكيد" : k === "back" ? "مسح" : k}
              >
                {k === "ok" ? "دخول" : k === "back" ? "⌫" : k}
              </button>
            ))}
          </div>
          <p className="text-xs font-bold text-muted-foreground text-center">
            امسح الـ QR بكاميرا التابلت — أو اكتب كودك (5 أرقام)
          </p>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// تسجيل سريع لطالب جديد من داخل شاشة الحضور — من غير ما تخرج من اللوب
// =====================================================================

function QuickRegisterDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (st: { id: string; code: string; name: string }) => void;
}) {
  const [academics, setAcademics] = useState<{
    grades: { id: string; name: string }[];
    groups: { id: string; name: string; subject: string; grade: string; gradeId: string }[];
  } | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", parentName: "", parentPhone: "", gradeId: "", groupIds: [] as string[] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof academics>("/api/academics").then(setAcademics).catch(() => {});
  }, []);

  useEffect(() => {
    if (academics && !form.gradeId) {
      setForm((f) => ({ ...f, gradeId: academics.grades[0]?.id ?? "" }));
    }
  }, [academics]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredGroups = academics?.groups.filter((g) => !form.gradeId || g.gradeId === form.gradeId) ?? [];

  async function save() {
    setBusy(true);
    try {
      const res = await api<{ student: { id: string; code: string; name: string } }>("/api/students", {
        method: "POST",
        body: form,
      });
      onCreated(res.student);
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  const inputCls = "w-full h-12 rounded-xl border-2 border-input bg-card px-3.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus:border-[color:var(--c-primary)]";

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-card w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto nk-scroll"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 nk-brand-text" /> تسجيل طالب جديد
          </h3>
          <button onClick={onClose} className="rounded-full hover:bg-muted p-2 text-muted-foreground" aria-label="إغلاق">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs font-bold text-muted-foreground bg-muted/60 rounded-xl px-3 py-2">
          الطالب واقف قدامك؟ سجّله هنا وكمّل حضوره على طول — الكود بيتولد أوتوماتيك.
        </p>

        {!academics ? (
          <Loading label="جاري تحميل المراحل والمجموعات..." />
        ) : (
          <div className="space-y-3">
            <input
              className={inputCls}
              placeholder="اسم الطالب (3 أسماء)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className={inputCls}
                placeholder="موبايل الطالب"
                inputMode="tel"
                dir="ltr"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <input
                className={inputCls}
                placeholder="موبايل ولي الأمر"
                inputMode="tel"
                dir="ltr"
                value={form.parentPhone}
                onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
              />
            </div>
            <input
              className={inputCls}
              placeholder="اسم ولي الأمر"
              value={form.parentName}
              onChange={(e) => setForm({ ...form, parentName: e.target.value })}
            />
            <select
              className={inputCls}
              value={form.gradeId}
              onChange={(e) => setForm({ ...form, gradeId: e.target.value, groupIds: [] })}
            >
              {academics.grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>

            {filteredGroups.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-extrabold text-muted-foreground">المجموعات (اختار اللي هو مشترك فيها):</p>
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto nk-scroll p-1">
                  {filteredGroups.map((g) => {
                    const on = form.groupIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setForm((f) => ({
                          ...f,
                          groupIds: on ? f.groupIds.filter((x) => x !== g.id) : [...f.groupIds, g.id],
                        }))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-bold transition",
                          on ? "nk-brand-bg text-white border-transparent shadow" : "border-border bg-card hover:bg-muted"
                        )}
                      >
                        {g.subject} — {g.grade} {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={save}
              disabled={busy}
              className="w-full nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <UserPlus className="w-5 h-5" />}
              سجّله وافتح كارته
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// PaymentPanel — kept for the student profile & payments views
// =====================================================================

export function PaymentPanel({ studentId, studentName, sessionId, suggestedDue, onPaid, compact, user }: {
  studentId: string; studentName: string; sessionId?: string; suggestedDue: number;
  onPaid: (msg: string, balance: number) => void; compact?: boolean; user?: SessionUser;
}) {
  const [amount, setAmount] = useState(suggestedDue > 0 ? String(suggestedDue / 100) : "");
  const [method, setMethod] = useState("CASH");
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [paidTxnId, setPaidTxnId] = useState<string | null>(null);
  const print = usePrint();

  // طالب جديد → reset كامل. تغيّر المطلوب بس (بعد دفعة مثلاً) → حدّث خانة
  // المبلغ من غير ما نمسح رسالة النجاح وزراير طباعة الإيصال.
  useEffect(() => {
    setAmount(suggestedDue > 0 ? String(suggestedDue / 100) : "");
    setResultMsg(null);
    setPaidTxnId(null);
  }, [studentId]);

  useEffect(() => {
    if (resultMsg) return; // سيب بطاقة النجاح + الطباعة ظاهرين بعد الدفع
    setAmount(suggestedDue > 0 ? String(suggestedDue / 100) : "");
  }, [suggestedDue]);

  async function payExact() {
    // تسديد المطلوب بالظبط — الباقي بيرجع للطالب كاش بره السistema
    const val = parseFloat(normalizeDigits(amount).replace(/,/g, ""));
    if (!isFinite(val) || val <= 0) {
      toast.error("اكتب المبلغ اللي الطالب دفعه.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ message: string; balance: number; txn: { id: string } }>("/api/payments", {
        method: "POST",
        body: { studentId, amount: val, method, sessionId, type: "PAYMENT" },
      });
      setResultMsg(res.message);
      setPaidTxnId(res.txn?.id ?? null);
      onPaid(res.message, res.balance);
      setAmount("");
      feedback("success");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حصل خطأ في التسديد.");
      feedback("red");
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    const val = parseFloat(normalizeDigits(amount).replace(/,/g, ""));
    if (!isFinite(val) || val <= 0) {
      toast.error("اكتب المبلغ اللي الطالب دفعه.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ message: string; balance: number; txn: { id: string } }>("/api/payments", {
        method: "POST",
        body: { studentId, amount: val, method, sessionId, type: "PAYMENT" },
      });
      setResultMsg(res.message);
      setPaidTxnId(res.txn?.id ?? null);
      onPaid(res.message, res.balance);
      setAmount("");
      feedback("success");
      // طباعة تلقائية لو مفعّلة
      if (res.txn?.id && user?.autoPrintReceipt) {
        try {
          const data = await api<ReceiptData>(`/api/receipts?txnId=${res.txn.id}`, { silent: true });
          print(
            user.receiptFormat === "A4"
              ? <PrintableReceiptA4 data={data} center={user.center} />
              : <PrintableReceiptThermal data={data} center={user.center} />,
            `إيصال ${data.receipt.number} — ${data.center.name}`,
          );
          toast.success("الإيصال جهز للطباعة تلقائيًا 🖨️", { duration: 2500 });
        } catch { /* silent */ }
      }
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <div className={cn("rounded-2xl bg-white/85 border border-border p-4 space-y-3", compact ? "" : "shadow-sm")}>
      <div className="flex items-center gap-2 flex-wrap">
        <Banknote className="w-4.5 h-4.5 nk-brand-text" />
        <h4 className="font-extrabold text-sm">دفع — {studentName}</h4>
        {suggestedDue > 0 && <Chip className="bg-rose-50 border-rose-200 text-rose-700">عليه: {fmt(suggestedDue)} ج</Chip>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          dir="ltr"
          inputMode="decimal"
          placeholder="0"
          className="flex-1 min-w-[120px] h-12 rounded-xl border-2 border-input bg-card px-4 text-lg font-extrabold text-center nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus:border-[color:var(--c-primary)]"
          value={amount}
          onChange={(e) => setAmount(normalizeDigits(e.target.value).replace(/[^\d.]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); pay(); } }}
          disabled={busy}
        />
        <div className="flex rounded-xl border border-input overflow-hidden bg-card h-12">
          {[
            { id: "CASH", label: "كاش" },
            { id: "VODAFONE", label: "فودافون كاش" },
            { id: "INSTAPAY", label: "انستاباي" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              className={cn("px-3 text-xs font-extrabold transition", method === m.id ? "nk-brand-bg text-white" : "text-muted-foreground hover:bg-muted")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {/* فئات جاهزة — دوسة واحدة: المطلوب + الفئات الثابتة */}
      <div className="flex flex-wrap gap-2">
        {suggestedDue > 0 && (
          <button type="button" onClick={() => setAmount(String(suggestedDue / 100))}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-extrabold nk-num transition",
              amount === String(suggestedDue / 100)
                ? "nk-brand-bg text-white border-transparent"
                : "border-[color-mix(in_srgb,var(--c-primary)_50%,white)] bg-[color-mix(in_srgb,var(--c-primary)_10%,white)] nk-brand-text"
            )}>
            المطلوب {fmt(suggestedDue)}
          </button>
        )}
        {[50, 100, 150, 200].map((v) => (
          <button key={v} type="button" onClick={() => setAmount(String(v))}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-extrabold nk-num transition",
              amount === String(v) ? "nk-brand-bg text-white border-transparent" : "border-border bg-card hover:bg-muted"
            )}>
            {v}
          </button>
        ))}
      </div>
      {/* المبلغ أكبر من المطلوب → مصير الباقي بضغطة واحدة */}
      {(() => {
        const val = parseFloat(normalizeDigits(amount).replace(/,/g, ""));
        const amountPi = isFinite(val) && val > 0 ? Math.round(val * 100) : 0;
        const overpay = amountPi - suggestedDue;
        if (amountPi > 0 && suggestedDue > 0 && overpay > 0) {
          return (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={pay}
                disabled={busy}
                className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <Wallet className="w-5 h-5" />}
                أضف الباقي للمحفظة ({fmt(overpay)} ج)
              </button>
              <button
                onClick={payExact}
                disabled={busy}
                className="sm:max-w-[210px] border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-3.5 active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Banknote className="w-5 h-5" />
                رجّع الباقي ({fmt(overpay)} ج)
              </button>
            </div>
          );
        }
        return (
          <button
            onClick={pay}
            disabled={busy}
            className="w-full nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3.5 shadow active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <Banknote className="w-5 h-5" />}
            تم الدفع
          </button>
        );
      })()}
      {resultMsg && (
        <div className="space-y-2.5">
          <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="w-4.5 h-4.5 shrink-0" /> {resultMsg}
          </p>
          {paidTxnId && user && (
            <div className="flex gap-2 items-stretch">
              <ReceiptActions txnId={paidTxnId} center={user.center} />
              <WhatsAppHandoffButton studentId={studentId} txnId={paidTxnId} template="payment_confirm" size="sm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

