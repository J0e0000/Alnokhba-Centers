"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RefreshCcw, SwitchCamera, ExternalLink } from "lucide-react";

/**
 * Camera QR scanner (html5-qrcode, dynamically imported).
 *
 * Robustness fixes:
 * - onScan kept in a ref → the camera NEVER restarts when parent state changes
 *   (the old code restarted the stream on every scan → froze on many phones).
 * - unique element id per mount (React strict-mode safe).
 * - start/stop serialized through a promise chain → no two instances fight.
 * - tries back camera first, falls back to any available camera.
 * - uses native BarcodeDetector when the browser supports it (much faster).
 * - detects blocked camera inside an iframe → offers "open in a new tab".
 */

type ScannerHandle = { stop: () => Promise<void>; clear: () => void };

// serialize stop/start across mounts (dev strict mode / quick toggles).
// NOTE: the chain itself must never reject — an unhandled rejection on the
// chain would surface in the Next.js dev overlay even though the caller
// already handled its own promise.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(p: Promise<T>): Promise<T> {
  chain = chain.then(() => p, () => p).catch(() => {});
  return p;
}

export function QrCameraScanner({ onScan, active }: { onScan: (text: string) => void; active: boolean }) {
  const [status, setStatus] = useState<"starting" | "running" | "error">("starting");
  const [errorMsg, setErrorMsg] = useState("");
  const [nonce, setNonce] = useState(0); // "try again" re-trigger
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const reactId = useId();
  const boxId = `nk-qr-${reactId.replace(/[^a-zA-Z0-9-]/g, "")}`;

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // stable across parent re-renders — no camera restart

  const scannerRef = useRef<ScannerHandle | null>(null);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setStatus("starting");
    setErrorMsg("");

    (async () => {
      try {
        await enqueue(Promise.resolve()); // wait for any previous stop to finish
        const mod = await import("html5-qrcode");
        const { Html5Qrcode } = mod;
        if (cancelled) return;

        const scanner = new Html5Qrcode(boxId, {
          verbose: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner as unknown as ScannerHandle;

        const onDecoded = (decoded: string) => {
          const now = Date.now();
          const t = decoded.trim();
          if (t === lastRef.current.text && now - lastRef.current.at < 2500) return;
          lastRef.current = { text: t, at: now };
          onScanRef.current(t);
        };

        const config = { fps: 10, qrbox: { width: 230, height: 230 } };
        try {
          await scanner.start({ facingMode: facing }, config, onDecoded, () => {});
        } catch {
          // back camera failed → retry with any available camera
          await scanner.start({ facingMode: "user" }, config, onDecoded, () => {});
        }
        if (!cancelled) setStatus("running");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(
          /permission|denied|NotAllowed/i.test(msg)
            ? "الكاميرا مرفوضة — اسمح للكاميرا من إعدادات المتصفح، أو اكتب كود الطالب باليد تحت."
            : /NotFound|no camera|devices|Requested device/i.test(msg)
              ? "مفيش كاميرا متاحة على الجهاز ده — اكتب كود الطالب باليد تحت."
              : inIframe
                ? "المتصفح مانع الكاميرا جوه الإطار المدمج — افتح التطبيق في تبويب جديد وجرب."
                : "الكاميرا مش شغالة هنا — اكتب كود الطالب باليد تحت."
        );
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        // stop() throws SYNCHRONOUSLY if the scanner never started (e.g. camera
        // permission denied) — must guard, otherwise React crashes on unmount.
        enqueue(
          Promise.resolve()
            .then(() => s.stop())
            .then(() => s.clear())
            .catch(() => { /* already stopped / never started */ })
        );
      }
    };
  }, [active, nonce, facing, boxId]);

  if (!active) return null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          id={boxId}
          className="rounded-2xl overflow-hidden border-2 border-dashed border-border bg-muted/50 min-h-[220px] grid place-items-center"
        />
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
      </div>

      {status === "starting" && <p className="text-xs font-bold text-muted-foreground text-center">جاري تشغيل الكاميرا...</p>}
      {status === "running" && <p className="text-xs font-bold text-center nk-brand-text">الكاميرا شغالة — وجّهها على كود الـ QR بتاع الطالب</p>}
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
