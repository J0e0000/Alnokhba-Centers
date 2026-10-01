"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LogIn, GraduationCap, Briefcase, QrCode, Wallet, Receipt, BellRing,
  Calculator, WifiOff, FileSpreadsheet, MessageCircle, ArrowLeft,
  ShieldCheck, Zap, Sparkles, Building2, Users, CalendarDays, ClipboardCheck,
  RefreshCw, Clock, TrendingUp, Lock, FileKey, ScrollText, ArrowDown,
  Menu, X, MonitorSmartphone, Landmark,
} from "lucide-react";
import { api, type SessionUser } from "./lib";
import { AlNokhbaMark } from "./shared";

/* ============================================================
   صفحة الهبوط (Landing) — البوابة العامة لمنتج ALNOKHBA CENTERS.
   هوية اللوجو الرسمي: كحلي #143159 + ذهبي D5A134 + Cairo.
   أقسام: Navbar · Hero بموك-أب حقيقي · ١١ ميزة · ٤ خطوات ·
   وضع الطوارئ · الأمان · سير العمل (٣ أدوار) · CTA · فوتر.
============================================================ */

const FEATURES = [
  { icon: <Users className="w-5 h-5" />, title: "الطلاب", body: "ملف كامل لكل طالب — كود 5 أرقام، كارت QR، ولي أمر، ورصيد لحظي." },
  { icon: <Landmark className="w-5 h-5" />, title: "المجموعات", body: "مجموعات بالمراحل والمواد والمدرسين — بأسعارها ونسب المدرس فيها." },
  { icon: <CalendarDays className="w-5 h-5" />, title: "الحصص", body: "فتح وقفل الحصص بأوقاتها الفعلية — حالات شغّالة/خلصت/ملغاة بوضوح." },
  { icon: <ClipboardCheck className="w-5 h-5" />, title: "الحضور", body: "امسح كارت الطالب — الحضور يتسجل والخصم يتحسب بالقروش فورًا." },
  { icon: <Wallet className="w-5 h-5" />, title: "الدفعات", body: "إيصالات مرقّمة، الباقي يتحسب ويتحط في المحفظة أو يرجع كاش." },
  { icon: <RefreshCw className="w-5 h-5" />, title: "الاشتراكات", body: "شوف حصص الطالب المستخدمة والباقية وسبق الدفع — وجدّد بضغطة." },
  { icon: <TrendingUp className="w-5 h-5" />, title: "مستحقات المدرسين", body: "نصيب المدرس يتولد من الحصص الفعلية — مستحق ومصروف وشفافية كاملة." },
  { icon: <Clock className="w-5 h-5" />, title: "الجدولة", body: "جدول أسبوعي لكل قاعة — من غير تداخل ولا وجع دماغ." },
  { icon: <MessageCircle className="w-5 h-5" />, title: "التواصل", body: "إشعارات بورتال + واتساب منظم — تنبيه رصيد وتأكيد دفع وإعلانات." },
  { icon: <FileSpreadsheet className="w-5 h-5" />, title: "التقارير", body: "تقارير جاهزة لكل حاجة — تحصيل، مستحقات، حضور، وCSV بضغطة." },
  { icon: <WifiOff className="w-5 h-5" />, title: "وضع الطوارئ", body: "النت قطع؟ نزّل حزمة أوفلاين لمدة 7 أيام — وشغّل السنتر عادي." },
];

const STEPS = [
  { n: "١", title: "جهّز سنترك", body: "المراحل والمواد والمدرسين والمجموعات والقاعات — في دقايق.", icon: <Building2 className="w-5 h-5" /> },
  { n: "٢", title: "سجّل طلابك", body: "كل طالب بياخد كود 5 أرقام وكارت QR — واتسجل في مجموعاته.", icon: <Users className="w-5 h-5" /> },
  { n: "٣", title: "امسح وشغّل", body: "مسح الكارت = حضور + خصم + رصيد لحظي · الدفع بإيصال · الخزنة بتتقفل بالعدّ.", icon: <QrCode className="w-5 h-5" /> },
  { n: "٤", title: "خليك محمي", body: "لو النت قطع — حزمة الطوارئ الأوفلاين بتشغّل الأساسيات لمدة 7 أيام.", icon: <ShieldCheck className="w-5 h-5" /> },
];

const SECURITY = [
  { icon: <Lock className="w-5 h-5" />, title: "دخول آمن بالأدوار", body: "مدير / استقبال / أدمن — كل واحد شايل صلاحياته، والباسوردات متهاش بـ scrypt." },
  { icon: <ShieldCheck className="w-5 h-5" />, title: "عزل كامل بين السنترات", body: "بيانات كل سنتر في نطاق منفصل — مفيش سنتر يشوف حاجة بتاعة سنتر تاني." },
  { icon: <ScrollText className="w-5 h-5" />, title: "سجل تدقيق لكل حركة", body: "كل عملية مالية أو إدارية بتتكتب في سجل append-only باسم الفاعل والوقت." },
  { icon: <Calculator className="w-5 h-5" />, title: "حسابات بالقرش", body: "ليدجر موقّع لكل طالب بالقروش (100 قرش = جنيه) — صفر أخطاء تقريب." },
  { icon: <FileKey className="w-5 h-5" />, title: "رخص طوارئ موقّعة", body: "حزم الطوارئ موقّعة RSA من السيرفر — أي تعديل في الملف يبطّله." },
  { icon: <RefreshCw className="w-5 h-5" />, title: "استرداد محكوم", body: "استيراد الطوارئ بيتحقق من كل معاملة — تكرار مستحيل وتعارض المدير بيقرره." },
];

const ROLES = [
  {
    icon: <Building2 className="w-5 h-5" />,
    title: "المدير",
    body: "واقف على كل حاجة: الخزنة، مستحقات المدرسين، التقارير، الإعلانات، حزم الطوارئ، والهوية البصرية للسنتر.",
    tone: "brand" as const,
  },
  {
    icon: <Briefcase className="w-5 h-5" />,
    title: "المدرس",
    body: "بورتاله بجوايزه: جدوله الأسبوعي، حصصه النهاردة، طلاب مجموعاته، ومستحقاته — من غير أرقام تواصل حد.",
    tone: "gold" as const,
  },
  {
    icon: <GraduationCap className="w-5 h-5" />,
    title: "الاستقبال (المساعد)",
    body: "شغله اليومي: امسح → الحضور والدفع والباقي → الطالب الجاي. وبورتال الطالب بيقلل الزحمة على الزجاج.",
    tone: "ok" as const,
  },
];

const NAV_LINKS = [
  { href: "#features", label: "المميزات" },
  { href: "#how", label: "إزاي بيشتغل" },
  { href: "#emergency", label: "وضع الطوارئ" },
  { href: "#security", label: "الأمان" },
  { href: "#contact", label: "تواصل" },
];

export function LandingPage() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api<{ user: SessionUser | null }>("/api/auth", { silent: true })
      .then((d) => setSession(d.user))
      .catch(() => setSession(null));
  }, []);

  return (
    <main className="light-locked min-h-screen bg-background relative overflow-hidden nk-safe-top">
      {/* خلفية العلامة — كحلي اللوجو + لمسات ذهبية */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -start-32 w-[30rem] h-[30rem] rounded-full opacity-[0.13] nk-brand-bg blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-[30%] -end-40 w-[34rem] h-[34rem] rounded-full opacity-[0.08] nk-gold-bg blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -start-24 w-[36rem] h-[36rem] rounded-full opacity-[0.10] nk-brand-bg blur-3xl" />

      {/* ================= NAVBAR ================= */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-white/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 group" aria-label="النخبة سنترز — الرئيسية">
            <AlNokhbaMark size={40} />
            <span className="hidden sm:block leading-tight">
              <span className="block font-extrabold text-sm nk-brand-text">نخبة سنترز</span>
              <span className="block text-[10px] font-bold text-[color:var(--c-accent-strong,var(--gold-deep))] tracking-wide">ALNOKHBA CENTERS</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="أقسام الصفحة">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3 py-2 rounded-xl text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/70 transition focus-visible:outline-2 focus-visible:outline-[color:var(--c-primary)]"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="h-10 rounded-xl px-4 text-sm font-bold flex items-center gap-1.5 border border-border bg-card text-foreground hover:border-[color:var(--c-primary)]/50 hover:shadow-sm transition focus-visible:outline-2 focus-visible:outline-[color:var(--c-primary)]"
            >
              <LogIn className="w-4 h-4" />
              <span className="hidden sm:inline">دخول</span>
            </Link>
            <Link
              href={session ? "/app" : "/login"}
              className="nk-btn-brand h-10 rounded-xl px-4 text-sm font-extrabold flex items-center gap-1.5"
            >
              {session ? <ArrowLeft className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
              {session ? "استكمال النظام" : "يلا نبدأ"}
            </Link>
            <button
              className="md:hidden h-10 w-10 rounded-xl border border-border bg-card grid place-items-center"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="القائمة"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="md:hidden border-t border-border/70 bg-card px-4 py-3 flex flex-col gap-1" aria-label="أقسام الصفحة">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="px-3 py-2.5 rounded-xl text-sm font-bold text-muted-foreground hover:bg-muted/70">
                {l.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-4 md:px-6">
        {/* ================= HERO ================= */}
        <section className="pt-10 md:pt-16 pb-12 md:pb-16">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-10 items-center">
            {/* النص */}
            <div className="text-center lg:text-start">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/80 px-3.5 py-1.5 text-xs font-bold text-muted-foreground mb-5">
                <Sparkles className="w-3.5 h-3.5 nk-brand-text" />
                نظام تشغيل السنترات التعليمية — من منظومة النخبة
              </span>
              <h1 className="text-3xl md:text-5xl font-extrabold leading-[1.25] tracking-tight">
                شغّل سنترك
                <span className="nk-brand-text"> أعقل</span>
                <span className="block mt-2 text-xl md:text-3xl font-bold text-muted-foreground">
                  حضور وحسابات واشتراكات — في مكان واحد
                </span>
              </h1>
              <span className="block nk-portal-divider mx-auto lg:mx-0 mt-5" aria-hidden />
              <p className="text-muted-foreground mt-4 text-sm md:text-base leading-relaxed max-w-xl mx-auto lg:mx-0">
                النخبة سنترز بيجمع الطلاب والمدرسين والحصص والحضور والدفعات والاشتراكات
                وعمليات السنتر كلها في نظام واحد بسيط — من غير وجع دماغ، وبحسابات دقيقة بالقرش.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mt-7">
                <Link href={session ? "/app" : "/login"} className="nk-btn-gold h-12 rounded-xl px-7 font-extrabold text-base flex items-center gap-2 w-full sm:w-auto justify-center">
                  <Zap className="w-5 h-5" />
                  {session ? "ادخل على نظامك" : "ابدأ دلوقتي — مجاني للتجربة"}
                </Link>
                <a href="#how" className="h-12 rounded-xl px-6 font-bold text-sm flex items-center gap-2 border border-border bg-card hover:border-[color:var(--c-primary)]/50 hover:shadow-sm transition w-full sm:w-auto justify-center">
                  <MonitorSmartphone className="w-4.5 h-4.5 nk-brand-text" />
                  شوف إزاي بيشتغل
                </a>
              </div>

              {/* بادجات الثقة */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 mt-7 text-xs font-bold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 nk-brand-text" /> حضور في ثواني</span>
                <span className="inline-flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5 nk-brand-text" /> وضع طوارئ أوفلاين</span>
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 nk-brand-text" /> بياناتك معزولة لكل سنتر</span>
              </div>
            </div>

            {/* موك-أب الداشبورد — من نفس لغة واجهة النظام الحقيقية */}
            <div className="relative" aria-hidden>
              <div className="nk-card brand p-4 md:p-5 shadow-xl">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-9 h-9 rounded-xl nk-brand-grad grid place-items-center text-white font-extrabold text-sm">ن</span>
                    <div>
                      <p className="font-extrabold text-sm nk-brand-text">مركز النخبة التعليمي</p>
                      <p className="text-[10px] font-bold text-muted-foreground">لوحة التشغيل · النهاردة</p>
                    </div>
                  </div>
                  <span className="nk-badge g">٦ حصص النهاردة</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { v: "١٨", l: "طالب نشط" },
                    { v: "٢", l: "شغّالة دلوقتي" },
                    { v: "١,٢٥٠ ج", l: "تحصيل اليوم" },
                  ].map((s) => (
                    <div key={s.l} className="rounded-xl nk-brand-bg-soft border border-[color:var(--c-primary)]/10 px-2.5 py-2 text-center">
                      <p className="nk-num font-extrabold text-base nk-brand-text leading-none">{s.v}</p>
                      <p className="text-[10px] font-bold text-muted-foreground mt-1">{s.l}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/70 text-muted-foreground">
                        <th className="text-start font-extrabold px-3 py-2">الوقت</th>
                        <th className="text-start font-extrabold px-3 py-2">الحصة</th>
                        <th className="text-start font-extrabold px-3 py-2 hidden sm:table-cell">القاعة</th>
                        <th className="text-start font-extrabold px-3 py-2">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="font-bold">
                      {[
                        { t: "١٧:٠٠", g: "فيزياء — أولى ثانوي (A)", r: "قاعة ١", s: "خلصت", tone: "m" },
                        { t: "١٨:٣٠", g: "رياضيات — تانية (B)", r: "قاعة ٢", s: "شغّالة", tone: "g" },
                        { t: "٢٠:٠٠", g: "إنجليزي — ثالثة (C)", r: "المعمل", s: "جاية", tone: "n" },
                      ].map((row) => (
                        <tr key={row.t} className={row.tone === "g" ? "bg-emerald-50/60" : "bg-card"}>
                          <td className="px-3 py-2.5 nk-num">{row.t}</td>
                          <td className="px-3 py-2.5">{row.g}</td>
                          <td className="px-3 py-2.5 hidden sm:table-cell text-muted-foreground">{row.r}</td>
                          <td className="px-3 py-2.5">
                            <span className={`nk-badge ${row.tone === "g" ? "g" : row.tone === "n" ? "n" : "m"}`}>{row.s}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-2 mt-3 text-[11px] font-bold text-muted-foreground">
                  <BellRing className="w-3.5 h-3.5 text-amber-500" />
                  تنبيه: ٣ طلاب رصيدهمقل — طابور واتساب جاهز
                </div>
              </div>

              {/* كارت عائم: نتيجة مسح */}
              <div className="absolute -bottom-5 -start-2 md:-start-6 w-[15rem] rounded-2xl bg-card border border-emerald-200 shadow-lg p-3.5 rotate-[-2deg]">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 grid place-items-center">
                    <QrCode className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-extrabold text-xs truncate">يوسف السيد — ١٠٠٠١</p>
                    <p className="text-[10px] font-bold text-muted-foreground">فيزياء · حضر ✓</p>
                  </div>
                </div>
                <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">
                  دفع <span className="nk-num text-emerald-700">١٠٠ ج</span> — الباقي <span className="nk-num text-emerald-700">٣٥ ج</span> اتحط في المحفظة
                </p>
              </div>
            </div>
          </div>

          {/* مداخل البورتالات الثلاثة */}
          <div className="grid sm:grid-cols-3 gap-3 md:gap-4 mt-12 text-start">
            <PortalCard href="/login" icon={<Building2 className="w-5.5 h-5.5" />} tone="brand" title="دخول السنتر" sub="للمدير والاستقبال — النظام الكامل" />
            <PortalCard href="/portal" icon={<GraduationCap className="w-5.5 h-5.5" />} tone="ok" title="بورتال الطالب" sub="بالموبايل والكود — رصيدك وجدولك" />
            <PortalCard href="/teacher" icon={<Briefcase className="w-5.5 h-5.5" />} tone="gold" title="بورتال المدرس" sub="بالموبايل والكود — جدولك ومستحقاتك" />
          </div>
        </section>

        {/* ================= المميزات ================= */}
        <section id="features" className="py-12 md:py-16 border-t border-border/70 scroll-mt-20">
          <div className="text-center mb-9">
            <h2 className="text-2xl md:text-3xl font-extrabold nk-brand-text">كل اللي السنتر محتاجه — في مكان واحد</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">من أول تسجيل الطالب لحد تقفيل الخزنة — وكل حاجة مربوطة ببعضها</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl nk-card p-4 flex flex-col gap-2.5">
                <span className="w-10 h-10 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center shrink-0">
                  {f.icon}
                </span>
                <h3 className="font-extrabold text-sm">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= إزاي بيشتغل ================= */}
        <section id="how" className="py-12 md:py-16 border-t border-border/70 scroll-mt-20">
          <div className="text-center mb-9">
            <h2 className="text-2xl md:text-3xl font-extrabold nk-brand-text">٤ خطوات وتبقى شغّال</h2>
            <p className="text-sm text-muted-foreground mt-2">نفس ترتيب الشغل اليومي بتاعك — من غير تدريب معقد</p>
          </div>
          <div className="grid md:grid-cols-4 gap-3 md:gap-4">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative">
                <div className="rounded-2xl nk-card p-5 h-full">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="w-10 h-10 rounded-xl nk-brand-grad text-white grid place-items-center shadow-sm shrink-0">{s.icon}</span>
                    <span className="text-[3.2rem] font-extrabold nk-brand-bg-soft-text select-none leading-none">{s.n}</span>
                  </div>
                  <h3 className="font-extrabold text-sm mb-1.5">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="hidden md:block absolute top-1/2 -start-2.5 -translate-x-full w-5 h-5 grid place-items-center text-[color:var(--gold-deep)]">
                    <ArrowLeft className="w-4 h-4" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ================= وضع الطوارئ ================= */}
        <section id="emergency" className="py-12 md:py-16 border-t border-border/70 scroll-mt-20">
          <div className="rounded-3xl nk-portal-card-dark p-7 md:p-10 relative overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute -top-24 -end-24 w-72 h-72 rounded-full opacity-20 nk-gold-bg blur-3xl" />
            <div className="relative max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-3.5 py-1.5 text-xs font-bold text-white mb-4">
                <WifiOff className="w-3.5 h-3.5" />
                EMERGENCY MODE — وضع الطوارئ
              </span>
              <h2 className="text-2xl md:text-4xl font-extrabold text-white leading-snug">
                مركزك شغّال —
                <span className="text-[color:var(--c-accent,var(--gold))]"> حتى لو النت مقطوع</span>
              </h2>
              <p className="text-white/80 text-sm md:text-base mt-3 leading-relaxed">
                لو النظام الأساسي وقع — النت قطع، السيرفر وقف، أو الداتابيز مش متاحة —
                نزّل <b className="text-white">حزمة نظام الطوارئ</b> وكمّل عمليات السنتر الأساسية أوفلاين
                لمدة <b className="text-white">٧ أيام</b>. ملف واحد شغّال على أي جهاز، من غير نت خالص.
              </p>

              {/* مسار الطوارئ */}
              <div className="mt-7 flex flex-col items-stretch sm:flex-row sm:items-center gap-2">
                {[
                  { t: "النظام أونلاين", ic: <Building2 className="w-4 h-4" /> },
                  { t: "نزّل الحزمة", ic: <Zap className="w-4 h-4" /> },
                  { t: "٧ أيام أوفلاين", ic: <WifiOff className="w-4 h-4" /> },
                  { t: "صدّر البيانات", ic: <FileSpreadsheet className="w-4 h-4" /> },
                  { t: "زامن ورجّع", ic: <RefreshCw className="w-4 h-4" /> },
                ].map((s, i) => (
                  <div key={s.t} className="flex items-center gap-2 flex-1">
                    <div className="flex items-center gap-2 rounded-full bg-card text-foreground font-extrabold text-[11px] px-3.5 py-2.5 shadow flex-1 whitespace-nowrap">
                      <span className="nk-brand-text shrink-0">{s.ic}</span>
                      {s.t}
                    </div>
                    {i < 4 && <ArrowLeft className="w-4 h-4 text-white/70 shrink-0 hidden sm:block" />}
                  </div>
                ))}
              </div>

              <ul className="mt-6 grid sm:grid-cols-2 gap-2.5 text-[13px] font-bold text-white/85">
                <li className="flex items-center gap-2"><CheckDot /> بحث سريع بالـ QR والكود 5 أرقام</li>
                <li className="flex items-center gap-2"><CheckDot /> حضور وتعديل حالته بالخصم الصحيح</li>
                <li className="flex items-center gap-2"><CheckDot /> دفعات بالباقي — كاش أو محفظة</li>
                <li className="flex items-center gap-2"><CheckDot /> تجديد اشتراكات وتسويات أرصدة</li>
                <li className="flex items-center gap-2"><CheckDot /> حصص متزامنة بفتح وقفل فعلي</li>
                <li className="flex items-center gap-2"><CheckDot /> كل عملية بكود فريد ETX — صفر تكرار</li>
                <li className="flex items-center gap-2"><CheckDot /> تقرير Excel احترافي بـ ١٠ صفحات</li>
                <li className="flex items-center gap-2"><CheckDot /> ملف استرداد آمن + استيراد محكوم</li>
              </ul>
              <p className="text-[11px] font-bold text-white/75 mt-5 leading-relaxed">
                خدمة مؤقتة للسنترات المشتركة: بعد ٧ أيام التطبيق بيتحوّل قراءة وتصدير بس — والحزمة الجديدة من المدير أونلاين. رخصة كل حزمة موقّعة RSA من السيرفر ومربوطة بسنترك.
              </p>
            </div>
          </div>
        </section>

        {/* ================= الأمان والثقة ================= */}
        <section id="security" className="py-12 md:py-16 border-t border-border/70 scroll-mt-20">
          <div className="text-center mb-9">
            <h2 className="text-2xl md:text-3xl font-extrabold nk-brand-text">بيتك محمي — بالحواجز مش بالكلام</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">إمكانيات أمان حقيقية مطبّقة فعلاً — من غير وعود مبالغ فيها</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {SECURITY.map((s) => (
              <div key={s.title} className="rounded-2xl nk-card p-4 flex gap-3">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 grid place-items-center shrink-0">
                  {s.icon}
                </span>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ================= سير العمل — ٣ أدوار ================= */}
        <section className="py-12 md:py-16 border-t border-border/70">
          <div className="text-center mb-9">
            <h2 className="text-2xl md:text-3xl font-extrabold nk-brand-text">٣ أدوار — نفس الداتا</h2>
            <p className="text-sm text-muted-foreground mt-2">كل واحد شايل شغلته… وكلهم بيشتغلوا على نفس بيانات السنتر بالثانية</p>
          </div>
          <div className="grid md:grid-cols-3 gap-3 md:gap-4">
            {ROLES.map((r) => (
              <div key={r.title} className="rounded-2xl nk-card p-5 flex flex-col gap-3">
                <span
                  className={
                    "w-11 h-11 rounded-xl grid place-items-center shrink-0 " +
                    (r.tone === "brand" ? "nk-brand-grad text-white shadow-sm"
                      : r.tone === "gold" ? "bg-amber-50 border border-amber-200 text-amber-700"
                        : "bg-emerald-50 border border-emerald-200 text-emerald-700")
                  }
                >
                  {r.icon}
                </span>
                <h3 className="font-extrabold text-base">{r.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{r.body}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-center mt-6">
            <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-xs font-extrabold text-muted-foreground shadow-sm">
              <Building2 className="w-4 h-4 nk-brand-text" /> المدير
              <ArrowDown className="w-3.5 h-3.5 rotate-[-90deg] text-[color:var(--gold-deep)]" />
              <ClipboardCheck className="w-4 h-4 text-emerald-600" /> الاستقبال
              <ArrowDown className="w-3.5 h-3.5 rotate-[90deg] text-[color:var(--gold-deep)]" />
              <Briefcase className="w-4 h-4 text-amber-600" /> المدرس
              <span className="text-[color:var(--c-primary)]">— نفس مصدر الحقيقة</span>
            </div>
          </div>
        </section>

        {/* ================= CTA نهائي ================= */}
        <section id="contact" className="py-12 md:py-16 border-t border-border/70 scroll-mt-20">
          <div className="rounded-3xl nk-portal-card-dark p-7 md:p-10 text-center relative overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute -bottom-24 -start-24 w-72 h-72 rounded-full opacity-[0.15] nk-gold-bg blur-3xl" />
            <h2 className="text-2xl md:text-4xl font-extrabold text-white relative">جاهز تشغّل سنترك صح؟</h2>
            <p className="text-white/80 text-sm md:text-base mt-3 max-w-lg mx-auto relative leading-relaxed">
              سجّل دخولك كمدير — وأول مرة هتلاقي جولة تعليمية بتشرحلك كل شاشة خطوة بخطوة،
              وزرار مساعدة في أي حتة مش مفهومة.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7 relative">
              <Link href={session ? "/app" : "/login"} className="nk-btn-gold h-12 rounded-xl px-7 font-extrabold text-base flex items-center gap-2 w-full sm:w-auto justify-center">
                <LogIn className="w-5 h-5" />
                {session ? "استكمال النظام" : "يلا نبدأ — دخول السنتر"}
              </Link>
              <Link
                href="/login"
                className="h-12 rounded-xl px-6 font-bold text-sm flex items-center gap-2 text-white/90 hover:text-white hover:bg-white/10 border border-white/30 transition w-full sm:w-auto justify-center"
              >
                <MessageCircle className="w-4.5 h-4.5" />
                تواصل معنا
              </Link>
            </div>
            <p className="text-[11px] font-bold text-white/75 mt-4">
              الدخول التجريبي شغّال بحساب مدير تجريبي من شاشة الدخول — استكشف براحتك.
            </p>
          </div>
        </section>

        {/* ================= FOOTER ================= */}
        <footer className="border-t border-border/70 py-8 mt-4">
          <div className="grid md:grid-cols-3 gap-6 items-start">
            <div className="flex flex-col gap-3">
              <AlNokhbaMark size={40} />
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xs font-bold">
                نخبة سنترز — نظام تشغيل السنترات التعليمية: حضور بالـ QR، حسابات بالقروش،
                اشتراكات، مستحقات مدرسين، ووضع طوارئ أوفلاين. امتداد من منظومة النخبة التعليمية.
              </p>
            </div>
            <nav className="flex flex-col gap-1.5 text-sm font-bold" aria-label="تنقل الفوتر">
              <span className="text-[11px] font-extrabold text-muted-foreground mb-1">الأقسام</span>
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className="text-muted-foreground hover:nk-brand-text transition w-fit">{l.label}</a>
              ))}
              <Link href="/login" className="text-muted-foreground hover:nk-brand-text transition w-fit flex items-center gap-1.5"><LogIn className="w-3.5 h-3.5" /> دخول السنتر</Link>
            </nav>
            <div className="flex flex-col gap-1.5 text-sm font-bold">
              <span className="text-[11px] font-extrabold text-muted-foreground mb-1">البورتالات</span>
              <Link href="/portal" className="text-muted-foreground hover:nk-brand-text transition w-fit flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> بورتال الطالب</Link>
              <Link href="/teacher" className="text-muted-foreground hover:nk-brand-text transition w-fit flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> بورتال المدرس</Link>
              <span className="text-muted-foreground w-fit flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" /> كل الحسابات بالقروش — وكل حركة مسجلة</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-7 pt-5 border-t border-border/60 text-[11px] font-bold text-muted-foreground">
            <span>© <span className="nk-num" dir="ltr">2026</span> نخبة سنترز — ALNOKHBA CENTERS</span>
            <span className="flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5" /> مبني لعمليات السنترات في مصر — بالعربي وبالمصري</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function CheckDot() {
  return <span className="w-4 h-4 shrink-0 rounded-full bg-[color:var(--c-accent,var(--gold))] grid place-items-center"><CheckMini /></span>;
}
function CheckMini() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PortalCard({ href, icon, title, sub, tone }: { href: string; icon: React.ReactNode; title: string; sub: string; tone: "brand" | "ok" | "gold" }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl nk-card p-4 md:p-5 border-2 border-transparent hover:border-[var(--c-primary)]/60 hover:shadow-lg transition-all duration-200 active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span
          className={
            "w-11 h-11 rounded-xl grid place-items-center " +
            (tone === "brand" ? "nk-brand-grad text-white shadow-sm"
              : tone === "ok" ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : "bg-amber-50 border border-amber-200 text-amber-700")
          }
        >
          {icon}
        </span>
        <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:nk-brand-text group-hover:-translate-x-0.5 transition-all" />
      </div>
      <span className="block font-extrabold text-base">{title}</span>
      <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">{sub}</span>
    </Link>
  );
}
