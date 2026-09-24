"use client";

import { useState } from "react";
import { toast } from "sonner";
import { LogIn, ShieldCheck, UserRound, KeyRound, Smartphone, GraduationCap, Briefcase, ArrowRight, UserPlus, Loader2 } from "lucide-react";
import { api, normalizeDigits, type SessionUser } from "./lib";
import { AlNokhbaMark } from "./shared";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

const DEMO_ACCOUNTS = [
  { username: "aca-teacher1", pw: "academia123", label: "مدرس — أكاديميا النخبة", desc: "سير العمل الصفي اليومي" },
  { username: "aca-manager", pw: "academia123", label: "مدير — أكاديميا النخبة", desc: "المجموعات والجداول والتقارير" },
  { username: "aca-admin", pw: "academia123", label: "أدمن — أكاديميا النخبة", desc: "كل الصلاحيات + سجل التدقيق" },
  { username: "aca-student1", pw: "academia123", label: "طالب — أكاديميا النخبة", desc: "بوابة الطالب" },
  { username: "manager", label: "مدير — مركز النخبة (سنترز)", desc: "كل الصلاحيات" },
  { username: "reception", label: "موظف استقبال — النخبة (سنترز)", desc: "عمليات يومية" },
  { username: "admin", label: "أدمن منصة النخبة (سنترز)", desc: "السناتر والاشتراكات" },
];

// أزرار الدخول السريع دي للتجربة بس — بتتخبى في أي build بدون المتغير ده
const SHOW_DEMO = process.env.NEXT_PUBLIC_DEMO_LOGINS === "1";

export function LoginScreen({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  async function submit(e?: React.FormEvent, quick?: string, quickPw?: string) {
    e?.preventDefault();
    const u = normalizeDigits(quick ?? username).trim().toLowerCase();
    const p = quick ? (quickPw ?? "nokhba123") : password;
    if (!u || !p) {
      toast.error("اكتب اسم المستخدم وكلمة السر.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ user: SessionUser }>("/api/auth", {
        method: "POST",
        body: { username: u, password: p },
      });
      onLogin(res.user);
    } catch {
      // toast already shown by api helper
    } finally {
      setBusy(false);
    }
  }

  // quick chips default password per product scope
  function quickSubmit(acc: (typeof DEMO_ACCOUNTS)[number]) {
    submit(undefined, acc.username, acc.pw ?? "nokhba123");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden nk-safe-top">
      {/* soft brand blobs — كحلي اللوجو + لمسة ذهبية */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -start-24 w-96 h-96 rounded-full opacity-[0.14] nk-brand-bg blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -end-24 w-[28rem] h-[28rem] rounded-full opacity-[0.10] nk-brand-bg blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-1/3 end-[-6rem] w-72 h-72 rounded-full opacity-[0.08] nk-gold-bg blur-3xl" />

      <div className="w-full max-w-md z-10">
        <div className="flex flex-col items-center gap-3 mb-6 text-center">
          <AlNokhbaMark size={56} />
          <div>
            <h1 className="text-2xl font-extrabold mt-1 nk-brand-text">نخبة سنترز</h1>
            <span className="block nk-portal-divider mx-auto mt-2" aria-hidden />
            <p className="text-sm text-muted-foreground mt-1.5">
              نظام تشغيل السنترات — حضور وحسابات من غير وجع دماغ
            </p>
          </div>
        </div>

        {/* ===== تسجيل الدخول ===== */}
        <form onSubmit={submit} className="nk-glass rounded-3xl p-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-sm font-bold flex items-center gap-1.5">
              <UserRound className="w-4 h-4 text-muted-foreground" /> اسم المستخدم
            </label>
            <input
              id="username"
              dir="ltr"
              className="flex h-12 w-full rounded-xl border border-input bg-card px-4 text-start font-semibold tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="manager"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-bold flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-muted-foreground" /> كلمة السر
            </label>
            <input
              id="password"
              type="password"
              dir="ltr"
              className="flex h-12 w-full rounded-xl border border-input bg-card px-4 text-start font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="••••••••"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="nk-btn-brand w-full h-12 rounded-xl font-extrabold text-base flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <span className="w-5 h-5 rounded-full border-[3px] border-white/60 border-t-white animate-spin" /> : <LogIn className="w-5 h-5" />}
            {busy ? "جاري الدخول..." : "دخول"}
          </button>

          {/* سجل حساب جديد — بيروح للأدمن موافقة وتعيين لسنتر */}
          <button
            type="button"
            onClick={() => setSignupOpen(true)}
            disabled={busy}
            className="w-full h-12 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-card nk-brand-text hover:border-[color-mix(in_srgb,var(--c-primary)_55%,white)] transition active:scale-[0.99] disabled:opacity-60"
          >
            <UserPlus className="w-4.5 h-4.5" /> مركز جديد؟ سجّل حسابك
          </button>

          {SHOW_DEMO && (
            <div className="pt-2">
              <p className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> حسابات تجريبية — دوس عليها للدخول السريع (أكاديميا: academia123 · سنترز: nokhba123)
              </p>
              <div className="grid gap-2">
                {DEMO_ACCOUNTS.map((d) => (
                  <button
                    key={d.username}
                    type="button"
                    disabled={busy}
                    onClick={() => quickSubmit(d)}
                    className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white/80 hover:bg-muted/60 px-3.5 py-2.5 text-start transition disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-sm font-bold">{d.label}</span>
                      <span className="block text-[11px] text-muted-foreground">{d.desc}</span>
                    </span>
                    <code dir="ltr" className="text-xs bg-muted rounded-md px-2 py-1 font-bold">{d.username}</code>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>

        <p className="text-center text-[11px] text-muted-foreground mt-5 flex items-center justify-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5" />
          النخبة سنترز — امتداد رسمي من منظومة النخبة التعليمية
        </p>

        <div className="mt-3 grid gap-2 mx-auto w-fit">
          <a
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-border bg-white/70 px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted/60 transition"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            رجوع للصفحة الرئيسية
          </a>
          <a
            href="/portal"
            className="flex items-center gap-1.5 rounded-full border border-border bg-white/70 px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted/60 transition"
          >
            <GraduationCap className="w-3.5 h-3.5" />
            طالب؟ افتح بورتال الطالب من هنا
          </a>
          <a
            href="/teacher"
            className="flex items-center justify-center gap-1.5 rounded-full border border-border bg-white/70 px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted/60 transition"
          >
            <Briefcase className="w-3.5 h-3.5" />
            مدرس؟ افتح بورتال المدرس من هنا
          </a>
        </div>
      </div>

      {/* ===== تسجيل حساب جديد (طلب انضمام — بيمشي للأدمن موافقة) ===== */}
      <SignupDialog open={signupOpen} onClose={() => setSignupOpen(false)} />
    </main>
  );
}

// ============================= تسجيل حساب جديد =============================

function SignupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", username: "", password: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/api/auth", {
        method: "POST",
        body: { action: "signup", ...form },
      });
      toast.success(res.message || "تم استلام طلبك — إدارة النخبة هتراجعه.", { duration: 7000 });
      setDone(true);
    } catch {
      // toast already shown
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "flex h-11 w-full rounded-xl border border-input bg-card px-4 text-start font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setDone(false); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 nk-brand-text" /> تسجيل حساب جديد
          </DialogTitle>
          <DialogDescription>
            سجّل بياناتك — إدارة النخبة هتوصّلها فورًا، وبتعيينك لسنترك هتقدر تسجل دخول عادي.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 text-center py-2">
            <span className="w-14 h-14 rounded-full bg-emerald-50 border-2 border-emerald-200 text-emerald-600 grid place-items-center mx-auto">
              <ShieldCheck className="w-7 h-7" />
            </span>
            <p className="text-sm font-extrabold">طلبك وصل لإدارة النخبة ✦</p>
            <p className="text-xs text-muted-foreground font-semibold leading-relaxed">
              هيتم مراجعة طلبك وتعيينك لسنتر. بمجرد الموافقة هتقدر تسجل دخول بنفس
              اسم المستخدم وكلمة السر اللي اخترتهم — وهيوصلك إشعار فور اتخاذ القرار.
            </p>
            <button
              onClick={() => { onClose(); setDone(false); }}
              className="nk-btn-brand w-full h-11 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2"
            >
              تمام، فهمت
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            <div className="space-y-1.5">
              <label htmlFor="su-name" className="text-xs font-extrabold">الاسم الكامل</label>
              <input
                id="su-name"
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="مثلاً: أ. محمد السيد"
                disabled={busy}
                required
                minLength={3}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="su-username" className="text-xs font-extrabold">اسم المستخدم (إنجليزي)</label>
              <input
                id="su-username"
                dir="ltr"
                className={inputCls}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.replace(/[^a-zA-Z0-9_.]/g, "").toLowerCase() })}
                placeholder="mohamed_say"
                disabled={busy}
                required
                minLength={3}
                maxLength={20}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="su-password" className="text-xs font-extrabold">كلمة السر</label>
              <input
                id="su-password"
                type="password"
                dir="ltr"
                className={inputCls}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="6 حروف على الأقل"
                disabled={busy}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="su-phone" className="text-xs font-extrabold">رقم الموبايل</label>
              <input
                id="su-phone"
                dir="ltr"
                inputMode="numeric"
                className={inputCls}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: normalizeDigits(e.target.value).replace(/\D/g, "") })}
                placeholder="01xxxxxxxxx"
                disabled={busy}
                required
              />
              <p className="text-[10px] text-muted-foreground font-bold">عشان نكلّمك لو احتجنا توضيح على الطلب</p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 nk-btn-brand h-12 rounded-xl font-extrabold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <UserPlus className="w-4.5 h-4.5" />}
                {busy ? "جاري الإرسال..." : "ابعت الطلب"}
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
