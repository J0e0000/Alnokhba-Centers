"""اختبار جودة التعرف: تحويل TTS WAV (24k) → 16k (زي تسجيل المتصفح) وتجربته على الـ route"""
import wave, sys, struct

src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/zk_speak.wav"
w = wave.open(src, "rb")
rate, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
frames = w.readframes(n)
w.close()
print(f"src: {rate}Hz {ch}ch {sw*8}bit {n/rate:.1f}s")

# 24k → 16k بمتوسط جيران (نفس منطق downsample بتاع المتصفح)
if rate != 16000:
    import array
    samples = array.array("h", frames)
    ratio = rate / 16000
    out = array.array("h")
    for i in range(int(len(samples) / ratio)):
        start = int(i * ratio)
        end = min(int((i + 1) * ratio), len(samples))
        chunk = samples[start:end]
        out.append(int(sum(chunk) / len(chunk)) if chunk else 0)
    ww = wave.open("/tmp/zk_16k.wav", "wb")
    ww.setnchannels(1); ww.setsampwidth(2); ww.setframerate(16000)
    ww.writeframes(out.tobytes())
    ww.close()
    print("wrote /tmp/zk_16k.wav")
else:
    import shutil; shutil.copy(src, "/tmp/zk_16k.wav")
