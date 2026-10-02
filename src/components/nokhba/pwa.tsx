"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Wifi, WifiOff, RefreshCw, Loader2, CheckCircle2, XCircle, Clock, Download, Share, PlusSquare, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "./lib";
import { cn } from "@/lib/utils";

/* ============================================================
   طبقة الـ PWA والحضور الأوفلاين:
   - PWARegister: تسجيل الـ service worker + manifest (مرة واحدة)
   - useOnlineStatus: حالة الاتصال الحية (navigator.onLine + events)
   - OfflineQueue: طابور حضور محلي (localStorage) بـ idempotency key
     * الحضور بس — الدفع أونلاين فقط (قرار أمان متعمد)
     * لما النت يرجع: مزامنة رسالة-بمسج، من غير تكرار (idemKey)
     * بيتفضى عند تسجيل الخروج
============================================================ */

export function PWARegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* تسجيل الـ SW مش حرج — ساكتين لو فشل */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}

// ============================= حالة الاتصال (online/offline) =============================
// useSyncExternalStore — النمط القياسي: مفيش setState جوه effect ولا hydration mismatch

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);
}

// ============================= طابور الحضور الأوفلاين =============================

export type PendingScan = {
  idemKey: string; // `${sessionId}:${query}:${deviceTime}` — منع التكرار
  sessionId: string | null;
  query: string; // الكود الخام (5 أرقام أو QR token) — الحل بيتم على السيرفر وقت المزامنة
  label: string; // عرض مبدئي (الكود اللي اتسحب)
  status: "PENDING" | "SYNCED" | "FAILED";
  error?: string;
  resolvedName?: string; // اسم الطالب بعد المزامنة الناجحة
  deviceTime: string; // ISO وقت الجهاز — للعرض الصادق
};

const QUEUE_KEY = "nokhba_pending_attendance_v1";

export function readPending(): PendingScan[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as PendingScan[];
  } catch {
    return [];
  }
}

function writePending(items: PendingScan[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function clearPending() {
  localStorage.removeItem(QUEUE_KEY);
}

export function queueScan(item: Omit<PendingScan, "status">) {
  const items = readPending();
  if (items.some((i) => i.idemKey === item.idemKey)) return; // مفيش تكرار
  items.push({ ...item, status: "PENDING" });
  writePending(items);
  // إشعار واجهة وضع التركيز إن الطابور اتغير (عداد الحفظ المحلي)
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nk-pending-changed"));
}

/** مزامنة كل المسح المعلق — رسالة-بمسج بإعادة محاولة per-item
 *  الحل + التسجيل بيحصلوا على السيرفر (idemKey بيمنع أي تكرار) */
export async function syncPending(): Promise<{ synced: number; failed: number }> {
  const items = readPending();
  let synced = 0;
  let failed = 0;
  const next: PendingScan[] = [];
  for (const it of items) {
    if (it.status === "SYNCED") { next.push(it); continue; }
    if (!it.sessionId) {
      // مسح من غير حصة محددة — مستحيل نعرف نحضّره فين، يتفشل بأمانة
      failed++;
      next.push({ ...it, status: "FAILED", error: "مفيش حصة محددة للمسح ده" });
      continue;
    }
    try {
      const res = await api<{ studentName: string; alreadyAttended: boolean }>("/api/attendance/sync", {
        method: "POST",
        silent: true,
        body: { sessionId: it.sessionId, query: it.query, idemKey: it.idemKey },
      });
      next.push({ ...it, status: "SYNCED", resolvedName: res.studentName });
      synced++;
    } catch (e) {
      failed++;
      next.push({ ...it, status: "FAILED", error: e instanceof Error ? e.message : "فشل غير معروف" });
    }
  }
  writePending(next);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nk-pending-changed"));
  return { synced, failed };
}

/** شريط حالة الاتصال + طابور الحضور الأوفلاين (يتركب في شاشة الحضور) */
export function OfflineStatusBar({ onSynced }: { onSynced?: () => void }) {
  const online = useOnlineStatus();
  const [pending, setPending] = useState<PendingScan[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setPending(readPending()), []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const unsynced = pending.filter((p) => p.status !== "SYNCED").length;
  const failed = pending.filter((p) => p.status === "FAILED").length;

  async function doSync() {
    if (busy || !online) return;
    setBusy(true);
    try {
      const res = await syncPending();
      if (res.synced > 0) toast.success(`اتزامن ${res.synced} حضور مع السيرفر.`);
      if (res.failed > 0) toast.error(`${res.failed} حضور فشل في المزامنة — جرّب تاني.`);
      refresh();
      onSynced?.();
    } finally { setBusy(false); }
  }

  // مبدئيًا: أول ما النت يرجع، حاول تزامن تلقائي مرة
  useEffect(() => {
    if (online && unsynced > 0) doSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  if (online && unsynced === 0 && pending.length === 0) return null;

  return (
    <div className={`rounded-2xl border p-3 space-y-2 ${
      online ? "border-emerald-200 bg-emerald-50/70" : "border-amber-300 bg-amber-50"
    }`} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-extrabold">
          {online ? (
            <><Wifi className="w-4 h-4 text-emerald-600" />
            <span className="text-emerald-800">متصل بالسيرفر</span></>
          ) : (
            <><WifiOff className="w-4 h-4 text-amber-600" />
            <span className="text-amber-800">شغال أوفلاين — الحضور بيتسجل محليًا ويتزامن أول ما النت يرجع</span></>
          )}
        </div>
        {online && unsynced > 0 && (
          <button onClick={doSync} disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-extrabold nk-brand-bg text-white rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            مزامنة ({unsynced})
          </button>
        )}
      </div>

      {pending.length > 0 && (
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {pending.slice(-8).reverse().map((p) => (
            <div key={p.idemKey} className="flex items-center gap-2 text-xs bg-white/70 rounded-lg px-2.5 py-1.5">
              {p.status === "SYNCED" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                : p.status === "FAILED" ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                : <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              <span className="font-bold truncate">{p.resolvedName ?? p.label}</span>
              {p.resolvedName && <span className="text-muted-foreground nk-num" dir="ltr">{p.label}</span>}
              <span className={`ms-auto shrink-0 font-bold ${p.status === "SYNCED" ? "text-emerald-700" : p.status === "FAILED" ? "text-red-700" : "text-amber-700"}`}>
                {p.status === "SYNCED" ? "متزامن ✓" : p.status === "FAILED" ? (p.error ?? "فشل") : "في الانتظار"}
              </span>
            </div>
          ))}
        </div>
      )}

      {failed > 0 && (
        <p className="text-[11px] font-bold text-red-600">
          الحصص المقفولة أو الملغاة مش بتقبل حضور متأخر — راجعها مع المدير.
        </p>
      )}
    </div>
  );
}

/* ============================================================
   كارت تثبيت التطبيق (PWA Install) — بيظهر لما المتصفح يسمح
   بالتثبيت، وبيختفي بعد التثبيت أو لو المستخدم رفض.
   ============================================================ */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function subscribeInstall(cb: () => void) {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}

function setDeferredPrompt(e: InstallPromptEvent | null) {
  deferredPrompt = e;
  installListeners.forEach((cb) => cb());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    setDeferredPrompt(e as InstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => setDeferredPrompt(null));
}

export function InstallCard() {
  const available = useSyncExternalStore(
    subscribeInstall,
    () => deferredPrompt !== null,
    () => false,
  );
  const installed = useSyncExternalStore(
    subscribeInstall,
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => true,
  );

  if (!available || installed) return null;

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") setDeferredPrompt(null);
  }

  return (
    <button
      onClick={install}
      className="w-full flex items-center gap-3 rounded-2xl border-2 nk-brand-border bg-card px-4 py-3 text-start hover:bg-muted/40 transition"
    >
      <span className="w-10 h-10 rounded-xl nk-brand-grad text-white grid place-items-center shrink-0">
        <Download className="w-5 h-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold text-[13.5px] nk-brand-text">نزّل التطبيق على جهازك</span>
        <span className="block text-[11.5px] font-bold text-muted-foreground">وصول أسرع + يشتغل من غير نت للحضور</span>
      </span>
      <span className="ms-auto text-[12px] font-extrabold nk-brand-text shrink-0">تثبيت</span>
    </button>
  );
}
