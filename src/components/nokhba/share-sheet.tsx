"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Share2, QrCode, Loader2, MessageCircle, Download } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildWaUrl, openWhatsAppHandoff } from "./wa";

/* ============================================================
   مشاركة أي حاجة (امتحان/واجب/كويز/إعلان) — QR + كوبي لينك + واتساب.
   - الـ QR بيتولّد على جهاز الموظف (مكتبة qrcode) — مفيش طلب شبكة.
   - اللينك ديب-لينك جوّه بورتال الطالب — يفتح التاب الصح.
   - نسخ اللينك فيه fallback للمتصفحات القديمة (execCommand).
============================================================ */

export function ShareSheet({
  open,
  onOpenChange,
  title,
  path,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string; // اسم الحاجة اللي بتتشير
  path: string; // ديب-لينك داخلي (يبدأ بـ /) مثال: /portal?tab=exams&open=<id>
  description?: string; // سطر اختياري (المجموعة/المادة…)
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  // توليد الـ QR كل ما الشيت يتفتح (أو اللينك يتغير)
  useEffect(() => {
    if (!open) { setQrDataUrl(null); setCopied(false); return; }
    let cancelled = false;
    setQrBusy(true);
    import("qrcode")
      .then((QR) => QR.toDataURL(fullUrl, {
        width: 560,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      }))
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); })
      .finally(() => { if (!cancelled) setQrBusy(false); });
    return () => { cancelled = true; };
  }, [open, fullUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success("اللينك اتنسخ — ابعتله للطلاب في أي مكان");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // fallback للمتصفحات اللي بتمنع الكليبورد جوه الإطار
      try {
        const ta = document.createElement("textarea");
        ta.value = fullUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        toast.success("اللينك اتنسخ");
        setTimeout(() => setCopied(false), 2500);
      } catch {
        toast.error("انسخ اللينك يدويًا من الصندوق تحت");
      }
    }
  }

  function shareWhatsApp() {
    const msg = `${title}\n${description ? `${description}\n` : ""}افتح من هنا: ${fullUrl}`;
    const ok = openWhatsAppHandoff(buildWaUrl("", msg).replace("https://wa.me/?text=", "https://wa.me/?text="));
    // buildWaUrl("", …) بيطلع wa.me بدون رقم — مشاركة لجهة اتصال تختارها الطالب/الموظف
    if (!ok) {
      void copyLink();
      toast.info("واتساب اتقفل من المتصفح — نسخنا اللينك، الصقه في الشات");
    }
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: description ? `${title} — ${description}` : title, url: fullUrl });
        return;
      } catch { /* المستخدم قفل الشيت — مفيش حاجة */ }
    }
    void copyLink();
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, "")}.png`;
    a.click();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0">
              <Share2 className="w-5 h-5 text-white" />
            </span>
            مشاركة
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="text-center space-y-0.5">
            <p className="font-extrabold text-sm leading-snug">{title}</p>
            {description && <p className="text-[11px] font-bold text-muted-foreground">{description}</p>}
          </div>

          {/* ============================= QR ============================= */}
          <div className="rounded-2xl border border-border bg-card p-3 grid place-items-center">
            {qrBusy ? (
              <div className="h-56 grid place-items-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qrDataUrl} alt={`QR — ${title}`} className="w-56 h-56 rounded-xl" />
            ) : (
              <div className="h-56 grid place-items-center text-muted-foreground">
                <QrCode className="w-10 h-10" />
              </div>
            )}
            <p className="text-[10px] font-bold text-muted-foreground mt-2">
              الطالب يمسح الكود بكاميرا موبايله — هيفتح الحاجة دي في بورتاله على طول
            </p>
          </div>

          {/* ============================= اللينك ============================= */}
          <div className="flex items-center gap-2 rounded-xl border border-input bg-muted/40 px-3 py-2">
            <input
              readOnly
              value={fullUrl}
              dir="ltr"
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 bg-transparent text-[11px] font-bold nk-num outline-none min-w-0"
            />
            <button
              onClick={copyLink}
              aria-label="نسخ اللينك"
              className="shrink-0 w-9 h-9 rounded-lg nk-brand-bg text-white grid place-items-center active:scale-95 transition"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* ============================= أزرار المشاركة ============================= */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={shareWhatsApp}
              className="h-11 rounded-xl bg-[#25D366] text-white font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition"
            >
              <MessageCircle className="w-4 h-4" /> واتساب
            </button>
            <button
              onClick={nativeShare}
              className="h-11 rounded-xl border-2 border-border bg-card font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition"
            >
              <Share2 className="w-4 h-4" /> مشاركة
            </button>
            <button
              onClick={downloadQr}
              disabled={!qrDataUrl}
              className="h-11 rounded-xl border-2 border-border bg-card font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> حفظ الكود
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
