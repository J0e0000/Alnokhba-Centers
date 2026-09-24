"use client";

import { useEffect, useState } from "react";
import { CreditCard, ChevronLeft, MessageSquareText, Loader2, ClipboardCheck, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, balanceLabel, PAY_METHOD_LABEL, type SessionUser } from "./lib";
import { PageHeader, Chip, BalanceChip, EmptyState, SectionCard, ListSkeleton } from "./shared";
import { PaymentPanel } from "./scan";
import { StudentSearchBar } from "./student-search";
import { TransactionPrintButton } from "./receipt-actions";


type StudentHit = {
  id: string; code: string; name: string; phone?: string | null; grade: string | null;
  status?: string; subjects?: string[];
};

type PaymentRow = {
  id: string; type: string; amount: number; method: string | null; note: string | null;
  createdAt: string; student: { id: string; name: string; code: string } | null; subject: string | null;
  byName?: string | null; receiptNumber?: string | null;
};

type MyRequestRow = {
  id: string; number: string; typeLabel: string; status: string;
  student: { name: string; code: string } | null;
  amount: number | null; reason: string;
  decidedByName: string | null; decisionNote: string | null; executedTxnId: string | null;
  createdAt: string;
};

const REQ_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "مستني قرار المدير", cls: "bg-amber-50 border-amber-200 text-amber-700" },
  APPROVED: { label: "اتقبل واتنفذ", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  REJECTED: { label: "اترفض", cls: "bg-rose-50 border-rose-200 text-rose-700" },
  CANCELLED: { label: "اتلغى", cls: "bg-muted border-border text-muted-foreground" },
};

export function PaymentsView({ user }: { user: SessionUser }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [selected, setSelected] = useState<StudentHit | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [recent, setRecent] = useState<PaymentRow[] | null>(null);
  const [remindBusy, setRemindBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [myRequests, setMyRequests] = useState<MyRequestRow[] | null>(null);
  const [cancelReqBusy, setCancelReqBusy] = useState<string | null>(null);

  // طلباتي (استرداد/تسوية بقالتها للمدير) — للجميع: المدير شايف الكل من «الموافقات»
  const showMyRequests = user.role === "RECEPTIONIST";
  useEffect(() => {
    if (!showMyRequests) return;
    api<{ requests: MyRequestRow[] }>("/api/approvals?scope=mine", { silent: true })
      .then((d) => setMyRequests(d.requests))
      .catch(() => setMyRequests([]));
  }, [showMyRequests, reload]);

  // سحب طلب مستني — صاحب الطلب بس (PENDING → CANCELLED)
  async function cancelMyRequest(r: MyRequestRow) {
    if (!confirm(`تلغي طلب ${r.number} (${r.typeLabel})؟\nلسه مستني قرار المدير — لو الغيته مش هيتنفذ.`)) return;
    setCancelReqBusy(r.id);
    try {
      await api("/api/approvals", { method: "PATCH", body: { id: r.id, action: "cancel" } });
      toast.success(`اتلغى طلب ${r.number} — مفيش أي حاجة هتتنفذ.`);
      setReload((k) => k + 1);
    } catch { /* toast */ } finally { setCancelReqBusy(null); }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) return;
      api<{ students: StudentHit[] }>(`/api/lookup?q=${encodeURIComponent(q.trim())}`).then((d) => setHits(d.students)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api<{ payments: PaymentRow[] }>("/api/payments").then((d) => setRecent(d.payments)).catch(() => setRecent([]));
  }, [reload]);
  useEffect(() => {
    if (selected) {
      api<{ balance: number }>(`/api/students/${selected.id}`).then((d) => setBalance(d.balance)).catch(() => setBalance(null));
    }
  }, [selected, reload]);

  // clear stale balance when switching students (render-time adjustment)
  const [prevSelectedId, setPrevSelectedId] = useState(selected?.id ?? null);
  const currentId = selected?.id ?? null;
  if (currentId !== prevSelectedId) {
    setPrevSelectedId(currentId);
    setBalance(null);
  }

  // ذكّر كل المديونين — دفعة واتساب لكل اللي عليهم فلوس (طابور الرسائل)
  async function remindDebtors() {
    if (remindBusy) return;
    setRemindBusy(true);
    try {
      const res = await api<{ batchLabel: string; created: number; deduped: number; invalidCount: number }>("/api/queue", {
        method: "POST",
        body: { source: "low_balance", customTitle: `تنبيه مديونية — ${new Date().toLocaleDateString("ar-EG", { day: "numeric", month: "long" })}` },
      });
      if (res.created > 0) {
        toast.success(`اتجهّزت ${res.created} رسالة تذكير في الطابور${res.deduped ? ` (${res.deduped} اتذكروا قبل كده)` : ""} — افتح «الرسائل» لتبعتها.`, { duration: 5000 });
        window.dispatchEvent(new CustomEvent("nk-navigate", { detail: { view: "messages" } }));
      } else {
        toast.info(res.deduped > 0 ? "كل المديونين اتذكروا خلاص الشهر ده — مفيش جديد يتبعت." : "مفيش طلاب عليهم فلوس خلاص 🎉");
      }
    } catch { /* toast shown — غالبًا تنبيهات الرصيد مقفولة من الإعدادات */ } finally {
      setRemindBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="الدفع"
        subtitle="اختار الطالب وسجّل الفلوس اللي دفعها"
        action={
          <button
            onClick={remindDebtors}
            disabled={remindBusy}
            title="رسائل واتساب تذكير لكل اللي عليهم فلوس"
            className="border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-3.5 py-2.5 flex items-center gap-1.5 text-xs active:scale-[0.98] disabled:opacity-60"
          >
            {remindBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareText className="w-4 h-4" />}
            ذكّر المديونين
          </button>
        }
      />

      {!selected ? (
        <>
          <StudentSearchBar
            autoFocus
            value={q}
            onChange={(v) => {
              setQ(v);
              if (!v.trim()) setHits([]);
            }}
            onPick={(s) => setSelected(s)}
          />

          {q.trim() && hits.length === 0 ? (
            <div className="nk-card rounded-2xl"><EmptyState title={`مفيش طالب بـ "${q}"`} hint="جرب الاسم الأول بس، أو الكود." /></div>
          ) : hits.length > 0 ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {hits.map((s) => (
                <button key={s.id} onClick={() => setSelected(s)}
                  className="nk-card rounded-2xl p-3.5 flex items-center gap-3 text-start hover:shadow-md transition">
                  <span className="w-10 h-10 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center font-extrabold shrink-0">{s.name.trim()[0]}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-extrabold text-sm truncate">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground font-semibold">كود <span className="nk-num">{s.code}</span>{s.grade ? ` · ${s.grade}` : ""}</span>
                  </span>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <>
              {showMyRequests && myRequests !== null && myRequests.length > 0 && (
                <SectionCard title="طلباتي المستنية قرار المدير" icon={<ClipboardCheck className="w-4 h-4" />}>
                  <ul className="divide-y">
                    {myRequests.slice(0, 5).map((r) => {
                      const meta = REQ_STATUS[r.status] ?? REQ_STATUS.PENDING;
                      return (
                        <li key={r.id} className="py-2.5 flex items-center gap-3">
                          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate">
                              {r.typeLabel}{r.student ? ` — ${r.student.name}` : ""}
                              {r.amount !== null && <span className="nk-num text-muted-foreground font-bold"> ({Math.abs(r.amount) / 100} ج)</span>}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-semibold truncate">
                              {r.number} · {r.decidedByName ? `قرار ${r.decidedByName}${r.decisionNote ? `: ${r.decisionNote}` : ""}` : "مستني"}
                            </p>
                          </div>
                          {r.status === "PENDING" && (
                            <button
                              onClick={() => cancelMyRequest(r)}
                              disabled={cancelReqBusy === r.id}
                              title="سحب الطلب — لسه مفيش قرار اتاخد فيه"
                              className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-xs font-extrabold flex items-center gap-1.5 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 transition disabled:opacity-60"
                            >
                              {cancelReqBusy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                              إلغاء الطلب
                            </button>
                          )}
                          <Chip className={cn("shrink-0", meta.cls)}>{meta.label}</Chip>
                        </li>
                      );
                    })}
                  </ul>
                </SectionCard>
              )}
              <SectionCard title="آخر الدفعات" icon={<CreditCard className="w-4 h-4" />}>
                {recent === null ? (
                  <ListSkeleton rows={5} />
                ) : recent.length === 0 ? (
                  <EmptyState title="لسه مفيش دفعات النهاردة" hint="ابحث عن طالب فوق وسجّل أول دفعة." />
                ) : (
                  <ul className="divide-y">
                    {recent.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate">{p.student?.name ?? "—"}</p>
                          <p className="text-[11px] text-muted-foreground font-semibold">
                            {PAY_METHOD_LABEL[p.method ?? "CASH"] ?? p.method}{p.subject ? ` · ${p.subject}` : ""} · {new Date(p.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            {p.byName ? ` · ${p.byName}` : ""}
                          </p>
                        </div>
                        <span className={cn("font-extrabold nk-num text-sm shrink-0", p.type === "PAYMENT" ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>
                          {p.type === "PAYMENT" ? "+" : "−"}{Math.abs(p.amount) / 100} ج
                        </span>
                        <TransactionPrintButton txnId={p.id} center={user.center} />
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
        </>
      ) : (
        <>
          <button onClick={() => { setSelected(null); setQ(""); setHits([]); }} className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-4 h-4 rotate-180" /> رجوع للبحث
          </button>

          <div className="nk-card rounded-2xl p-4 flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl nk-brand-bg-soft nk-brand-text grid place-items-center font-extrabold text-lg shrink-0">
              {selected.name.trim()[0]}
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="font-extrabold">{selected.name}</h3>
              <p className="text-xs text-muted-foreground font-semibold">
                كود <span className="nk-num">{selected.code}</span>
                {selected.grade ? ` · ${selected.grade}` : ""} · {selected.subjects?.length ?? 0} مادة
              </p>
            </div>
            {balance !== null && <BalanceChip balance={balance} />}
          </div>

          {balance !== null && (
            <PaymentPanel
              studentId={selected.id}
              studentName={selected.name}
              suggestedDue={Math.max(-balance, 0)}
              onPaid={() => setReload((k) => k + 1)}
              user={user}
            />
          )}
          {balance !== null && (
            <p className={cn(
              "text-sm font-bold rounded-xl px-4 py-2.5 border",
              balance < 0 ? "bg-rose-50 border-rose-200 text-rose-700" : balance > 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-muted border-border text-muted-foreground"
            )}>
              {balanceLabel(balance).text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
