"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellRing, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { api } from "./lib";

// ============================================================
// كارت التنبيهات الذكية (المرحلة 6) — للمدير بس.
// أرقام محسوبة لحظة الفتح من البيانات — مفيش polling تقيل (زرار تحديث يدوي).
// ============================================================

type SmartAlert = {
  key: string; severity: "CRITICAL" | "WARN" | "INFO";
  title: string; detail: string; count: number;
  items: { label: string; sub?: string }[];
};

const SEV: Record<SmartAlert["severity"], { ring: string; badge: string; label: string }> = {
  CRITICAL: { ring: "border-red-500/40 bg-red-500/5", badge: "bg-red-500/15 text-red-600", label: "حرج" },
  WARN: { ring: "border-amber-500/40 bg-amber-500/5", badge: "bg-amber-500/15 text-amber-600", label: "تحذير" },
  INFO: { ring: "border-sky-500/40 bg-sky-500/5", badge: "bg-sky-500/15 text-sky-600", label: "متابعة" },
};

export function AlertsCard() {
  const [alerts, setAlerts] = useState<SmartAlert[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // الجلب الفعلي — كل الـ setState جوّه callbacks غير متزامنة (قاعدة react-hooks)
  const fetchAlerts = useCallback(() => {
    return api<{ alerts: SmartAlert[] }>("/api/alerts", { silent: true })
      .then((d) => setAlerts(d.alerts))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchAlerts().finally(() => { if (!alive) return; });
    return () => { alive = false; };
  }, [fetchAlerts]);

  const refresh = () => {
    setLoading(true);
    void fetchAlerts();
  };

  if (alerts === null) {
    return loading ? (
      <div className="nk2-card flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> بنجهّز التنبيهات الذكية…
      </div>
    ) : null;
  }

  if (alerts.length === 0) {
    return (
      <div className="nk2-card flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
          <BellRing className="w-4 h-4 text-emerald-600" />
        </span>
        <div className="min-w-0">
          <p className="font-extrabold text-sm">كل حاجة تمام ✅</p>
          <p className="text-xs text-muted-foreground font-semibold">مفيش مديونيات متأخرة ولا حصص مش مقفولة ولا طلبات مستنّية</p>
        </div>
      </div>
    );
  }

  const critical = alerts.filter((a) => a.severity === "CRITICAL").reduce((s, a) => s + a.count, 0);

  return (
    <div className="nk2-card">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-3">
        <h2 className="nk2-sec-title flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          تنبيهات محتاجة انتباهك {critical > 0 && <span className="text-red-500">({critical} حرجة)</span>}
        </h2>
        <button onClick={refresh} disabled={loading}
          className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground hover:text-foreground transition disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> تحديث
        </button>
      </div>
      <div className="space-y-2">
        {alerts.map((a) => {
          const sev = SEV[a.severity];
          const open = openKey === a.key;
          return (
            <div key={a.key} className={`rounded-xl border p-3 ${sev.ring}`}>
              <button className="w-full flex items-center justify-between gap-2 text-start"
                onClick={() => setOpenKey(open ? null : a.key)}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 ${sev.badge}`}>{sev.label}</span>
                    <p className="font-extrabold text-sm">{a.title}</p>
                    <span className="nk-num font-extrabold text-sm">{a.count}</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">{a.detail}</p>
                </div>
                {a.items.length > 0 && (open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />)}
              </button>
              {open && a.items.length > 0 && (
                <ul className="mt-2 pt-2 border-t border-border/60 space-y-1.5">
                  {a.items.map((it, i) => (
                    <li key={i} className="text-xs font-semibold">
                      <span className="font-extrabold">{it.label}</span>
                      {it.sub && <span className="text-muted-foreground"> — {it.sub}</span>}
                    </li>
                  ))}
                  {a.count > a.items.length && (
                    <li className="text-[11px] text-muted-foreground font-semibold">و {a.count - a.items.length} كمان…</li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
