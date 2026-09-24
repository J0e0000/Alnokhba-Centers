"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/nokhba/login";
import { api, type SessionUser } from "@/components/nokhba/lib";

/* بوابة الدخول الموحدة — /login
   جلسة موجودة؟ → التطبيق المناسب حسب النطاق (أكاديميا / سنترز).
   بعد الدخول: النطاق هو اللي بيحدد الوجهة (scope-aware redirect). */
export default function LoginPage() {
  const router = useRouter();

  const destFor = (u: SessionUser | null | undefined) => {
    if (!u) return "/login";
    if (u.scope === "academia") return "/academia";
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
