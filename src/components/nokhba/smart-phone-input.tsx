"use client";

import { cn } from "@/lib/utils";
import { smartPhoneDigits } from "@/lib/normalize";

/* ============================================================
   SmartPhoneInput — تسجيل الأرقام الذكي (طلب المالك):
   «خليني لما اكتب الرقم يحط قبله +2 بس ميحذفش حاجة يعني»
   • +2 ثابتة جوه الحقل قبل الرقم — بتظهر لوحدها من غير ما تكتبها.
   • بيقبل أي صيغة: 01xxxxxxxxx / +201012345678 / 00201012345678 /
     20 101 234 5678 / أرقام عربية ٠١٠… — وبيطبّعها لوحده.
   • مش بيمسح حاجة: الأرقام اللي بتكتبها بتفضل موجودة —
     التعديل الوحيد هو شيل كود الدولة المكرر (+2/20/0020).
============================================================ */

export function SmartPhoneInput({
  value,
  onChange,
  placeholder = "01xxxxxxxxx",
  hasError = false,
  className,
  id,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hasError?: boolean;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={cn("relative", className)} dir="ltr">
      {/* +2 ثابتة — بتظهر قبل الرقم أوتوماتيك زي ما المالك طلب */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 pr-1.5 text-sm font-extrabold nk-num text-muted-foreground select-none"
      >
        +2
      </span>
      <input
        id={id}
        dir="ltr"
        inputMode="tel"
        autoComplete="off"
        className={cn(
          "w-full h-11 rounded-xl border-2 bg-card px-3.5 font-semibold text-sm nk-num focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition",
          hasError ? "border-rose-300 focus-visible:ring-rose-400" : "border-input",
          "pl-10",
        )}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          // تطبيع ذكي غير مدمّر: أرقام عربية/دولية/مسافات كلها تتظبط — الأرقام نفسها ما بتضيعش
          onChange(smartPhoneDigits(e.target.value).slice(0, 11));
        }}
      />
    </div>
  );
}
