"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2, BadgeCheck, GraduationCap, Receipt, MonitorCog, Activity,
  MoreHorizontal, RefreshCcw, AlertTriangle, Users, CalendarDays, Wallet, Loader2,
  UserCog, HardDriveDownload, DatabaseBackup, ShieldCheck, LifeBuoy, UserPlus, UserMinus, ArchiveRestore, FileSpreadsheet, Download, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, fmt, fmtE, formatDateAR, darkenForAA, STUDENT_STATUS } from "./lib";
import { PageHeader, MoneyStat, Stat, Chip, Loading, SectionCard, EmptyState } from "./shared";
import { PRICING, pricingBreakdown } from "@/lib/pricing";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type PricingInfo = {
  students: number; baseMonthly: number; baseIncludedStudents: number;
  tiers: { label: string; count: number; unit: number; subtotal: number }[];
  total: number; avgPerStudent: number; nextStudentUnit: number;
  usageRatio: number; warnLevel: "NONE" | "WARN_80" | "WARN_95" | "LIMIT";
};

export type AdminData = {
  totals: { centers: number; activeCenters: number; totalActiveStudents: number; platformRevenue: number; expiringSoon: number };
  unreadNotifs?: number;
  joinRequests: { id: string; name: string; username: string; phone: string | null; createdAt: string }[];
  plans: { id: string; name: string; pricePerStudent: number; maxStudents: number | null }[];
  pricingRules: {
    baseMonthly: number; baseIncludedStudents: number; hardLimitStudents: number;
    tiers: { from: number; to: number; unit: number; label: string }[];
  };
  centers: {
    id: string; name: string; slug: string; status: string; primaryColor: string; phone: string | null;
    createdAt: string; activeStudents: number; totalStudents: number; staff: number; todaySessions: number;
    monthRevenue: number; teachers: number; groups: number;
    pricing: PricingInfo;
    subscription: {
      id: string; plan: string; planId: string; status: string; pricePerStudent: number;
      renewalDate: string; paymentStatus: string; billingPeriod: string;
      currentAmount: number; maxStudents: number | null; overLimit: boolean;
    } | null;
  }[];
  billings: { id: string; centerName: string; students: number; pricePerStudent: number; amount: number; periodStart: string; periodEnd: string; status: string; createdAt: string }[];
  recentLogs: { id: string; userName: string; action: string; reason: string | null; createdAt: string; centerId: string | null }[];
  users: { id: string; name: string; username: string; role: string; isActive: boolean; centerId: string; centerName: string }[];
  teams: {
    id: string; name: string; description: string | null; isActive: boolean; createdAt: string;
    members: { id: string; userId: string; name: string; username: string; role: string; centerName: string }[];
  }[];
};

export function AdminCentersView({ data, reload }: { data: AdminData | null; reload: () => void }) {
  const [detail, setDetail] = useState<AdminData["centers"][number] | null>(null);
  const [supportFor, setSupportFor] = useState<AdminData["users"][number] | null>(null);
  const [supportReason, setSupportReason] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);

  async function startSupport() {
    if (!supportFor) return;
    setSupportBusy(true);
    try {
      await api("/api/admin", {
        method: "POST",
        body: { action: "support-start", targetUserId: supportFor.id, reason: supportReason },
      });
      toast.success(`دخلت باسم ${supportFor.name} — جلسة دعم 30 دقيقة. اضغط «خروج من الدعم» فوق للرجوع.`);
      // الجلسة اتبدلت باسم المستخدم → إعادة تحميل التطبيق بتجيب بيانات الجلسة الجديدة
      window.location.reload();
    } catch { /* toast */ } finally { setSupportBusy(false); }
  }

  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="السناتر" subtitle={`${data.totals.activeCenters} سنتر شغال من ${data.totals.centers}`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="عدد السنترات" value={data.totals.centers} tone="brand" icon={<Building2 className="w-4 h-4" />} />
        <Stat label="طلاب فعالين" value={data.totals.totalActiveStudents} icon={<GraduationCap className="w-4 h-4" />} />
        <MoneyStat label="إيراد المنصة" piastres={data.totals.platformRevenue} icon={<Wallet className="w-4 h-4" />} />
        <Stat label="اشتراكات قريبة" value={data.totals.expiringSoon} tone={data.totals.expiringSoon > 0 ? "warning" : "default"} icon={<AlertTriangle className="w-4 h-4" />} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {data.centers.map((c) => {
          const daysLeft = c.subscription ? Math.ceil((new Date(c.subscription.renewalDate).getTime() - Date.now()) / 86400000) : null;
          return (
            <div key={c.id} className="nk-card rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-11 h-11 rounded-2xl grid place-items-center font-extrabold text-white shrink-0"
                    style={{ background: `linear-gradient(135deg, ${darkenForAA(c.primaryColor)}, ${darkenForAA(c.primaryColor)}cc)` }}>
                    {c.name.trim()[0]}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-extrabold truncate">{c.name}</h3>
                    <p className="text-[11px] text-muted-foreground font-semibold" dir="ltr">@{c.slug}</p>
                  </div>
                </div>
                <Chip className={c.status === "ACTIVE" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}>
                  {c.status === "ACTIVE" ? "شغال" : "موقوف"}
                </Chip>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <MiniStat label="طلاب" value={c.activeStudents} />
                <MiniStat label="مدرسين" value={c.teachers} />
                <MiniStat label="مجموعات" value={c.groups} />
                <MiniStat label="حصص النهاردة" value={c.todaySessions} />
              </div>

              {c.subscription ? (
                <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 text-xs font-bold space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الخطة</span>
                    <span>{c.subscription.plan} · {fmt(c.subscription.pricePerStudent)} ج/طالب</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الفاتورة الشهرية</span>
                    <span className="nk-num">{fmt(c.subscription.currentAmount)} ج ({c.activeStudents} طالب)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">التجديد</span>
                    <span className={cn(daysLeft !== null && daysLeft <= 10 && "text-amber-700")}>
                      {formatDateAR(c.subscription.renewalDate)} {daysLeft !== null ? `(${daysLeft} يوم)` : ""}
                    </span>
                  </div>
                  {c.subscription.overLimit && (
                    <p className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> عدّى حد الخطة ({c.subscription.maxStudents} طالب)</p>
                  )}
                </div>
              ) : (
                <p className="text-xs font-bold text-rose-600">ملوش اشتراك</p>
              )}

              <div className="flex gap-2">
                <button onClick={() => setDetail(c)} className="flex-1 rounded-xl border border-border bg-card py-2 text-xs font-extrabold hover:bg-muted/50">
                  التفاصيل
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(c.status === "ACTIVE" ? `توقيف سنتر ${c.name}؟ الستاف مش هيعرف يسجل دخول.` : `تشغيل سنتر ${c.name}؟`)) return;
                    try {
                      await api("/api/admin", { method: "POST", body: { action: "set-status", centerId: c.id, status: c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } });
                      toast.success("تم تحديث حالة السنتر.");
                      reload();
                    } catch { /* toast */ }
                  }}
                  className={cn("rounded-xl border py-2 px-3 text-xs font-extrabold",
                    c.status === "ACTIVE" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                  {c.status === "ACTIVE" ? "إيقاف" : "تشغيل"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {detail && (
        <Dialog open onOpenChange={() => setDetail(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{detail.name} — التفاصيل</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="طلاب فعالين" value={detail.activeStudents} />
              <Stat label="إجمالي الطلاب (غير مؤرشف)" value={detail.totalStudents} />
              <Stat label="طاقم العمل" value={detail.staff} />
              <MoneyStat label="إيراد الشهر (السنتر)" piastres={detail.monthRevenue} />
            </div>
            <p className="text-xs text-muted-foreground font-semibold">
              مسجل من {formatDateAR(detail.createdAt.slice(0, 10))}{detail.phone ? ` · ${detail.phone}` : ""}
            </p>

            {/* موظفو السنتر + دخول الدعم الفني */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="bg-muted/60 px-3.5 py-2.5 text-xs font-extrabold flex items-center gap-1.5">
                <UserCog className="w-3.5 h-3.5" /> موظفو السنتر ({data.users.filter((u) => u.centerId === detail.id).length})
              </div>
              <ul className="divide-y max-h-56 overflow-y-auto nk-scroll">
                {data.users.filter((u) => u.centerId === detail.id).map((u) => (
                  <li key={u.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <span className={cn("w-8 h-8 rounded-full grid place-items-center text-[11px] font-extrabold shrink-0",
                      u.role === "MANAGER" ? "nk-brand-bg-soft nk-brand-text" : "bg-muted text-muted-foreground")}>
                      {u.name.slice(0, 2)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{u.name}</p>
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        {u.role === "MANAGER" ? "مدير" : "استقبال"} · @{u.username} {!u.isActive && "· موقوف"}
                      </p>
                    </div>
                    {u.isActive && (
                      <button
                        onClick={() => { setSupportFor(u); setSupportReason(""); }}
                        title="دخول باسم المستخدم لمساعدته (30 دقيقة)"
                        className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 flex items-center gap-1"
                      >
                        <LifeBuoy className="w-3.5 h-3.5" /> دعم
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {supportFor && (
        <Dialog open onOpenChange={() => !supportBusy && setSupportFor(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-600" /> دخول دعم فني — {supportFor.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3.5">
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs font-bold text-amber-800 leading-relaxed">
                هتدخل باسم <b>{supportFor.name}</b> (@{supportFor.username}) في سنتر {supportFor.centerName}.
                الجلسة مؤقتة (٣٠ دقيقة) وبانر واضح فوق الشاشة طول الوقت، وكل عملية هتتسجل في سجل التدقيق باسمك وبالسبب ده.
                <b> مفيش أي كلمة سر بتظهر أو بتتخزن.</b>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold">سبب الدعم (إجباري)</label>
                <textarea
                  value={supportReason}
                  onChange={(e) => setSupportReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="مثال: العميل بلغ إن الحصص مش بتظهر في الرئيسية — بتحقق من حسابه"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={startSupport} disabled={supportBusy || supportReason.trim().length < 3}
                  className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm">
                  {supportBusy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <LifeBuoy className="w-4.5 h-4.5" />} ابدأ جلسة الدعم
                </button>
                <button onClick={() => setSupportFor(null)} disabled={supportBusy}
                  className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function AdminSubscriptionsView({ data, reload }: { data: AdminData | null; reload: () => void }) {
  const [renewFor, setRenewFor] = useState<AdminData["centers"][number] | null>(null);
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);

  if (!data) return <Loading />;

  async function renew() {
    if (!renewFor?.subscription) return;
    setBusy(true);
    try {
      const res = await api<{ renewalDate: string; amount: number; students: number }>("/api/admin", {
        method: "POST", body: { action: "renew", centerId: renewFor.id, months },
      });
      toast.success(`تم التجديد لحد ${formatDateAR(res.renewalDate)} — فاتورة ${fmt(res.amount)} ج عن ${res.students} طالب.`);
      setRenewFor(null);
      reload();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="الاشتراكات" subtitle="تسعير شرائح النخبة — 600 ج أساسي (أول 100 طالب) + شرائح تنازلية، والفوترة على كل الطلاب المسجلين غير الأرشيف" />

      {/* قواعد التسعير الثابتة */}
      <div className="nk-card rounded-2xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
          <div className="rounded-xl bg-[var(--c-primary)]/10 p-3">
            <div className="nk-num text-lg font-extrabold nk-brand-text">{fmtE(60000)}</div>
            <div className="text-[10px] font-bold text-muted-foreground mt-0.5">أساسي/شهر — أول 100 طالب</div>
          </div>
          {[
            ["101 – 1,000", 4],
            ["1,001 – 2,000", 3],
            ["2,001 – 3,000", 2.5],
            ["3,001 – 10,000", 1.75],
          ].map(([label, unit]) => (
            <div key={label} className="rounded-xl bg-muted/50 p-3">
              <div className="nk-num text-lg font-extrabold">{unit} <span className="text-[10px]">ج/طالب</span></div>
              <div className="text-[10px] font-bold text-muted-foreground mt-0.5 nk-num">{label} طالب</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {data.centers.map((c) => {
          const p = c.pricing;
          const pct = Math.min(100, Math.round(p.usageRatio * 100));
          return (
            <div key={c.id} className="nk-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold">{c.name}</h3>
                {c.subscription ? (
                  <Chip className={c.subscription.status === "ACTIVE" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}>
                    {c.subscription.status === "ACTIVE" ? "نشط" : "منتهي"}
                  </Chip>
                ) : <Chip>بدون</Chip>}
              </div>

              {/* تحذيرات السعة 80% / 95% / الحد */}
              {p.warnLevel !== "NONE" && (
                <div className={`rounded-xl p-2.5 text-xs font-bold flex items-center gap-2 ${
                  p.warnLevel === "LIMIT" ? "bg-red-100 text-red-700"
                  : p.warnLevel === "WARN_95" ? "bg-orange-100 text-orange-700"
                  : "bg-amber-100 text-amber-800"
                }`}>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {p.warnLevel === "LIMIT"
                    ? `وصل الحد الأقصى — ${p.students.toLocaleString("en-EG")} من ${PRICING.hardLimitStudents.toLocaleString("en-EG")} طالب`
                    : p.warnLevel === "WARN_95"
                      ? `قربت توصل الحد الأقصى — ${pct}% من ${PRICING.hardLimitStudents.toLocaleString("en-EG")}`
                      : `استهلاك ${pct}% من حد الـ ${PRICING.hardLimitStudents.toLocaleString("en-EG")} طالب`}
                </div>
              )}

              <div className="rounded-xl bg-muted/40 border border-border p-3.5 space-y-1.5 text-sm">
                <SubRow label="الطلاب المفوترين" value={`${p.students.toLocaleString("en-EG")} طالب (غير الأرشيف)`} />
                {/* تفصيل الفاتورة صف-بصف */}
                <div className="border-t border-border/60 my-1.5" />
                <SubRow label={`أساسي — أول ${p.baseIncludedStudents} طالب`} value={fmtE(p.baseMonthly)} />
                {p.tiers.filter((t) => t.count > 0).map((t) => (
                  <SubRow key={t.label} label={`${t.label} (${t.count.toLocaleString("en-EG")} × ${fmt(t.unit)} ج)`} value={fmtE(t.subtotal)} />
                ))}
                <div className="border-t border-border/60 my-1.5" />
                <SubRow label="الفاتورة الشهرية" value={fmtE(p.total)} highlight />
                <SubRow label="متوسط للطالب" value={`${fmtE(p.avgPerStudent)} / طالب`} />
                <SubRow
                  label="الطالب الجاي هيكلف"
                  value={p.nextStudentUnit === 0 ? "مجاني (جوه الباقة)" : `${fmt(p.nextStudentUnit)} ج`}
                />
              </div>

              {/* شريط الاستهلاك */}
              <div>
                <div className="flex justify-between text-[10px] font-bold text-muted-foreground mb-1">
                  <span>السعة</span><span className="nk-num">{p.students.toLocaleString("en-EG")} / {PRICING.hardLimitStudents.toLocaleString("en-EG")}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full transition-all ${pct >= 95 ? "bg-red-500" : pct >= 80 ? "bg-orange-400" : "nk-brand-bg"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>

              {c.subscription && <SubRow label="التجديد" value={formatDateAR(c.subscription.renewalDate)} />}

              <button onClick={() => { setRenewFor(c); setMonths(1); }}
                className="w-full nk-brand-bg text-white font-extrabold rounded-xl py-3 shadow flex items-center justify-center gap-2 text-sm">
                <RefreshCcw className="w-4 h-4" /> تجديد الاشتراك
              </button>
            </div>
          );
        })}
      </div>

      {renewFor && (
        <Dialog open onOpenChange={() => setRenewFor(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><BadgeCheck className="w-5 h-5 nk-brand-text" /> تجديد اشتراك — {renewFor.name}</DialogTitle></DialogHeader>
            <div className="space-y-3.5">
              {/* حساب شفاف من نفس محرك التسعير */}
              {(() => {
                const p = pricingBreakdown(renewFor.totalStudents);
                return (
                  <div className="rounded-xl bg-muted/50 border border-border p-3.5 space-y-1.5 text-sm">
                    <p className="text-xs font-bold text-muted-foreground mb-1">
                      فاتورة الشهر الواحد — {p.students.toLocaleString("en-EG")} طالب (غير الأرشيف):
                    </p>
                    <SubRow label={`أساسي — أول ${p.baseIncludedStudents} طالب`} value={fmtE(p.baseMonthly)} />
                    {p.tiers.filter((t) => t.count > 0).map((t) => (
                      <SubRow key={t.label} label={t.label} value={`${t.count.toLocaleString("en-EG")} × ${fmt(t.unit)} ج = ${fmtE(t.subtotal)}`} />
                    ))}
                    <div className="border-t border-border/60 my-1" />
                    <SubRow label={`الإجمالي × ${months} ${months === 1 ? "شهر" : "شهور"}`} value={fmtE(p.total * months)} highlight />
                  </div>
                );
              })()}
              <div className="space-y-1.5">
                <label className="text-sm font-bold">عدد الشهور</label>
                <div className="flex gap-2">
                  {[1, 3, 6, 12].map((m) => (
                    <button key={m} onClick={() => setMonths(m)}
                      className={cn("flex-1 rounded-xl border-2 py-2.5 text-sm font-extrabold nk-num",
                        months === m ? "nk-brand-bg text-white border-transparent" : "border-input bg-card")}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={renew} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2">
                  {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <RefreshCcw className="w-4.5 h-4.5" />} تأكيد التجديد
                </button>
                <button onClick={() => setRenewFor(null)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function AdminStudentsView({ data }: { data: AdminData | null }) {
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="الطلاب" subtitle="عدد الطلاب النشطين في كل سنتر (أساس الفوترة)" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="إجمالي الطلاب النشطين" value={data.totals.totalActiveStudents} tone="brand" icon={<GraduationCap className="w-4 h-4" />} />
      </div>
      <SectionCard title="الطلاب حسب السنتر" icon={<Users className="w-4 h-4" />}>
        <div className="overflow-x-auto nk-scroll">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-muted/60 border-b">
                <th className="px-3.5 py-3 text-start font-extrabold text-xs">السنتر</th>
                <th className="px-3.5 py-3 text-start font-extrabold text-xs">طلاب نشطين</th>
                <th className="px-3.5 py-3 text-start font-extrabold text-xs">غير مؤرشف</th>
                <th className="px-3.5 py-3 text-start font-extrabold text-xs">مجموعات</th>
                <th className="px-3.5 py-3 text-start font-extrabold text-xs">مدرسين</th>
              </tr>
            </thead>
            <tbody>
              {data.centers.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3.5 py-3 font-bold">{c.name}</td>
                  <td className="px-3.5 py-3 font-extrabold nk-num">{c.activeStudents}</td>
                  <td className="px-3.5 py-3 nk-num text-muted-foreground">{c.totalStudents}</td>
                  <td className="px-3.5 py-3 nk-num">{c.groups}</td>
                  <td className="px-3.5 py-3 nk-num">{c.teachers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground font-semibold mt-3">
          الطالب النشط = حالته "شغال" في السنتر — المؤرشف والمتوقف مبيتحسبوش في الفوترة.
        </p>
      </SectionCard>
    </div>
  );
}

export function AdminBillingView({ data }: { data: AdminData | null }) {
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="الفوترة" subtitle="فواتير اشتراكات السنترات" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MoneyStat label="إجمالي المحصّل" piastres={data.totals.platformRevenue} tone="brand" icon={<Receipt className="w-4 h-4" />} />
        <Stat label="عدد الفواتير" value={data.billings.length} />
      </div>
      <SectionCard title="سجل الفواتير" icon={<Receipt className="w-4 h-4" />}>
        {data.billings.length === 0 ? (
          <EmptyState title="مفيش فواتير لسه" hint="الفواتير بتتولد لما تجدد اشتراك سنتر." />
        ) : (
          <ul className="divide-y">
            {data.billings.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{b.centerName}</p>
                  <p className="text-[11px] text-muted-foreground font-semibold">
                    {b.students} طالب × {fmt(b.pricePerStudent)} ج · {formatDateAR(b.periodStart)} → {formatDateAR(b.periodEnd)}
                  </p>
                </div>
                <div className="text-end shrink-0">
                  <p className="font-extrabold nk-num text-sm">{fmtE(b.amount)}</p>
                  <Chip className={b.status === "PAID" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}>
                    {b.status === "PAID" ? "مدفوعة" : "معلّقة"}
                  </Chip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

export function AdminSystemView({ data }: { data: AdminData | null }) {
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="النظام" subtitle="خطط الاشتراك وإعدادات المنصة" />
      <SectionCard title="خطط الاشتراك" icon={<MonitorCog className="w-4 h-4" />}>
        <div className="grid gap-3 md:grid-cols-3">
          {data.plans.map((p, i) => (
            <div key={p.id} className={cn("rounded-2xl border-2 p-4", i === 1 ? "nk-brand-border nk-brand-bg-soft" : "border-border bg-card")}>
              <h3 className="font-extrabold text-lg">{p.name}</h3>
              <p className="nk-num font-extrabold text-2xl mt-1">{fmt(p.pricePerStudent)} <span className="text-xs font-bold opacity-70">ج / طالب / شهر</span></p>
              <p className="text-xs text-muted-foreground font-bold mt-1">
                {p.maxStudents ? `حد أقصى ${p.maxStudents} طالب` : "بدون حد للطلاب"}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground font-semibold mt-3">
          الفوترة على عدد الطلاب النشطين — الطالب المؤرشف مش بيتحسب.
        </p>
      </SectionCard>
      <SectionCard title="معلومات المنصة" icon={<Activity className="w-4 h-4" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="عدد السنترات" value={data.totals.centers} />
          <Stat label="سنترات شغالة" value={data.totals.activeCenters} />
          <Stat label="طلاب على المنصة" value={data.totals.totalActiveStudents} />
          <Stat label="اشتراكات تنتهي قريب" value={data.totals.expiringSoon} tone={data.totals.expiringSoon > 0 ? "warning" : "default"} />
        </div>
      </SectionCard>
    </div>
  );
}

export function AdminMonitorView({ data, reload }: { data: AdminData | null; reload: () => void }) {
  const load = useCallback(() => reload(), [reload]);
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="المراقبة" subtitle="آخر العمليات على المنصة — بتتحدث تلقائياً" />
      <SectionCard title="نشاط مباشر" icon={<Activity className="w-4 h-4" />} action={
        <button onClick={reload} className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCcw className="w-3.5 h-3.5" /> تحديث
        </button>
      }>
        {data.recentLogs.length === 0 ? (
          <EmptyState title="مفيش نشاط لسه" />
        ) : (
          <ul className="divide-y">
            {data.recentLogs.map((l) => {
              const center = data.centers.find((c) => c.id === l.centerId);
              return (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-8 h-8 rounded-full nk-brand-bg-soft nk-brand-text grid place-items-center text-[11px] font-extrabold shrink-0">{l.userName.slice(0, 2)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">
                      <span className="text-muted-foreground font-semibold">{l.userName}</span> — {l.action}
                      {center && <span className="text-muted-foreground"> · {center.name}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-semibold">
                      {new Date(l.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </p>
                  </div>
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function SubRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("nk-num", highlight ? "font-extrabold text-base" : "font-bold")}>{value}</span>
    </div>
  );
}

// ============================= الفرق (Teams) =============================

export function AdminTeamsView({ data, reload }: { data: AdminData | null; reload: () => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AdminData["teams"][number] | null>(null);
  const [addUserId, setAddUserId] = useState("");
  const [renameFor, setRenameFor] = useState<AdminData["teams"][number] | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (!data) return <Loading />;

  async function create() {
    setBusy(true);
    try {
      await api("/api/admin", { method: "POST", body: { action: "team-create", name, description: description || undefined } });
      toast.success(`تم إنشاء فريق «${name}».`);
      setName(""); setDescription(""); setCreateOpen(false);
      reload();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function teamAction(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try {
      await api("/api/admin", { method: "POST", body });
      toast.success(msg);
      reload();
      return true;
    } catch { return false; } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="الفرق" subtitle="فرق العمل — للتنظيم والمتابعة. عضوية الفريق مش بتدي أي صلاحيات إضافية." />

      <div className="flex items-center justify-between gap-2">
        <Stat label="عدد الفرق" value={data.teams.length} tone="brand" icon={<UserCog className="w-4 h-4" />} />
        <button onClick={() => setCreateOpen(true)}
          className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 shadow flex items-center gap-2 text-sm">
          <UserPlus className="w-4.5 h-4.5" /> فريق جديد
        </button>
      </div>

      {data.teams.length === 0 ? (
        <EmptyState icon={<UserCog className="w-8 h-8" />} title="مفيش فرق لسه" hint="اعمل فريق — مثال: فريق الدعم الفني أو فريق المبيعات." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.teams.map((t) => (
            <div key={t.id} className={cn("nk-card rounded-2xl p-4 space-y-3", !t.isActive && "opacity-60")}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-extrabold truncate">{t.name}</h3>
                  {t.description && <p className="text-[11px] text-muted-foreground font-semibold truncate">{t.description}</p>}
                </div>
                <Chip className={t.isActive ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-muted"}>
                  {t.isActive ? "نشط" : "متوقف"}
                </Chip>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {t.members.length === 0 ? (
                  <p className="text-xs font-bold text-muted-foreground">مفيش أعضاء</p>
                ) : t.members.slice(0, 6).map((m) => (
                  <span key={m.id} className="rounded-full bg-muted/70 border border-border px-2.5 py-1 text-[11px] font-bold">
                    {m.name} <span className="text-muted-foreground">· {m.centerName}</span>
                  </span>
                ))}
                {t.members.length > 6 && (
                  <span className="rounded-full bg-muted/70 border border-border px-2.5 py-1 text-[11px] font-bold nk-num">+{t.members.length - 6}</span>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setDetail(t); setAddUserId(""); }}
                  className="flex-1 rounded-xl border border-border bg-card py-2 text-xs font-extrabold hover:bg-muted/50">
                  الأعضاء ({t.members.length})
                </button>
                <button onClick={() => { setRenameFor(t); setRenameValue(t.name); }}
                  className="rounded-xl border border-border bg-card py-2 px-3 text-xs font-extrabold hover:bg-muted/50">
                  تعديل الاسم
                </button>
                <button
                  onClick={() => {
                    if (!confirm(t.isActive ? `توقيف فريق «${t.name}»؟` : `تشغيل فريق «${t.name}»؟`)) return;
                    void teamAction({ action: "team-set-status", teamId: t.id, status: t.isActive ? "SUSPENDED" : "ACTIVE" }, "تم تحديث حالة الفريق.");
                  }}
                  className={cn("rounded-xl border py-2 px-3 text-xs font-extrabold",
                    t.isActive ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                  {t.isActive ? "إيقاف" : "تشغيل"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* إنشاء فريق */}
      {createOpen && (
        <Dialog open onOpenChange={() => !busy && setCreateOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 nk-brand-text" /> فريق جديد</DialogTitle></DialogHeader>
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-sm font-bold">اسم الفريق</label>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                  className="w-full h-12 rounded-xl border border-input bg-card px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="مثال: فريق الدعم الفني" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-bold">الوصف (اختياري)</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)}
                  className="w-full h-12 rounded-xl border border-input bg-card px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="مثال: مساعدة عملاء السنترات" />
              </div>
              <p className="text-[11px] text-muted-foreground font-bold bg-muted/50 rounded-xl px-3 py-2 leading-relaxed">
                الفرق للتنظيم بس — عضوية الفريق مش بتأثر على صلاحيات أي مستخدم.
              </p>
              <div className="flex gap-2">
                <button onClick={create} disabled={busy || name.trim().length < 2}
                  className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm">
                  {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <UserPlus className="w-4.5 h-4.5" />} إنشاء
                </button>
                <button onClick={() => setCreateOpen(false)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* إدارة الأعضاء */}
      {detail && (
        <Dialog open onOpenChange={() => setDetail(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>أعضاء — {detail.name}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {detail.members.length === 0 ? (
                <p className="text-sm font-bold text-muted-foreground text-center py-2">مفيش أعضاء لسه.</p>
              ) : (
                <ul className="divide-y rounded-xl border border-border overflow-hidden max-h-64 overflow-y-auto nk-scroll">
                  {detail.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <span className="w-8 h-8 rounded-full bg-muted grid place-items-center text-[11px] font-extrabold shrink-0">{m.name.slice(0, 2)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{m.name}</p>
                        <p className="text-[11px] text-muted-foreground font-semibold">
                          {m.role === "MANAGER" ? "مدير" : "استقبال"} · {m.centerName}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          if (!confirm(`إزالة ${m.name} من الفريق؟`)) return;
                          void teamAction({ action: "team-remove-member", teamId: detail.id, userId: m.userId }, `تم إزالة ${m.name}.`);
                          setDetail((cur) => cur ? { ...cur, members: cur.members.filter((x) => x.id !== m.id) } : cur);
                        }}
                        className="shrink-0 rounded-lg p-2 text-rose-600 hover:bg-rose-50" title="إزالة من الفريق">
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rounded-xl border border-border p-3 space-y-2">
                <label className="text-xs font-extrabold text-muted-foreground">ضيف عضو جديد</label>
                <div className="flex gap-2">
                  <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)}
                    className="flex-1 h-11 rounded-xl border border-input bg-card px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="">اختار مستخدم…</option>
                    {data.users.filter((u) => u.isActive && !detail.members.some((m) => m.userId === u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.name} — {u.centerName} ({u.role === "MANAGER" ? "مدير" : "استقبال"})</option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      if (!addUserId) return;
                      const ok = await teamAction({ action: "team-add-member", teamId: detail.id, userId: addUserId }, "تمت الإضافة للفريق.");
                      if (ok) {
                        const u = data.users.find((x) => x.id === addUserId);
                        setDetail((cur) => cur && u ? {
                          ...cur,
                          members: [...cur.members, { id: `tmp-${u.id}`, userId: u.id, name: u.name, username: u.username, role: u.role, centerName: u.centerName }],
                        } : cur);
                        setAddUserId("");
                      }
                    }}
                    disabled={!addUserId || busy}
                    className="nk-brand-bg text-white font-extrabold rounded-xl px-4 disabled:opacity-60 flex items-center gap-1.5 text-sm">
                    <UserPlus className="w-4 h-4" /> ضيف
                  </button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* تعديل الاسم */}
      {renameFor && (
        <Dialog open onOpenChange={() => setRenameFor(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>تعديل اسم الفريق</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus
                className="w-full h-12 rounded-xl border border-input bg-card px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    const ok = await teamAction({ action: "team-rename", teamId: renameFor.id, name: renameValue }, "تم تعديل الاسم.");
                    if (ok) setRenameFor(null);
                  }}
                  disabled={busy || renameValue.trim().length < 2}
                  className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3 disabled:opacity-60 text-sm">
                  حفظ
                </button>
                <button onClick={() => setRenameFor(null)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============================= النسخ الاحتياطية والاستعادة =============================

type BackupData = {
  status: {
    lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null;
    lastWeeklyAt: string | null; lastWeeklyTrigger: string | null; nextScheduledAt: string | null; scheduleLabel: string;
  };
  dbBackups: { file: string; size: number; createdAt: string }[];
  excelBackups: { file: string; centerName: string; size: number; createdAt: string; validated: boolean; validationError: string | null; checksum: string; sheets: number }[];
  restoreTables: { table: string; label: string }[];
};

export function AdminBackupsView({ data }: { data: AdminData | null }) {
  const [backups, setBackups] = useState<BackupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewFor, setPreviewFor] = useState<{ file: string; centerName: string | null; createdAt: string; tables: { table: string; label: string; rows: number }[] } | null>(null);
  const [restoreTables, setRestoreTables] = useState<string[]>([]);
  const [restoreResult, setRestoreResult] = useState<{ table: string; label: string; inserted: number; existing: number; failed?: number }[] | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api<BackupData>("/api/admin/backup", { silent: true })
      .then(setBackups)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : "حصل خطأ"));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loadError) {
    return (
      <div className="space-y-4">
        <PageHeader title="النسخ الاحتياطية والاستعادة" subtitle="نسخ تلقائية كل جمعة 10 مساءً بتوقيت القاهرة + نسخة يومية خفيفة — والتنزيل اليدوي هو الضمان الحقيقي" />
        <div className="nk-card rounded-2xl p-6 text-center space-y-3">
          <span className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 grid place-items-center mx-auto">
            <DatabaseBackup className="w-6 h-6" />
          </span>
          <p className="font-extrabold text-sm">النسخ الاحتياطية مش بتحمل دلوقتي</p>
          <p className="text-xs text-muted-foreground font-semibold leading-relaxed">{loadError}</p>
          <button onClick={load}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-5 py-3 shadow flex items-center gap-2 text-sm mx-auto">
            <RefreshCcw className="w-4 h-4" /> جرب تحميل تاني
          </button>
        </div>
      </div>
    );
  }

  if (!backups) return <Loading />;

  const fmtSize = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

  async function createFull() {
    setBusy(true);
    try {
      const res = await api<{ dbFile: string; excelFiles: { centerName: string; validated: boolean }[] }>("/api/admin/backup", {
        method: "POST", body: { action: "create" },
      });
      const okCount = res.excelFiles.filter((f) => f.validated).length;
      toast.success(`نسخة كاملة اتعملت: ${res.dbFile} + Excel لـ ${okCount} سنتر (متتحقق منها).`);
      load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function openPreview(file: string) {
    try {
      const res = await api<{ file: string; centerName: string | null; createdAt: string; tables: { table: string; label: string; rows: number }[] }>(
        `/api/admin/backup?preview=${encodeURIComponent(file)}`, { silent: true },
      );
      setPreviewFor(res);
      setRestoreTables(["Student", "StudentTransaction", "Attendance"]);
      setRestoreResult(null);
    } catch { /* toast */ }
  }

  async function doRestore() {
    if (!previewFor) return;
    if (!confirm(`استعادة الصفوف الناقصة من ${previewFor.file}؟\nمفيش أي حاجة هتتمسح أو تتعدل — بس إضافات للصفوف الناقصة.`)) return;
    setBusy(true);
    try {
      const res = await api<{ results: { table: string; label: string; inserted: number; existing: number; failed?: number }[] }>("/api/admin/backup", {
        method: "POST",
        body: { action: "restore", file: previewFor.file, tables: restoreTables },
      });
      setRestoreResult(res.results);
      const total = res.results.reduce((a, r) => a + r.inserted, 0);
      const failed = res.results.reduce((a, r) => a + (r.failed ?? 0), 0);
      if (failed > 0) toast.error(`تمت استعادة ${total} صف — لكن ${failed} صف فشلوا (مرجع ناقص). شوف التفاصيل تحت.`);
      else toast.success(total > 0 ? `تمت استعادة ${total} صف ناقص.` : "مفيش صفوف ناقصة — الداتا كاملة خلاص.");
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="النسخ الاحتياطية والاستعادة" subtitle="نسخ تلقائية كل جمعة 10 مساءً بتوقيت القاهرة + نسخة يومية خفيفة — والتنزيل اليدوي هو الضمان الحقيقي" />

      {/* حالة الجدولة */}
      <div className="nk-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl nk-brand-bg-soft nk-brand-text grid place-items-center shrink-0">
              <DatabaseBackup className="w-5 h-5" />
            </span>
            <div>
              <p className="font-extrabold text-sm">{backups.status.scheduleLabel}</p>
              <p className="text-[11px] text-muted-foreground font-semibold">
                {backups.status.nextScheduledAt
                  ? `النسخة الجاية: ${new Date(backups.status.nextScheduledAt).toLocaleString("ar-EG", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`
                  : "هتتحدد بعد أول تشغيل"}
              </p>
            </div>
          </div>
          <button onClick={createFull} disabled={busy}
            className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-3 shadow flex items-center gap-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <DatabaseBackup className="w-4.5 h-4.5" />} نسخة كاملة دلوقتي
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] font-bold">
          <div className="rounded-xl bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">آخر نسخة أسبوعية: </span>
            {backups.status.lastWeeklyAt ? new Date(backups.status.lastWeeklyAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "—"}
          </div>
          <div className="rounded-xl bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">آخر لقطة: </span>
            {backups.status.lastSuccessAt ? new Date(backups.status.lastSuccessAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "—"}
          </div>
          <div className={cn("rounded-xl px-3 py-2", backups.status.lastError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
            {backups.status.lastError ? `آخر خطأ: ${backups.status.lastError.slice(0, 60)}` : "مفيش أخطاء ✓"}
          </div>
        </div>
      </div>

      {/* مصنفات Excel */}
      <SectionCard title="مصنفات Excel (ملف لكل سنتر)" icon={<FileSpreadsheet className="w-4 h-4" />}>
        {backups.excelBackups.length === 0 ? (
          <EmptyState title="مفيش مصنفات لسه" hint="اضغط «نسخة كاملة دلوقتي» أو هتتعمل تلقائيًا كل جمعة." />
        ) : (
          <ul className="divide-y">
            {backups.excelBackups.map((e) => (
              <li key={e.file} className="flex items-center gap-3 py-3">
                <span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 grid place-items-center shrink-0">
                  <FileSpreadsheet className="w-4.5 h-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{e.centerName}</p>
                  <p className="text-[11px] text-muted-foreground font-semibold truncate" dir="ltr">{e.file}</p>
                  <p className="text-[11px] text-muted-foreground font-semibold">
                    {new Date(e.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {fmtSize(e.size)} · {e.sheets} شيت
                    {e.validated
                      ? <span className="text-emerald-700 font-extrabold"> · متتحقق منها ✓</span>
                      : <span className="text-rose-600 font-extrabold"> · فشل التحقق: {e.validationError}</span>}
                  </p>
                </div>
                <a
                  href={`/api/admin/backup?download=${encodeURIComponent(e.file)}`}
                  className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-xs font-extrabold flex items-center gap-1.5 hover:bg-muted/50"
                  download
                >
                  <Download className="w-3.5 h-3.5" /> تنزيل
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground font-semibold mt-3 leading-relaxed">
          المصنف فيه كل حاجة (الطلاب، الدفعات، الحضور، الحصص، المصروفات…) بالجنيه — ومفيش أي كلمات سر أو بيانات سرية. بعد التنزيل افتحه بأي برنامج Excel.
        </p>
      </SectionCard>

      {/* لقطات قاعدة البيانات + الاستعادة */}
      <SectionCard title="لقطات قاعدة البيانات (للاستعادة)" icon={<HardDriveDownload className="w-4 h-4" />}>
        {backups.dbBackups.length === 0 ? (
          <EmptyState title="مفيش لقطات لسه" />
        ) : (
          <ul className="divide-y">
            {backups.dbBackups.map((b) => (
              <li key={b.file} className="flex items-center gap-3 py-3">
                <span className="w-9 h-9 rounded-xl bg-sky-50 text-sky-700 grid place-items-center shrink-0">
                  <HardDriveDownload className="w-4.5 h-4.5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm nk-num" dir="ltr">{b.file}</p>
                  <p className="text-[11px] text-muted-foreground font-semibold">
                    {new Date(b.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {fmtSize(b.size)}
                  </p>
                </div>
                <button onClick={() => openPreview(b.file)}
                  className="shrink-0 rounded-xl border border-border bg-card px-3 py-2 text-xs font-extrabold flex items-center gap-1.5 hover:bg-muted/50">
                  <Eye className="w-3.5 h-3.5" /> معاينة واستعادة
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* معاينة + استعادة موجّهة */}
      {previewFor && (
        <Dialog open onOpenChange={() => setPreviewFor(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><ArchiveRestore className="w-5 h-5 nk-brand-text" /> معاينة النسخة واستعادة موجّهة</DialogTitle></DialogHeader>
            <div className="space-y-3.5">
              <div className="rounded-xl bg-muted/50 border border-border p-3 text-xs font-bold space-y-1">
                <p className="nk-num" dir="ltr">{previewFor.file}</p>
                <p className="text-muted-foreground">
                  {previewFor.centerName ? `سنتر: ${previewFor.centerName} · ` : ""}
                  اتعملت {new Date(previewFor.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <div className="bg-muted/60 px-3.5 py-2.5 text-xs font-extrabold flex items-center justify-between">
                  <span>اختار الجداول اللي عايز تستعيدها</span>
                  <button
                    onClick={() => setRestoreTables(restoreTables.length === previewFor.tables.length ? [] : previewFor.tables.map((t) => t.table))}
                    className="nk-brand-text font-extrabold text-[11px]"
                  >
                    {restoreTables.length === previewFor.tables.length ? "إلغاء الكل" : "تحديد الكل"}
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto nk-scroll divide-y">
                  {previewFor.tables.map((t) => {
                    const checked = restoreTables.includes(t.table);
                    return (
                      <button
                        key={t.table}
                        onClick={() => setRestoreTables((cur) => checked ? cur.filter((x) => x !== t.table) : [...cur, t.table])}
                        className={cn("w-full flex items-center gap-3 px-3.5 py-2.5 text-start transition", checked ? "nk-brand-bg-soft" : "hover:bg-muted/40")}
                      >
                        <span className={cn("w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 text-[11px] font-black",
                          checked ? "nk-brand-bg text-white border-transparent" : "border-input bg-card")}>
                          {checked ? "✓" : ""}
                        </span>
                        <span className="flex-1 text-sm font-bold">{t.label}</span>
                        <span className="nk-num text-xs font-extrabold text-muted-foreground">{t.rows} صف</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[11px] font-bold text-amber-800 leading-relaxed">
                الاستعادة بتضيف الصفوف الناقصة في الإنتاج بس — أي صف موجود خلاص بيفضل زي ما هو.
                <b> مفيش أي حاجة بتتمسح أو تتعدل.</b> كل عملية استعادة بتتسجل في سجل التدقيق.
              </div>

              {restoreResult && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="bg-muted/60 px-3.5 py-2 text-xs font-extrabold">نتيجة الاستعادة</div>
                  <ul className="divide-y text-sm">
                    {restoreResult.map((r) => (
                      <li key={r.table} className="flex items-center justify-between px-3.5 py-2.5">
                        <span className="font-bold">{r.label}</span>
                        <span className="nk-num font-extrabold text-xs">
                          <span className={r.inserted > 0 ? "text-emerald-700" : "text-muted-foreground"}>+{r.inserted} مستعاد</span>
                          <span className="text-muted-foreground"> · {r.existing} موجود خلاص</span>
                          {!!r.failed && r.failed > 0 && (
                            <span className="text-rose-600 font-bold"> · {r.failed} فشلوا (مرجع ناقص)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={doRestore} disabled={busy || restoreTables.length === 0}
                  className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm">
                  {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ArchiveRestore className="w-4.5 h-4.5" />}
                  استعادة الصفوف الناقصة
                </button>
                <button onClick={() => setPreviewFor(null)} className="rounded-xl border border-border bg-card font-bold px-5">إغلاق</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/50 py-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="nk-num font-extrabold">{value}</p>
    </div>
  );
}

// ============================= طلبات الانضمام =============================
// الحسابات الجديدة اللي بتسجل من صفحة الدخول — الأدمن بيعيّنها لسنتر أو يرفضها.

export function AdminRequestsView({ data, reload }: { data: AdminData | null; reload: () => void }) {
  // إعادة تحميل فورية لما يوصل إشعار طلب انضمام جديد
  useEffect(() => {
    const onEvt = () => reload();
    window.addEventListener("nk-staff-notifs", onEvt);
    return () => window.removeEventListener("nk-staff-notifs", onEvt);
  }, [reload]);

  const [assignFor, setAssignFor] = useState<AdminData["joinRequests"][number] | null>(null);
  const [assignCenter, setAssignCenter] = useState("");
  const [assignRole, setAssignRole] = useState<"RECEPTIONIST" | "MANAGER">("RECEPTIONIST");
  const [busy, setBusy] = useState(false);
  const [rejectFor, setRejectFor] = useState<AdminData["joinRequests"][number] | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const requests = data?.joinRequests ?? [];

  async function assign() {
    if (!assignFor || !assignCenter) return;
    setBusy(true);
    try {
      const res = await api<{ centerName: string; role: string }>("/api/admin", {
        method: "POST",
        body: { action: "request-assign", targetUserId: assignFor.id, centerId: assignCenter, requestRole: assignRole },
      });
      toast.success(`تم تعيين ${assignFor.name} لـ ${res.centerName} — دلوقتي يقدر يسجل دخول عادي.`, { duration: 5000 });
      setAssignFor(null);
      setAssignCenter("");
      reload();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  async function reject() {
    if (!rejectFor) return;
    setBusy(true);
    try {
      await api("/api/admin", {
        method: "POST",
        body: { action: "request-reject", targetUserId: rejectFor.id, reason: rejectReason },
      });
      toast.info(`تم رفض طلب ${rejectFor.name} — القرار اتسجل في سجل العمليات.`);
      setRejectFor(null);
      setRejectReason("");
      reload();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="طلبات الانضمام"
        subtitle="حسابات جديدة سجلت من صفحة الدخول — عيّنها لسنتر أو ارفضها"
        action={
          <Chip className={requests.length > 0 ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}>
            <UserPlus className="w-3.5 h-3.5" /> {requests.length} مستني
          </Chip>
        }
      />

      {!data ? (
        <Loading />
      ) : requests.length === 0 ? (
        <SectionCard title="مفيش طلبات مستنية" icon={<UserPlus className="w-4 h-4" />}>
          <EmptyState
            title="مفيش حد مستني تعيين"
            hint="لما حد يسجل حساب جديد من صفحة الدخول هيظهر هنا فورًا + هيوصلك إشعار بالجرس."
          />
        </SectionCard>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {requests.map((r) => (
            <div key={r.id} className="nk-card rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-11 h-11 rounded-2xl nk-brand-grad text-white grid place-items-center font-extrabold shrink-0">
                    {r.name.trim().slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-extrabold truncate">{r.name}</h3>
                    <p className="text-xs text-muted-foreground font-semibold" dir="ltr">@{r.username}</p>
                  </div>
                </div>
                <Chip className="bg-amber-50 border-amber-200 text-amber-700 shrink-0">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {formatDateAR(r.createdAt)}
                </Chip>
              </div>

              {r.phone && (
                <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5" /> رقم التواصل: <span className="nk-num" dir="ltr">{r.phone}</span>
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setAssignFor(r); setAssignCenter(""); setAssignRole("RECEPTIONIST"); }}
                  className="flex-1 rounded-xl nk-brand-bg text-white font-extrabold px-3 py-2.5 flex items-center justify-center gap-1.5 text-sm shadow transition active:scale-[0.98]"
                >
                  <UserPlus className="w-4.5 h-4.5" /> عيّن لسنتر
                </button>
                <button
                  onClick={() => { setRejectFor(r); setRejectReason(""); }}
                  className="rounded-xl border-2 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-extrabold px-3.5 py-2.5 flex items-center justify-center gap-1.5 text-sm transition active:scale-[0.98]"
                >
                  <UserMinus className="w-4.5 h-4.5" /> ارفض
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== ديالوج التعيين لسنتر ===== */}
      <Dialog open={!!assignFor} onOpenChange={(o) => { if (!o) setAssignFor(null); }}>
        <DialogContent className="max-w-md">
          {assignFor && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 nk-brand-text" />
                  تعيين {assignFor.name} لسنتر
                </DialogTitle>
                <DialogDescription>
                  اختار السنتر والدور — الحساب هيتفعّل فورًا وه يقدر يسجل دخول بنفس البيانات.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold">السنتر</label>
                  <select
                    value={assignCenter}
                    onChange={(e) => setAssignCenter(e.target.value)}
                    className="w-full h-11 rounded-xl border border-input bg-card px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">— اختار السنتر —</option>
                    {(data?.centers ?? []).filter((c) => c.status === "ACTIVE").map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.activeStudents} طالب نشط)</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-extrabold">الدور</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "RECEPTIONIST" as const, label: "موظف استقبال", desc: "عمليات يومية + صلاحيات المدير اللي يحددها" },
                      { id: "MANAGER" as const, label: "مدير السنتر", desc: "لو السنتر مالوش مدير خلاص" },
                    ].map((role) => (
                      <button
                        key={role.id}
                        onClick={() => setAssignRole(role.id)}
                        className={cn(
                          "rounded-xl border-2 p-3 text-start transition",
                          assignRole === role.id ? "border-[var(--c-primary)] nk-brand-bg-soft" : "border-border bg-card hover:bg-muted/50",
                        )}
                      >
                        <span className="block text-sm font-extrabold">{role.label}</span>
                        <span className="block text-[10px] font-bold text-muted-foreground mt-0.5 leading-relaxed">{role.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={assign}
                    disabled={busy || !assignCenter}
                    className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
                  >
                    {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ShieldCheck className="w-4.5 h-4.5" />}
                    تأكيد التعيين
                  </button>
                  <button onClick={() => setAssignFor(null)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== ديالوج الرفض ===== */}
      <Dialog open={!!rejectFor} onOpenChange={(o) => { if (!o) setRejectFor(null); }}>
        <DialogContent className="max-w-md">
          {rejectFor && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserMinus className="w-5 h-5 text-rose-600" />
                  رفض طلب {rejectFor.name}
                </DialogTitle>
                <DialogDescription>
                  الحساب مش هيقدر يسجل دخول — والقرار بيتسجل في سجل العمليات.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="reject-reason" className="text-xs font-extrabold">سبب الرفض (إجباري)</label>
                  <textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    maxLength={300}
                    placeholder="مثلاً: مفيش سنتر متاح في منطقتك حاليًا"
                    className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={reject}
                    disabled={busy || rejectReason.trim().length < 3}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
                  >
                    {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <UserMinus className="w-4.5 h-4.5" />}
                    تأكيد الرفض
                  </button>
                  <button onClick={() => setRejectFor(null)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
