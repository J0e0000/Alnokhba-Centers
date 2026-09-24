"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight, Phone, User, Printer, School, StickyNote, BookOpen, Clock,
  Wallet, TrendingDown, TrendingUp, MessageCircle, Pencil, Loader2, Scale, Undo2, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  api, fmt, fmtE, formatDateAR, formatTime12, balanceLabel, STUDENT_STATUS, TXN_LABEL,
  ATTENDANCE_LABEL, PAY_METHOD_LABEL, userCan, userCanRequest, type SessionUser,
} from "./lib";
import { PageHeader, Chip, BalanceChip, SectionCard, Loading, EmptyState, Stat, MoneyStat, InfoRow } from "./shared";
import { PaymentPanel } from "./scan";
import { TransactionPrintButton } from "./receipt-actions";
import { StudentFormDialog } from "./students";
import { StudentCardPrint } from "./cards";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type Profile = {
  student: {
    id: string; code: string; name: string; phone: string | null; parentName: string | null;
    parentPhone: string | null; grade: string | null; school: string | null; status: string;
    notes: string | null; createdAt: string;
  };
  balance: number;
  totalPaid: number;
  totalCharged: number;
  subjectStats: {
    groupId: string; subject: string; groupName: string; teacher: string | null;
    price: number; isOverride: boolean; status: string; attended: number;
    weeklyTimes: { day: number; start: string; end: string; room: string | null }[]; classmates: number;
  }[];
  attendance: { id: string; date: string; startTime: string; status: string; subject: string; charged: number | null }[];
  transactions: { id: string; type: string; amount: number; method: string | null; reason: string | null; createdAt: string; byName?: string | null }[];
};

export function StudentProfileView({ user, studentId, onBack }: {
  user: SessionUser; studentId: string; onBack: () => void;
}) {
  const [data, setData] = useState<Profile | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<Profile>(`/api/students/${studentId}`).then(setData).catch(() => {});
  }, [studentId, reload]);

  if (!data) return <Loading />;
  const s = data.student;
  const bal = balanceLabel(data.balance);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground transition">
        <ChevronRight className="w-4 h-4" /> رجوع للطلاب
      </button>

      <PageHeader
        title={s.name}
        subtitle={`كود الطالب: ${s.code} · ${s.grade ?? "بدون مرحلة"}`}
        action={
          <div className="flex gap-2">
            <button onClick={() => setCardOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-3.5 py-2.5 shadow flex items-center gap-1.5 text-sm active:scale-[0.98]">
              <Printer className="w-4 h-4" /> الكارت
            </button>
            <button onClick={() => setEditOpen(true)} className="border border-border bg-card font-bold rounded-xl px-3.5 py-2.5 flex items-center gap-1.5 text-sm">
              <Pencil className="w-4 h-4" /> تعديل
            </button>
          </div>
        }
      />

      {/* ===== summary ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MoneyStat label="الرصيد الحالي" piastres={Math.abs(data.balance)} tone={bal.tone === "owe" ? "danger" : bal.tone === "credit" ? "success" : "muted"} hint={bal.text} />
        <MoneyStat label="إجمالي المدفوع" piastres={data.totalPaid} icon={<TrendingUp className="w-4 h-4" />} />
        <MoneyStat label="إجمالي الحصص" piastres={data.totalCharged} icon={<TrendingDown className="w-4 h-4" />} />
        <Stat label="حصص حضرها" value={data.attendance.length} hint={`من ${(data.subjectStats.reduce((a, x) => a + x.attended, 0))} تسجيل`} icon={<Clock className="w-4 h-4" />} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ===== info ===== */}
        <SectionCard title="بيانات الطالب" icon={<User className="w-4 h-4" />}>
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <InfoRow label="موبايل الطالب" value={s.phone ? <a href={`tel:${s.phone}`} className="nk-brand-text nk-num" dir="ltr">{s.phone}</a> : "—"} />
              <InfoRow label="ولي الأمر" value={s.parentName ?? "—"} />
              <InfoRow label="موبايل ولي الأمر" value={s.parentPhone ? <a href={`tel:${s.parentPhone}`} className="nk-brand-text nk-num" dir="ltr">{s.parentPhone}</a> : "—"} />
              <InfoRow label="المدرسة" value={s.school ?? "—"} />
              <InfoRow label="الحالة" value={<span className={cn("text-xs font-bold rounded-full border px-2 py-0.5", STUDENT_STATUS[s.status]?.cls)}>{STUDENT_STATUS[s.status]?.label}</span>} />
              <InfoRow label="مسجل من" value={formatDateAR(s.createdAt.slice(0, 10))} />
            </div>
            <div className="text-center space-y-1.5 shrink-0">
              <div className="w-24 h-24 rounded-2xl border-2 nk-brand-border bg-card grid place-items-center overflow-hidden">
                <CardQr studentId={s.id} />
              </div>
              <Chip className="bg-muted border-border">كود <span className="nk-num">{s.code}</span></Chip>
            </div>
          </div>
          {s.notes && (
            <p className="mt-3 flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 font-semibold text-amber-800">
              <StickyNote className="w-4 h-4 mt-0.5 shrink-0" /> {s.notes}
            </p>
          )}
        </SectionCard>

        {/* ===== subjects ===== */}
        <SectionCard title="المواد والمجموعات" icon={<BookOpen className="w-4 h-4" />}>
          {data.subjectStats.length === 0 ? (
            <EmptyState title="الطالب مش مسجل في أي مجموعة" hint="عدّل بيانات الطالب وضيفه لمجموعة." />
          ) : (
            <div className="space-y-2.5">
              {data.subjectStats.map((g) => (
                <div key={g.groupId} className="rounded-xl border border-border bg-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-sm">{g.subject} — مجموعة {g.groupName}</span>
                    <Chip className={g.isOverride ? "bg-sky-50 border-sky-200 text-sky-700" : "bg-muted border-border text-muted-foreground"}>
                      الحصة {fmt(g.price)} ج{g.isOverride ? " (سعر خاص)" : ""}
                    </Chip>
                  </div>
                  <p className="text-xs text-muted-foreground font-semibold mt-1">
                    {g.teacher ?? "بدون مدرس"} · حضر {g.attended} حصة · {g.classmates} طالب في المجموعة
                  </p>
                  {g.weeklyTimes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {g.weeklyTimes.map((t, i) => (
                        <Chip key={i} className="bg-muted/60 border-border text-muted-foreground">
                          <Clock className="w-3 h-3" /> {["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][t.day]} {formatTime12(t.start)}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ===== payment + whatsapp ===== */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <PaymentPanel
            studentId={s.id}
            studentName={s.name}
            suggestedDue={Math.max(-data.balance, 0)}
            onPaid={() => setReload((k) => k + 1)}
            user={user}
          />
          {/* تسوية/استرداد: صلاحية مباشرة → تنفيذ فوري · من غيرها → طلب موافقة للمدير */}
          {(userCan(user, "REFUND_PAYMENT") || userCan(user, "ADJUST_BALANCE")) ? (
            <div className="flex gap-2">
              <button onClick={() => setAdjustOpen(true)} className="flex-1 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold px-4 py-3 flex items-center justify-center gap-2 text-sm transition">
                <Scale className="w-4 h-4" /> تسوية / استرداد
              </button>
            </div>
          ) : (userCanRequest(user, "REQUEST_REFUND") || userCanRequest(user, "REQUEST_ADJUSTMENT")) ? (
            <div className="flex gap-2">
              <button onClick={() => setRequestOpen(true)} className="flex-1 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold px-4 py-3 flex items-center justify-center gap-2 text-sm transition">
                <ClipboardCheck className="w-4 h-4" /> طلب استرداد / تسوية
              </button>
            </div>
          ) : null}
        </div>

        <WhatsAppPanel studentId={s.id} studentName={s.name} parentPhone={s.parentPhone} />
      </div>

      {/* ===== transactions ===== */}
      <SectionCard title="كشف الحساب (الليدجر)" icon={<Wallet className="w-4 h-4" />}>
        {data.transactions.length === 0 ? (
          <EmptyState title="مفيش حركات لسه" />
        ) : (
          <ul className="divide-y max-h-96 overflow-y-auto nk-scroll">
            {data.transactions.map((t) => {
              const meta = TXN_LABEL[t.type] ?? { label: t.type, cls: "" };
              const printable = t.type === "PAYMENT" || t.type === "REFUND" || t.type === "ADJUSTMENT";
              return (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span className={cn("text-[11px] font-bold rounded-full border px-2 py-0.5 shrink-0", meta.cls)}>{meta.label}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{t.reason ?? PAY_METHOD_LABEL[t.method ?? "CASH"] ?? "—"}{t.byName ? <span className="text-muted-foreground font-semibold"> · {t.byName}</span> : null}</p>
                    <p className="text-[11px] text-muted-foreground font-semibold">
                      {new Date(t.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <span className={cn("font-extrabold nk-num text-sm shrink-0", t.amount >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
                    {t.amount >= 0 ? "+" : "−"}{fmt(Math.abs(t.amount))} ج
                  </span>
                  {printable && <TransactionPrintButton txnId={t.id} center={user.center} title="طباعة إيصال المعاملة" />}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ===== attendance ===== */}
      <SectionCard title="سجل الحضور" icon={<Clock className="w-4 h-4" />}>
        {data.attendance.length === 0 ? (
          <EmptyState title="لسه مفيش حضور" />
        ) : (
          <ul className="divide-y max-h-72 overflow-y-auto nk-scroll">
            {data.attendance.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{a.subject} · {formatDateAR(a.date)}</p>
                  <p className="text-[11px] text-muted-foreground font-semibold">{formatTime12(a.startTime)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-muted-foreground nk-num">{a.charged ? `${fmt(a.charged)} ج` : "—"}</span>
                  <span className={cn(
                    "text-[11px] font-bold rounded-full border px-2 py-0.5",
                    a.status === "PRESENT" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                    a.status === "LATE" ? "bg-amber-50 border-amber-200 text-amber-700" :
                    "bg-sky-50 border-sky-200 text-sky-700"
                  )}>{ATTENDANCE_LABEL[a.status]}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* dialogs */}
      <StudentCardPrint open={cardOpen} onClose={() => setCardOpen(false)} studentIds={[s.id]} center={user.center} />

      <StudentEditDialog open={editOpen} onClose={() => setEditOpen(false)} profile={data} onSaved={() => { setEditOpen(false); setReload((k) => k + 1); }} />

      <AdjustDialog open={adjustOpen} onClose={() => setAdjustOpen(false)} student={s} balance={data.balance} onSaved={() => { setAdjustOpen(false); setReload((k) => k + 1); }} />

      <RequestAdjustDialog open={requestOpen} onClose={() => setRequestOpen(false)} student={s} balance={data.balance} onSent={() => setRequestOpen(false)} />
    </div>
  );
}

// =====================================================================

function CardQr({ studentId }: { studentId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    api<{ cards: { qrDataUrl: string }[] }>(`/api/students/${studentId}/card`)
      .then((d) => setSrc(d.cards[0]?.qrDataUrl ?? null))
      .catch(() => {});
  }, [studentId]);
  if (!src) return <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="QR" className="w-full h-full object-contain p-1" />;
}

function WhatsAppPanel({ studentId, studentName, parentPhone }: { studentId: string; studentName: string; parentPhone: string | null }) {
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [rendered, setRendered] = useState<{ text: string; link: string | null; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ templates: { id: string; name: string }[] }>("/api/templates").then((d) => setTemplates(d.templates)).catch(() => {});
  }, []);

  async function render(id: string) {
    setBusy(true);
    try {
      const res = await api<{ text: string; link: string | null; phone: string }>("/api/templates", {
        method: "POST",
        body: { action: "render", id, studentId },
      });
      setRendered(res);
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <SectionCard title="واتساب" icon={<MessageCircle className="w-4 h-4" />}>
      {templates.length === 0 ? (
        <EmptyState title="مفيش قوالب واتساب" hint="المدير يقدر يعمل قوالب من الإعدادات." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button key={t.id} onClick={() => render(t.id)} disabled={busy}
                className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-3.5 py-2 text-xs font-extrabold hover:bg-emerald-100 transition disabled:opacity-60">
                {t.name}
              </button>
            ))}
          </div>
          {rendered && (
            <div className="space-y-2.5">
              <div className="rounded-2xl bg-[#e7ffdb] border border-emerald-200 p-3.5 text-sm font-semibold whitespace-pre-wrap leading-relaxed">
                {rendered.text}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {rendered.link ? (
                  <a href={rendered.link} target="_blank" rel="noreferrer"
                    className="flex-1 min-w-[180px] text-center bg-[#25D366] text-white font-extrabold rounded-xl px-4 py-3 shadow flex items-center justify-center gap-2 active:scale-[0.99]">
                    <MessageCircle className="w-5 h-5" /> ابعت واتساب {rendered.phone ? `(${rendered.phone})` : ""}
                  </a>
                ) : (
                  <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex-1">
                    {studentName} ماليهوش رقم موبايل مسجل — ضيف الرقم من تعديل البيانات.
                  </p>
                )}
                <button onClick={() => setRendered(null)} className="rounded-xl border border-border bg-card font-bold px-4 py-3 text-sm">مسح</button>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function AdjustDialog({ open, onClose, student, balance, onSaved }: {
  open: boolean; onClose: () => void; student: Profile["student"]; balance: number; onSaved: () => void;
}) {
  const [type, setType] = useState<"REFUND" | "ADJUSTMENT">("REFUND");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const val = parseFloat(amount);
    if (!isFinite(val) || (type === "REFUND" && val <= 0) || (type === "ADJUSTMENT" && val === 0)) {
      toast.error("اكتب مبلغ صحيح.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/payments", {
        method: "POST",
        body: { studentId: student.id, amount: val, type, method: "CASH", note: note || undefined },
      });
      toast.success(type === "REFUND" ? "تم عمل الاسترداد." : "تمت التسوية.");
      setAmount(""); setNote("");
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Undo2 className="w-5 h-5 text-sky-600" /> تسوية / استرداد — {student.name}</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          <p className="text-sm font-bold bg-muted rounded-xl px-3.5 py-2.5">{balanceLabel(balance).text}</p>
          <div className="flex rounded-xl border border-input overflow-hidden">
            {[
              { id: "REFUND" as const, label: "استرداد فلوس (−)" },
              { id: "ADJUSTMENT" as const, label: "تسوية رصيد (+/−)" },
            ].map((t) => (
              <button key={t.id} onClick={() => setType(t.id)}
                className={cn("flex-1 py-2.5 text-xs font-extrabold", type === t.id ? "nk-brand-bg text-white" : "bg-card text-muted-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-bold">المبلغ (جنيه)</label>
              <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.\-]/g, ""))}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-bold nk-num text-center" placeholder="50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-bold">ملاحظة</label>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm" placeholder="سبب التسوية..." />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground font-semibold">
            الاسترداد بيقلل رصيد الطالب — التسوية بتعدّل الرصيد بالزيادة أو النقصان. كل حركة بتتحفظ في السجل.
          </p>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">{busy ? "جاري..." : "تنفيذ"}</button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================= طلب استرداد / تسوية (موافقة المدير) =============================
// الموظف اللي معندهوش صلاحية مباشرة — بيبعت طلب سبب + مبلغ، والمدير يقرر.

// ============================= طلب استرداد / تسوية (موافقة المدير) =============================
// الموظف اللي معندهوش صلاحية مباشرة — بيبعت طلب سبب + مبلغ، والمدير يقرر.

// ============================= طلب استرداد / تسوية (موافقة المدير) =============================
// الموظف اللي معندهوش صلاحية مباشرة — بيبعت طلب سبب + مبلغ، والمدير يقرر.

// ============================= طلب استرداد / تسوية (موافقة المدير) =============================
// الموظف اللي معندهوش صلاحية مباشرة — بيبعت طلب سبب + مبلغ، والمدير يقرر.

// ============================= طلب استرداد / تسوية (موافقة المدير) =============================
// الموظف اللي معندهوش صلاحية مباشرة — بيبعت طلب سبب + مبلغ، والمدير يقرر.

function RequestAdjustDialog({ open, onClose, student, balance, onSent }: {
  open: boolean; onClose: () => void; student: Profile["student"]; balance: number; onSent: () => void;
}) {
  const [type, setType] = useState<"REFUND" | "ADJUSTMENT">("REFUND");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const val = parseFloat(amount);
    if (!isFinite(val) || (type === "REFUND" && val <= 0) || (type === "ADJUSTMENT" && val === 0)) {
      toast.error("اكتب مبلغ صحيح.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("اكتب سبب الطلب — المدير محتاجه يقرر.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ request: { number: string }; message: string }>("/api/approvals", {
        method: "POST",
        body: { type, studentId: student.id, amount: val, reason: reason.trim() },
      });
      toast.success(res.message ?? `تم إرسال الطلب للمدير (${res.request.number}) — هتوصلك النتيجة فور اتخاذ القرار.`, { duration: 6000 });
      setAmount(""); setReason("");
      onSent();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-amber-600" /> طلب موافقة — {student.name}
          </DialogTitle>
          <DialogDescription>
            العملية دي محتاجة موافقة المدير — الطلب بيوصله فورًا مع إشعار، والفلوس مبتتغيرش غير بعد الاعتماد.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <p className="text-sm font-bold bg-muted rounded-xl px-3.5 py-2.5">{balanceLabel(balance).text}</p>
          <div className="flex rounded-xl border border-input overflow-hidden">
            {[
              { id: "REFUND" as const, label: "استرداد فلوس (−)" },
              { id: "ADJUSTMENT" as const, label: "تسوية رصيد (+/−)" },
            ].map((t) => (
              <button key={t.id} onClick={() => setType(t.id)}
                className={cn("flex-1 py-2.5 text-xs font-extrabold", type === t.id ? "nk-brand-bg text-white" : "bg-card text-muted-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-bold">المبلغ (جنيه)</label>
            <input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.\-]/g, ""))}
              className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-bold nk-num text-center" placeholder="50" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="req-reason" className="text-sm font-bold">سبب الطلب (إجباري)</label>
            <textarea
              id="req-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="مثلاً: الطالب دفع مرتين بالغلط في نفس اليوم — محتاج استرداد المبلغ"
              className="w-full rounded-xl border-2 border-input bg-card px-3.5 py-2.5 font-semibold text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed">
            مفيش أي تغيير مالي بيحصل دلوقتي — المدير بيراجع الطلب ولو اعتمده العملية اتنفذ فورًا وبتوصلك إشعار بالنتيجة.
          </p>
          <div className="flex gap-2">
            <button onClick={send} disabled={busy} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ClipboardCheck className="w-4.5 h-4.5" />}
              {busy ? "جاري الإرسال..." : "ابعت الطلب للمدير"}
            </button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StudentEditDialog({ open, onClose, profile, onSaved }: {
  open: boolean; onClose: () => void; profile: Profile; onSaved: () => void;
}) {
  const academics = { groups: profile.subjectStats };
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", parentName: "", parentPhone: "", school: "", notes: "", status: "ACTIVE",
  });

  useEffect(() => {
    if (open) {
      setForm({
        name: profile.student.name,
        phone: profile.student.phone ?? "",
        parentName: profile.student.parentName ?? "",
        parentPhone: profile.student.parentPhone ?? "",
        school: profile.student.school ?? "",
        notes: profile.student.notes ?? "",
        status: profile.student.status,
      });
    }
  }, [open, profile]);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/students/${profile.student.id}`, { method: "PATCH", body: form });
      toast.success("تم حفظ التعديلات.");
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto nk-scroll">
        <DialogHeader><DialogTitle>تعديل بيانات الطالب</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="الاسم" />
          <div className="grid grid-cols-2 gap-3">
            <input dir="ltr" inputMode="numeric" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm nk-num" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d]/g, "").slice(0, 11) })} placeholder="موبايل الطالب" />
            <input className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm" value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} placeholder="ولي الأمر" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input dir="ltr" inputMode="numeric" className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm nk-num" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value.replace(/[^\d]/g, "").slice(0, 11) })} placeholder="موبايل ولي الأمر" />
            <input className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} placeholder="المدرسة" />
          </div>
          <select className="w-full h-11 rounded-xl border-2 border-input bg-card px-3.5 font-semibold text-sm" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="ACTIVE">شغال</option>
            <option value="PAUSED">متوقف مؤقتاً</option>
            <option value="ARCHIVED">مؤرشف</option>
          </select>
          <textarea className="w-full min-h-[64px] rounded-xl border-2 border-input bg-card px-3.5 py-2.5 font-semibold text-sm resize-none" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات" />
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">{busy ? "جاري..." : "حفظ"}</button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
        {academics.groups.length === 0 && null}
      </DialogContent>
    </Dialog>
  );
}
