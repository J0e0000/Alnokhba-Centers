"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ClipboardCheck, Scale, Undo2, Ban, CheckCircle2, XCircle, Clock, Loader2,
  Wallet, UserRound, CalendarX, Archive, LogOut, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, type SessionUser } from "./lib";
import { PageHeader, Chip, EmptyState, SectionCard, ListSkeleton } from "./shared";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/* ============================================================
   الموافقات (Approvals Center) — شاشة المدير
   كل طلب بيعرض: إيه / مين / إمتا / ليه / الأثر المالي.
   الاعتماد/الرفض بتأكيد — والانتقال بيحصل مرة واحدة بس.
============================================================ */

type ApprovalRow = {
  id: string;
  number: string;
  type: string;
  typeLabel: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  student: { id: string; name: string; code: string } | null;
  amount: number | null; // piastres
  amountEgp: number | null;
  reason: string;
  note: string | null;
  sessionLabel: string | null;
  groupLabel: string | null;
  balanceBefore: number | null;
  requestedByName: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedTxnId: string | null;
  createdAt: string;
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  REFUND: <Undo2 className="w-5 h-5" />,
  ADJUSTMENT: <Scale className="w-5 h-5" />,
  SESSION_CANCEL: <CalendarX className="w-5 h-5" />,
  STUDENT_CANCEL: <Archive className="w-5 h-5" />,
  REGISTRATION_CANCEL: <LogOut className="w-5 h-5" />,
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "مستني قرارك", cls: "bg-amber-50 border-amber-200 text-amber-700" },
  APPROVED: { label: "اتقبل", cls: "bg-emerald-50 border-emerald-200 text-emerald-700" },
  REJECTED: { label: "اترفض", cls: "bg-rose-50 border-rose-200 text-rose-700" },
  CANCELLED: { label: "اتلغى", cls: "bg-muted border-border text-muted-foreground" },
};

function fmtPiastres(p: number): string {
  return (Math.abs(p) / 100).toLocaleString("en-EG");
}

export function ApprovalsView({ user }: { user: SessionUser }) {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  // ديالوج القرار
  const [decision, setDecision] = useState<{ row: ApprovalRow; action: "approve" | "reject" } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(() => {
    api<{ requests: ApprovalRow[]; pendingCount: number }>("/api/approvals", { silent: true })
      .then((d) => { setRows(d.requests); setPendingCount(d.pendingCount); })
      .catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // تحديث فوري لما يوصل إشعار جديد
  useEffect(() => {
    const onEvt = () => load();
    window.addEventListener("nk-staff-notifs", onEvt);
    return () => window.removeEventListener("nk-staff-notifs", onEvt);
  }, [load]);

  async function decide(row: ApprovalRow, action: "approve" | "reject", note: string) {
    if (busyId) return;
    setDeciding(true);
    try {
      const res = await api<{ status: string; note: string | null }>("/api/approvals", {
        method: "PATCH",
        body: { id: row.id, action, note: note || null },
      });
      if (res.status === "APPROVED") {
        toast.success(`اتقبل طلب ${row.number} — العملية اتنفذت وسُجّلت في سجل العمليات.`, { duration: 5000 });
      } else {
        toast.info(`اترفض طلب ${row.number} — مفيش أي تغيير مالي حصل.`);
      }
      setDecision(null);
      setDecisionNote("");
      load();
    } catch { /* toast shown by api */ } finally {
      setDeciding(false);
      setBusyId(null);
    }
  }

  const pending = (rows ?? []).filter((r) => r.status === "PENDING");
  const history = (rows ?? []).filter((r) => r.status !== "PENDING");

  return (
    <div className="space-y-4">
      <PageHeader
        title="الموافقات"
        subtitle={
          pendingCount > 0
            ? `في ${pendingCount} طلب مستني قرارك — استردادات وتسويات وإلغاءات`
            : "طلبات الموظفين الحساسة — استرداد / تسوية / إلغاء حصة"
        }
        action={
          pendingCount > 0 ? (
            <Chip className="bg-amber-50 border-amber-200 text-amber-700 shrink-0">
              <Clock className="w-3.5 h-3.5" /> {pendingCount} مستني
            </Chip>
          ) : (
            <Chip className="bg-emerald-50 border-emerald-200 text-emerald-700 shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" /> مفيش طلبات مستنية
            </Chip>
          )
        }
      />

      {/* ===== طريقة الشغل ===== */}
      <div className="nk-card rounded-2xl p-4 flex items-start gap-3 nk-brand-bg-soft">
        <span className="w-9 h-9 rounded-xl nk-brand-grad text-white grid place-items-center shrink-0">
          <ClipboardCheck className="w-4.5 h-4.5" />
        </span>
        <p className="text-xs font-bold text-muted-foreground leading-relaxed">
          الموظف اللي معندوش صلاحية مباشرة بيبعتلك طلب بدل ما ينفّذ بنفسه — والفلوس مبتتغيرش غير بعد ما تعتمد.
          كل قرار بيتسجل في سجل العمليات، والاسترداد بيобав حركة عكسية (الدفعات الأصلية بتتحفظ زي ما هي).
        </p>
      </div>

      {/* ===== المستني قرارك ===== */}
      <SectionCard title={`مستني قرارك (${pending.length})`} icon={<ClipboardCheck className="w-4 h-4" />}>
        {rows === null ? (
          <ListSkeleton rows={3} />
        ) : pending.length === 0 ? (
          <EmptyState title="مفيش طلبات مستنية" hint="لما الموظفين يبعتوا طلب استرداد أو إلغاء هيظهر هنا فورًا مع إشعار." />
        ) : (
          <div className="grid gap-3">
            {pending.map((r) => (
              <div key={r.id} className="rounded-2xl border-2 border-amber-200/70 dark:border-amber-900/70 bg-amber-50/40 dark:bg-amber-950/40 p-4 space-y-3">
                {/* رأس الطلب */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-10 h-10 rounded-xl bg-card border border-amber-200 text-amber-700 grid place-items-center shrink-0">
                      {TYPE_ICON[r.type] ?? <Wallet className="w-5 h-5" />}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-sm">
                        {r.typeLabel}
                        <span className="text-muted-foreground font-bold text-[11px]"> · {r.number}</span>
                      </h3>
                      <p className="text-[11px] text-muted-foreground font-bold">
                        {r.requestedByName} · {new Date(r.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  {r.amount !== null && (
                    <Chip className="bg-rose-50 border-rose-200 text-rose-700 shrink-0 nk-num font-extrabold">
                      {fmtPiastres(r.amount)} ج
                    </Chip>
                  )}
                </div>

                {/* التفاصيل */}
                <div className="grid gap-1.5 text-[13px] font-semibold">
                  {r.student && (
                    <p className="flex items-center gap-1.5">
                      <UserRound className="w-4 h-4 text-muted-foreground shrink-0" />
                      الطالب: <b>{r.student.name}</b>
                      <span className="text-muted-foreground">· كود <span className="nk-num">{r.student.code}</span></span>
                      {r.balanceBefore !== null && (
                        <span className="text-muted-foreground">· الرصيد وقت الطلب: <span className="nk-num">{fmtPiastres(r.balanceBefore)} ج</span></span>
                      )}
                    </p>
                  )}
                  {r.sessionLabel && (
                    <p className="flex items-center gap-1.5">
                      <CalendarX className="w-4 h-4 text-muted-foreground shrink-0" />
                      الحصة: <b>{r.sessionLabel}</b>
                    </p>
                  )}
                  {r.groupLabel && (
                    <p className="flex items-center gap-1.5">
                      <LogOut className="w-4 h-4 text-muted-foreground shrink-0" />
                      التسجيل: <b>{r.groupLabel}</b>
                    </p>
                  )}
                  <p className="rounded-xl bg-card border border-amber-100 px-3 py-2 leading-relaxed">
                    <span className="text-muted-foreground font-bold">السبب: </span>{r.reason}
                  </p>
                </div>

                {/* أزرار القرار */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setDecision({ row: r, action: "approve" }); setDecisionNote(""); }}
                    disabled={busyId === r.id}
                    className="flex-1 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold px-4 py-2.5 flex items-center justify-center gap-1.5 text-sm shadow transition active:scale-[0.98] disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4.5 h-4.5" /> اعتمد ونفّذ
                  </button>
                  <button
                    onClick={() => { setDecision({ row: r, action: "reject" }); setDecisionNote(""); }}
                    disabled={busyId === r.id}
                    className="flex-1 rounded-xl border-2 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-extrabold px-4 py-2.5 flex items-center justify-center gap-1.5 text-sm transition active:scale-[0.98] disabled:opacity-60"
                  >
                    <XCircle className="w-4.5 h-4.5" /> ارفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ===== سجل القرارات ===== */}
      <SectionCard title={`آخر القرارات (${history.length})`} icon={<Clock className="w-4 h-4" />}>
        {rows === null ? (
          <ListSkeleton rows={3} />
        ) : history.length === 0 ? (
          <EmptyState title="لسه مفيش قرارات" />
        ) : (
          <ul className="divide-y">
            {history.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <li key={r.id} className="py-3 flex items-center gap-3">
                  <span className={cn("w-9 h-9 rounded-xl grid place-items-center shrink-0",
                    r.status === "APPROVED" ? "bg-emerald-50 text-emerald-600 border border-emerald-200" :
                    r.status === "REJECTED" ? "bg-rose-50 text-rose-600 border border-rose-200" :
                    "bg-muted text-muted-foreground border border-border")}>
                    {TYPE_ICON[r.type] ?? <Wallet className="w-4.5 h-4.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">
                      {r.typeLabel} — {r.student?.name ?? r.sessionLabel ?? r.groupLabel ?? r.number}
                      {r.amount !== null && <span className="nk-num text-muted-foreground font-bold"> ({fmtPiastres(r.amount)} ج)</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-semibold truncate">
                      طلب {r.requestedByName} · قرار {r.decidedByName ?? "—"}
                      {r.decidedAt ? ` · ${new Date(r.decidedAt).toLocaleString("ar-EG", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                      {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                      {r.executedTxnId ? " · ✦ اتنفذت حركة مالية" : ""}
                    </p>
                  </div>
                  <Chip className={cn("shrink-0", meta.cls)}>{meta.label}</Chip>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ===== ديالوج القرار ===== */}
      <Dialog open={!!decision} onOpenChange={(o) => { if (!o) { setDecision(null); setDecisionNote(""); } }}>
        <DialogContent className="max-w-md">
          {decision && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {decision.action === "approve"
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    : <XCircle className="w-5 h-5 text-rose-600" />}
                  {decision.action === "approve" ? "اعتماد الطلب وتنفيذه" : "رفض الطلب"}
                </DialogTitle>
                <DialogDescription>
                  {decision.action === "approve"
                    ? `هتنفّذ ${decision.row.typeLabel}${decision.row.amount !== null ? ` بمبلغ ${fmtPiastres(decision.row.amount)} ج` : ""}${decision.row.student ? ` للطالب ${decision.row.student.name}` : ""} فور الاعتماد — العملية دي بتاخد أثر مالي وبتتحفظ في السجل.`
                    : `مفيش أي تغيير مالي هيحصل — بس القرار بيتسجل في سجل العمليات وبيتوصل للموظف.`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-muted/40 p-3 text-[13px] font-semibold space-y-1">
                  <p><span className="text-muted-foreground">الطلب:</span> {decision.row.number} · {decision.row.typeLabel}</p>
                  <p><span className="text-muted-foreground">من:</span> {decision.row.requestedByName}</p>
                  <p><span className="text-muted-foreground">السبب:</span> {decision.row.reason}</p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="decision-note" className="text-xs font-extrabold">
                    {decision.action === "approve" ? "ملاحظة على الاعتماد (اختياري)" : "سبب الرفض (إجباري)"}
                  </label>
                  <textarea
                    id="decision-note"
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    rows={2}
                    maxLength={300}
                    placeholder={decision.action === "approve" ? "مثلاً: راجعت كشف الحساب وطلبت المستحق فعلاً" : "اكتب السبب عشان الموظف يفهم القرار"}
                    className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => decide(decision.row, decision.action, decisionNote)}
                    disabled={deciding || (decision.action === "reject" && decisionNote.trim().length < 3)}
                    className={cn(
                      "flex-1 rounded-xl font-extrabold py-3 text-white shadow transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2",
                      decision.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700",
                    )}
                  >
                    {deciding ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Ban className="w-4.5 h-4.5" />}
                    {decision.action === "approve" ? "تأكيد الاعتماد" : "تأكيد الرفض"}
                  </button>
                  <button
                    onClick={() => { setDecision(null); setDecisionNote(""); }}
                    className="rounded-xl border border-border bg-card font-bold px-5"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
