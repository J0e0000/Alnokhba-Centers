"use client";

import { useEffect, useRef, useState } from "react";
import {
  RefreshCcw,
  SwitchCamera,
  ExternalLink,
  ScanLine,
  Flashlight,
  FlashlightOff,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * سكانر كاميرا حقيقي (مش مجرد معاينة) — بيقرا كود حضور الحصة (موديل Slot QR).
 *
 * إيه اللي يخليه "سكانر كاميرا" فعلًا:
 * - إطار سكان (reticle) + خط مسح متحرك + تعتيم حوالين الإطار — زي كاميرات السكانر الأصلية
 * - BarcodeDetector الأصلي (كروم/أندرويد) أولًا — أسرع وأنسب مسار على الموبايل
 * - jsQR fallback على كادر مسحوب 900px + دمج آخر 8 كادات للظروف الصعبة
 * - زوم (لو الكاميرا بتدعم) — لتقريب الكود اللي على شاشة بعيدة
 * - فلاش/تورش (لو مدعوم) + اهتزاز + صوت + وميض أخضر عند القراءة
 * - سمات data-*-بيانات للفحص الآلي: data-scan-status / data-decode-count / data-last-decode
 *
 * Robustness (نفس دروس QrCameraScanner):
 * - onScan kept in a ref → the camera NEVER restarts on parent re-renders
 * - start/stop serialized through a promise chain
 * - back camera first, switchable, iframe-friendly errors
 */

type Frame = { data: Uint8ClampedArray; width: number; height: number };

const FRAME_FPS_MS = 66;      // ~15fps grab
const BUFFER_SIZE = 8;        // ~530ms من الكادات — دمج للظروف الصعبة
const COMPOSITE_EVERY = 3;    // دمج كل 3 كادات (~5Hz)
const MAX_DIM = 900;          // تعيينة أعلى للأكواد البعيدة/الصغيرة (كانت 640)

type ZoomCaps = { min: number; max: number; step: number };
type TrackWithExtras = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { zoom?: ZoomCaps; torch?: boolean };
  getSettings?: () => MediaTrackSettings & { zoom?: number };
};
type BarcodeDetectorLike = { detect: (src: unknown) => Promise<{ rawValue: string }[]> };

export function CombiningQrScanner({ onScan, active }: { onScan: (text: string) => void; active: boolean }) {
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [nonce, setNonce] = useState(0);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [zoom, setZoom] = useState<{ caps: ZoomCaps; val: number } | null>(null);
  const [torchAvail, setTorchAvail] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [flash, setFlash] = useState(false);        // وميض أخضر عند القراءة
  const [decodeCount, setDecodeCount] = useState(0); // كام كود اتقري (للفحص الآلي)
  const [lastDecode, setLastDecode] = useState("");  // آخر نص اتقري
  const [everStarted, setEverStarted] = useState(false); // نسيب المعاينة ظاهرة وقت التسجيل

  const videoRef = useRef<HTMLVideoElement>(null);
  const grabCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<Frame[]>([]);
  const tickRef = useRef(0);
  const rafRef = useRef(0);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  /** نغمة قراءة قصيرة — WebAudio (بيشتغل بعد أي لمسة فتحت السكانر) */
  function beep() {
    try {
      const AC = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.07);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch { /* الصوت مش أساسي */ }
  }

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    setStatus("starting");
    setErrorMsg("");
    setDecodeCount(0);
    setLastDecode("");
    setZoom(null);
    setTorchAvail(false);
    setTorchOn(false);
    setEverStarted(true);
    bufferRef.current = [];

    const chain = (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        if (cancelled) return;

        // مسار أصلي أسرع: BarcodeDetector (كروم/أندرويد) لو متاح
        let detector: BarcodeDetectorLike | null = null;
        try {
          const BD = (window as unknown as {
            BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
          }).BarcodeDetector;
          if (BD) detector = new BD({ formats: ["qr_code"] });
        } catch { detector = null; }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play().catch(() => {});

        // قدرات الكاميرا: زوم + تورش (اختياري حسب الجهاز)
        const track = (stream.getVideoTracks()[0] ?? null) as TrackWithExtras | null;
        trackRef.current = track;
        try {
          const caps = track?.getCapabilities?.() as
            | (MediaTrackCapabilities & { zoom?: ZoomCaps; torch?: boolean })
            | undefined;
          if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
            const settings = track?.getSettings?.() as (MediaTrackSettings & { zoom?: number }) | undefined;
            setZoom({ caps: caps.zoom, val: settings?.zoom ?? caps.zoom.min });
          }
          setTorchAvail(!!caps?.torch);
        } catch { /* الجهاز مش بيدعم — بنكمل من غيرهم */ }

        // الكانفس المخفي لسحب الكادات
        const grab = document.createElement("canvas");
        grabCanvasRef.current = grab;
        const grabCtx = grab.getContext("2d", { willReadFrequently: true });

        let lastGrab = 0;
        let videoReady = video.readyState >= 1;
        if (!videoReady) video.onloadedmetadata = () => { videoReady = true; };

        const decodeText = (text: string) => {
          if (cancelled) return false;
          const t = (text || "").trim();
          if (!t) return false;
          const now = Date.now();
          if (t === lastRef.current.text && now - lastRef.current.at < 2500) return true; // dedup لكن اعتبره نجاح
          lastRef.current = { text: t, at: now };
          setDecodeCount((c) => c + 1);
          setLastDecode(t.slice(0, 80));
          try { navigator.vibrate?.(70); } catch { /* مفيش اهتزاز */ }
          beep();
          setFlash(true);
          window.setTimeout(() => { if (!cancelled) setFlash(false); }, 550);
          onScanRef.current(t);
          return true;
        };

        let detecting = false;
        const loop = (t: number) => {
          rafRef.current = requestAnimationFrame(loop);
          if (!videoReady || video.readyState < 2 || !grabCtx) return;
          if (t - lastGrab < FRAME_FPS_MS) return;
          lastGrab = t;
          tickRef.current++;

          // 1) المسار الأصلي: BarcodeDetector على الكادر الكامل (بدون تصغير — أدق وأسرع)
          if (detector && !detecting) {
            detecting = true;
            detector
              .detect(video)
              .then((rs) => {
                detecting = false;
                if (rs && rs.length > 0) decodeText(rs[0].rawValue);
              })
              .catch(() => { detecting = false; });
          }

          // 2) مسار jsQR: سحب الكادر + قراءة مباشرة
          const vw = video.videoWidth, vh = video.videoHeight;
          if (!vw || !vh) return;
          const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
          const w = Math.max(2, Math.round(vw * scale) & ~1);
          const h = Math.max(2, Math.round(vh * scale) & ~1);
          if (grab.width !== w || grab.height !== h) { grab.width = w; grab.height = h; bufferRef.current = []; }

          grabCtx.drawImage(video, 0, 0, w, h);
          const img = grabCtx.getImageData(0, 0, w, h);

          const direct = jsQR(img.data, w, h);
          if (direct?.data && decodeText(direct.data)) return;

          // 3) الدمج: آخر N كادات — لكل بكسل بنختار الأغمق (ظروف إضاءة/مسافة صعبة)
          const buf = bufferRef.current;
          buf.push({ data: img.data, width: w, height: h });
          if (buf.length > BUFFER_SIZE) buf.shift();
          if (buf.length >= 3 && tickRef.current % COMPOSITE_EVERY === 0) {
            const comp = new Uint8ClampedArray(w * h * 4);
            for (const f of buf) {
              const fd = f.data;
              for (let i = 0; i < comp.length; i += 4) {
                if (fd[i] < comp[i]) comp[i] = fd[i];
                if (fd[i + 1] < comp[i + 1]) comp[i + 1] = fd[i + 1];
                if (fd[i + 2] < comp[i + 2]) comp[i + 2] = fd[i + 2];
                comp[i + 3] = 255;
              }
            }
            const merged = jsQR(comp, w, h);
            if (merged?.data && decodeText(merged.data)) return;
          }
        };
        rafRef.current = requestAnimationFrame(loop);
        if (!cancelled) setStatus("running");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(
          /permission|denied|NotAllowed/i.test(msg)
            ? "الكاميرا مرفوضة — اسمح للكاميرا من إعدادات المتصفح وجرب تاني."
            : /NotFound|no camera|devices|Requested device/i.test(msg)
              ? "مفيش كاميرا متاحة على الجهاز ده — استخدم لصق رابط الحصة تحت."
              : inIframe
                ? "المتصفح مانع الكاميرا جوه الإطار المدمج — افتح التطبيق في تبويب جديد وجرب."
                : "الكاميرا مش شغالة هنا — استخدم لصق رابط الحصة تحت."
        );
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      const s = stream;
      if (s) s.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      bufferRef.current = [];
      void chain.catch(() => {});
    };
  }, [active, nonce, facing]);

  const applyZoom = (v: number) => {
    setZoom((z) => (z ? { ...z, val: v } : z));
    const track = trackRef.current;
    if (!track) return;
    try {
      void track.applyConstraints({
        advanced: [{ zoom: v } as unknown as MediaTrackConstraintSet],
      } as MediaTrackConstraints);
    } catch { /* تجاهل */ }
  };

  const stepZoom = (dir: 1 | -1) => {
    if (!zoom) return;
    const big = Math.max(zoom.caps.step, (zoom.caps.max - zoom.caps.min) / 4);
    applyZoom(Math.min(zoom.caps.max, Math.max(zoom.caps.min, zoom.val + dir * big)));
  };

  const toggleTorch = () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    void track
      .applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      } as MediaTrackConstraints)
      .then(() => setTorchOn(next))
      .catch(() => {});
  };

  // وقت تسجيل الحضور (busy) بنِسيب المعاينة ظاهرة بآخر كادر بدل ما تختفي فجأة
  if (!active && !everStarted) return null;

  return (
    <div
      className="space-y-2"
      data-scan-status={status}
      data-decode-count={decodeCount}
      data-last-decode={lastDecode}
    >
      <div className="relative">
        <video ref={videoRef} playsInline muted className="w-full rounded-2xl bg-black/90 border-2 border-dashed border-border min-h-[260px] object-cover" />

        {status === "starting" && (
          <div className="absolute inset-0 grid place-items-center text-white/80 text-xs font-bold">جاري تشغيل الكاميرا…</div>
        )}

        {/* ============ إطار السكان + خط المسح (شكل سكانر حقيقي) ============ */}
        {status === "running" && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[72%] max-w-[300px] aspect-square">
              {/* تعتيم كل حاجة بره الإطار */}
              <div className="absolute inset-0 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              {/* أركان الإطار — بتخضرّ لحظة القراءة */}
              <span className={cn("absolute -top-1 -start-1 w-9 h-9 rounded-tl-2xl border-t-[3px] border-s-[3px] transition-colors", flash ? "border-emerald-400" : "border-white/95")} />
              <span className={cn("absolute -top-1 -end-1 w-9 h-9 rounded-tr-2xl border-t-[3px] border-e-[3px] transition-colors", flash ? "border-emerald-400" : "border-white/95")} />
              <span className={cn("absolute -bottom-1 -start-1 w-9 h-9 rounded-bl-2xl border-b-[3px] border-s-[3px] transition-colors", flash ? "border-emerald-400" : "border-white/95")} />
              <span className={cn("absolute -bottom-1 -end-1 w-9 h-9 rounded-br-2xl border-b-[3px] border-e-[3px] transition-colors", flash ? "border-emerald-400" : "border-white/95")} />
              {/* خط المسح المتحرك */}
              <div
                className={cn(
                  "nk-scan-line absolute inset-x-4 h-[3px] rounded-full transition-colors",
                  flash ? "bg-emerald-300 shadow-[0_0_14px_3px_rgba(52,211,153,0.9)]" : "bg-white/85 shadow-[0_0_10px_2px_rgba(255,255,255,0.55)]",
                )}
                style={{ animation: "nk-scan-sweep 2.2s ease-in-out infinite alternate" }}
              />
              {flash && <div className="absolute inset-0 rounded-3xl bg-emerald-400/20" />}
            </div>
            {flash ? (
              <div className="absolute bottom-3 inset-x-0 flex justify-center">
                <span className="rounded-full bg-emerald-500 text-white px-3 py-1 text-[10px] font-black flex items-center gap-1.5 shadow-lg">
                  <CheckCircle2 className="w-3.5 h-3.5" /> تم التقاط الكود ✓
                </span>
              </div>
            ) : (
              <div className="absolute bottom-3 inset-x-0 flex justify-center">
                <span className="rounded-full bg-black/55 text-white backdrop-blur px-3 py-1 text-[10px] font-bold flex items-center gap-1.5">
                  <ScanLine className="w-3.5 h-3.5" /> الكاميرا بتفحص… وجّهها على كود الحصة
                </span>
              </div>
            )}
          </div>
        )}

        {/* ============ أزرار التحكم في الكاميرا ============ */}
        {status === "running" && (
          <div className="absolute top-2 start-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
              className="rounded-full bg-black/55 text-white backdrop-blur px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1"
              aria-label="بدّل الكاميرا"
            >
              <SwitchCamera className="w-3.5 h-3.5" /> بدّل الكاميرا
            </button>
            {torchAvail && (
              <button
                type="button"
                onClick={toggleTorch}
                className={cn(
                  "rounded-full backdrop-blur px-2.5 py-1.5 text-[11px] font-bold flex items-center gap-1",
                  torchOn ? "bg-amber-400 text-black" : "bg-black/55 text-white",
                )}
                aria-label="الفلاش"
              >
                {torchOn ? <Flashlight className="w-3.5 h-3.5" /> : <FlashlightOff className="w-3.5 h-3.5" />}
                {torchOn ? "الفلاش مولع" : "الفلاش"}
              </button>
            )}
          </div>
        )}

        {/* زوم — لتقريب كود الشاشة اللي بعيد */}
        {status === "running" && zoom && (
          <div className="absolute bottom-12 inset-x-0 flex justify-center pointer-events-none">
            <div className="pointer-events-auto rounded-full bg-black/55 text-white backdrop-blur px-2 py-1 flex items-center gap-1.5">
              <button type="button" onClick={() => stepZoom(-1)} aria-label="بعّد الزوم" className="p-1 active:scale-90 transition">
                <ZoomOut className="w-4 h-4" />
              </button>
              <input
                type="range"
                dir="ltr"
                min={zoom.caps.min}
                max={zoom.caps.max}
                step={zoom.caps.step}
                value={zoom.val}
                onChange={(e) => applyZoom(Number(e.target.value))}
                className="w-24 accent-emerald-400"
                aria-label="زوم الكاميرا"
              />
              <button type="button" onClick={() => stepZoom(1)} aria-label="قرّب الزوم" className="p-1 active:scale-90 transition">
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className="nk-num text-[10px] font-bold w-9 text-center" dir="ltr">
                {(zoom.val / (zoom.caps.min || 1)).toFixed(1)}×
              </span>
            </div>
          </div>
        )}
      </div>

      {status === "error" && (
        <div className="text-xs font-bold text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-2">
          <p>{errorMsg}</p>
          <div className="flex justify-center gap-2">
            {inIframe && (
              <button
                type="button"
                onClick={() => window.open(window.location.href, "_blank")}
                className="nk-brand-bg text-white rounded-lg px-3 py-1.5 font-extrabold inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> افتح في تبويب جديد
              </button>
            )}
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              className="border border-amber-300 bg-card text-amber-800 rounded-lg px-3 py-1.5 font-extrabold inline-flex items-center gap-1.5"
            >
              <RefreshCcw className="w-3.5 h-3.5" /> جرّب تاني
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
