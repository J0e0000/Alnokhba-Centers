"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Keyboard, ScanLine, ListChecks, Loader2, Zap, CameraOff, CheckCircle2,
  AlertTriangle, XCircle, Clock3, Undo2, Volume2, VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, normalizeDigits, formatTime12, ATTENDANCE_LABEL, type SessionUser } from "./lib";
import { useCaps } from "./caps";
import { QrCameraScanner } from "./qr-scanner";
import { feedback, unlockAudio, useFeedbackSettings, useWakeLock } from "./feedback";
import { useOnlineStatus } from "./pwa";

/* ============================================================
   لوحة الحضور الموحدة — النموذج الرابع المعتمد (ميكس ٢+٣)
   ------------------------------------------------------------
   تابت واحدة فيها 3 طرق: كتابة كود · سكان · ضغطة اسم.
   حتى لو أكتر من حصة شغالة: بمجرد كتابة الكود الطالب
   «بيلاقي علطول مجموعته» (autoRoute على السيرفر) — من غير
   ما الموظف يختار حصة الأول.
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

type FeedItem = { name: string; note: string; at: string };

const CAMERA_IDLE_MS = 45_000;

export function UnifiedAttendancePanel({ user }: { user: SessionUser }) {
  const caps = useCaps();
  const { sound, vibrateOn, toggleSound, toggleVibrate } = useFeedbackSettings();
  const [mode, setMode] = useState<"code" | "scan" | "name">("code");
  const [sessions, setSessions] = useState<PanelSess[]>([]);
  const [res, setRes] = useState<UARes | null>(null);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [query, setQuery] = useState("");
  const [nameMatches, setNameMatches] = useState<{ id: string; code: string; name: string; grade: string | null }[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [rosters, setRosters] = useState<Record<string, RosterRow[]>>({});
  const [rosterLoading, setRosterLoading] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  const lastActivityRef = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const online = useOnlineStatus();
  const nameCap = caps.name_attendance.enabled; // كتابة كود + ضغطة اسم = NAME
  const qrCap = caps.static_qr.enabled;         // سكان كارت الطالب = STATIC_QR
  const lateCap = caps.late_checkin.enabled;

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

  // ===== التوجيه التلقائي — قلب اللوحة =====
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
      setRes(r);
      setQuery("");
      feedback(r.status === "GREEN" ? (r.alreadyAttended ? "orange" : "green") : r.status === "ORANGE" ? "orange" : "red");
    } catch (e) {
      feedback("red");
      toast.error(e instanceof Error ? e.message : "المسح مش معروف — جرب تاني.");
    } finally { setBusy(false); }
  }, [online]);
  useEffect(() => { resolveRef.current = resolve; }, [resolve]);

  // كارت النتيجة يظهر مرئي فورًا — بيتمركز في الشاشة (فوق الشريط العايم والروبوت)
  useEffect(() => {
    if (res) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [res]);

  // ===== تسجيل حضور (قلب التسجيل للطرق التلاتة) =====
  // OPTIMISTIC: الضغطة بتقلّب الصف في الكشف في نفس اللحظة — الطلب بيمشي للسيرفر في الخلفية
  // ولو فشل الصف بيرجع زي ما كان + رسالة غلط. (طلب المالك: «لو دوست حضور يشجل لحظيا»)
  const doMark = useCallback(async (opts: {
    studentId: string; sessionId: string; status?: "PRESENT" | "LATE";
    display: string; sessLabel: string; method?: "MANUAL" | "QR_SCAN";
    rosterSessionId?: string;
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
      const m = await api<{ alreadyAttended: boolean; charged: number | null; balance: number; amountDue: number }>("/api/attendance/mark", {
        method: "POST",
        body: { studentId: opts.studentId, sessionId: opts.sessionId, status: opts.status ?? "PRESENT", method: opts.method ?? "MANUAL" },
      });
      const note = m.alreadyAttended
        ? "متسجل من قبل"
        : `${opts.status === "LATE" ? "متأخر" : "حاضر"} · ${opts.sessLabel}${m.charged ? ` · اتحسب ${fmt(m.charged)} ج` : ""}`;
      setFeed((f) => [{ name: opts.display, note, at: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) }, ...f].slice(0, 10));
      if (!m.alreadyAttended) feedback("green"); else feedback("orange");
      // تحديث الكارت لو هو نفس الطالب — التسجيل نجح فهو بقى «متسجل» في الحالتين
      // (الاستجابة alreadyAttended=false معناها إن الندة دي هي اللي سجلته)
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
  }, [marking, loadSessions, rosters]);

  // ===== سكان الكاميرا =====
  const onScan = useCallback(async (q: string) => {
    if (!qrCap) return;
    if (!online) { toast.error("أنت أوفلاين — استخدم «وضع الحصة المحددة» تحت."); return; }
    setBusy(true);
    try {
      const r = await api<UARes>("/api/attendance/scan", { method: "POST", body: { query: q, autoRoute: true } });
      setRes(r);
      feedback(r.status === "GREEN" ? (r.alreadyAttended ? "orange" : "green") : r.status === "ORANGE" ? "orange" : "red");
    } catch (e) {
      feedback("red");
      toast.error(e instanceof Error ? e.message : "المسح مش معروف — جرب تاني.");
    } finally { setBusy(false); }
  }, [qrCap, online]);

  // ===== كشف الحصة في وضع الاسم (تحميل كسول) =====
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

  const modeBtns: { k: typeof mode; label: string; icon: typeof Keyboard; ok: boolean; offMsg: string }[] = [
    { k: "code", label: "كتابة كود", icon: Keyboard, ok: nameCap, offMsg: "كتابة الكود مقفولة في المركز — كلّم المدير يفعّل «حضور بالاسم»." },
    { k: "scan", label: "سكان", icon: ScanLine, ok: qrCap, offMsg: "سكان كروت الطلاب مقفول في المركز — كلّم المدير." },
    { k: "name", label: "ضغطة اسم", icon: ListChecks, ok: nameCap, offMsg: "الحضور بالاسم مقفول في المركز — كلّم المدير." },
  ];

  return (
    <div className="nk2-card !p-0 overflow-hidden" data-testid="unified-attendance">
      {/* ===== راس اللوحة: العنوان + الصوت/الاهتزاز ===== */}
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
                  اكتب كود الطالب واضغط Enter — لو حصته شغالة هيتسجل فورًا، ولو لأ هنقولك حالته.
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
                <span className="text-[11px] font-bold text-muted-foreground">النظام هيسجله في مجموعته لوحده</span>
              </button>
            )}
          </div>
        )}

        {/* ---------- وضع الضغطة بالاسم ---------- */}
        {mode === "name" && (
          <div>
            {!nameCap ? (
              <CapOff msg="الحضور بالاسم محتاج تفعيل «حضور بالاسم» من إعدادات المركز." />
            ) : openSessions.length === 0 ? (
              <CapOff warn msg="مفيش حصة مفتوحة دلوقتي — افتح الحصة من «حصص النهاردة» تحت، وافتح الكشوف هنا فورًا." />
            ) : (
              <div className="grid gap-3">
                {openSessions.map((s) => {
                  const rows = rosters[s.id];
                  const loading = !!rosterLoading[s.id];
                  const presentN = rows ? rows.filter((r) => r.status !== null).length : s.attendanceCount;
                  return (
                    <div key={s.id} className="rounded-2xl border border-border bg-card overflow-hidden min-w-0" data-testid={`ua-roster-${s.id}`}>
                      <button type="button" onClick={() => loadRoster(s.id)}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-3 hover:bg-muted/40 transition text-start">
                        <div className="min-w-0">
                          <b className="block text-[13.5px] font-extrabold truncate">{s.subject} · {s.grade} {s.groupName}</b>
                          <span className="block text-[11px] font-bold text-muted-foreground">{formatTime12(s.startTime)}{s.room ? ` · ${s.room}` : ""} · {presentN}{rows ? ` / ${rows.length}` : ""} حاضر</span>
                        </div>
                        {rows ? <CheckCircle2 className="w-5 h-5 text-muted-foreground/50 shrink-0" /> : loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" /> : <ListChecks className="w-5 h-5 nk-brand-text shrink-0" />}
                      </button>
                      {rows && (
                        <div className="border-t border-border grid gap-1 p-1.5 max-h-[340px] overflow-y-auto nk-scroll">
                          {rows.map((r) => {
                            const key = `${s.id}:${r.studentId}`;
                            const isMarking = !!marking[key];
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
                                      <button type="button" title="مسح الرصد" disabled={isMarking}
                                        onClick={async () => {
                                          // OPTIMISTIC: العلامة تختفي فورًا — لو فشل السيرفر بترجع زي ما كانت
                                          const snapshotRow = r;
                                          setRosters((rs) => ({ ...rs, [s.id]: (rs[s.id] ?? []).map((x) => x.studentId === r.studentId ? { ...x, status: null, attId: null, charged: null } : x) }));
                                          try {
                                            await api(`/api/attendance/mark?attendanceId=${r.attId}`, { method: "DELETE" });
                                            setFeed((f) => [{ name: r.name, note: "اتشال العلامة", at: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) }, ...f].slice(0, 10));
                                            loadSessions();
                                          } catch (e) {
                                            setRosters((rs) => ({ ...rs, [s.id]: (rs[s.id] ?? []).map((x) => x.studentId === snapshotRow.studentId ? { ...x, status: snapshotRow.status, attId: snapshotRow.attId, charged: snapshotRow.charged } : x) }));
                                            toast.error(e instanceof Error ? e.message : "مش كده.");
                                          }
                                        }}
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
                                          onClick={() => doMark({ studentId: r.studentId, sessionId: s.id, status: "PRESENT", display: r.name, sessLabel: `${s.subject} ${s.groupName}`, rosterSessionId: s.id })}
                                          className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold bg-[var(--nk-ok-bg)] text-[var(--nk-ok-strong)] border border-[var(--nk-ok-border)] transition active:scale-95">
                                          حاضر
                                        </button>
                                        {lateCap && (
                                          <button type="button"
                                            onClick={() => doMark({ studentId: r.studentId, sessionId: s.id, status: "LATE", display: r.name, sessLabel: `${s.subject} ${s.groupName}`, rosterSessionId: s.id })}
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
                          {rows.length === 0 && <p className="text-center py-4 text-xs font-bold text-muted-foreground m-0">الكشف فاضي — المجموعة دي مفيهاش طلاب نشطين.</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== كارت النتيجة — «🎯 راح مجموعته» — بيتوسّط في الشاشة أوتوماتيك ===== */}
        <div ref={resultRef}>
          {res && (
            <ResultCardUA
              res={res}
              busy={busy}
              lateCap={lateCap}
              canRegister={!!res.canRegister}
              onMark={(status) => res.student && res.session && doMark({
                studentId: res.student.id, sessionId: res.session.id, status,
                display: res.student.name, sessLabel: `${res.session.subject} ${res.session.groupName}`,
              })}
              onClose={() => setRes(null)}
              onRetry={(code) => resolve(code)}
            />
          )}
        </div>

        {/* ===== آخر التسجيلات ===== */}
        {feed.length > 0 && (
          <div className="mt-3.5 rounded-2xl border border-border bg-card p-3">
            <p className="text-[11px] font-extrabold text-muted-foreground m-0 mb-1.5 flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5" /> آخر التسجيلات
            </p>
            <ul className="divide-y m-0 p-0 list-none">
              {feed.slice(0, 5).map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="font-extrabold text-[12.5px] truncate min-w-0">{f.name}</span>
                  <span className="text-[11px] text-muted-foreground font-bold shrink-0">{f.note} · {f.at}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==================== كارت النتيجة ==================== */
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
