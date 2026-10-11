"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, Grid3x3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chip } from "./shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  PERMISSION_CATALOG, PERMISSION_IDS, PERMISSION_GROUP_LABELS, DIRECT_TO_REQUEST,
  buildGrantsFromResolved, type PermissionId, type PermissionGroup,
} from "@/lib/permission-catalog";
import { MODULE_CATALOG, MODULE_KEYS, type ModuleKey } from "@/lib/modules";

/* ============================================================
   محررات الحساب المشتركة — الصلاحيات (الكتالوج الكامل) + أقسام المنتج
   - بيتستخدموا من إعدادات المدير (الموظفين) ولوحة الأدمن (كل الحسابات).
   - الحفظ بيتم عبر onSaved — الراوت (staff/admin) هو اللي بيفحص ويسجل.
   - الفحص الحقيقي سيرفري دايمًا — ده مجرد تكييف للتحكم.
============================================================ */

export type EditorStaff = {
  id: string;
  name: string;
  role: string;
  permissions: string[];
  moduleGrants: Record<string, boolean>;
  centerModules?: Record<string, { enabled: boolean }>;
};

/** محرر الصلاحيات الكامل — 24 صلاحية مجموعة مجموعة + فلتر + أزواج الطلب */
export function PermissionsEditorDialog({ staff, onClose, onSaved }: {
  staff: EditorStaff;
  onClose: () => void;
  onSaved: (grants: Record<string, boolean>) => Promise<void>;
}) {
  const [grants, setGrants] = useState<Record<string, boolean>>(() => buildGrantsFromResolved(staff.permissions, staff.role));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");

  function toggle(id: string, val: boolean) {
    setGrants((g) => ({ ...g, [id]: val }));
    // تنفيذ مباشر → حق الطلب شغال معاه (مش منطقي ينفّذ ومش يقدر يطلب)
    if (val && DIRECT_TO_REQUEST[id as PermissionId]) {
      setGrants((g) => ({ ...g, [DIRECT_TO_REQUEST[id as PermissionId]!]: true }));
    }
    // وقلب الطلب مع تنفيذ شغال → اقفل التنفيذ كمان (اتنين بعض)
    if (!val && Object.values(DIRECT_TO_REQUEST).includes(id as PermissionId)) {
      const direct = (Object.keys(DIRECT_TO_REQUEST) as PermissionId[]).find((d) => DIRECT_TO_REQUEST[d] === id);
      if (direct && grants[direct] === true) setGrants((g) => ({ ...g, [direct]: false }));
    }
  }

  const groups = Array.from(new Set(PERMISSION_IDS.map((p) => PERMISSION_CATALOG[p].group))) as PermissionGroup[];
  const visible = (pid: PermissionId) =>
    filter === "all" || (filter === "on" ? grants[pid] === true : grants[pid] !== true);
  const onCount = PERMISSION_IDS.filter((p) => grants[p] === true).length;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 nk-brand-text" /> صلاحيات {staff.name}
          </DialogTitle>
          <DialogDescription>
            الكتالوج كامل — كل صلاحية بتتفحص على السيرفر مع كل طلب. {staff.role === "TEACHER" ? "المدرس افتراضيًا معاه امتحانات وكويزات وواجبات بس — من هنا تقدر تزوّده أكتر." : "افتراضي الاستقبال: العمليات اليومية + الطلبات، والحساس بتنفّذه الإدارة."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1.5 text-[11px] font-bold">
          {([["all", `الكل (${PERMISSION_IDS.length})`], ["on", `مفعّلة (${onCount})`], ["off", `مقفولة (${PERMISSION_IDS.length - onCount})`]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={cn("rounded-lg px-2.5 py-1.5 border transition", filter === v ? "nk-brand-bg-soft nk-brand-text nk-brand-border" : "border-border bg-card text-muted-foreground")}>
              {l}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {groups.map((g) => {
            const items = PERMISSION_IDS.filter((p) => PERMISSION_CATALOG[p].group === g && visible(p));
            if (!items.length) return null;
            return (
              <div key={g} className="rounded-xl border border-border overflow-hidden">
                <p className="text-[11px] font-extrabold bg-muted/60 px-3 py-1.5 text-muted-foreground">{PERMISSION_GROUP_LABELS[g]}</p>
                <div className="divide-y">
                  {items.map((pid) => {
                    const meta = PERMISSION_CATALOG[pid];
                    const on = grants[pid] === true;
                    const paired = DIRECT_TO_REQUEST[pid];
                    return (
                      <label key={pid} className={cn(
                        "flex items-start justify-between gap-3 px-3.5 py-2.5 cursor-pointer transition",
                        on ? "bg-amber-50/60" : "bg-card hover:bg-muted/40",
                      )}>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-extrabold">
                            {meta.label}
                            {meta.sensitive && <span className="text-amber-600 font-black"> ·</span>}
                          </span>
                          <span className="block text-[11px] font-bold text-muted-foreground leading-relaxed">{meta.desc}</span>
                          {paired && on && (
                            <span className="block text-[10px] font-bold text-emerald-600">معاها: {PERMISSION_CATALOG[paired].label}</span>
                          )}
                        </span>
                        <input
                          type="checkbox"
                          className="w-5 h-5 accent-amber-600 mt-0.5 shrink-0"
                          checked={on}
                          onChange={(e) => toggle(pid, e.target.checked)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed bg-muted/50 rounded-xl p-3">
          «صلاحية مباشرة» = الموظف ينفّذ من غير انتظار — «طلب موافقة» = بيبعتل الإدارة الطلب وهي تقرر.
          كل تغيير بيتسجل في سجل العمليات. القفل على مستوى الحساب هنا، وقفل الأقسام كاملة من محرر «الأقسام والميزات».
        </p>
        <div className="flex gap-2">
          <button
            onClick={async () => { setBusy(true); try { await onSaved(grants); } finally { setBusy(false); } }}
            disabled={busy}
            className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
          >
            {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <ShieldCheck className="w-4.5 h-4.5" />} حفظ الصلاحيات
          </button>
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** محرر أقسام المنتج للحساب — قفل قسم على الموظف ده بس (مفيش فتح فوق قفل السنتر/الخطة) */
export function StaffModulesEditorDialog({ staff, onClose, onSaved }: {
  staff: EditorStaff;
  onClose: () => void;
  onSaved: (modules: Record<string, boolean>) => Promise<void>;
}) {
  const [grants, setGrants] = useState<Record<string, boolean>>({ ...staff.moduleGrants });
  const [busy, setBusy] = useState(false);

  const lockedForUser = (k: ModuleKey) => grants[k] === false;
  const centerOff = (k: ModuleKey) => staff.centerModules?.[k]?.enabled === false;

  function toggle(k: ModuleKey, allow: boolean) {
    setGrants((g) => {
      const next = { ...g };
      if (allow) delete next[k];
      else next[k] = false;
      return next;
    });
  }

  const offCount = MODULE_KEYS.filter((k) => lockedForUser(k)).length;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Grid3x3 className="w-5 h-5 nk-brand-text" /> أقسام {staff.name}
          </DialogTitle>
          <DialogDescription>
            اقفل قسم معين على الموظف ده بس — من غير ما تقفله للسنتر كله. الأقسام المقفولة من الاشتراك/الخطة بتتحكم من «أقسام المنتج».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {MODULE_KEYS.map((k) => {
            const meta = MODULE_CATALOG[k];
            const centerOffFlag = centerOff(k);
            const locked = lockedForUser(k);
            return (
              <div key={k} className={cn(
                "flex items-start justify-between gap-3 rounded-xl border-2 px-3.5 py-2.5 transition",
                centerOffFlag ? "border-border bg-muted/40 opacity-70" : locked ? "border-rose-200 bg-rose-50/60" : "border-border bg-card",
              )}>
                <span className="min-w-0">
                  <span className="block text-[13px] font-extrabold">{meta.label}</span>
                  <span className="block text-[11px] font-bold text-muted-foreground leading-relaxed">
                    {centerOffFlag ? "مقفول للسنتر كله — من تبويب «أقسام المنتج»" : meta.desc}
                  </span>
                </span>
                {centerOffFlag ? (
                  <Chip className="bg-muted border-border text-[10px] shrink-0">مقفول للسنتر</Chip>
                ) : (
                  <Switch
                    checked={!locked}
                    onCheckedChange={(v) => toggle(k, v)}
                    aria-label={`${meta.label} لـ ${staff.name}`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed bg-muted/50 rounded-xl p-3">
          القسم المقفول بيختفي من شاشة الموظف وبيترفض من السيرفر كمان (الـ API وأدوات زكي معاهم).
          مفتاح مفعّل = القسم وراثة من السنتر. مقفولين حاليًا: {offCount} قسم.
        </p>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setBusy(true);
              try {
                // نبعت الحالة الكاملة: false = قفل، true = رجّع وراثة السنتر
                const payload: Record<string, boolean> = {};
                for (const k of MODULE_KEYS) payload[k] = grants[k] !== false;
                await onSaved(payload);
              } finally { setBusy(false); }
            }}
            disabled={busy}
            className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
          >
            {busy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <Grid3x3 className="w-4.5 h-4.5" />} حفظ الأقسام
          </button>
          <button onClick={onClose} disabled={busy} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
