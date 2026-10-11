"use client";

import { useCallback, useEffect, useState } from "react";
import { Grid3x3, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import { SectionCard, Loading, Chip } from "./shared";
import { MODULE_CATALOG, MODULE_KEYS, type ModuleKey } from "@/lib/modules";

/* ============================================================
   تبويب «أقسام المنتج» — إعدادات المدير (Master Prompt §8)
   - المدير يشوف الأقسام الفعلية لسنتره ومصدر الحجب
   - يقدر يقفل قسم مشمول في خطته، أو يرجّع قفل سنتر قديم
   - ميعرفش يفتح قسم مستثنى من الخطة — السقف عند الخطة (سيرفري)
============================================================ */

type ModuleState = { enabled: boolean; lockedBy?: "platform" | "plan" | "center" | "subscription" };
type SubState = {
  hasSubscription: boolean; effective: string; planName: string | null;
  planFeatures: string[] | null; maxStudents: number | null; renewalDate: string | null; daysLeft: number | null;
};

const LOCK_LABEL: Record<string, string> = {
  platform: "المركز مش مفعّل على المنصة",
  subscription: "الاشتراك منتهي — جدّد لتفعيله",
  plan: "مش مشمول في خطتك",
  center: "متقفل من إعدادات السنتر",
};

export function ModulesTab() {
  const [modules, setModules] = useState<Record<string, ModuleState> | null>(null);
  const [sub, setSub] = useState<SubState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ modules: Record<string, ModuleState>; subscription: SubState }>("/api/center/capabilities", { silent: true })
      .then((d) => { setModules(d.modules); setSub(d.subscription); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!modules) return <Loading label="جاري تحميل أقسام المنتج…" />;

  async function toggle(key: ModuleKey, enable: boolean) {
    setBusyKey(key);
    try {
      await api("/api/center/capabilities", {
        method: "PATCH",
        body: { modules: [{ key, enabled: enable }] },
        silent: true,
      });
      toast.success(enable ? "القسم رجع شغال." : "اتقفل القسم — والسيرفر فرضه على كل الـ API فورًا.");
      load();
    } catch { /* toast */ } finally { setBusyKey(null); }
  }

  const lockedCount = MODULE_KEYS.filter((k) => !modules[k]?.enabled).length;

  return (
    <div className="space-y-4">
      {sub?.hasSubscription && (
        <SectionCard title="اشتراكك" icon={<Grid3x3 className="w-4 h-4 nk-brand-text" />}>
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Chip className={sub.effective === "ACTIVE" || sub.effective === "TRIAL" ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300" : sub.effective === "GRACE" ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300" : "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300"}>
              {sub.planName ?? "بدون خطة"} — {sub.effective === "ACTIVE" ? "نشط" : sub.effective === "TRIAL" ? "تجريبي" : sub.effective === "GRACE" ? "فترة سماح" : "منتهي"}
            </Chip>
            {sub.daysLeft != null && sub.effective === "ACTIVE" && (
              <span className="text-muted-foreground text-xs font-extrabold">
                {sub.daysLeft > 0 ? `باقي ${sub.daysLeft} يوم على التجديد` : "التجديد مستحق"}
              </span>
            )}
            {sub.maxStudents != null && <Chip>حد الطلاب: {sub.maxStudents}</Chip>}
            {sub.planFeatures && <Chip>{sub.planFeatures.length} قسم مشمول في الخطة</Chip>}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="أقسام المنتج — تشغيل وإيقاف"
        icon={<Grid3x3 className="w-4 h-4 nk-brand-text" />}
        action={<span className="text-[11px] font-bold text-muted-foreground">{MODULE_KEYS.length - lockedCount}/{MODULE_KEYS.length} مفتوح</span>}
      >
        <div className="space-y-2">
          {MODULE_KEYS.map((k) => {
            const st = modules[k] ?? { enabled: true };
            const meta = MODULE_CATALOG[k];
            const busy = busyKey === k;
            const canToggle = st.enabled || st.lockedBy === "center";
            return (
              <div key={k} className={cn("flex items-center justify-between gap-3 rounded-2xl border p-3",
                st.enabled ? "border-border bg-card" : "border-dashed border-rose-200 bg-rose-50/40 dark:bg-rose-950/20")}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm">{meta.label}</span>
                    {!st.enabled && (
                      <Chip className={st.lockedBy === "center" ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300" : "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300"}>
                        <Lock className="w-3 h-3 inline ml-0.5" /> {LOCK_LABEL[st.lockedBy ?? "center"]}
                      </Chip>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">{meta.desc}</p>
                </div>
                {canToggle ? (
                  <button
                    disabled={busy}
                    onClick={() => toggle(k, !st.enabled)}
                    className={cn("shrink-0 rounded-full px-4 py-2 text-xs font-extrabold transition",
                      st.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-card border border-border text-muted-foreground")}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : st.enabled ? "مفتوح — اضغط للقفل" : "مقفل — اضغط للفتح"}
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] font-extrabold text-rose-500">ثابت من {st.lockedBy === "plan" ? "الخطة" : st.lockedBy === "subscription" ? "الاشتراك" : "المنصة"}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground font-semibold mt-3">
          القفل بيتنفذ على السيرفر في كل الـ API وأدوات زكي — مش مجرد إخفاء من الشاشة. القسم المستثنى من خطتك محتاج ترقية الخطة من إدارة المنصة.
        </p>
      </SectionCard>
    </div>
  );
}
