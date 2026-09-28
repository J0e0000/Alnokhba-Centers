"use client";

import { Phone, MessageCircle } from "lucide-react";
import { buildWaUrl, openWhatsAppHandoff } from "./wa";
import { cn } from "@/lib/utils";

/* ============================================================
   ContactActions — تواصل مباشر مع الطالب/ولي الأمر (spec §2)
   اتصال + واتساب لكل جهة (الأرقام الموجودة بس).
   الواتساب handoff صادق: بيفتح wa.me برسالة جاهزة — مفيش إرسال أوتوماتيكي.
============================================================ */

export type ContactTarget = {
  name?: string | null;
  phone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
};

type Size = "sm" | "md";

const SIZE: Record<Size, string> = {
  sm: "h-7 w-7 p-0 rounded-lg",
  md: "h-9 px-2.5 rounded-xl gap-1.5",
};

function CallBtn({ phone, label, size }: { phone: string; label: string; size: Size }) {
  return (
    <a
      href={`tel:${phone}`}
      title={`اتصال ${label} — ${phone}`}
      aria-label={`اتصال ${label}`}
      className={cn("inline-flex items-center justify-center border border-border bg-card text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition", SIZE[size])}
    >
      <Phone className="w-3.5 h-3.5" />
      {size === "md" && <span className="text-[11px] font-extrabold">{label}</span>}
    </a>
  );
}

function WaBtn({ phone, label, message, size }: { phone: string; label: string; message: string; size: Size }) {
  const url = buildWaUrl(phone, message);
  return (
    <button
      type="button"
      title={`واتساب ${label} — ${phone}`}
      aria-label={`واتساب ${label}`}
      onClick={() => {
        const opened = openWhatsAppHandoff(url);
        if (!opened) {
          navigator.clipboard?.writeText(url).catch(() => {});
        }
      }}
      className={cn("inline-flex items-center justify-center border border-border bg-card text-[#128C7E] dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition", SIZE[size])}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {size === "md" && <span className="text-[11px] font-extrabold">{label}</span>}
    </button>
  );
}

/**
 * أزرار تواصل مضغوطة: اتصال/واتساب للطالب + ولي الأمر.
 * بيظهر بس لو الرقم موجود — بدون أرقام يختفي كله.
 * showLabels: مناسب لملف الطالب؛ بدونه مناسب للجداول والقوائم.
 */
export function ContactActions({
  target,
  size = "sm",
  showLabels = false,
  waMessage,
  className,
}: {
  target: ContactTarget;
  size?: Size;
  showLabels?: boolean;
  waMessage?: string;
  className?: string;
}) {
  const studentPhone = (target.phone ?? "").trim();
  const parentPhone = (target.parentPhone ?? "").trim();
  if (!studentPhone && !parentPhone) return null;

  const baseMsg = waMessage?.trim()
    || `معك إدارة السنتر بخصوص ${target.name ?? "الطالب"}.\n`;

  return (
    <div className={cn("inline-flex items-center gap-1 print:hidden", className)} dir="rtl">
      {studentPhone && (
        <>
          <CallBtn phone={studentPhone} label="الطالب" size={size} />
          <WaBtn phone={studentPhone} label="الطالب" message={baseMsg} size={size} />
        </>
      )}
      {parentPhone && (
        <>
          <CallBtn phone={parentPhone} label={target.parentName || "ولي الأمر"} size={size} />
          <WaBtn phone={parentPhone} label={target.parentName || "ولي الأمر"} message={baseMsg} size={size} />
        </>
      )}
    </div>
  );
}
