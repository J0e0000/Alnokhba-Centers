"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Loader2, Copy, Check } from "lucide-react";
import { api } from "./lib";
import { openWhatsAppHandoff } from "./wa";

/**
 * WhatsAppHandoffButton — تنبيه واتساب صادق (manual handoff):
 * يجهّز الرسالة من قالب السنتر → يسجّل محاولة الإرسال → يفتح محادثة واتساب
 * لولي الأمر برسالة جاهزة. الإرسال الفعلي بيعمله الموظف بنفسه.
 *
 * الصدق في الحالات:
 * - «تم فتح واتساب» (OPENED) لما المحادثة تتفتح فقط — دي أقصى حقيقة متاحة
 * - «تم الإرسال» (SENT) محجوزة لتأكيد صريح من الموظف بعد ما يبعت فعلاً
 *
 * إصلاح iPhone/Safari: بعد أي await المتصفح بيعتبر window.open popup مش
 * مستخدم-initiated ويقفله — فعلى iOS بنستخدم تنقل في نفس التاب.
 */
export function WhatsAppHandoffButton({ studentId, txnId, template, size = "lg", onOpen }: {
  studentId: string;
  txnId?: string;
  template: "payment_confirm" | "low_balance";
  size?: "sm" | "lg";
  onOpen?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true);
    onOpen?.();
    try {
      const res = await api<{ attemptId: string; waUrl: string; message: string }>("/api/notify", {
        method: "POST",
        body: { studentId, txnId, template },
      });

      // فتح محادثة واتساب بأفضل طريقة للمتصفح (نفس التاب على iOS)
      const didOpen = openWhatsAppHandoff(res.waUrl);
      if (didOpen) {
        toast.success("فتحنا محادثة واتساب بالرسالة الجاهزة — راجعها وابعتها هناك.", { duration: 5000 });
        setOpened(true);
        // نسجّل الحقيقة: المحادثة اتفتحت (مش إنه اتبعت)
        api("/api/notify", { method: "PATCH", body: { attemptId: res.attemptId, status: "OPENED" } }).catch(() => {});
      } else {
        // الـ popup اتقفل — fallback: نسخ الرسالة
        await navigator.clipboard.writeText(res.message).catch(() => {});
        toast.error("المتصفح قفل النافذة — اتمنسخت الرسالة، الصقها في واتساب بنفسك.", { duration: 6000 });
        api("/api/notify", { method: "PATCH", body: { attemptId: res.attemptId, status: "FAILED", error: "popup blocked" } }).catch(() => {});
      }
    } catch { /* toast already shown by api helper */ } finally { setBusy(false); }
  }

  async function copyMessage() {
    if (busy) return;
    setBusy(true);
    onOpen?.();
    try {
      const res = await api<{ message: string }>("/api/notify", {
        method: "POST",
        body: { studentId, txnId, template },
      });
      await navigator.clipboard.writeText(res.message);
      toast.success("اتنسخت الرسالة — الصقها في أي محادثة.");
    } catch { /* toast */ } finally { setBusy(false); }
  }

  const btn = size === "lg" ? "px-4 py-2.5 text-sm gap-2" : "px-3 py-2 text-xs gap-1.5";

  return (
    <div className="flex flex-col gap-1.5">
      <button onClick={send} disabled={busy}
        title="يفتح محادثة واتساب لولي الأمر برسالة جاهزة — الإرسال بيبقى منك"
        className={`bg-[#25D366] text-white font-extrabold rounded-xl shadow inline-flex items-center justify-center disabled:opacity-60 hover:brightness-95 ${btn}`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : opened ? <Check className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
        {opened ? "تم فتح واتساب" : "واتساب للوالد"}
      </button>
      <button onClick={copyMessage} disabled={busy}
        className="text-[11px] font-bold text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 disabled:opacity-60">
        <Copy className="w-3 h-3" /> نسخ الرسالة بدل كده
      </button>
    </div>
  );
}
