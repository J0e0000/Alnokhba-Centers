"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Wallet, Receipt, Users, BookOpen, Plus, Loader2, Scale, Banknote, DoorClosed, DoorOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, fmtE, formatDateAR, EXPENSE_LABEL, PAY_METHOD_LABEL, todayStr } from "./lib";
import { PageHeader, MoneyStat, Stat, Chip, Loading, SectionCard, EmptyState } from "./shared";
import { Field, inputCls } from "./students";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type AccountingData = {
  expenses: { id: string; category: string; amount: number; date: string; note: string | null }[];
  monthTotal: number;
  opening: number; cashIn: number; cashOut: number; expensesTotal: number; teacherPayouts: number;
  refunds: number; expected: number;
  cashDay: { id: string; status: string; countedCash: number | null; openingCash: number; closedAt: string | null } | null;
  movements: { id: string; type: string; amount: number; method: string | null; createdAt: string; student: { name: string; code: string } | null }[];
  settlements: { teacherId: string; name: string; phone: string | null; payable: number }[];
  recent: { id: string; teacherId: string; type: string; amount: number; date: string; note: string | null }[];
  journal: { id: string; type: string; amount: number; date: string; note: string | null }[];
};

const TABS = [
  { id: "cash", label: "الصندوق", icon: <Wallet className="w-4 h-4" /> },
  { id: "expenses", label: "المصروفات", icon: <Receipt className="w-4 h-4" /> },
  { id: "teachers", label: "مستحقات المدرسين", icon: <Users className="w-4 h-4" /> },
  { id: "journal", label: "اليومية", icon: <BookOpen className="w-4 h-4" /> },
] as const;

const JOURNAL_LABEL: Record<string, string> = {
  SESSION_REVENUE: "إيراد حصة",
  BOOK_SALE: "بيع كتاب",
  EXPENSE: "مصروف",
  TEACHER_SHARE: "نصيب مدرس",
  TEACHER_PAYOUT: "صرف مدرس",
  REFUND: "استرداد",
  ADJUSTMENT: "تسوية",
  SUBSCRIPTION_FEE: "اشتراك",
};

export function AccountingView() {
  const [data, setData] = useState<AccountingData | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("cash");
  const [busy, setBusy] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");

  const load = useCallback(() => {
    api<AccountingData>("/api/accounting").then(setData).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading />;

  async function action(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    try {
      await api("/api/accounting", { method: "POST", body });
      toast.success(okMsg);
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  const cashClosed = data.cashDay?.status === "CLOSED";
  const difference = data.cashDay?.countedCash != null ? data.cashDay.countedCash - data.expected : null;

  return (
    <div className="space-y-4">
      <PageHeader title="الحسابات" subtitle="الصندوق والمصروفات ومستحقات المدرسين" />

      <div className="flex gap-1.5 overflow-x-auto nk-scroll pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-2xl border px-4 py-2.5 font-extrabold text-sm transition flex items-center gap-2",
              tab === t.id ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:text-foreground"
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ===== CASH ===== */}
      {tab === "cash" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MoneyStat label="افتتاحي الصندوق" piastres={data.opening} tone="muted" />
            <MoneyStat label="دخل كاش النهاردة" piastres={data.cashIn} tone="success" icon={<Banknote className="w-4 h-4" />} />
            <MoneyStat label="خرج النهاردة" piastres={data.cashOut} tone="warning" hint={`مصروفات ${fmt(data.expensesTotal)} ج + صرف مدرسين ${fmt(data.teacherPayouts)} ج + استردادات ${fmt(data.refunds)} ج`} />
            <MoneyStat label="المتوقع في الصندوق" piastres={data.expected} tone="brand" />
          </div>

          {difference !== null ? (
            <div className={cn(
              "rounded-2xl border-2 px-5 py-4 font-extrabold text-center text-lg nk-num",
              difference === 0 ? "bg-emerald-50 border-emerald-300 text-emerald-700" :
              difference > 0 ? "bg-sky-50 border-sky-300 text-sky-700" : "bg-rose-50 border-rose-300 text-rose-700"
            )}>
              فرق الصندوق: {fmt(difference)} جنيه {difference < 0 ? "(ناقص)" : difference > 0 ? "(زيادة)" : "(مظبوط ✧)".replace(" ✧", "")}
              <p className="text-xs font-semibold mt-1 text-muted-foreground">
                المتوقع {fmtE(data.expected)} · المعدود {fmtE(data.cashDay?.countedCash ?? 0)}
              </p>
            </div>
          ) : (
            <div className="nk-card rounded-2xl p-4 space-y-3">
              <h3 className="font-extrabold flex items-center gap-2"><Scale className="w-4.5 h-4.5" /> قفل الصندوق آخر اليوم</h3>
              <p className="text-sm text-muted-foreground font-semibold">عدّ الفلوس اللي في الصندوق واكتبها — هنحسب الفرق لوحدينا.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input dir="ltr" inputMode="decimal" placeholder={`المتوقع: ${(data.expected / 100).toLocaleString("en-EG")}`}
                  className="flex-1 h-12 rounded-xl border-2 border-input bg-card px-4 font-extrabold text-center nk-num text-lg"
                  value={countedCash} onChange={(e) => setCountedCash(e.target.value.replace(/[^\d.]/g, ""))} />
                <button disabled={busy || !countedCash}
                  onClick={() => action({ action: "close-day", countedCash: parseFloat(countedCash) }, "تم قفل الصندوق.")}
                  className="nk-brand-bg text-white font-extrabold rounded-xl px-6 py-3 shadow disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <DoorClosed className="w-4.5 h-4.5" />} قفل الصندوق
                </button>
              </div>
            </div>
          )}

          {data.cashDay?.status !== "CLOSED" && (
            <div className="nk-card rounded-2xl p-4 flex flex-col sm:flex-row gap-2 items-end">
              <div className="flex-1 w-full">
                <Field label="رصيد الصندوق الافتتاحي">
                  <input dir="ltr" inputMode="decimal" className={cn(inputCls(false), "nk-num")} value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value.replace(/[^\d.]/g, ""))} placeholder={data.cashDay ? String(data.cashDay.openingCash / 100) : "500"} />
                </Field>
              </div>
              <button disabled={busy || !openingCash}
                onClick={() => action({ action: "open-day", openingCash: parseFloat(openingCash) }, "تم تحديد رصيد الصندوق.")}
                className="rounded-xl border-2 border-border bg-card font-bold px-5 py-2.5 h-11 flex items-center gap-2 disabled:opacity-50">
                <DoorOpen className="w-4 h-4" /> {data.cashDay ? "تحديث الافتتاحي" : "فتح اليوم"}
              </button>
            </div>
          )}

          <SectionCard title="حركة الفلوس النهاردة" icon={<Wallet className="w-4 h-4" />}>
            {data.movements.length === 0 ? (
              <EmptyState title="مفيش حركة فلوس النهاردة" />
            ) : (
              <ul className="divide-y max-h-80 overflow-y-auto nk-scroll">
                {data.movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{m.student?.name ?? "—"}</p>
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        {PAY_METHOD_LABEL[m.method ?? "CASH"] ?? m.method} · {new Date(m.createdAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <span className={cn("font-extrabold nk-num text-sm shrink-0", m.amount >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
                      {m.type === "REFUND" ? `−${fmt(Math.abs(m.amount))}` : `+${fmt(m.amount)}`} ج
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}

      {/* ===== EXPENSES ===== */}
      {tab === "expenses" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <MoneyStat label="مصروفات الشهر" piastres={data.monthTotal} tone="warning" icon={<Receipt className="w-4 h-4" />} />
            <Stat label="عدد العمليات" value={data.expenses.length} />
          </div>
          <button onClick={() => setExpenseOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2">
            <Plus className="w-4.5 h-4.5" /> مصروف جديد
          </button>
          <SectionCard title="سجل المصروفات" icon={<Receipt className="w-4 h-4" />}>
            {data.expenses.length === 0 ? (
              <EmptyState title="مفيش مصروفات" />
            ) : (
              <ul className="divide-y max-h-96 overflow-y-auto nk-scroll">
                {data.expenses.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 grid place-items-center shrink-0"><Receipt className="w-4.5 h-4.5" /></span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">{EXPENSE_LABEL[e.category] ?? e.category}{e.note ? ` — ${e.note}` : ""}</p>
                      <p className="text-[11px] text-muted-foreground font-semibold">{formatDateAR(e.date)}</p>
                    </div>
                    <span className="font-extrabold nk-num text-sm text-rose-600 shrink-0">−{fmt(e.amount)} ج</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {expenseOpen && (
            <ExpenseDialog onClose={() => setExpenseOpen(false)} onSaved={() => { setExpenseOpen(false); load(); }} />
          )}
        </div>
      )}

      {/* ===== TEACHERS ===== */}
      {tab === "teachers" && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.settlements.length === 0 ? (
            <div className="md:col-span-2 nk-card rounded-2xl"><EmptyState title="مفيش مدرسين" /></div>
          ) : data.settlements.map((t) => (
            <TeacherSettlementCard key={t.teacherId} teacher={t} busy={busy} onPay={(amount) => action({ action: "pay-teacher", teacherId: t.teacherId, amount }, "تم صرف المستحقات.")} />
          ))}
        </div>
      )}

      {/* ===== JOURNAL ===== */}
      {tab === "journal" && (
        <SectionCard title="دفتر اليومية (للتصدير المحاسبي)" icon={<BookOpen className="w-4 h-4" />}>
          {data.journal.length === 0 ? (
            <EmptyState title="الدفتر فاضي" />
          ) : (
            <ul className="divide-y max-h-[28rem] overflow-y-auto nk-scroll">
              {data.journal.map((j) => (
                <li key={j.id} className="flex items-center gap-3 py-2.5">
                  <Chip className={cn("shrink-0", j.amount >= 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700")}>
                    {JOURNAL_LABEL[j.type] ?? j.type}
                  </Chip>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{j.note ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground font-semibold">{formatDateAR(j.date)}</p>
                  </div>
                  <span className={cn("font-extrabold nk-num text-sm shrink-0", j.amount >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
                    {j.amount >= 0 ? "+" : "−"}{fmt(Math.abs(j.amount))} ج
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ category: "RENT", amount: "", note: "", date: todayStr() });
  const [busy, setBusy] = useState(false);

  async function save() {
    const val = parseFloat(form.amount);
    if (!isFinite(val) || val <= 0) {
      toast.error("اكتب مبلغ المصروف صح.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/accounting", { method: "POST", body: { action: "add-expense", ...form, amount: val } });
      toast.success("تم تسجيل المصروف.");
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>مصروف جديد</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label className="text-sm font-bold">البند</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(EXPENSE_LABEL).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setForm({ ...form, category: id })}
                  className={cn("rounded-xl border px-3.5 py-2 text-xs font-extrabold",
                    form.category === id ? "nk-brand-bg text-white border-transparent" : "bg-card border-border")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="المبلغ (جنيه)" required>
              <input dir="ltr" inputMode="decimal" className={cn(inputCls(false), "text-center nk-num")} value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder="1500" />
            </Field>
            <Field label="التاريخ">
              <input type="date" dir="ltr" className={cn(inputCls(false), "nk-num")} value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
          </div>
          <Field label="ملاحظة">
            <input className={inputCls(false)} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="إيجار شهر كذا..." />
          </Field>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4.5 h-4.5 animate-spin" />} حفظ
            </button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeacherSettlementCard({ teacher, busy, onPay }: {
  teacher: { teacherId: string; name: string; phone: string | null; payable: number };
  busy: boolean;
  onPay: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(teacher.payable > 0 ? String(teacher.payable / 100) : "");
  return (
    <div className="nk-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-extrabold">{teacher.name}</h3>
          {teacher.phone && <p className="text-xs text-muted-foreground font-semibold nk-num" dir="ltr">{teacher.phone}</p>}
        </div>
        <Chip className={teacher.payable > 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-muted border-border text-muted-foreground"}>
          {teacher.payable > 0 ? `له ${fmt(teacher.payable)} ج` : "تم الصرف"}
        </Chip>
      </div>
      {teacher.payable > 0 && (
        <div className="flex gap-2">
          <input dir="ltr" inputMode="decimal" className="flex-1 h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-center nk-num"
            value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <button disabled={busy || !amount}
            onClick={() => onPay(parseFloat(amount))}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow disabled:opacity-50 flex items-center gap-1.5 text-sm">
            <Banknote className="w-4 h-4" /> صرف
          </button>
        </div>
      )}
    </div>
  );
}
