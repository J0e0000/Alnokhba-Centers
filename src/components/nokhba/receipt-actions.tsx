"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Printer, Loader2, ReceiptText, PrinterCheck, BellOff } from "lucide-react";
import { api, type SessionUser } from "./lib";
import { usePrint } from "./print";
import { PrintableReceiptA4, PrintableReceiptThermal, type ReceiptData } from "./print";
import { cn } from "@/lib/utils";

/**
 * ReceiptActions — يظهر بعد أي دفعة ناجحة.
 * زرارين طباعة واضحين على طول (من غير منيو مخفي):
 *   1) «طباعة الإيصال» → A4 (ولي الأمر) — الزرار الرئيسي الأخضر
 *   2) «ثيرمال 80مم» → نسخة الكاشير
 * مبيدّعيش إن الإيصال اتطبع غير لما أمر الطباعة نفسه يتفتح فعلاً.
 */
export function ReceiptActions({ txnId, center, size = "sm" }: {
  txnId: string;
  center: SessionUser["center"];
  size?: "sm" | "lg";
}) {
  const print = usePrint();
  const [busy, setBusy] = useState<"a4" | "thermal" | null>(null);

  async function printReceipt(mode: "a4" | "thermal") {
    if (busy) return;
    setBusy(mode);
    try {
      const data = await api<ReceiptData>(`/api/receipts?txnId=${txnId}`);
      print(
        mode === "a4"
          ? <PrintableReceiptA4 data={data} center={center} />
          : <PrintableReceiptThermal data={data} center={center} />,
        `إيصال ${data.receipt.number} — ${data.center.name}`,
      );
    } catch { /* toast already shown */ } finally { setBusy(null); }
  }

  const big = size === "lg";
  const primaryCls = big
    ? "flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 shadow inline-flex items-center justify-center gap-2 text-sm disabled:opacity-60"
    : "flex-1 nk-brand-bg text-white font-extrabold rounded-xl px-3 py-2 shadow inline-flex items-center justify-center gap-1.5 text-xs disabled:opacity-60";
  const thermalCls = big
    ? "border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text font-extrabold rounded-xl px-4 py-3 shadow-sm inline-flex items-center justify-center gap-2 text-sm disabled:opacity-60"
    : "border-2 border-border bg-card nk-brand-text font-extrabold rounded-xl px-3 py-2 inline-flex items-center justify-center gap-1.5 text-xs disabled:opacity-60";

  return (
    <div className="flex gap-2 w-full">
      <button onClick={() => printReceipt("a4")} disabled={busy !== null} className={primaryCls}>
        {busy === "a4"
          ? <Loader2 className="w-4.5 h-4.5 animate-spin" />
          : <Printer className="w-4.5 h-4.5" />}
        طباعة الإيصال
      </button>
      <button onClick={() => printReceipt("thermal")} disabled={busy !== null} className={thermalCls} title="طباعة ثيرمال 80mm (كاشير)">
        {busy === "thermal"
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <ReceiptText className="w-4 h-4" />}
        ثيرمال
      </button>
    </div>
  );
}

/**
 * TransactionPrintButton — زرار طباعة صغير لأي معاملة (دفع / استرداد / تسوية)
 * بيتحط في صفوف سجل الدفعات وكشف حساب الطالب. ضغطة واحدة → إيصال A4
 * فيه التاريخ والوقت واسم الموظف اللي عمل المعاملة.
 */
export function TransactionPrintButton({ txnId, center, title }: {
  txnId: string;
  center: SessionUser["center"] | null;
  title?: string;
}) {
  const print = usePrint();
  const [busy, setBusy] = useState(false);

  async function printTxn() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api<ReceiptData>(`/api/receipts?txnId=${txnId}`);
      print(
        <PrintableReceiptA4 data={data} center={center} />,
        `إيصال ${data.receipt.number ?? "معاملة"} — ${data.center.name}`,
      );
    } catch { /* toast already shown */ } finally { setBusy(false); }
  }

  return (
    <button
      onClick={printTxn}
      disabled={busy}
      title={title ?? "طباعة الإيصال"}
      className="shrink-0 w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted grid place-items-center transition disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
    </button>
  );
}

/**
 * PrintSettingsButton — إعدادات الطباعة التلقائية (لكل موظف على حدة):
 * تشغيل/إيقاف الطباعة التلقائية بعد كل دفعة + اختيار الصيغة (ثيرمال 80mm أو A4).
 * بتتحدث على السيرفر فبتلاحق الموظف في أي جهاز.
 */
export function PrintSettingsButton({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const auto = user.autoPrintReceipt ?? false;
  const format = user.receiptFormat ?? "THERMAL";

  async function save(nextAuto: boolean, nextFormat: "THERMAL" | "A4") {
    setBusy(true);
    try {
      const res = await api<{ user: SessionUser }>("/api/auth", {
        method: "POST",
        body: { action: "update-prefs", autoPrintReceipt: nextAuto, receiptFormat: nextFormat },
      });
      window.dispatchEvent(new CustomEvent("nk-user-updated", { detail: res.user }));
      toast.success(
        nextAuto
          ? `الطباعة التلقائية شغالة — كل دفعة هتجهز إيصال ${nextFormat === "A4" ? "A4" : "ثيرمال"} فورًا.`
          : "الطباعة التلقائية اتقفلت — الإيصال بضغطة زرار عادي.",
      );
      setOpen(false);
    } catch { /* toast shown */ } finally { setBusy(false); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={auto ? `الطباعة التلقائية شغالة (${format === "A4" ? "A4" : "ثيرمال"})` : "الطباعة التلقائية مقفولة"}
        aria-label="إعدادات الطباعة التلقائية"
        className={cn(
          "w-9 h-9 rounded-xl border grid place-items-center transition",
          auto ? "nk-brand-bg-soft nk-brand-text border-transparent" : "bg-card border-border text-muted-foreground"
        )}
      >
        {auto ? <PrinterCheck className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-card w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <Printer className="w-5 h-5 nk-brand-text" /> الطباعة التلقائية
              </h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground text-sm font-bold">إلغاء</button>
            </div>

            <p className="text-xs font-bold text-muted-foreground bg-muted/60 rounded-xl px-3 py-2 leading-relaxed">
              لما تشغّلها: كل دفعة تتسجل بنجاح → الإيصال بيجهز للطباعة على طول من غير أي زرار. الإيصال بيطلع باسمك وبالتاريخ والوقت.
            </p>

            <div className="space-y-2">
              <p className="text-xs font-extrabold text-muted-foreground">الصيغة:</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(true, "THERMAL")}
                  className={cn(
                    "rounded-xl border-2 px-3 py-3 text-sm font-extrabold transition text-start space-y-0.5",
                    auto && format === "THERMAL"
                      ? "nk-brand-bg text-white border-transparent shadow"
                      : "border-border bg-card hover:bg-muted/50"
                  )}
                >
                  ثيرمال 80mm
                  <span className="block text-[10px] font-bold opacity-70">طابعة الكاشير الصغيرة</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(true, "A4")}
                  className={cn(
                    "rounded-xl border-2 px-3 py-3 text-sm font-extrabold transition text-start space-y-0.5",
                    auto && format === "A4"
                      ? "nk-brand-bg text-white border-transparent shadow"
                      : "border-border bg-card hover:bg-muted/50"
                  )}
                >
                  A4
                  <span className="block text-[10px] font-bold opacity-70">ورق عادي لولي الأمر</span>
                </button>
              </div>

              {auto && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(false, format)}
                  className="w-full rounded-xl border-2 border-border bg-card px-3 py-2.5 text-xs font-extrabold text-muted-foreground hover:bg-muted/50 transition flex items-center justify-center gap-1.5"
                >
                  <BellOff className="w-4 h-4" /> {busy ? "..." : "اقفل الطباعة التلقائية"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
