"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Fingerprint, QrCode, ScanLine, UserRound, Users, MonitorSmartphone,
  RefreshCcw, Plus, Copy, CheckCircle2, Clock, Loader2, ExternalLink, Trash2, Timer, ShieldCheck, Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "./lib";
import { SectionCard, Loading, Chip } from "./shared";
import { InfoIcon, ActionPill, ActionSquare } from "./action-button";
import { notifyCapsChanged } from "./caps";
import {
  CAPABILITY_CATALOG, CAPABILITY_KEYS,
  type CapabilityKey, type CapabilityMap,
} from "@/lib/capabilities";

/* ============================================================
   تبويب «الحضور» — إعدادات قدرات المركز (مدير فقط)
   - مفتاح تشغيل لكل قدرة + شرح ورا علامة "!"
   - إعداد البصمة (أقصى عدد) + إعداد شاشة الموظفين (سرعة التدوير)
   - أجهزة الحضور: تسجيل شاشة QR / جهاز بصمة — المفتاح بيتعرض مرة واحدة
   - حضور الموظفين النهاردة (من السجل الموحد)
   التحديد بيتحفظ فورًا عبر PATCH /api/center/capabilities —
   والسيرفر هو اللي بيفرض القدرات على كل الـ API (مش مجرد إخفاء UI).
============================================================ */

type Device = { id: string; name: string; kind: string; active: boolean; lastSeenAt: string | null; createdAt: string };
type TrustedDevice = { id: string; studentId?: string; studentName: string; studentCode: string; studentStatus?: string | null; boundAt: string; lastUsedAt: string | null; status: string; revokedAt: string | null; revokedByName: string | null; revokeReason: string | null; deviceTail: string };
type StaffEvent = { id: string; name: string; role: string | null; method: string; methodLabel: string; status: string; occurredAt: string; today: boolean; sessionLabel: string | null };

export function AttendanceTab() {
  const [caps, setCaps] = useState<CapabilityMap | null>(null);
  const [busyKey, setBusyKey] = useState<CapabilityKey | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<StaffEvent[]>([]);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [addingDevice, setAddingDevice] = useState(false);
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);
  const [trusted, setTrusted] = useState<TrustedDevice[] | null>(null);
  const [revokeFor, setRevokeFor] = useState<TrustedDevice | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(() => {
    api<{ capabilities: CapabilityMap }>("/api/center/capabilities", { silent: true })
      .then((d) => setCaps(d.capabilities))
      .catch(() => {});
    api<{ devices: Device[] }>("/api/attendance/staff-qr/device", { silent: true })
      .then((d) => setDevices(d.devices))
      .catch(() => {});
    api<{ events: StaffEvent[] }>("/api/attendance/staff-events?days=2", { silent: true })
      .then((d) => setEvents(d.events))
      .catch(() => {});
    api<{ devices: TrustedDevice[] }>("/api/attendance/trusted-devices", { silent: true })
      .then((d) => setTrusted(d.devices))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!caps) return <Loading label="جاري تحميل إعدادات الحضور…" />;

  async function patch(key: CapabilityKey, enabled?: boolean, config?: Record<string, unknown>) {
    setBusyKey(key);
    try {
      const res = await api<{ capabilities: CapabilityMap }>("/api/center/capabilities", {
        method: "PATCH",
        body: { capabilities: [{ key, ...(enabled !== undefined ? { enabled } : {}), ...(config ? { config } : {}) }] },
        silent: true,
      });
      setCaps(res.capabilities);
      notifyCapsChanged();
      toast.success("حفظت — مفعّلة على مستوى السيرفر كمان.");
    } catch { /* toast من api */ } finally { setBusyKey(null); }
  }

  async function addDevice() {
    const name = newDeviceName.trim();
    if (name.length < 2) { toast.error("اكتب اسم واضح للجهاز."); return; }
    setAddingDevice(true);
    try {
      const res = await api<{ device: { id: string; name: string }; deviceKey: string }>("/api/attendance/staff-qr/device", {
        method: "POST", body: { name }, silent: true,
      });
      setShownKey({ name: res.device.name, key: res.deviceKey });
      setNewDeviceName("");
      api<{ devices: Device[] }>("/api/attendance/staff-qr/device", { silent: true }).then((d) => setDevices(d.devices)).catch(() => {});
    } catch { /* toast */ } finally { setAddingDevice(false); }
  }

  async function toggleDevice(d: Device) {
    try {
      await api("/api/attendance/staff-qr/device", { method: "PATCH", body: { id: d.id, active: !d.active }, silent: true });
      api<{ devices: Device[] }>("/api/attendance/staff-qr/device", { silent: true }).then((x) => setDevices(x.devices)).catch(() => {});
    } catch { /* toast */ }
  }

  async function revokeTrusted() {
    if (!revokeFor) return;
    if (revokeReason.trim().length < 3) { toast.error("اكتب سبب السحب (3 حروف على الأقل) — العملية دي متدقيقة باسمك."); return; }
    setRevoking(true);
    try {
      const res = await api<{ message: string }>("/api/attendance/trusted-devices", {
        method: "DELETE", body: { studentId: revokeFor.studentId, reason: revokeReason }, silent: true,
      });
      toast.success(res.message ?? "اتسحب الجهاز الموثوق.");
      setRevokeFor(null); setRevokeReason("");
      api<{ devices: TrustedDevice[] }>("/api/attendance/trusted-devices", { silent: true }).then((d) => setTrusted(d.devices)).catch(() => {});
    } catch { /* toast */ } finally { setRevoking(false); }
  }

  const studentCaps = CAPABILITY_KEYS.filter((k) => CAPABILITY_CATALOG[k].group === "students");
  const staffCaps = CAPABILITY_KEYS.filter((k) => CAPABILITY_CATALOG[k].group === "staff");

  return (
    <div className="space-y-4">
      {/* ============ قدرات حضور الطلاب ============ */}
      <SectionCard title="حضور الطلاب — ميزات المركز" icon={<Users className="w-4 h-4 nk-brand-text" />}>
        <div className="space-y-2">
          {studentCaps.map((k) => (
            <CapRow key={k} capKey={k} caps={caps} busy={busyKey === k} onToggle={(v) => patch(k, v)} onConfig={(c) => patch(k, undefined, c)} />
          ))}
        </div>
      </SectionCard>

      {/* ============ قدرات الموظفين ============ */}
      <SectionCard title="حضور الموظفين والمدرسين" icon={<UserRound className="w-4 h-4 nk-brand-text" />}>
        <div className="space-y-2">
          {staffCaps.map((k) => (
            <CapRow key={k} capKey={k} caps={caps} busy={busyKey === k} onToggle={(v) => patch(k, v)} onConfig={(c) => patch(k, undefined, c)} />
          ))}
        </div>
      </SectionCard>

      {/* ============ أجهزة الحضور (شاشة QR) ============ */}
      {caps.staff_qr_checkin.enabled && (
        <SectionCard
          title="أجهزة الحضور — شاشة QR"
          icon={<MonitorSmartphone className="w-4 h-4 nk-brand-text" />}
          action={<InfoIcon text="الجهاز شاشة ثابتة في المركز بتعكس كود متغير — الموظف يمسحه من موبايله يسجّل حضوره. المفتاح بيتعرض مرة واحدة بس." />}
        >
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <input
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                placeholder="اسم الجهاز (مثال: شاشة الاستقبال)"
                className="flex-1 h-10 rounded-xl border border-input bg-card px-3 text-sm font-bold"
                maxLength={60}
              />
              <ActionSquare icon={<Plus className="w-5 h-5" />} label="إضافة" variant="primary" size="sm" loading={addingDevice} onClick={addDevice} tooltip="تسجيل جهاز جديد" />
            </div>

            {devices.length === 0 && (
              <p className="text-xs font-bold text-muted-foreground py-2">مفيش أجهزة مسجلة — ضيف شاشة ومحلّها في المركز.</p>
            )}
            <div className="space-y-2">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn("w-8 h-8 rounded-lg grid place-items-center shrink-0", d.active ? "nk-brand-bg-soft nk-brand-text" : "bg-muted text-muted-foreground")}>
                      <QrCode className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-extrabold text-[13px] truncate">{d.name}</p>
                      <p className="text-[10.5px] text-muted-foreground font-bold nk-num" dir="ltr">
                        {d.lastSeenAt ? `آخر ظهور ${new Date(d.lastSeenAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}` : "لسه مفتحش الشاشة"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Chip className={d.active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-muted text-muted-foreground"}>{d.active ? "شغال" : "موقوف"}</Chip>
                    <ActionPill icon={<Trash2 className="w-3.5 h-3.5" />} label={d.active ? "إيقاف" : "تفعيل"} variant={d.active ? "ghost" : "secondary"} onClick={() => toggleDevice(d)} tooltip={d.active ? "إيقاف الجهاز" : "تفعيل الجهاز"} />
                  </div>
                </div>
              ))}
            </div>

            <a
              href="/staff-screen"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-2.5 text-xs font-extrabold nk-brand-text hover:bg-muted/50 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" /> افتح شاشة حضور الموظفين (تابلت/شاشة المركز)
            </a>
          </div>
        </SectionCard>
      )}

      {/* ============ حضور الموظفين النهاردة ============ */}
      <SectionCard
        title="حضور الموظفين — آخر يومين"
        icon={<Clock className="w-4 h-4 nk-brand-text" />}
        action={<ActionPill icon={<RefreshCcw className="w-3.5 h-3.5" />} label="تحديث" variant="ghost" onClick={load} tooltip="تحديث القايمة" />}
      >
        {events.length === 0 ? (
          <p className="text-xs font-bold text-muted-foreground py-2">مفيش أحداث حضور موظفين لسه.</p>
        ) : (
          <div className="divide-y">
            {events.slice(0, 12).map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-2.5">
                <span className={cn("w-8 h-8 rounded-lg grid place-items-center shrink-0", e.status === "CHECK_IN" ? "nk-brand-bg-soft nk-brand-text" : "bg-muted text-muted-foreground")}>
                  {e.method === "FINGERPRINT" ? <Fingerprint className="w-4 h-4" /> : e.method === "SESSION_START" ? <CheckCircle2 className="w-4 h-4" /> : <ScanLine className="w-4 h-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-[13px] truncate">{e.name} {!e.today && <span className="text-[10px] text-muted-foreground">(امبارح)</span>}</p>
                  <p className="text-[10.5px] text-muted-foreground font-bold">{e.methodLabel}{e.sessionLabel ? ` — ${e.sessionLabel}` : ""}</p>
                </div>
                <span className="text-[11px] font-extrabold nk-num text-muted-foreground shrink-0" dir="ltr">
                  {new Date(e.occurredAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ============ مفتاح الجهاز (مرة واحدة) ============ */}
      {/* ============ الأجهزة الموثوقة (استرجاع إداري) ============ */}
      {caps.trusted_devices.enabled && trusted && trusted.length > 0 && (
        <SectionCard
          title="الأجهزة الموثوقة — ربط الطلاب بموبايلاتهم"
          icon={<Smartphone className="w-4 h-4 nk-brand-text" />}
          action={<InfoIcon text="الطالب المربوط بجهاز ميسجّلش من جهاز تاني. لو الطالب غيّر موبايله: اسحب الربط من هنا (بسبب موثّق) — وأول حضور ناجح بعده هيربط الجهاز الجديد تلقائيًا." />}
        >
          <div className="space-y-2">
            {trusted.map((t) => (
              <div key={t.id} className={cn("flex items-center justify-between gap-2 rounded-xl border p-3", t.status === "ACTIVE" ? "border-border bg-card" : "border-border/50 bg-muted/30 opacity-70")}>
                <div className="min-w-0">
                  <p className="font-extrabold text-[13px]">
                    {t.studentName} <span className="nk-num text-muted-foreground text-[11px]">({t.studentCode})</span>
                    {t.status !== "ACTIVE" && <span className="text-rose-600 text-[11px] font-black"> — مسحوب</span>}
                  </p>
                  <p className="text-[10.5px] font-bold text-muted-foreground mt-0.5">
                    ارتبط {new Date(t.boundAt).toLocaleDateString("ar-EG")}
                    {t.lastUsedAt ? ` · آخر استخدام ${new Date(t.lastUsedAt).toLocaleDateString("ar-EG")}` : " · لسه ما استخدمش"}
                    {t.revokedByName ? ` · سحبه ${t.revokedByName}` : ""}
                  </p>
                </div>
                {t.status === "ACTIVE" && (
                  <button
                    onClick={() => setRevokeFor(t)}
                    className="shrink-0 rounded-xl border-2 border-rose-200 text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 px-3 py-1.5 text-[11px] font-extrabold hover:bg-rose-100 dark:hover:bg-rose-900/50"
                  >
                    سحب الجهاز
                  </button>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {revokeFor && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div className="nk-card rounded-3xl p-6 w-full max-w-sm space-y-3">
            <h3 className="font-extrabold text-base">سحب جهاز {revokeFor.studentName}</h3>
            <p className="text-xs font-bold text-muted-foreground leading-relaxed">
              بعد السحب، الطالب يقدر يربط موبايله الجديد من أول حضور ناجح. العملية بتتسجل في سجل العمليات باسمك وسببك.
            </p>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="السبب (إلزامي) — مثال: الطالب غير موبايله"
              className="w-full rounded-xl border-2 border-border bg-card p-3 text-sm font-bold min-h-20"
            />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setRevokeFor(null); setRevokeReason(""); }} className="rounded-xl border-2 border-border bg-card font-extrabold text-sm py-2.5">إلغاء</button>
              <button
                disabled={revoking}
                onClick={revokeTrusted}
                className="rounded-xl bg-rose-600 text-white font-extrabold text-sm py-2.5 shadow active:scale-95 disabled:opacity-50"
              >
                {revoking ? "بيسحب…" : "تأكيد السحب"}
              </button>
            </div>
          </div>
        </div>
      )}

      {shownKey && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true">
          <div className="nk-card rounded-3xl p-6 w-full max-w-sm space-y-4 text-center">
            <span className="mx-auto w-12 h-12 rounded-2xl nk-brand-bg-soft nk-brand-text grid place-items-center"><QrCode className="w-6 h-6" /></span>
            <h3 className="font-extrabold text-base">مفتاح «{shownKey.name}»</h3>
            <p className="text-xs font-bold text-muted-foreground leading-relaxed">
              افتح صفحة شاشة الحضور على جهاز المركز والصق المفتاح ده — <b>مش هيتعرض تاني</b>.
            </p>
            <div className="rounded-xl bg-muted/60 border border-border p-3 nk-num text-[12px] font-bold break-all select-all" dir="ltr">{shownKey.key}</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { navigator.clipboard?.writeText(shownKey.key).then(() => toast.success("اتنسخ")); }}
                className="rounded-xl border-2 border-border bg-card font-extrabold text-sm py-2.5 flex items-center justify-center gap-1.5"
              >
                <Copy className="w-4 h-4" /> نسخ
              </button>
              <button onClick={() => setShownKey(null)} className="rounded-xl nk-brand-grad text-white font-extrabold text-sm py-2.5 shadow active:scale-95">
                تم
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== صف قدرة واحدة: مفتاح تشغيل + شرح "!" + إعدادات فرعية ===== */
function CapRow({ capKey, caps, busy, onToggle, onConfig }: {
  capKey: CapabilityKey;
  caps: CapabilityMap;
  busy: boolean;
  onToggle: (v: boolean) => void;
  onConfig: (config: Record<string, unknown>) => void;
}) {
  const meta = CAPABILITY_CATALOG[capKey];
  const state = caps[capKey];
  const icon = CAP_ICONS[capKey];

  return (
    <div className={cn("rounded-xl border p-3 transition-colors", state.enabled ? "border-border bg-card" : "border-border/60 bg-muted/30")}>
      <div className="flex items-center gap-2.5">
        <span className={cn("w-9 h-9 rounded-xl grid place-items-center shrink-0", state.enabled ? "nk-brand-bg-soft nk-brand-text" : "bg-muted text-muted-foreground")}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-[13px] flex items-center gap-1.5 flex-wrap">
            {meta.label}
            <InfoIcon text={meta.desc} />
          </p>
          <p className="text-[10.5px] font-bold text-muted-foreground mt-0.5">
            {state.enabled ? "مفعّلة في المركز" : "مقفولة — مبتظهرش لأحد"}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={meta.label}
          disabled={busy}
          onClick={() => onToggle(!state.enabled)}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50",
            state.enabled ? "nk-brand-bg" : "bg-muted-foreground/30",
          )}
        >
          <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", state.enabled ? "start-[22px]" : "start-0.5")} />
        </button>
      </div>

      {/* إعدادات فرعية حسب القدرة */}
      {state.enabled && capKey === "fingerprint" && (
        <NumberConfig
          icon={<Users className="w-3.5 h-3.5" />}
          label="أقصى عدد بصمات مسجلة"
          value={Number(state.config.maxUsers ?? 3)}
          min={1} max={10}
          onCommit={(v) => onConfig({ maxUsers: v })}
        />
      )}
      {state.enabled && capKey === "staff_qr_checkin" && (
        <NumberConfig
          icon={<Timer className="w-3.5 h-3.5" />}
          label="تدوير الكود كل (ثواني)"
          value={Number(state.config.slotSeconds ?? 10)}
          min={5} max={30}
          onCommit={(v) => onConfig({ slotSeconds: v })}
        />
      )}
      {state.enabled && capKey === "teacher_auto_attendance" && (
        <label className="flex items-center gap-2 mt-2 ps-11 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!state.config.requireCenterPresence}
            onChange={(e) => onConfig({ requireCenterPresence: e.target.checked })}
            className="w-4 h-4 accent-[var(--c-primary)]"
          />
          <span className="text-[11px] font-extrabold text-muted-foreground flex items-center gap-1.5">
            إثبات حضور مادي قبل بدء الحصة
            <InfoIcon text="لما تتشغل: فتح الحصة بيرفض لو المدرس معندوش أي حضور اليوم (شاشة QR أو بصمة) — إثبات إنه فعلًا في المركز." />
          </span>
        </label>
      )}
    </div>
  );
}

const CAP_ICONS: Record<CapabilityKey, React.ReactNode> = {
  name_attendance: <Users className="w-4 h-4" />,
  static_qr: <QrCode className="w-4 h-4" />,
  dynamic_qr: <RefreshCcw className="w-4 h-4" />,
  student_self_scan: <ScanLine className="w-4 h-4" />,
  staff_qr_checkin: <MonitorSmartphone className="w-4 h-4" />,
  fingerprint: <Fingerprint className="w-4 h-4" />,
  late_checkin: <Clock className="w-4 h-4" />,
  teacher_auto_attendance: <ShieldCheck className="w-4 h-4" />,
  trusted_devices: <Smartphone className="w-4 h-4" />,
};

/** حقل رقمي بحفظ عند التغيير */
function NumberConfig({ icon, label, value, min, max, onCommit }: {
  icon: React.ReactNode; label: string; value: number; min: number; max: number; onCommit: (v: number) => void;
}) {
  const [v, setV] = useState(String(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(String(value)), [value]);

  async function commit() {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max || n === value) return;
    setSaving(true);
    try { onCommit(n); } finally { setSaving(false); }
  }

  return (
    <div className="flex items-center gap-2 mt-2 ps-11">
      <span className="text-[11px] font-extrabold text-muted-foreground flex items-center gap-1">{icon} {label}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        inputMode="numeric"
        dir="ltr"
        className="w-16 h-8 rounded-lg border border-input bg-card text-center text-sm font-extrabold nk-num"
      />
      {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}
