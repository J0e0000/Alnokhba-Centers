"use client";

/* ============================================================
   RECORD WAV — تسجيل مايك عالمي على كل المتصفحات
   المشكلة القديمة: كنا معتمدين على SpeechRecognition بتاع
   المتصفح — بيفشل في متصفحات كتير (وخصوصًا العربي) حتى مع
   الإذن متاح. الحل: نسجل الصوت خام (PCM) ونحوله WAV وننقل
   التعرف للسيرفر (/api/agent/transcribe) — شغال على Chrome
   وFirefox وSafari والموبايل من غير استثناءات.
============================================================ */

export type RecordingSession = {
  stop: () => Promise<{ base64: string; seconds: number }>;
  cancel: () => void;
};

const TARGET_RATE = 16000; // الصوت المثالي للتعرف على الكلام
const MAX_SECONDS = 45;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/** تخفيض التردد بسيط ومستقر (متوسط الجيران) — كفاية للكلام */
function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) { sum += input[j]; count++; }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(blob);
  });
}

/** تسجيل المايك → WAV base64. يرمي رسائل خطأ عربية واضحة. */
export async function startMicRecording(opts?: { onLevel?: (level: number) => void }): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("المتصفح ده مش بيدعم تسجيل الصوت — جرب Chrome أو Safari الحديث.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const name = (e as DOMException)?.name ?? "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error("المايك مقفول — اسمح للموقع بالمايك من أيقونة القفل جنب العنوان وجرب تاني.");
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new Error("مفيش مايك متوصل بالجهاز — اتأكد من التوصيل وجرب.");
    }
    throw new Error("مقدرتش افتح المايك — اقفل أي تاب تاني بيستخدمه وجرب تاني.");
  }

  const AudioCtx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("المتصفح ده مش بيدعم تسجيل الصوت — جرب Chrome أو Safari الحديث.");
  }

  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor قديم بس شغال على كل المتصفحات — AudioWorklet بيتطلب https+module وبيختلف سلوكه
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let total = 0;
  let cancelled = false;

  const cleanup = () => {
    try { processor.disconnect(); } catch { /* صامت */ }
    try { source.disconnect(); } catch { /* صامت */ }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => { /* صامت */ });
  };

  processor.onaudioprocess = (ev) => {
    if (cancelled) return;
    const input = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    total += input.length;
    if (opts?.onLevel) {
      let peak = 0;
      for (let i = 0; i < input.length; i += 16) {
        const v = Math.abs(input[i]);
        if (v > peak) peak = v;
      }
      opts.onLevel(peak);
    }
    if (total / ctx.sampleRate >= MAX_SECONDS) {
      // حد أقصى — الباقي يتسجل من غير زيادة
      cancelled = true;
    }
  };
  source.connect(processor);
  // مخرج وهمي (مش بنسمع التسجيل — بنجمعه بس)
  const silent = ctx.createGain();
  silent.gain.value = 0;
  processor.connect(silent);
  silent.connect(ctx.destination);

  return {
    stop: () =>
      new Promise<{ base64: string; seconds: number }>((resolve, reject) => {
        cancelled = true;
        setTimeout(() => {
          cleanup();
          try {
            const merged = new Float32Array(total);
            let offset = 0;
            for (const c of chunks) { merged.set(c, offset); offset += c.length; }
            const seconds = total / ctx.sampleRate;
            if (seconds < 0.4) {
              reject(new Error("الضغطة كانت سريعة — دوس على المايك واتكلم وسيبه لحد ما تخلص جملتك."));
              return;
            }
            const down = downsample(merged, ctx.sampleRate, TARGET_RATE);
            // تجاهل الصمت المطلق من الأول والآخر
            const blob = encodeWav(down, TARGET_RATE);
            blobToBase64(blob).then((base64) => resolve({ base64, seconds })).catch(() => reject(new Error("مقدرتش جهز التسجيل — جرب تاني.")));
          } catch {
            reject(new Error("مقدرتش جهز التسجيل — جرب تاني."));
          }
        }, 120); // نستنى آخر بافر صوت يجي
      }),
    cancel: () => {
      cancelled = true;
      cleanup();
    },
  };
}
