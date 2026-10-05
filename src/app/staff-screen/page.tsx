"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { QrCode, LogIn, RefreshCcw, Loader2, ShieldCheck } from "lucide-react";
import { AlNokhbaMark } from "@/components/nokhba/shared";

/* ============================================================
   شاشة حضور الموظفين (/staff-screen) — جهاز ثابت في المركز
   - التفعيل مرة واحدة بمفتاح الجهاز (بيتخزن محليًا على الشاشة)
   - بتجيب كود Slot قصير العمر (10ث افتراضيًا) وبتدوّر تلقائيًا
   - الكود بيفتح /c/<token> — التوكن opaque ومربوط بالمركز server-side
   - الصورة/السكرين شوت لكود قديم بيموت خلال ثواني (نفس فلسفة Slot QR)
============================================================ */

const KEY_STORAGE = "nk-staff-screen-key";

type Slot = {
  token: string;
  expiresAt: string;
  slotSeconds: number;
  centerName: string;
  checkinPath: string;
};

export default function StaffScreenPage() {
  const [phase, setPhase] = useState<"boot" | "pair" | "live" | "error">("boot");
  const [keyInput, setKeyInput] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [qrData, setQrData] = useState("");
  const [clock, setClock] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  // جلب الكود الحالي — الدالة بتستدعي نفسها جدولةً (ref يكسر الدائرية للـ lint)
  const fetchSlotRef = useRef<(deviceKey: string) => Promise<void>>(async () => {});
  const fetchSlot = useCallback(async (deviceKey: string) => {
    if (!aliveRef.current) return;
    try {
      const res = await fetch("/api/attendance/staff-qr/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceKey }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // مفتاح باطل/جهاز موقوف/ميزة مقفولة → رجوع للتفعيل
        setErrorMsg(data.error ?? "الجهاز مش مسجل أو الميزة مقفولة.");
        try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
        setPhase("pair");
        return;
      }
      const s = data as Slot;
      setSlot(s);
      setPhase("live");
      const url = `${window.location.origin}${s.checkinPath}`;
      setQrData(await QRCode.toDataURL(url, { width: 720, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b1220", light: "#ffffff" } }));
      // جدولة الكود الجاي قبل انتهاء الحالي بشوية — مفيش فراغ على الشاشة
      const waitMs = Math.max(2500, new Date(s.expiresAt).getTime() - Date.now() - 1200);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { if (aliveRef.current) void fetchSlotRef.current(deviceKey); }, waitMs);
    } catch {
      // شبكة — جرب تاني بعد 4ث (الشاشة بتكمل شغل)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { if (aliveRef.current) void fetchSlotRef.current(deviceKey); }, 4000);
    }
  }, []);
  useEffect(() => { fetchSlotRef.current = fetchSlot; }, [fetchSlot]);

  // التفعيل المحفوظ + الساعة
  useEffect(() => {
    aliveRef.current = true;
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY_STORAGE); } catch { /* ignore */ }
    if (stored) void fetchSlot(stored);
    else setPhase("pair");

    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1000);
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      clearInterval(t);
    };
  }, [fetchSlot]);

  function pair() {
    const k = keyInput.trim().toLowerCase();
    if (!/^[0-9a-f]{32,96}$/.test(k)) {
      toast.error("المفتاح مش شكله صح — انسخه زي ما ظهر للمدير بالظبط.");
      return;
    }
    try { localStorage.setItem(KEY_STORAGE, k); } catch { /* ignore */ }
    setPhase("boot");
    void fetchSlot(k);
  }

  return (
    <div className="min-h-screen bg-[#0b1220] text-white flex flex-col items-center justify-center p-6 select-none" dir="rtl">
      {/* الهيدر */}
      <div className="absolute top-6 inset-x-0 flex items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <img src="/logo-mark-white.png" alt="" className="w-10 h-10 object-contain opacity-95" />
          <div>
            <p className="font-extrabold text-lg leading-tight">{slot?.centerName ?? "حضور الموظفين"}</p>
            <p className="text-[11px] font-bold text-white/60">امسح الكود بموبايلك — حضورك بيتسجل فورًا</p>
          </div>
        </div>
        <span className="text-2xl font-extrabold nk-num tabular-nums" dir="ltr">{clock}</span>
      </div>

      {/* ===== التفعيل ===== */}
      {phase === "pair" && (
        <div className="w-full max-w-sm space-y-4 text-center">
          <span className="mx-auto w-16 h-16 rounded-3xl bg-white/10 grid place-items-center"><LogIn className="w-8 h-8 text-white/80" /></span>
          <h1 className="text-xl font-extrabold">تفعيل شاشة الحضور</h1>
          <p className="text-sm text-white/70 font-bold leading-relaxed">
            الصق مفتاح الجهاز اللي المدير ديمله عند تسجيل الشاشة — مرة واحدة بس.
          </p>
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pair()}
            placeholder="مفتاح الجهاز (48 حرف)"
            dir="ltr"
            className="w-full h-12 rounded-2xl bg-white/10 border border-white/20 px-4 text-center text-sm font-bold text-white placeholder:text-white/40 outline-none focus:border-white/50"
          />
          <button onClick={pair} className="w-full h-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-extrabold shadow-lg transition active:scale-95">
            فعّل الشاشة
          </button>
          {errorMsg && <p className="text-xs font-bold text-rose-300">{errorMsg}</p>}
          <p className="text-[10.5px] text-white/40 font-bold flex items-center justify-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> الكود بيتجدد تلقائيًا لمنع صور الأكواد القديمة</p>
        </div>
      )}

      {/* ===== شغالة ===== */}
      {(phase === "live" || phase === "boot") && (
        <div className="flex flex-col items-center gap-5 mt-10">
          <div className="relative bg-white rounded-[2rem] p-6 shadow-[0_0_80px_rgba(16,185,129,0.25)]">
            {qrData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrData} alt="كود حضور الموظفين" className="w-[46vmin] h-[46vmin] max-w-[420px] max-h-[420px] object-contain" />
            ) : (
              <div className="w-[46vmin] h-[46vmin] max-w-[420px] max-h-[420px] grid place-items-center">
                <Loader2 className="w-10 h-10 animate-spin text-slate-400" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-white/70 font-extrabold text-sm">
            <QrCode className="w-4 h-4" />
            الكود بيتجدد كل {slot?.slotSeconds ?? 10} ثواني — امسح أحدث كود
          </div>
          {slot && (
            <CountdownBar expiresAt={slot.expiresAt} />
          )}
        </div>
      )}

      {/* الفوتر */}
      <div className="absolute bottom-6 flex items-center gap-2 text-white/35 text-[11px] font-bold">
        <AlNokhbaMark size={22} light />
        <button onClick={() => { try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ } setPhase("pair"); setSlot(null); }} className="ms-4 hover:text-white/70 flex items-center gap-1">
          <RefreshCcw className="w-3 h-3" /> إعادة تفعيل
        </button>
      </div>
    </div>
  );
}

/** شريط التقدم — عمر الكود الحالي */
function CountdownBar({ expiresAt }: { expiresAt: string }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const end = new Date(expiresAt).getTime();
    const t = setInterval(() => {
      const p = Math.max(0, Math.min(100, ((end - Date.now()) / 14000) * 100));
      setPct(p);
    }, 250);
    return () => clearInterval(t);
  }, [expiresAt]);
  return (
    <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}
