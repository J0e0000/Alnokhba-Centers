"use client";

/* ============================================================
   تاب «المدرسين» — تبسيط الرأي: كل مدرس في كارت واحد فيه بس:
   1) حضرتك جاي إمتى — الحصة الجاية (اليوم/بكرة/السبت) بالوقت والقاعة
   2) عدد الطلاب فيها كذا — عداد على كارت الحصة
   3) تواصل — واتساب بضغطة + اتصال
   4) مستحقاته — للمدير: اللي عليه لسه وزرار صرف فوري
   (المدرس نفسه شغلته في بورتال المدرس — ده شاشة الإدارة له)
============================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock, Users, Search, Loader2, Banknote, Phone, MessageCircle, Presentation,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, formatTime12, type SessionUser } from "./lib";
import { PageHeader, Stat, MoneyStat, Chip, EmptyState, Loading } from "./shared";
import { buildWaUrl, openWhatsAppHandoff } from "./wa";

type NextSession = {
  dayOfWeek: number; dayName: string; isToday: boolean;
  startTime: string; endTime: string; room: string | null;
  groupName: string; grade: string; subject: string; students: number; inDays: number;
};

type TeacherRow = {
  id: string; name: string; phone: string | null; isActive: boolean;
  subjects: string[]; grades: string[]; groups: string[];
  weeklySessions: number; totalStudents: number;
  next: NextSession | null;
  payable?: number;
};

type TeachersData = {
  today: string;
  teachers: TeacherRow[];
  summary: { total: number; active: number; weeklySessions: number; pendingDues?: number };
};

function nextLabel(n: NextSession): string {
  if (n.isToday) return "النهاردة";
  if (n.inDays === 1) return "بكرة";
  if (n.inDays === 7) return `${n.dayName} الجاي`;
  return n.dayName;
}

export function TeachersView({ user }: { user: SessionUser }) {
  const [data, setData] = useState<TeachersData | null>(null);
  const [q, setQ] = useState("");
  const isManager = user.role === "MANAGER";

  const load = useCallback(() => {
    api<TeachersData>("/api/teachers").then(setData).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // تحديث دوري خفيف — الحصة «الجاية» بتتغير مع الوقت من غير ريفرش
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = q.trim();
    if (!s) return data.teachers;
    return data.teachers.filter((t) =>
      t.name.includes(s) || t.subjects.some((x) => x.includes(s)) || t.groups.some((g) => g.includes(s)),
    );
  }, [data, q]);

  if (!data) return <Loading />;

  const totalStudents = data.teachers.reduce((s, t) => s + t.totalStudents, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="المدرسين"
        subtitle="مين جاي إمتى، عدد الطلاب، ومستحقاته — كارت لكل مدرس"
      />

      {/* أرقام سريعة */}
      <div className={cn("grid gap-3", isManager ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3")}>
        <Stat label="مدرس نشط" value={`${data.summary.active} من ${data.summary.total}`} />
        <Stat label="حصص الأسبوع" value={data.summary.weeklySessions} />
        <Stat label="إجمالي الطلاب" value={totalStudents} />
        {isManager && (
          <MoneyStat label="مستحقات معلقة" piastres={data.summary.pendingDues ?? 0} tone={((data.summary.pendingDues ?? 0) > 0) ? "warning" : "muted"} />
        )}
      </div>

      {/* بحث */}
      {data.teachers.length > 3 && (
        <div className="relative">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="دوّر على مدرس بالاسم أو المادة..."
            className="w-full h-12 rounded-xl border-2 border-input bg-card ps-10 pe-4 font-bold text-sm"
          />
        </div>
      )}

      {/* كروت المدرسين */}
      {data.teachers.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState
            icon={<Presentation className="w-8 h-8" />}
            title="مفيش مدرسين متسجلين"
            hint="ضيف المدرسين من تاب «الحصص» ← «المجموعات» ← «المدرسين»"
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="nk-card rounded-2xl">
          <EmptyState title={`مفيش نتايج لـ «${q}»`} hint="جرب اسم تاني" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((t) => (
            <TeacherCard key={t.id} t={t} isManager={isManager} centerName={user.center?.name ?? "السنتر"} onPaid={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherCard({ t, isManager, centerName, onPaid }: {
  t: TeacherRow;
  isManager: boolean;
  centerName: string;
  onPaid: () => void;
}) {
  const initials = t.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const waMessage = `السلام عليكم أ/ ${t.name}، معاك إدارة ${centerName}.`;

  function openWa() {
    if (!t.phone) return;
    openWhatsAppHandoff(buildWaUrl(t.phone, waMessage));
  }

  return (
    <div className="nk-card rounded-2xl p-4 space-y-3">
      {/* الاسم + الحالة */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-11 h-11 rounded-xl nk-brand-grad text-white grid place-items-center font-extrabold text-sm shrink-0">
            {initials}
          </span>
          <div className="min-w-0">
            <h3 className="font-extrabold truncate">{t.name}</h3>
            <p className="text-[11px] text-muted-foreground font-bold truncate">
              {t.subjects.length > 0 ? t.subjects.join(" · ") : "لسه ملهوش مجموعات"}
            </p>
          </div>
        </div>
        {!t.isActive && <Chip className="bg-rose-50 border-rose-200 text-rose-600 shrink-0">موقوف</Chip>}
      </div>

      {/* الحصة الجاية — حضرتك جاي إمتى */}
      {t.next ? (
        <div className="rounded-xl nk-brand-bg-soft border nk-brand-border px-3.5 py-3 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-card border border-border grid place-items-center shrink-0 nk-brand-text">
            <CalendarClock className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-sm nk-brand-text">
              {nextLabel(t.next)} · <span className="nk-num" dir="ltr">{formatTime12(t.next.startTime)}</span>
              {t.next.endTime ? <> – <span className="nk-num" dir="ltr">{formatTime12(t.next.endTime)}</span></> : null}
            </p>
            <p className="text-[11px] font-bold text-muted-foreground truncate">
              {t.next.subject} · {t.next.grade} {t.next.groupName}{t.next.room ? ` · ${t.next.room}` : ""}
            </p>
          </div>
          {/* عدد الطلاب فيها كذا */}
          <span className="shrink-0 rounded-full bg-card border border-border px-3 py-1.5 text-xs font-extrabold nk-num flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            {t.next.students}
          </span>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-3.5 py-3 text-sm font-bold text-muted-foreground text-center">
          مفيش حصص مجدولة ليه
        </div>
      )}

      {/* أرقام سريعة */}
      <div className="flex flex-wrap gap-1.5">
        <Chip>حصص الأسبوع: <b className="nk-num">{t.weeklySessions}</b></Chip>
        <Chip>طلابه: <b className="nk-num">{t.totalStudents}</b></Chip>
        {t.grades.length > 0 && <Chip className="max-w-full truncate">{t.grades.join("، ")}</Chip>}
      </div>

      {/* المستحقات — للمدير بس */}
      {isManager && t.payable != null && t.payable > 0 && (
        <PayRow teacherId={t.id} payable={t.payable} onDone={onPaid} />
      )}
      {isManager && t.payable != null && t.payable <= 0 && (
        <div className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
          <Banknote className="w-3.5 h-3.5" /> مستحقاته مصروفة خلاص
        </div>
      )}

      {/* أزرار التواصل — واتساب بضغطة */}
      <div className="flex gap-2 pt-0.5">
        {t.phone ? (
          <>
            <button
              onClick={openWa}
              className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-sm"
            >
              <MessageCircle className="w-4.5 h-4.5" /> واتساب
            </button>
            <a
              href={`tel:${t.phone}`}
              aria-label={`اتصال بـ ${t.name}`}
              className="w-11 h-11 rounded-xl border-2 border-border bg-card grid place-items-center text-foreground hover:bg-muted active:scale-[0.98] transition shrink-0"
            >
              <Phone className="w-4.5 h-4.5" />
            </a>
          </>
        ) : (
          <span className="text-[11px] font-bold text-muted-foreground">مفيش رقم موبايل مسجل — ضيفه من المجموعات</span>
        )}
      </div>
    </div>
  );
}

/** صرف مستحقات المدرس — المدير بس، والمبلغ متعب مسبقًا بالمستحق */
function PayRow({ teacherId, payable, onDone }: {
  teacherId: string; payable: number; onDone: () => void;
}) {
  const [amount, setAmount] = useState(payable > 0 ? String(payable / 100) : "");
  const [busy, setBusy] = useState(false);

  async function pay() {
    const v = parseFloat(amount);
    if (!isFinite(v) || v <= 0) {
      toast.error("اكتب مبلغ صح.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/accounting", { method: "POST", body: { action: "pay-teacher", teacherId, amount: v } });
      toast.success("تم صرف المستحقات.");
      onDone();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2.5 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0">
        له <b className="nk-num">{fmt(payable)}</b> ج
      </span>
      <input
        dir="ltr" inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        aria-label="مبلغ الصرف بالجنيه"
        className="flex-1 min-w-[5rem] h-9 rounded-lg border-2 border-input bg-card px-2 text-center font-extrabold text-sm nk-num"
      />
      <button
        onClick={pay}
        disabled={busy || !amount}
        className="nk-brand-bg text-white font-extrabold rounded-lg px-3.5 py-2 text-xs shadow disabled:opacity-50 flex items-center gap-1.5 shrink-0 active:scale-[0.98] transition"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />} صرف
      </button>
    </div>
  );
}
