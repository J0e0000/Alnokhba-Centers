import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function tryASR(path: string, label: string) {
  try {
    const zai = await ZAI.create();
    const audioFile = fs.readFileSync(path);
    const base64Audio = audioFile.toString('base64');
    const asr = await zai.audio.asr.create({ file_base64: base64Audio });
    console.log(`ASR[${label}] OK: "${String(asr.text ?? '').slice(0, 80)}"`);
  } catch (e: any) {
    console.log(`ASR[${label}] FAILED: ${e?.message || e}`);
  }
}

async function main() {
  await tryASR('/home/z/my-project/scripts/arabic_tts_test.webm', 'webm/opus');
  await tryASR('/home/z/my-project/scripts/arabic_tts_test.m4a', 'mp4/aac');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
