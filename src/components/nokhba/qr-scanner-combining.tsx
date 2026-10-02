"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCcw, SwitchCamera, ExternalLink, ScanLine } from "lucide-react";

/**
 * QR scanner — بيقرا كود حضور الحصة (موديل Slot QR).
 *
 * الكود المعروض على الشاشة ثابت وسليم 10 ثواني (بيتغير كل 10ث والقديم بيموت)،
 * فأي كاميرا بتقراه في ثانية من المسار المباشر. وبرضه بنفس محرك الدمج
 * القديم بيغطي أي حالات صعبة (مسافة/اضاءة ضعيفة/اهتزاز) بدمج كذا كادر.
 * Robustness (same lessons as QrCameraScanner):
 * - onScan kept in a ref → the camera NEVER restarts on parent re-renders
 * - start/stop serialized through a promise chain
 * - back camera first, switchable, iframe-friendly errors
 */

type Frame = { data: Uint8ClampedArray; width: number; height: number };

const FRAME_FPS_MS = 66;      // ~15fps grab
const BUFFER_SIZE = 8;        // ~530ms of frames — عمق دمج أعلى = قراءة أثبت
const COMPOSITE_EVERY = 3;    // دمج كل 3 كادات (~5Hz) — تكلفة CPU معقولة
const MAX_DIM = 640;          // تصغير الكادر لسرعة التحويل (640 = تعيينة أحسن للأكواد البعيدة)

export function CombiningQrScanner({ onScan, active }: { onScan: (text: string) => void; active: boolean }) {
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [nonce, setNonce] = useState(0);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const videoRef = useRef<HTMLVideoElement>(null);
  const grabCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<Frame[]>([]);
  const tickRef = useRef(0);
  const rafRef = useRef(0);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    setStatus("starting");
    setErrorMsg("");
    bufferRef.current = [];

    const chain = (async () => {
      try {
        const jsQR = (await import("jsqr")).default;
        if (cancelled) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.muted = true;
        await video.play().catch(() => {});

        // الكانفس المخفي لسحب الكادات
        const grab = document.createElement("canvas");
        grabCanvasRef.current = grab;
        const grabCtx = grab.getContext("2d", { willReadFrequently: true });

        let lastGrab = 0;
        let videoReady = false;
        video.onloadedmetadata = () => { videoReady = true; };

        const decodeText = (text: string) => {
          const t = (text || "").trim();
          if (!t) return false;
          const now = Date.now();
          if (t === lastRef.current.text && now - lastRef.current.at < 2500) return true; // dedup لكن اعتبره نجاح
          lastRef.current = { text: t, at: now };
          onScanRef.current(t);
          return true;
        };

        const loop = (t: number) => {
          rafRef.current = requestAnimationFrame(loop);
          if (!videoReady || video.readyState < 2 || !grabCtx) return;
          if (t - lastGrab < FRAME_FPS_MS) return;
          lastGrab = t;

          const vw = video.videoWidth, vh = video.videoHeight;
          if (!vw || !vh) return;
          const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
          const w = Math.max(2, Math.round(vw * scale) & ~1);
          const h = Math.max(2, Math.round(vh * scale) & ~1);
          if (grab.width !== w || grab.height !== h) { grab.width = w; grab.height = h; bufferRef.current = []; }

          grabCtx.drawImage(video, 0, 0, w, h);
          const img = grabCtx.getImageData(0, 0, w, h);
          tickRef.current++;

          // 1) محاولة قراءة الكادر المفرد (بيغطي الأكواد الثابتة + الأكواد اللي طلعت كاملة بالصدفة)
          const direct = jsQR(img.data, w, h);
          if (direct?.data && decodeText(direct.data)) return;

          // 2) الدمج: آخر N كادات — لكل بكسل بنختار الأغمق (بيرجّع اللي اتشال من طور الطرف التاني)
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
      bufferRef.current = [];
      void chain.catch(() => {});
    };
  }, [active, nonce, facing]);

  if (!active) return null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <video ref={videoRef} playsInline muted className="w-full rounded-2xl bg-black/90 border-2 border-dashed border-border min-h-[220px] object-cover" />
        {status === "starting" && (
          <div className="absolute inset-0 grid place-items-center text-white/80 text-xs font-bold">جاري تشغيل الكاميرا…</div>
        )}
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
          </div>
        )}
        {status === "running" && (
          <div className="absolute bottom-2 inset-x-0 flex justify-center">
            <span className="rounded-full bg-black/55 text-white backdrop-blur px-3 py-1 text-[10px] font-bold flex items-center gap-1.5">
              <ScanLine className="w-3.5 h-3.5" /> الكود بيتغير كل 10 ثواني — وجّه الكاميرا على الشاشة وهيتقري في ثانية
            </span>
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
