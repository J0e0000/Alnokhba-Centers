import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function main() {
  const zai = await ZAI.create();

  // 1. TTS with Arabic text
  try {
    const response = await zai.audio.tts.create({
      input: 'مرحبا، أنا زكي، مساعدك الإداري الذكي. كيف يمكنني مساعدتك اليوم؟',
      voice: 'tongtong',
      speed: 1.0,
      response_format: 'wav',
      stream: false,
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    fs.writeFileSync('/home/z/my-project/scripts/arabic_tts_test.wav', buffer);
    console.log('TTS OK, mp3 bytes:', buffer.length);
  } catch (e: any) {
    console.log('TTS FAILED:', e?.message || e);
  }

  // 2. ASR roundtrip on generated file
  try {
    const audioFile = fs.readFileSync('/home/z/my-project/scripts/arabic_tts_test.wav');
    const base64Audio = audioFile.toString('base64');
    const asr = await zai.audio.asr.create({ file_base64: base64Audio });
    console.log('ASR OK, text:', asr.text);
  } catch (e: any) {
    console.log('ASR FAILED:', e?.message || e);
  }

  // 3. LLM quick Arabic + tool-intent test
  try {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'أنت مساعد إداري لسنتر دراسي. رد بالعربية المصرية البسيطة.' },
        { role: 'user', content: 'مين الطلاب الغايبين النهارده؟' },
      ],
      thinking: { type: 'disabled' },
    });
    const text = completion.choices?.[0]?.message?.content;
    console.log('LLM OK:', (text || '').slice(0, 200));
  } catch (e: any) {
    console.log('LLM FAILED:', e?.message || e);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
