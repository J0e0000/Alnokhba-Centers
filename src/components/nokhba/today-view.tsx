"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarClock, LockOpen, Loader2, Zap, PlayCircle, Ban, DoorClosed,
  Printer, ClipboardCheck, ScanLine, LogIn, CheckCircle2, Plus, Users, Globe2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, DAY_TABS, type SessionUser } from "./lib";
import { PageHeader, SectionCard, EmptyState, Loading } from "./shared";
import { usePrint, PrintableDaySchedule, type DayScheduleHall } from "./print";
import { ActionSquare, ActionPill } from "./action-button";
import { useCaps } from "./caps";
import { CombiningQrScanner } from "./qr-scanner-combining";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ViewId } from "./shell";

/* ============================================================
   تاب «اليوم» — العمليات بتاعة النهاردة بس:
   حصص النهاردة بحالاتها وإجراءاتها الواضحة + مسح الحضور
   + طباعة جدول القاعات + الموافقات المحتاجة
   الحالات: جاية · شغالة · خلصت · ملغاة — ولكل حالة إجراء واحد واضح
============================================================ */

type SessionCard = {
  id: string; startTime: string; endTime: string; room: string | null; status: string;
  subject: string; grade: string; groupName: string; teacher: string; price: number;
  presentCount: number; openedAt: string | null;
  studentSource?: string; studentCodeLength?: number | null;
  closedAggregates: { totalRevenue: number; teacherShare: number; centerShare: number; presentCount: number } | null;
};

type PlannedSession = {
  scheduleId: string; startTime: string; endTime: string; room: string | null;
  subject: string; grade: string; groupName: string; teacher: string; price: number;
  students: number;
};

type SessionsData = {
  date: string;
  sessions: SessionCard[];
  suggestions: PlannedSession[];
};

type Slot = {
  id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null;
  groupName: string; subject: string; grade: string; teacher: string; students: number;
};

export function TodayView({ user, setView, openSession, goScanForSession }: {
  user: SessionUser;
  setView: (v: ViewId) => void;
  openSession: (id: string) => void;
  goScanForSession: (id: string) => void;
}) {
  const [data, setData] = useState<SessionsData | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const caps = useCaps();
  const printSheet = usePrint();

  const load = useCallback(() => {
    api<SessionsData>("/api/sessions").then(setData).catch(() => {});
    // مواعيد الجدول الأسبوعي للنهاردة — لطباعة جدول القاعات
    api<{ days: { dayOfWeek: number; slots: Slot[] }[] }>("/api/schedule")
      .then((d) => {
        const dow = new Date().getDay();
        setSlots(d.days.find((x) => x.dayOfWeek === dow)?.slots ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const onChange = () => load();
    window.addEventListener("nk-sessions-changed", onChange);
    return () => { clearInterval(t); window.removeEventListener("nk-sessions-changed", onChange); };
  }, [load]);

  if (!data) return <Loading />;

  async function openPlanned(scheduleId: string) {
    setOpening(scheduleId);
    try {
      const res = await api<{ session: { id: string }; teacherAutoAttendance: { teacherName: string } | null }>("/api/sessions", { method: "POST", body: { scheduleId } });
      toast.success("الحصة فتحت خلاص 🟢 — جاهز للمسح");
      // حضور المدرس التلقائي — بدء الحصة = تسجيل المدرس حاضر
      if (res.teacherAutoAttendance) {
        toast.success(`حضور المدرس اتسجل تلقائيًا — ${res.teacherAutoAttendance.teacherName} ✅`, { duration: 5000 });
      }
      window.dispatchEvent(new CustomEvent("nk-sessions-changed"));
      openSession(res.session.id);
    } catch { /* toast */ } finally { setOpening(null); }
  }

  // طباعة جدول قاعات النهاردة (A4 RTL — نفس نظام الطباعة الموجود)
  function printDaySchedule() {
    const dow = new Date().getDay();
    const dayLabel = DAY_TABS.find((d) => d.dow === dow)?.label ?? "";
    const hallMap = new Map<string, Slot[]>();
    for (const s of slots) {
      const key = s.room ?? "بدون قاعة";
      if (!hallMap.has(key)) hallMap.set(key, []);
      hallMap.get(key)!.push(s);
    }
    const halls: DayScheduleHall[] = [...hallMap.entries()].map(([name, roomSlots]) => ({
      name,
      capacity: null,
      slots: roomSlots.map((s) => ({
        startTime: s.startTime, endTime: s.endTime, subject: s.subject, grade: s.grade,
        groupName: s.groupName, teacher: s.teacher, students: s.students,
      })),
    }));
    printSheet(
      <PrintableDaySchedule
        dayLabel={dayLabel}
        dateStr={new Date().toLocaleDateString("ar-EG")}
        halls={halls}
        center={user.center}
      />,
      `جدول ${dayLabel} — القاعات`,
    );
  }

  const live = data.sessions.filter((s) => s.status === "OPEN");
  const isManager = user.role === "MANAGER";
  const isStaff = user.role === "MANAGER" || user.role === "RECEPTIONIST";
  // التكيف مع قدرات المركز: شاشة المسح بتظهر لو فيها طريقة شغالة على الأقل
  const scanScreenAvailable = caps.static_qr.enabled || caps.name_attendance.enabled;
  // حضور الموظفين الذاتي — لو الميزة مفعّلة والموظف معندوش حضور النهاردة (بيتحدد بالسيرفر)
  const canSelfCheckin = isStaff && caps.staff_qr_checkin.enabled;

  return (
    <div className="space-y-5 nk-anim-stagger">
      <PageHeader
        title="يوم كامل في مكان واحد"
        subtitle={`${data.date} — ${data.sessions.length + data.suggestions.length} حصة`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNewOpen(true)}
              className="nk-brand-bg text-white rounded-xl px-3.5 py-2.5 font-extrabold text-xs flex items-center gap-1.5 shadow active:scale-[0.98] transition"
            >
              <Plus className="w-4 h-4" />
              حصة جديدة
            </button>
            <button
              onClick={printDaySchedule}
              className="rounded-xl border-2 border-border bg-card px-3.5 py-2.5 font-extrabold text-xs flex items-center gap-1.5 hover:border-[color-mix(in_srgb,var(--c-primary)_35%,white)] transition"
            >
              <Printer className="w-4 h-4" />
              طباعة جدول القاعات
            </button>
          </div>
        }
      />

      {/* CTA المسح — أهم إجراء تشغيلي في اليوم (مخفي لو مفيش طرق مسح مفعّلة) */}
      {scanScreenAvailable && (
      <button
        onClick={() => setView("scan")}
        className="w-full nk-brand-grad nk-portal-card rounded-2xl p-4 text-white flex items-center gap-3.5 shadow-lg active:scale-[0.99] transition"
      >
        <span className="rounded-xl bg-white/20 p-2.5"><ScanLine className="w-6 h-6" /></span>
        <span className="flex-1 text-start">
          <span className="block font-extrabold text-[15px]">امسح حضور</span>
          <span className="block text-[11px] opacity-90 font-semibold">QR أو كود الطالب — تسجيل فوري ومحسوب</span>
        </span>
        {live.length > 0 && (
          <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-extrabold">{live.length} حصة شغالة</span>
        )}
      </button>
      )}

      {/* حضور الموظف الذاتي — امسح كود شاشة المركز (لو الميزة مفعّلة) */}
      {canSelfCheckin && (
        <div className="nk-card rounded-2xl p-4 flex items-center gap-3.5">
          <span className="rounded-xl p-2.5 nk-brand-bg-soft nk-brand-text"><LogIn className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-sm">تسجيل حضورك</p>
            <p className="text-[11px] font-bold text-muted-foreground">امسح كود شاشة المركز — مرة واحدة في اليوم</p>
          </div>
          <ActionSquare icon={<ScanLine className="w-5 h-5" />} label="امسح" variant="primary" size="sm" onClick={() => setCheckinOpen(true)} tooltip="فتح ماسح كود حضور الموظفين" />
        </div>
      )}

      {/* ===== حصص النهاردة بحالاتها ===== */}
      <SectionCard title="حصص النهاردة" icon={<CalendarClock className="w-4 h-4" />}>
        {data.sessions.length === 0 && data.suggestions.length === 0 ? (
          <EmptyState icon={<CalendarClock className="w-8 h-8" />} title="مفيش حصص النهاردة" hint="ضيف حصة من تاب الحصص ← الجداول." />
        ) : (
          <div className="space-y-3">
            {data.sessions.map((s) => {
              const cancelled = s.status === "CANCELLED";
              const closed = s.status === "CLOSED";
              const isOpen = s.status === "OPEN";
              return (
                <div key={s.id} className={cn(
                  "rounded-2xl border p-4 flex items-center gap-3.5 transition",
                  isOpen ? "border-emerald-300 bg-emerald-50/70" :
                  cancelled ? "border-rose-200 bg-rose-50/40 opacity-75" :
                  closed ? "border-border bg-muted/40 opacity-80" : "border-border bg-card",
                )}>
                  <button onClick={() => !cancelled && openSession(s.id)} disabled={cancelled} className={cn("flex-1 min-w-0 text-start", cancelled && "cursor-default")}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("nk-num text-center rounded-xl py-1.5 px-2.5 text-sm font-extrabold border", isOpen ? "bg-emerald-600 text-white border-transparent" : "bg-card border-border")} dir="ltr">
                        {formatTime12(s.startTime)}
                      </span>
                      <span className="font-extrabold text-[15px]">{s.subject}{s.grade !== "—" ? ` — ${s.grade} ${s.groupName}` : ""}</span>
                      {/* مصدر الطلاب — شارة واضحة (spec §8): مفتوحة = من غير كشف */}
                      {s.studentSource === "OPEN" ? <StatusChip tone="blue"><Globe2 className="w-3 h-3 inline" /> مفتوحة</StatusChip> : null}
                      {isOpen && <StatusChip tone="green">شغالة 🟢</StatusChip>}
                      {closed && <StatusChip tone="muted"><DoorClosed className="w-3 h-3 inline" /> خلصت</StatusChip>}
                      {cancelled && <StatusChip tone="red"><Ban className="w-3 h-3 inline" /> ملغاة</StatusChip>}
                    </div>
                    <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      {s.studentSource === "OPEN" ? (
                        // الحضور المفتوح: العدد المسجل هو كل المعلومة — مفيش غياب ولا حسابات (spec §15)
                        <span className="nk-num">اتسجل {s.presentCount}{s.studentCodeLength ? ` · كود ${s.studentCodeLength} أرقام` : ""}</span>
                      ) : (
                        <>
                          <span>{s.teacher}</span>
                          <span className="nk-num">{fmt(s.price)} ج · حضر {s.presentCount}</span>
                        </>
                      )}
                      {s.room && <span className="nk-brand-text font-extrabold">{s.room}</span>}
                      {closed && s.studentSource !== "OPEN" && s.closedAggregates && (
                        <span className="nk-num text-emerald-700 dark:text-emerald-300 font-extrabold">إيراد {fmt(s.closedAggregates.totalRevenue)} ج</span>
                      )}
                    </p>
                  </button>
                  {/* الإجراء الواضح لكل حالة — هرمية: أساسي واضح + ثانوي هادي */}
                  {isOpen && (
                    <div className="shrink-0 flex items-center gap-2">
                      <ActionPill icon={<PlayCircle className="w-4 h-4" />} label="متابعة" onClick={() => openSession(s.id)} tooltip="فتح شاشة الحصة الحية" />
                      {scanScreenAvailable && (
                        <ActionSquare icon={<Zap className="w-5 h-5" />} label="امسح" variant="primary" size="sm" onClick={() => goScanForSession(s.id)} tooltip="مسح حضور الحصة دي" />
                      )}
                    </div>
                  )}
                  {closed && (
                    <ActionPill icon={<ClipboardCheck className="w-4 h-4" />} label={s.studentSource === "OPEN" ? "النتائج + CSV" : "عرض النتائج"} onClick={() => openSession(s.id)} tooltip="مراجعة إجمالي الحصة" className="bg-muted border-transparent" />
                  )}
                </div>
              );
            })}

            {/* الحصص المخططة — لسه متفتحتش */}
            {data.suggestions.map((p) => (
              <div key={`plan-${p.scheduleId}`} className="rounded-2xl border-2 border-dashed border-border bg-card p-4 flex items-center gap-3.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="nk-num text-center rounded-xl py-1.5 px-2.5 text-sm font-extrabold border border-dashed bg-muted/60 text-muted-foreground" dir="ltr">
                      {formatTime12(p.startTime)}
                    </span>
                    <span className="font-extrabold text-[15px]">{p.subject} — {p.grade} {p.groupName}</span>
                    <StatusChip tone="amber">جاية</StatusChip>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                    <span>{p.teacher}</span>
                    {p.room && <span className="nk-brand-text font-extrabold">{p.room}</span>}
                    <span className="nk-num">{fmt(p.price)} ج · {p.students} طالب</span>
                  </p>
                </div>
                <ActionSquare
                  icon={opening === p.scheduleId ? <Loader2 className="w-5 h-5 animate-spin" /> : <LockOpen className="w-5 h-5" />}
                  label="ابدأ"
                  variant="primary"
                  size="sm"
                  disabled={opening === p.scheduleId}
                  onClick={() => openPlanned(p.scheduleId)}
                  tooltip="فتح الحصة — حضور المدرس بيتسجل تلقائيًا"
                />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* موافقات محتاجة — للمدير */}
      {isManager && (
        <button
          onClick={() => setView("approvals")}
          className="w-full nk-card rounded-2xl p-4 flex items-center gap-3 hover:shadow-md transition active:scale-[0.99]"
        >
          <span className="rounded-xl p-2.5 nk-brand-bg-soft nk-brand-text"><ClipboardCheck className="w-5 h-5" /></span>
          <span className="flex-1 text-start font-extrabold text-sm">طلبات محتاجة موافقة</span>
        </button>
      )}

      {/* ===== شيت حصة جديدة — اسم + مصدر طلاب + خلاص (spec §3) ===== */}
      <NewSessionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => { setNewOpen(false); window.dispatchEvent(new CustomEvent("nk-sessions-changed")); openSession(id); }}
      />

      {/* ===== شيت حضور الموظف — امسح كود شاشة المركز ===== */}
      <Dialog open={checkinOpen} onOpenChange={setCheckinOpen}>
        <DialogContent dir="rtl" className="max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0"><LogIn className="w-5 h-5 text-white" /></span>
              تسجيل حضورك — امسح كود المركز
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs font-bold text-muted-foreground leading-relaxed">
              وجّه الكاميرا على الكود المعروض على شاشة المركز — الكود بيتغير كل ثواني قليلة، امسح أحدث كود.
            </p>
            <StaffCheckinScanner onDone={(msg) => { setCheckinOpen(false); toast.success(msg, { duration: 5000, icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" /> }); }} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** سكانر كود حضور الموظفين — بياخد /c/<token> ويسجّل على طول */
function StaffCheckinScanner({ onDone }: { onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const lastRef = useRef({ token: "", at: 0 });

  async function claim(token: string) {
    const now = Date.now();
    if (lastRef.current.token === token && now - lastRef.current.at < 4000) return;
    lastRef.current = { token, at: now };
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; alreadyCheckedIn?: boolean; message?: string }>("/api/attendance/staff-qr/claim", {
        method: "POST", body: { token }, silent: true,
      });
      onDone(r.alreadyCheckedIn ? "حضورك متسجل بالفعل النهاردة 👍" : (r.message ?? "تم تسجيل حضورك ✅"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "مش قادرين نسجل حضورك — جرب تاني.");
    } finally { setBusy(false); }
  }

  function onScan(text: string) {
    if (busy) return;
    const m = text.trim().match(/\/c\/([0-9a-fA-F]{16,64})/) ?? ( /^[0-9a-fA-F]{16,64}$/.test(text.trim()) ? [null, text.trim()] : null );
    if (!m) {
      toast.error("الكود ده مش كود حضور موظفين — امسح كود شاشة المركز.");
      return;
    }
    void claim(m[1].toLowerCase());
  }

  return (
    <div className="relative">
      <CombiningQrScanner active={!busy} onScan={onScan} />
      {busy && (
        <div className="absolute inset-0 grid place-items-center bg-black/45 rounded-2xl text-white text-sm font-extrabold">
          <Loader2 className="w-5 h-5 animate-spin ms-2" /> جاري تسجيل حضورك…
        </div>
      )}
    </div>
  );
}

function StatusChip({ children, tone }: { children: React.ReactNode; tone: "green" | "amber" | "red" | "muted" | "blue" }) {
  return (
    <span className={cn(
      "text-[10.5px] font-extrabold rounded-full px-2 py-0.5",
      tone === "green" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
      tone === "amber" && "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
      tone === "red" && "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
      tone === "blue" && "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
      tone === "muted" && "bg-muted text-muted-foreground",
    )}>
      {children}
    </span>
  );
}

/* ============================================================
   شيت حصة جديدة (spec §3): اسم + مصدر طلاب + إعداد واحد لكل مصدر + ابدأ.
   الاختيار الوحيد المطلوب من المدرس (طلب المستخدم حرفيًا):
   - من قاعدة البيانات: بيتحقق من وجود الطالب في النظام قبل التسجيل (كشف/مجموعة)
   - بدون قاعدة بيانات: الاسم والكود بيتسجلوا زي ما الطالب يكتبهم — من غير أي تحقق
   - حضور مفتوح: طول كود الطالب (افتراضي 5 — قابل للضبط، مش hardcode)
   — الإعداد الأدنى الممكن؛ اسم الحصة المفتوحة بيتعبّي لوحده (فتح بضغطة)
============================================================ */

type GroupOption = { id: string; name: string; subject: string; grade: string; students: number };

function timeNowRounded(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function timePlus90(start: string): string {
  const [h, m] = start.split(":").map(Number);
  const t = h * 60 + m + 90;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function NewSessionDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (sessionId: string) => void;
}) {
  const [source, setSource] = useState<"ROSTER" | "OPEN">("ROSTER");
  const [name, setName] = useState("");
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [groupId, setGroupId] = useState("");
  const [allowUnreg, setAllowUnreg] = useState(false);
  const [codeLen, setCodeLen] = useState("5");
  // مضاد الغش: كود قاعة متغيّر جنب الـ QR (مفعّل افتراضيًا — طلب المستخدم ضد مشاركة الكود)
  const [roomPin, setRoomPin] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [busy, setBusy] = useState(false);

  // وقت افتراضي منطقي: من دلوقتي → بعد ساعة ونص (مربوطة بفتح الشيت مش بالمونت)
  useEffect(() => {
    if (open) {
      const s = timeNowRounded();
      setStartTime(s);
      setEndTime(timePlus90(s));
      setSource("ROSTER");
      setName("");
      setAllowUnreg(false);
      setCodeLen("5");
      setRoomPin(true); // مضاد الغش مفعّل افتراضيًا — المدرس يقدر يقفله
    }
  }, [open]);

  // المجموعات النشطة (الكشف المتاح) — بتتجيب أول ما الشيت يتفتح
  useEffect(() => {
    if (!open || groups) return;
    api<{ groups: GroupOption[] }>("/api/academics")
      .then((d) => setGroups(d.groups))
      .catch(() => setGroups([]));
  }, [open, groups]);

  const codeLenNum = Math.max(3, Math.min(12, Math.round(Number(codeLen) || 5)));
  const canSubmit =
    !busy &&
    (source === "OPEN" ? name.trim().length >= 2 : groupId !== "") &&
    startTime && endTime && endTime > startTime;

  async function create() {
    setBusy(true);
    try {
      const body = source === "OPEN"
        ? { studentSource: "OPEN", name: name.trim(), studentCodeLength: codeLenNum, startTime, endTime, requireRoomPin: roomPin }
        : { studentSource: "ROSTER", groupId, startTime, endTime, allowUnregistered: allowUnreg, requireRoomPin: roomPin };
      const res = await api<{ session: { id: string } }>("/api/sessions", { method: "POST", body });
      toast.success(source === "OPEN" ? "الحصة المفتوحة فتحت 🟢 — اعرض الكود وخلي الطلاب يسجلوا" : "الحصة فتحت 🟢 — جاهزة للمسح");
      onCreated(res.session.id);
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0"><Plus className="w-5 h-5 text-white" /></span>
            حصة جديدة
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* المصدر أولاً — القرار الوحيد المهم (spec §16) */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSource("ROSTER")}
              className={cn(
                "rounded-2xl border-2 p-3 text-start transition active:scale-[0.98]",
                source === "ROSTER" ? "nk-brand-bg text-white border-transparent shadow" : "border-border bg-card hover:bg-muted/50",
              )}
            >
              <Users className="w-5 h-5 mb-1.5" />
              <span className="block font-extrabold text-sm">من قاعدة البيانات</span>
              <span className={cn("block text-[10.5px] font-bold leading-snug", source === "ROSTER" ? "opacity-90" : "text-muted-foreground")}>
                بيتحقق من وجود الطالب في النظام — والغايب بيتحسب تلقائيًا
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSource("OPEN");
                // اسم افتراضي جاهز — المدرس يقدر يفتح الحصة بضغطة واحدة من غير كتابة (طلب المستخدم)
                setName((n) => n || `حضور مفتوح — ${timeNowRounded()}`);
              }}
              className={cn(
                "rounded-2xl border-2 p-3 text-start transition active:scale-[0.98]",
                source === "OPEN" ? "nk-brand-bg text-white border-transparent shadow" : "border-border bg-card hover:bg-muted/50",
              )}
            >
              <Globe2 className="w-5 h-5 mb-1.5" />
              <span className="block font-extrabold text-sm">بدون قاعدة بيانات</span>
              <span className={cn("block text-[10.5px] font-bold leading-snug", source === "OPEN" ? "opacity-90" : "text-muted-foreground")}>
                يسجّل الاسم والكود زي ما الطالب يكتبهم — من غير تحقق
              </span>
            </button>
          </div>

          {source === "OPEN" && (
            <div>
              <label htmlFor="ns-name" className="text-xs font-bold block mb-1">اسم الحصة</label>
              <input
                id="ns-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 80))}
                placeholder="مثلاً: رياضيات — الأسبوع 4"
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-bold text-sm"
              />
            </div>
          )}

          {source === "ROSTER" && (
            <div className="space-y-2">
              <label htmlFor="ns-group" className="text-xs font-bold block">المجموعة (الكشف)</label>
              {!groups ? (
                <div className="h-11 rounded-xl bg-muted animate-pulse" />
              ) : groups.length === 0 ? (
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-xl px-3 py-2.5">
                  مفيش مجموعات نشطة — ضيف مجموعة الأول من تاب الحصص.
                </p>
              ) : (
                <select
                  id="ns-group"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm"
                >
                  <option value="">اختار المجموعة…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.subject} — {g.grade} {g.name} ({g.students} طالب)
                    </option>
                  ))}
                </select>
              )}
              {/* إعداد إداري ثانوي — قبول غير المسجلين بدل رفضهم (spec §22) */}
              <label className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-3.5 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowUnreg}
                  onChange={(e) => setAllowUnreg(e.target.checked)}
                  className="w-4 h-4 accent-[color-mix(in_srgb,var(--c-primary)_88%,black)]"
                />
                <span className="text-xs font-bold leading-snug">
                  قبول الطلاب غير المسجلين في الكشف (بدل رفضهم)
                  <span className="block text-[10.5px] font-semibold text-muted-foreground">هيتسجلوا باسمهم ويبانوا في القائمة كـ«غير مسجل» — من غير خصم</span>
                </span>
              </label>
            </div>
          )}

          {source === "OPEN" && (
            <div>
              <label htmlFor="ns-codelen" className="text-xs font-bold block mb-1">طول كود الطالب (أرقام)</label>
              <input
                id="ns-codelen"
                value={codeLen}
                onChange={(e) => setCodeLen(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-extrabold text-sm nk-num"
                dir="ltr"
              />
              <p className="text-[10.5px] font-bold text-muted-foreground mt-1">
                الطالب لازم يكتب {codeLenNum} أرقام بالظبط — غيّرها براحتك (3 إلى 12).
              </p>
            </div>
          )}

          {/* مضاد الغش — مفعّل افتراضيًا (مضاد مشاركة الـ QR عن بُعد): كود قاعة متغيّر جنب الـ QR */}
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 px-3.5 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={roomPin}
              onChange={(e) => setRoomPin(e.target.checked)}
              className="w-4 h-4 mt-0.5 accent-amber-600"
            />
            <span className="text-xs font-bold leading-snug">
              🔒 كود مكافحة الغش (موصى به)
              <span className="block text-[10.5px] font-semibold text-muted-foreground">
                4 أرقام بتظهر جنب الـ QR وبتتبدّل كل دقيقتين — الطالب يكتبها مع اسمه وكوده،
                فصورة الكود المتبعتة لحد بره القاعة مبتنفّعش
              </span>
            </span>
          </label>

          {/* وقت الحصة — افتراضي منطقي وقابل للتعديل */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="ns-start" className="text-xs font-bold block mb-1">من</label>
              <input id="ns-start" type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setEndTime(timePlus90(e.target.value)); }}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" dir="ltr" />
            </div>
            <div>
              <label htmlFor="ns-end" className="text-xs font-bold block mb-1">إلى</label>
              <input id="ns-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm nk-num" dir="ltr" />
            </div>
          </div>

          <button
            onClick={create}
            disabled={!canSubmit}
            className="w-full h-12 rounded-2xl nk-brand-bg text-white font-extrabold shadow active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
            {busy ? "جاري الفتح…" : "ابدأ الحضور"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
