"use client";

import { useEffect, useState } from "react";
import { Copy, Check, QrCode, Loader2, MessageCircle, Download, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildWaUrl, openWhatsAppHandoff } from "./wa";

/* ============================================================
   StudentQrLinkModal — «خليني اقدر ابعت qr link زرار واضح» (طلب المالك).
   الفكرة من repo المالك المرجعي (StudentQRModal):
   • الـ QR بيشفّر لينك البورتال الكامل (/portal?qr=توكن) — مش التوكن الخام —
     فكاميرا الموبايل العادية بتفتح بورتال الطالب مسجّل على طول.
   • اللينك دايمًا ملزوق جوه رسالة الواتساب (مش بيتنسى أبدًا).
   • هامش الـ QR واسع (4 وحدات) عشان السكرين شوت والصور تتقري بسهولة.
   ملاحظة أمنية: اللينك ده هو هوية الطالب في البورتال — زيه زي كارته.
============================================================ */

export function StudentQrLinkModal({
  open,
  onOpenChange,
  student,
  centerName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  student: { name: string; code: string; phone: string | null; parentPhone: string | null; qrToken: string };
  centerName?: string | null;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const portalLink = typeof window !== "undefined" && student.qrToken
    ? `${window.location.origin}/portal?qr=${student.qrToken}`
    : "";

  // توليد QR اللينك كل ما الشيت يتفتح
  useEffect(() => {
    if (!open || !portalLink) { setQrDataUrl(null); setCopied(false); return; }
    let cancelled = false;
    setQrBusy(true);
    import("qrcode")
      .then((QR) => QR.toDataURL(portalLink, {
        width: 560,
        margin: 4, // هامش واسع — السكرين شوت يتقري من أي كاميرا (نفس إصلاح الريبو المرجعي)
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      }))
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(null); })
      .finally(() => { if (!cancelled) setQrBusy(false); });
    return () => { cancelled = true; };
  }, [open, portalLink]);

  async function copyLink(silent = false) {
    if (!portalLink) return;
    try {
      await navigator.clipboard.writeText(portalLink);
    } catch {
      // fallback للمتصفحات القديمة
      try {
        const ta = document.createElement("textarea");
        ta.value = portalLink;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        toast.error("انسخ اللينك يدويًا من الصندوق");
        return;
      }
    }
    setCopied(true);
    if (!silent) toast.success("لينك الطالب اتنسخ — ابعتله في أي مكان");
    setTimeout(() => setCopied(false), 2500);
  }

  function sendWhatsApp() {
    if (!portalLink || sending) return;
    const firstName = student.name.trim().split(/\s+/)[0] ?? student.name;
    const msg = [
      `أهلًا ${firstName}،`,
      `ده لينك بورتالك في ${centerName || "السنتر"} — بيفتح من غير تسجيل دخول:`,
      portalLink,
      "احتفظ باللينك ده — رصيدك وجدولك وواجباتك كلها فيه في أي وقت.",
    ].join("\n");
    const target = student.phone?.trim() || student.parentPhone?.trim() || "";
    setSending(true);
    try {
      const ok = target
        ? openWhatsAppHandoff(buildWaUrl(target, msg))
        : openWhatsAppHandoff(`https://wa.me/?text=${encodeURIComponent(msg)}`);
      if (!ok) {
        void copyLink(true);
        toast.info("واتساب اتقفل من المتصفح — نسخنا اللينك، الصقه في الشات");
      }
    } finally { setSending(false); }
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `QR-portal-${student.name.replace(/[\\/:*?"<>|\s]+/g, "_")}.png`;
    a.click();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl nk-brand-bg grid place-items-center shrink-0">
              <QrCode className="w-5 h-5 text-white" />
            </span>
            لينك بورتال الطالب
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="text-center space-y-0.5">
            <p className="font-extrabold text-sm leading-snug">{student.name}</p>
            <p className="text-[11px] font-bold text-muted-foreground">
              كود <span className="nk-num">{student.code}</span> — الطالب يفتح اللينك ده من غير تسجيل دخول خالص
            </p>
          </div>

          {/* ============================= QR ============================= */}
          <div className="rounded-2xl border border-border bg-card p-3 grid place-items-center">
            {qrBusy ? (
              <div className="h-56 grid place-items-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR بورتال — ${student.name}`} className="w-56 h-56 rounded-xl" />
            ) : (
              <div className="h-56 grid place-items-center text-muted-foreground">
                <QrCode className="w-10 h-10" />
              </div>
            )}
            <p className="text-[10px] font-bold text-muted-foreground mt-2">
              الطالب أو ولي الأمر يمسح الكود بكاميرا الموبايل — البورتال بيفتح مسجّل على طول
            </p>
          </div>

          {/* ============================= اللينك ============================= */}
          <div className="flex items-center gap-2 rounded-xl border border-input bg-muted/40 px-3 py-2">
            <input
              readOnly
              value={portalLink}
              dir="ltr"
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 bg-transparent text-[11px] font-bold nk-num outline-none min-w-0"
            />
            <button
              onClick={() => copyLink()}
              aria-label="نسخ اللينك"
              className="shrink-0 w-9 h-9 rounded-lg nk-brand-bg text-white grid place-items-center active:scale-95 transition"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* ============================= أزرار الإرسال ============================= */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={sendWhatsApp}
              disabled={sending || !portalLink}
              className="h-11 rounded-xl bg-[#25D366] text-white font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition disabled:opacity-50"
            >
              <MessageCircle className="w-4 h-4" /> ابعت واتساب
            </button>
            <button
              onClick={downloadQr}
              disabled={!qrDataUrl}
              className="h-11 rounded-xl border-2 border-border bg-card font-extrabold text-xs flex flex-col items-center justify-center gap-0.5 active:scale-[0.98] transition disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> حفظ الكود
            </button>
          </div>

          <p className="text-[10px] font-bold text-muted-foreground flex items-start gap-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 leading-relaxed">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            اللينك ده هو دخول الطالب للبورتال — سيبه معاه هو أو ولي أمره بس، زي كارته بالظبط.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
