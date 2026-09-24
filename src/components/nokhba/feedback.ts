"use client";

import { useEffect, useRef, useState } from "react";

/* ============================================================
   Feedback للعمليات — صوت + اهتزاز + Wake Lock:
   - نغمة مختلفة لكل نتيجة (أخضر / برتقالي / أحمر / نجاح)
   - اهتزاز على الموبايل (أنماط مختلفة لكل حالة)
   - Wake Lock: الشاشة مبتقفلش طول ما المسح شغال
   - إعدادات on/off محفوظة على الجهاز (localStorage)
   الصوت Web Audio (بدون ملفات) — لازم أول تفاعل من المستخدم
   عشان المتصفح يسمح بالصوت (بنفتح الـ context عند أول لمسة).
============================================================ */

const LS_SOUND = "nokhba_feedback_sound";
const LS_VIBRATE = "nokhba_feedback_vibrate";

export function readSoundEnabled(): boolean {
  try { return localStorage.getItem(LS_SOUND) !== "0"; } catch { return true; }
}
export function readVibrateEnabled(): boolean {
  try { return localStorage.getItem(LS_VIBRATE) !== "0"; } catch { return true; }
}
function writeSound(v: boolean) { try { localStorage.setItem(LS_SOUND, v ? "1" : "0"); } catch { /* ignore */ } }
function writeVibrate(v: boolean) { try { localStorage.setItem(LS_VIBRATE, v ? "1" : "0"); } catch { /* ignore */ } }

// ---------- Audio engine (Web Audio — no files needed) ----------

let ctx: AudioContext | null = null;

/** فتح الـ audio context عند أول تفاعل — المتصفحات بتمنع الصوت من غير لمسة */
export function unlockAudio() {
  try {
    if (!ctx && typeof window !== "undefined") {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx?.state === "suspended") void ctx.resume();
  } catch { /* ignore */ }
}

function tone(freq: number, startAt: number, duration: number, type: OscillatorType = "sine", gain = 0.12) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, startAt);
  g.gain.exponentialRampToValueAtTime(gain, startAt + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export type FeedbackKind = "green" | "orange" | "red" | "success" | "tap";

/** شغّل نغمة النتيجة — كل حالة ليها توقيعها الصوتي */
function playBeep(kind: FeedbackKind) {
  if (!readSoundEnabled()) return;
  unlockAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  switch (kind) {
    case "green": // نغمة صاعدة قصيرة مريحة
      tone(880, t, 0.09, "sine", 0.14);
      tone(1318.5, t + 0.09, 0.12, "sine", 0.12);
      break;
    case "orange": // نغمتين تنبيهيتين
      tone(659.3, t, 0.1, "triangle", 0.13);
      tone(659.3, t + 0.14, 0.1, "triangle", 0.13);
      break;
    case "red": // buzz واطي مزعج
      tone(196, t, 0.22, "sawtooth", 0.1);
      tone(185, t + 0.24, 0.22, "sawtooth", 0.1);
      break;
    case "success": // أرپيجيو نجاح قصير
      tone(659.3, t, 0.08, "sine", 0.12);
      tone(880, t + 0.08, 0.08, "sine", 0.12);
      tone(1318.5, t + 0.16, 0.14, "sine", 0.12);
      break;
    case "tap": // نقرة خفيفة جداً للتأكيدات
      tone(987.8, t, 0.05, "sine", 0.06);
      break;
  }
}

// ---------- Vibration ----------

function vibrate(pattern: number | number[]) {
  if (!readVibrateEnabled()) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

/** صوت + اهتزاز معاً حسب حالة النتيجة */
export function feedback(kind: FeedbackKind) {
  playBeep(kind);
  switch (kind) {
    case "green": vibrate(40); break;
    case "orange": vibrate([50, 60, 50]); break;
    case "red": vibrate([120, 60, 120, 60, 200]); break;
    case "success": vibrate([30, 40, 30]); break;
    case "tap": break;
  }
}

/** حالة إعدادات الصوت والاهتزاز + toggle (للأزرار في واجهة المسح) */
export function useFeedbackSettings() {
  const [sound, setSound] = useState(true);
  const [vibrateOn, setVibrateOn] = useState(true);
  useEffect(() => {
    // قراءة الجهاز بعد أول تيك — من غير cascading render ومن غير hydration mismatch
    const t = setTimeout(() => {
      setSound(readSoundEnabled());
      setVibrateOn(readVibrateEnabled());
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return {
    sound, vibrateOn,
    toggleSound: () => { const v = !readSoundEnabled(); writeSound(v); setSound(v); if (v) { unlockAudio(); playBeep("tap"); } },
    toggleVibrate: () => { const v = !readVibrateEnabled(); writeVibrate(v); setVibrateOn(v); if (v) vibrate(60); },
  };
}

// ---------- Wake Lock (الشاشة مبتقفلش أثناء المسح) ----------

/**
 * useWakeLock(active) — يمسك screen wake lock طول ما active=true
 * ويرجعه أول ما الصفحة ترجع ظاهرة (بعد ما الجهاز يقفل ويفتح تاني).
 */
export function useWakeLock(active: boolean) {
  const ref = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    let cancelled = false;

    async function acquire() {
      try {
        if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
        if (document.visibilityState !== "visible") return;
        const wl = await navigator.wakeLock.request("screen");
        if (cancelled) { void wl.release(); return; }
        ref.current = wl;
        wl.addEventListener("release", () => { ref.current = null; });
      } catch { /* NotAllowedError — عادي، بنكمل من غير wake lock */ }
    }

    function release() {
      try { void ref.current?.release(); } catch { /* ignore */ }
      ref.current = null;
    }

    const onVis = () => {
      if (document.visibilityState === "visible" && active) void acquire();
    };

    if (active) void acquire();
    else release();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      release();
    };
  }, [active]);
}
