"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Palette, MessageCircle, Users, ScrollText, Loader2, Save, Plus, Pencil, Trash2,
  ShieldCheck, Eye, Upload, Variable, Smartphone, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, applyCenterBranding, darkenForAA, type SessionUser } from "./lib";
import { PageHeader, Chip, Loading, SectionCard, EmptyState } from "./shared";
import { Field, inputCls } from "./students";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

/* ============================================================
   تنبيهات الواتساب (opt-in) — المدير بيفعّل نوع التنبيه وحد الرصيد
   ويسجّل ملاحظة الموافقة (الوالد وافق يستقبل رسايل).
   بدون التفعيل ده، أزرار الواتساب في النظام كله مقفولة — ده شرط الأمانة.
============================================================ */
function WhatsAppAlertsCard() {
  const [cfg, setCfg] = useState<{
    waPaymentsEnabled: boolean; waLowBalanceEnabled: boolean;
    waLowBalanceThreshold: number; waConsentNote: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState("");

  const load = useCallback(() => {
    api<{ whatsappAlerts: typeof cfg }>("/api/settings", { silent: true })
      .then((d) => { setCfg(d.whatsappAlerts); setConsent(d.whatsappAlerts?.waConsentNote ?? ""); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", body });
      await load();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  if (!cfg) return null;
  const thresholdEGP = (cfg.waLowBalanceThreshold / 100).toLocaleString("en-EG");

  return (
    <SectionCard title="تنبيهات الواتساب — تفعيل من المدير" icon={<MessageCircle className="w-4 h-4" />}>
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-muted/30 p-3.5 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span>
              <span className="block text-sm font-extrabold">تأكيد الدفعات</span>
              <span className="block text-[11px] text-muted-foreground font-semibold">زرار «واتساب للوالد» يظهر بعد كل دفعة ناجحة</span>
            </span>
            <Switch checked={cfg.waPaymentsEnabled} disabled={busy}
              onCheckedChange={(v) => patch({ waPaymentsEnabled: v })}
              aria-label="تفعيل تنبيهات الدفع" />
          </label>

          <div className="border-t border-border/60" />

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span>
              <span className="block text-sm font-extrabold">تنبيه الرصيد المنخفض</span>
              <span className="block text-[11px] text-muted-foreground font-semibold">
                طابور رسايل للطلاب اللي عليهم فلوس — الحد الحالي: {thresholdEGP} ج
              </span>
            </span>
            <Switch checked={cfg.waLowBalanceEnabled} disabled={busy}
              onCheckedChange={(v) => patch({ waLowBalanceEnabled: v })}
              aria-label="تفعيل تنبيهات الرصيد" />
          </label>

          {cfg.waLowBalanceEnabled && (
            <div className="space-y-1.5 pt-1">
              <label htmlFor="wa-threshold" className="text-xs font-bold text-muted-foreground">
                حد التنبيه بالجنيه (التنبيه لما المدينون يتخطوه)
              </label>
              <input id="wa-threshold" dir="ltr" inputMode="decimal" disabled={busy}
                className={inputCls(false)}
                defaultValue={cfg.waLowBalanceThreshold / 100}
                onBlur={(e) => {
                  const egp = parseFloat(e.target.value);
                  if (isFinite(egp) && egp >= 0 && Math.round(egp * 100) !== cfg.waLowBalanceThreshold) {
                    patch({ waLowBalanceThreshold: Math.round(egp * 100) });
                  }
                }}
                placeholder="50" />
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="wa-consent" className="text-xs font-bold text-muted-foreground">
            ملاحظة الموافقة (شيفا) — سجّل مين من الأولياء وافق يستقبل رسايل
          </label>
          <textarea id="wa-consent" rows={2} disabled={busy}
            className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={consent} onChange={(e) => setConsent(e.target.value)}
            placeholder="مثلاً: أولياء أمور المجموعة A وافقوا في اجتماع أول الشهر" />
          <button onClick={() => patch({ waConsentNote: consent })} disabled={busy}
            className="text-xs font-extrabold nk-brand-text hover:underline disabled:opacity-50">
            حفظ الملاحظة
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed">
          التسليم يدوي في كل الأحوال: النظام بيجهّز الرسالة ويفتح محادثة واتساب لولي الأمر —
          والإرسال الفعلي بيبقى بضغطة منك. مفيش إرسال أوتوماتيك بدون موافقة صريحة.
        </p>
      </div>
    </SectionCard>
  );
}

/* لون نص مقروء فوق أي لون براند (داكن للخلفيات الفاتحة — زي الذهبي على كحلي)
   عشان معاينة الهوية والرقائق الملونة تفضل واضحة مهما كان اختيار السنتر */
function readableOn(bg: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((bg ?? "").trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.22 ? "#1b2635" : "#ffffff";
}

const TABS = [
  { id: "branding", label: "هوية السنتر", icon: <Palette className="w-4 h-4" /> },
  { id: "whatsapp", label: "قوالب واتساب", icon: <MessageCircle className="w-4 h-4" /> },
  { id: "staff", label: "الموظفين", icon: <Users className="w-4 h-4" /> },
  { id: "prefs", label: "تفضيلاتي", icon: <SlidersHorizontal className="w-4 h-4" /> },
  { id: "audit", label: "سجل العمليات", icon: <ScrollText className="w-4 h-4" /> },
] as const;

export function SettingsView({ user, onBrandingChanged }: { user: SessionUser; onBrandingChanged: (c: SessionUser["center"]) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("branding");

  return (
    <div className="space-y-4">
      <PageHeader title="الإعدادات" subtitle="هوية السنتر والقوالب والموظفين والسجل" />

      <div className="flex gap-1.5 overflow-x-auto nk-scroll pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-2xl border px-4 py-2.5 font-extrabold text-sm transition flex items-center gap-2",
              tab === t.id ? "nk-brand-bg text-white border-transparent shadow" : "bg-card border-border text-muted-foreground hover:text-foreground"
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "branding" && <BrandingTab user={user} onBrandingChanged={onBrandingChanged} />}
      {tab === "whatsapp" && <WhatsAppTab />}
      {tab === "staff" && <StaffTab />}
      {tab === "prefs" && <PersonalPrefsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

// ============================= BRANDING =============================

type Branding = {
  name: string; logo: string | null; primaryColor: string; secondaryColor: string;
  accentColor: string | null; phone: string; whatsapp: string; address: string;
  slogan: string; signature: string;
};

function BrandingTab({ user, onBrandingChanged }: { user: SessionUser; onBrandingChanged: (c: SessionUser["center"]) => void }) {
  const [form, setForm] = useState<Branding | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ branding: Branding }>("/api/settings").then((d) => setForm(d.branding)).catch(() => {});
  }, []);

  if (!form) return <Loading />;

  function set<K extends keyof Branding>(k: K, v: Branding[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function save() {
    setBusy(true);
    try {
      const res = await api<{ branding: Branding }>("/api/settings", { method: "PATCH", body: form });
      toast.success("تم حفظ هوية السنتر — بتظهر في كل حتة.");
      applyCenterBranding(res.branding as unknown as SessionUser["center"]);
      onBrandingChanged({ ...user.center!, ...res.branding } as SessionUser["center"]);
    } catch { /* toast */ } finally { setBusy(false); }
  }

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 400 * 1024) {
      toast.error("اللوجو كبير — ارفع صورة أقل من 400KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logo", String(reader.result));
    reader.readAsDataURL(file);
  }

  const preview = form;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <SectionCard title="بيانات الهوية" icon={<Palette className="w-4 h-4" />} action={
        <button onClick={save} disabled={busy} className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2 shadow flex items-center gap-1.5 text-sm disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} حفظ
        </button>
      }>
        <div className="space-y-3.5">
          <Field label="اسم السنتر" required>
            <input className={inputCls(false)} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="اللوجو" hint="PNG أو JPG — صغير وأنيق">
                <button onClick={() => fileRef.current?.click()} className="w-full h-11 rounded-xl border-2 border-dashed border-input bg-card font-bold text-sm flex items-center justify-center gap-2 hover:bg-muted/40">
                  <Upload className="w-4 h-4" /> {form.logo ? "غيّر اللوجو" : "ارفع لوجو"}
                </button>
              </Field>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogoFile} />
            </div>
            {form.logo && (
              <button onClick={() => set("logo", null)} className="text-rose-600 text-xs font-bold pb-3">مسح</button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <ColorField label="اللون الأساسي" value={form.primaryColor} onChange={(v) => set("primaryColor", v)} />
            <ColorField label="اللون الثاني" value={form.secondaryColor} onChange={(v) => set("secondaryColor", v)} />
            <ColorField label="لون التمييز" value={form.accentColor ?? ""} optional onChange={(v) => set("accentColor", v || null)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="تليفون السنتر">
              <input dir="ltr" inputMode="numeric" className={cn(inputCls(false), "nk-num")} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value.replace(/[^\d]/g, ""))} placeholder="010xxxxxxxx" />
            </Field>
            <Field label="رقم الواتساب">
              <input dir="ltr" inputMode="numeric" className={cn(inputCls(false), "nk-num")} value={form.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value.replace(/[^\d]/g, ""))} placeholder="010xxxxxxxx" />
            </Field>
          </div>

          <Field label="العنوان">
            <input className={inputCls(false)} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="15 شارع الجامعة، المعادي" />
          </Field>
          <Field label="الشعار / الجملة (اختياري)">
            <input className={inputCls(false)} value={form.slogan ?? ""} onChange={(e) => set("slogan", e.target.value)} placeholder="نخبة التلاميذ… نخبة المستقبل" />
          </Field>
          <Field label="توقيع الواتساب" hint="بيتزاد أوتوماتيك آخر كل رسالة">
            <input className={inputCls(false)} value={form.signature ?? ""} onChange={(e) => set("signature", e.target.value)} placeholder="مع تحيات فريق السنتر" />
          </Field>
        </div>
      </SectionCard>

      {/* live preview */}
      <div className="space-y-4">
        <SectionCard title="معاينة حية" icon={<Eye className="w-4 h-4" />}>
          <div className="space-y-3">
            {/* dashboard card preview */}
            <div className="rounded-2xl p-4 text-white shadow-md" style={{ background: `linear-gradient(135deg, ${darkenForAA(preview.primaryColor)}, ${darkenForAA(preview.secondaryColor)})` }}>
              <div className="flex items-center gap-2.5">
                {preview.logo ? (
                  <img src={preview.logo} alt="" className="w-9 h-9 rounded-lg object-cover bg-white/90" />
                ) : (
                  <span className="w-9 h-9 rounded-lg bg-black/20 grid place-items-center font-extrabold">{preview.name.trim()[0] ?? "ن"}</span>
                )}
                <div className="leading-tight">
                  <p className="font-extrabold text-sm">{preview.name || "اسم السنتر"}</p>
                  <p className="text-[10px] font-bold opacity-80">{preview.slogan || "شعار السنتر"}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {["تحصيل اليوم", "الحضور", "الحصص"].map((l, i) => (
                  <div key={l} className="rounded-lg bg-white/15 py-2">
                    <p className="text-[9px] font-bold opacity-80">{l}</p>
                    <p className="font-extrabold nk-num text-sm">{[128, 34, 6][i]}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* scan result preview */}
            <div className="rounded-2xl border p-3.5" style={{ borderColor: preview.primaryColor, background: `color-mix(in srgb, ${preview.primaryColor} 6%, #fff)` }}>
              <p className="text-xs font-bold" style={{ color: darkenForAA(preview.primaryColor) }}>الطالب مسجل في المجموعة دي</p>
              <div className="flex gap-2 mt-2">
                <span className="rounded-lg px-2.5 py-1.5 text-xs font-extrabold" style={{ background: darkenForAA(preview.primaryColor), color: readableOn(darkenForAA(preview.primaryColor)) }}>الحصة 65 ج</span>
                <span className="rounded-lg px-2.5 py-1.5 text-xs font-extrabold border" style={{ borderColor: darkenForAA(preview.secondaryColor), color: darkenForAA(preview.secondaryColor) }}>المطلوب اليوم 30 ج</span>
                {preview.accentColor && (
                  <span className="rounded-lg px-2.5 py-1.5 text-xs font-extrabold" style={{ background: preview.accentColor, color: readableOn(preview.accentColor) }}>رصيد 35 ج</span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground font-semibold text-center leading-relaxed">
              الهوية دي بتظهر على: الداشبورد، كارت الطالب، الإيصالات، رسايل الواتساب، التقارير، والمطبوعات.
            </p>
          </div>
        </SectionCard>

        {/* identity note */}
        <div className="nk-card rounded-2xl p-4 flex items-start gap-3">
          <ShieldCheck className="w-8 h-8 nk-brand-text shrink-0" />
          <div>
            <p className="font-bold text-sm">هوية النخبة محفوظة</p>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5 leading-relaxed">
              النخبة سنترز بتظهر كهوية تقنية للمنصة، وهوية السنتر هي اللي بتظهر لعملاءك في كل التعاملات اليومية.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, optional }: {
  label: string; value: string; onChange: (v: string) => void; optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold block">{label}</label>
      <div className="flex rounded-xl border-2 border-input overflow-hidden bg-card h-11">
        <input type="color" value={value || "#0E9F6E"} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-11 h-full border-e-2 border-input cursor-pointer bg-transparent" aria-label={label} />
        <input dir="ltr" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="flex-1 px-2 text-xs font-bold nk-num text-center" placeholder={optional ? "اختياري" : "#0E9F6E"} />
      </div>
    </div>
  );
}

// ============================= WHATSAPP =============================

const VARIABLES = [
  "{student_name}", "{parent_name}", "{subject}", "{group_name}", "{amount}",
  "{balance}", "{amount_due}", "{date}", "{session_time}", "{center_name}",
  "{teacher_name}", "{student_code}", "{center_phone}",
];

function WhatsAppTab() {
  const [templates, setTemplates] = useState<{ id: string; name: string; body: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ id?: string; name: string; body: string } | null>(null);

  const load = () => api<{ templates: typeof templates }>("/api/templates").then((d) => { setTemplates(d.templates); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function save() {
    if (!edit) return;
    try {
      if (edit.id) {
        await api("/api/templates", { method: "PATCH", body: edit });
      } else {
        await api("/api/templates", { method: "POST", body: { name: edit.name, body: edit.body } });
      }
      toast.success("تم حفظ القالب.");
      setEdit(null);
      load();
    } catch { /* toast */ }
  }

  return (
    <div className="space-y-4">
      <WhatsAppAlertsCard />
      <button onClick={() => setEdit({ name: "", body: "" })} className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2">
        <Plus className="w-4.5 h-4.5" /> قالب جديد
      </button>

      {loading ? <Loading /> : templates.length === 0 ? (
        <div className="nk-card rounded-2-xl"><EmptyState title="مفيش قوالب" hint="اعمل أول قالب — مثلاً تأكيد حضور." /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="nk-card rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold">{t.name}</h3>
                <div className="flex gap-1">
                  <button onClick={() => setEdit({ ...t })} className="text-muted-foreground hover:text-foreground p-1" aria-label="تعديل"><Pencil className="w-4 h-4" /></button>
                  <button onClick={async () => {
                    if (!confirm(`تمسح قالب "${t.name}"؟`)) return;
                    try { await api(`/api/templates?id=${t.id}`, { method: "DELETE" }); toast.success("تم الحذف."); load(); } catch { /* toast */ }
                  }} className="text-rose-500 hover:text-rose-600 p-1" aria-label="حذف"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <p className="mt-2 text-sm font-semibold leading-relaxed whitespace-pre-wrap bg-[#e7ffdb] border border-emerald-200 rounded-xl p-3">{t.body}</p>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? "تعديل قالب" : "قالب واتساب جديد"}</DialogTitle></DialogHeader>
            <div className="space-y-3.5">
              <Field label="اسم القالب" required>
                <input className={inputCls(false)} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="تأكيد حضور" />
              </Field>
              <Field label="نص الرسالة" required hint="دوس على المتغيرات تحت عشان تحطها في الرسالة">
                <textarea className={cn(inputCls(false), "min-h-[120px] resize-none leading-relaxed")} value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                  placeholder="تم تسجيل حضور الطالب {student_name} في حصة {subject} اليوم." />
              </Field>
              <div>
                <p className="text-xs font-bold mb-1.5 flex items-center gap-1.5"><Variable className="w-3.5 h-3.5" /> المتغيرات المتاحة</p>
                <div className="flex flex-wrap gap-1.5">
                  {VARIABLES.map((v) => (
                    <button key={v} type="button" dir="ltr"
                      onClick={() => setEdit({ ...edit, body: edit.body + " " + v })}
                      className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[11px] font-bold hover:bg-emerald-100">
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground font-semibold">
                توقيع السنتر بيتراسل أوتوماتيك في آخر الرسالة — اتأكد من هوية السنتر في تاب "هوية السنتر".
              </p>
              <div className="flex gap-2">
                <button onClick={save} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5">حفظ</button>
                <button onClick={() => setEdit(null)} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============================= STAFF =============================

function StaffTab() {
  const [staff, setStaff] = useState<{ id: string; name: string; username: string; role: string; canAddStudents: boolean; isActive: boolean; permissions?: string[]; phone?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [permFor, setPermFor] = useState<{ id: string; name: string; permissions: string[] } | null>(null);

  const load = () => api<{ staff: typeof staff }>("/api/staff").then((d) => { setStaff(d.staff); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api("/api/staff", { method: "PATCH", body: { id, ...body } });
      toast.success("تم التحديث.");
      load();
    } catch { /* toast */ }
  }

  return (
    <div className="space-y-4">
      <button onClick={() => setAddOpen(true)} className="nk-brand-bg text-white font-extrabold rounded-xl px-4 py-2.5 shadow flex items-center gap-2">
        <Plus className="w-4.5 h-4.5" /> موظف جديد
      </button>

      {loading ? <Loading /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {staff.map((s) => (
            <div key={s.id} className="nk-card rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-extrabold">{s.name}</h3>
                  <p className="text-xs text-muted-foreground font-semibold" dir="ltr">@{s.username}</p>
                </div>
                <Chip className={s.role === "MANAGER" ? "nk-brand-bg-soft nk-brand-text border-transparent" : s.isActive ? "bg-muted border-border" : "bg-rose-50 border-rose-200 text-rose-600"}>
                  {s.role === "MANAGER" ? "مدير" : s.isActive ? "موظف استقبال" : "موقوف"}
                </Chip>
              </div>
              {s.role === "RECEPTIONIST" && (
                <>
                  {/* الصلاحيات الممنوحة زيادة عن الافتراضي */}
                  {s.permissions && s.permissions.filter((p) => SENSITIVE_PERMS.some((x) => x.id === p && x.direct)).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {s.permissions.filter((p) => {
                        const meta = SENSITIVE_PERMS.find((x) => x.id === p);
                        return meta && meta.direct;
                      }).map((p) => (
                        <Chip key={p} className="bg-amber-50 border-amber-200 text-amber-700 text-[10px]">
                          {SENSITIVE_PERMS.find((x) => x.id === p)?.label ?? p}
                        </Chip>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setPermFor({ id: s.id, name: s.name, permissions: s.permissions ?? [] })}
                      className="flex-1 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 font-extrabold px-3 py-2 text-xs flex items-center justify-center gap-1.5 transition">
                      <ShieldCheck className="w-3.5 h-3.5" /> الصلاحيات الحساسة
                    </button>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 cursor-pointer">
                    <span className="text-xs font-bold">يسمح له يضيف طلاب جدد</span>
                    <input type="checkbox" className="w-5 h-5 accent-[var(--c-primary)]" checked={s.canAddStudents}
                      onChange={(e) => patch(s.id, { permissions: { ...permOverridesFrom(s.permissions), ADD_STUDENT: e.target.checked } })} />
                  </label>
                  <div className="flex gap-2">
                    <button onClick={() => patch(s.id, { isActive: !s.isActive })}
                      className={cn("flex-1 rounded-xl border px-3 py-2 text-xs font-extrabold",
                        s.isActive ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                      {s.isActive ? "إيقاف الحساب" : "تشغيل الحساب"}
                    </button>
                    <button onClick={() => {
                      const pw = prompt("كلمة سر جديدة (6 حروف على الأقل):");
                      if (pw) patch(s.id, { password: pw });
                    }} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold">
                      تغيير الباسورد
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <AddStaffDialog onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />
      )}

      {permFor && (
        <PermissionsDialog
          staff={permFor}
          onClose={() => setPermFor(null)}
          onSaved={async (grants) => {
            await patch(permFor.id, { permissions: grants });
            setPermFor(null);
          }}
        />
      )}
    </div>
  );
}

/** الصلاحيات الحساسة اللي المدير بيتحكم فيها — نسخة العميل من كتالوج السيرفر */
const SENSITIVE_PERMS: { id: string; label: string; desc: string; direct: boolean }[] = [
  { id: "REFUND_PAYMENT", label: "استرداد فوري", desc: "ينفّذ استرداد فلوس من غير انتظار موافقة", direct: true },
  { id: "REQUEST_REFUND", label: "طلب استرداد", desc: "يبعت طلب استرداد للمدير يقرره", direct: false },
  { id: "ADJUST_BALANCE", label: "تسوية فورية", desc: "ينفّذ تسوية رصيد من غير موافقة", direct: true },
  { id: "REQUEST_ADJUSTMENT", label: "طلب تسوية", desc: "يبعت طلب تسوية رصيد للمدير", direct: false },
  { id: "CANCEL_SESSION", label: "إلغاء حصة فوري", desc: "يلغي حصة من غير انتظار موافقة", direct: true },
  { id: "REQUEST_SESSION_CANCELLATION", label: "طلب إلغاء حصة", desc: "يبعت طلب إلغاء حصة للمدير", direct: false },
  { id: "ARCHIVE_STUDENT", label: "أرشفة طالب فوري", desc: "يؤرشف طالب من غير موافقة", direct: true },
  { id: "REQUEST_STUDENT_CANCEL", label: "طلب أرشفة طالب", desc: "يبعت طلب أرشفة طالب للمدير", direct: false },
  { id: "CANCEL_SUBSCRIPTION", label: "إلغاء تسجيل فوري", desc: "يشيل تسجيل طالب من مجموعة فورًا", direct: true },
  { id: "REQUEST_CANCELLATION", label: "طلب إلغاء تسجيل", desc: "يبعت طلب إلغاء تسجيل للمدير", direct: false },
  { id: "EXPORT_REPORTS", label: "تصدير التقارير", desc: "ينزّل تقارير CSV/Excel", direct: true },
];

/** يبني grants من قائمة صلاحيات محسومة (للتعديل التدريجي) */
function permOverridesFrom(perms?: string[]): Record<string, boolean> {
  // الافتراضي للاستقبال: كل الطلبات مفتوحة — نثبّت الوضع الحالي بس للحساس
  const defaults = new Set(["REQUEST_REFUND", "REQUEST_ADJUSTMENT", "REQUEST_SESSION_CANCELLATION", "REQUEST_STUDENT_CANCEL", "REQUEST_CANCELLATION"]);
  const grants: Record<string, boolean> = {};
  for (const p of perms ?? []) {
    if (SENSITIVE_PERMS.some((x) => x.id === p)) grants[p] = true;
  }
  for (const p of defaults) {
    if (!(perms ?? []).includes(p)) grants[p] = false; // مقفولة صراحة
  }
  return grants;
}

function PermissionsDialog({ staff, onClose, onSaved }: {
  staff: { id: string; name: string; permissions: string[] };
  onClose: () => void; onSaved: (grants: Record<string, boolean>) => Promise<void>;
}) {
  const [grants, setGrants] = useState<Record<string, boolean>>(() => permOverridesFrom(staff.permissions));
  const [busy, setBusy] = useState(false);

  function toggle(id: string, val: boolean) {
    setGrants((g) => ({ ...g, [id]: val }));
    // لو منحناه تنفيذ مباشر → سيب له حق الطلب شغال (مش منطقي يقدر ينفّذ ومش يقدر يطلب)
    if (val && (id === "REFUND_PAYMENT" || id === "ADJUST_BALANCE" || id === "CANCEL_SESSION" || id === "ARCHIVE_STUDENT" || id === "CANCEL_SUBSCRIPTION")) {
      const requestPair: Record<string, string> = {
        REFUND_PAYMENT: "REQUEST_REFUND",
        ADJUST_BALANCE: "REQUEST_ADJUSTMENT",
        CANCEL_SESSION: "REQUEST_SESSION_CANCELLATION",
        ARCHIVE_STUDENT: "REQUEST_STUDENT_CANCEL",
        CANCEL_SUBSCRIPTION: "REQUEST_CANCELLATION",
      };
      setGrants((g) => ({ ...g, [requestPair[id]]: true }));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto nk-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 nk-brand-text" /> صلاحيات {staff.name} الحساسة
          </DialogTitle>
          <DialogDescription>
            الفحص بيحصل على السيرفر في كل الحالات — إخفاء الزرار من الموظف مش أمان، الأمان هو الصلاحية نفسها.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {SENSITIVE_PERMS.map((p) => {
            const on = grants[p.id] === true;
            return (
              <label key={p.id} className={cn(
                "flex items-start justify-between gap-3 rounded-xl border-2 px-3.5 py-2.5 cursor-pointer transition",
                on ? "border-amber-200 bg-amber-50" : "border-border bg-card hover:bg-muted/40",
              )}>
                <span className="min-w-0">
                  <span className="block text-[13px] font-extrabold">{p.label}</span>
                  <span className="block text-[11px] font-bold text-muted-foreground leading-relaxed">{p.desc}</span>
                </span>
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-amber-600 mt-0.5 shrink-0"
                  checked={on}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                />
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground font-semibold leading-relaxed bg-muted/50 rounded-xl p-3">
          الصلاحيات المباشرة بتخلي الموظف ينفّذ من غير انتظار — "طلب موافقة" معناها بيبعتلك الطلب وانت تقرر.
          كل تغيير بيتسجل في سجل العمليات، وكل طلب موافقة بيعدي عليك الأول.
        </p>
        <div className="flex gap-2">
          <button
            onClick={async () => { setBusy(true); await onSaved(grants); setBusy(false); }}
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

function AddStaffDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", username: "", password: "", canAddStudents: true });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api("/api/staff", { method: "POST", body: { ...form, role: "RECEPTIONIST" } });
      toast.success("تم إضافة الموظف.");
      onSaved();
    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>موظف استقبال جديد</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          <Field label="اسم الموظف" required>
            <input className={inputCls(false)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="سارة محمد" />
          </Field>
          <Field label="اسم المستخدم (إنجليزي)" required hint="بحروف إنجليزية وأرقام بس">
            <input dir="ltr" className={inputCls(false)} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/[^a-zA-Z0-9_.]/g, "").toLowerCase() })} placeholder="sara" />
          </Field>
          <Field label="كلمة السر" required hint="6 حروف على الأقل">
            <input dir="ltr" type="text" className={inputCls(false)} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••" />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3.5 py-2.5 cursor-pointer">
            <span className="text-xs font-bold">يسمح له يضيف طلاب جدد</span>
            <input type="checkbox" className="w-5 h-5 accent-[var(--c-primary)]" checked={form.canAddStudents}
              onChange={(e) => setForm({ ...form, canAddStudents: e.target.checked })} />
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex-1 nk-brand-bg text-white font-extrabold rounded-xl py-3.5 disabled:opacity-60">{busy ? "جاري..." : "إضافة"}</button>
            <button onClick={onClose} className="rounded-xl border border-border bg-card font-bold px-5">إلغاء</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================= AUDIT =============================

function AuditTab() {
  const [data, setData] = useState<{
    total: number;
    logs: { id: string; userName: string; action: string; reason: string | null; createdAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
  } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api<typeof data>(`/api/audit?page=${page}`).then(setData).catch(() => {});
  }, [page]);

  if (!data) return <Loading />;

  return (
    <SectionCard title={`سجل العمليات (${data.total} عملية)`} icon={<ScrollText className="w-4 h-4" />}>
      {data.logs.length === 0 ? (
        <EmptyState title="السجل فاضي" />
      ) : (
        <>
          <ul className="divide-y max-h-[32rem] overflow-y-auto nk-scroll">
            {data.logs.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full nk-brand-bg-soft nk-brand-text grid place-items-center text-[11px] font-extrabold shrink-0">
                    {l.userName.slice(0, 2)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">
                      <span className="text-muted-foreground font-semibold">{l.userName}</span> — {l.action}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-semibold">
                      {new Date(l.createdAt).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </p>
                  </div>
                </div>
                {(l.before || l.after) && (
                  <details className="mt-1.5 ms-11">
                    <summary className="text-[11px] font-bold text-muted-foreground cursor-pointer">التفاصيل</summary>
                    <div className="text-[11px] font-mono bg-muted/50 rounded-lg p-2 mt-1 overflow-x-auto" dir="ltr">
                      {l.before ? <p className="text-rose-600">- {JSON.stringify(l.before)}</p> : null}
                      {l.after ? <p className="text-emerald-700">+ {JSON.stringify(l.after)}</p> : null}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between pt-3">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold disabled:opacity-40">السابق</button>
            <span className="text-xs font-bold text-muted-foreground">صفحة {page}</span>
            <button disabled={page * 40 >= data.total} onClick={() => setPage((p) => p + 1)} className="rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold disabled:opacity-40">الجاي</button>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ============================= تفضيلاتي (spec §11) =============================

function PersonalPrefsTab() {
  const [theme, setTheme] = useState<string>("system");
  const [language, setLanguage] = useState("ar");
  const [prefs, setPrefs] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ preferences: { theme: string | null; language: string; prefs: Record<string, unknown> } }>("/api/preferences", { silent: true })
      .then((d) => {
        setTheme(d.preferences.theme ?? "system");
        setLanguage(d.preferences.language);
        setPrefs(d.preferences.prefs ?? {});
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(next?: { theme?: string }) {
    setBusy(true);
    try {
      await api("/api/preferences", {
        method: "PUT",
        body: { theme: next?.theme ?? theme, language, prefs },
      });
      if (next?.theme) setTheme(next.theme);
      toast.success("تم حفظ تفضيلاتك — بتتطبق مع كل دخول.");
      // طبّق فورًا لو الحقول ظاهرة
      window.dispatchEvent(new CustomEvent("nk-prefs-changed", { detail: { theme: next?.theme ?? theme } }));
    } catch { /* toast */ } finally { setBusy(false); }
  }

  if (!loaded) return <Loading label="جاري التحميل..." />;

  return (
    <div className="space-y-4">
      <SectionCard title="تفضيلاتي الشخصية" icon={<SlidersHorizontal className="w-4 h-4" />}>
        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-bold block mb-1.5">المظهر (يتطبق مع دخولك من أي جهاز)</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: "light", label: "فاتح ☀️" },
                { v: "dark", label: "غامق 🌙" },
                { v: "system", label: "حسب الجهاز" },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => { setTheme(o.v); void save({ theme: o.v }); }}
                  className={cn(
                    "rounded-xl border-2 py-2.5 text-xs font-extrabold transition active:scale-[0.98]",
                    theme === o.v ? "nk-brand-border nk-brand-bg-soft nk-brand-text" : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold block mb-1.5">اللغة المفضلة (للتوسعات الجاية — الواجهة عربي حاليًا)</label>
            <select
              value={language}
              onChange={(e) => { setLanguage(e.target.value); void save(); }}
              className="w-full h-11 rounded-xl border-2 border-input bg-card px-3 font-bold text-sm"
            >
              <option value="ar">العربية</option>
              <option value="en">English (قريبًا)</option>
            </select>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-sm font-extrabold">صوت وشاشة التنبيهات للطالب</span>
                <span className="block text-[11px] text-muted-foreground font-semibold">تنبيه منبثق وصوت لما وصل إشعار جديد</span>
              </span>
              <Switch
                checked={(prefs.portalChime as boolean) ?? true}
                onCheckedChange={(v) => { const next = { ...prefs, portalChime: v }; setPrefs(next); void save(); }}
                aria-label="تفعيل صوت التنبيهات"
              />
            </label>
          </div>

          <p className="text-[11px] font-bold text-muted-foreground">
            تفضيلاتك محفوظة على حسابك — بتتبعك على أي جهاز، ومش بتأثر على هوية السنتر.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
