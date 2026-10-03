"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/nokhba/login";
import { api, type SessionUser } from "@/components/nokhba/lib";

/* بوابة الدخول الموحدة — /login
   جلسة موجودة؟ → التطبيق المناسب حسب النطاق (أكاديميا / سنترز).
   بعد الدخول: النطاق هو اللي بيحدد الوجهة (scope-aware redirect).
   ?next=/path — وجهة داخلية اختيارية (لسباق تسجيل حضور الموظفين من /c/…) —
   مسموح بس بمسار داخلي يبدأ بـ "/" (حماية open-redirect). */
export default function LoginPage() {
  const router = useRouter();

  const safeNext = () => {
    try {
      const n = new URLSearchParams(window.location.search).get("next");
      return n && n.startsWith("/") && !n.startsWith("//") ? n : null;
    } catch { return null; }
  };

  const destFor = (u: SessionUser | null | undefined) => {
    if (!u) return "/login";
    if (u.scope === "academia") return "/academia";
    const next = safeNext();
    if (next) return next; // مركزز → وجهة داخلية مطلوبة (حضور الموظفين)
    return "/app";
  };

  // جلسة موجودة؟ يبقى مفيش لازمة لشاشة الدخول — ادخل
  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/auth", { silent: true })
      .then((d) => {
        if (d.user) router.replace(destFor(d.user));
      })
      .catch(() => {});
  }, [router]);

  return (
    <LoginScreen
      onLogin={(user) => {
        // تحميل كامل للنظام المناسب — حالة نظيفة من أول وجديد
        window.location.href = destFor(user);
      }}
    />
  );
}
