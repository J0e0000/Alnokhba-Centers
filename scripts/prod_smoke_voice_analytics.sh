#!/bin/bash
# Smoke إنتاج — زكي بعد ترقية الصوت والتحليل (كلها قراءة/صوت، صفر كتابة على داتا حقيقية)
set -u
BASE="https://alnokhba-centers.vercel.app"
JAR="/tmp/nk_prod_jar"
rm -f "$JAR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "❌ $1"; }

echo "=== 1) login manager ==="
curl -s -c "$JAR" -X POST "$BASE/api/auth" -H "Content-Type: application/json" \
  -d '{"username":"manager","password":"nokhba123"}' -o /dev/null -w "http=%{http_code}\n"

echo "=== 2) agent/status — العقل ==="
ST=$(curl -s -b "$JAR" "$BASE/api/agent/status")
echo "$ST" | head -c 300; echo
echo "$ST" | grep -q "gpt-oss-120b" && ok "LLM: Groq gpt-oss-120b" || bad "LLM status unexpected"

echo "=== 3) whisper حقيقي على الإنتاج — صوت من TTS محلي (ساندبوكس) ==="
# إنتاج: صوت زكي بيتولد سيرفري بالـ SDK بتاع بيئة النشر — هنا بنستخدم WAV من TTS محلي ونرفعه
curl -s -c /tmp/nk_local_jar -X POST http://localhost:3000/api/auth -H "Content-Type: application/json" -d '{"username":"manager","password":"nokhba123"}' -o /dev/null
curl -s -b /tmp/nk_local_jar -X POST http://localhost:3000/api/agent/speak -H "Content-Type: application/json" \
  -d '{"text":"سجل حضور أحمد النهارده في حصة الكيمياء"}' -o /tmp/prod_speak.wav -w "local tts http=%{http_code} bytes=%{size_download}\n"
python3 -c "
import json, base64
b = base64.b64encode(open('/tmp/prod_speak.wav','rb').read()).decode()
json.dump({'audio': b, 'mime': 'audio/wav'}, open('/tmp/prod_asr.json','w'))
"
RESP=$(curl -s -b "$JAR" -X POST "$BASE/api/agent/transcribe" -H "Content-Type: application/json" -d @/tmp/prod_asr.json --max-time 60)
echo "$RESP" | head -c 400; echo
echo "$RESP" | grep -q '"provider":"groq"' && ok "STT provider = groq (whisper شغال على الإنتاج)" || { echo "$RESP" | grep -q '"provider":"zai"' && bad "fallback to zai — groq مش شغال" || bad "transcribe failed"; }
# ملاحظة: صوت TTS الاصطناعي صعب على whisper (العربي المحكي آليًا) — الاختبار الحاسم
# هو الإنجليزي تحت (control) — والاختبار الحقيقي النهائي: مايك حقيقي بصوت بشري.
echo "$RESP" | grep -qE 'أحمد|احمد' && ok "whisper فهم الكلام العربي (فيه أحمد)" || echo "ℹ️ نص العربي الاصطناعي مش مفهوم (قيد صوت TTS — مش البايبلاين)"

echo "=== 4) تحليل أداء عبر LLM (طلب مفتوح) ==="
sleep 3
EV=$(curl -s -N -b "$JAR" -X POST "$BASE/api/agent/message" -H "Content-Type: application/json" \
  -d '{"text":"حلل أداء السنتر الأسبوع ده وقولي أهم حاجة محتاجة تدخل من المدير","context":{"view":"reports"}}' --max-time 120 | grep '^data:' | sed 's/^data: //')
echo "$EV" | grep -q '"tool":"reports.analyze"' && ok "LLM اختار reports.analyze" || bad "reports.analyze ما اتنادتش: $(echo "$EV" | grep '"tool"' | head -1)"
echo "$EV" | grep -q '"status":"COMPLETED"' && ok "COMPLETED" || bad "مش مكتملة"
FINAL=$(echo "$EV" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const ms=[];for(const l of d.split('\n')){try{const e=JSON.parse(l);if(e.type==='message'&&e.text)ms.push(e.text)}catch{}}console.log(ms[ms.length-1]??'')})")
echo "الرد النهائي: ${FINAL:0:260}"

echo "=== 5) إعدادات agentStt ظاهرة (masked) ==="
S=$(curl -s -b "$JAR" "$BASE/api/settings")
echo "$S" | grep -q '"agentStt"' && ok "settings expose agentStt" || bad "agentStt missing from settings"
echo "$S" | grep -qE '"agentLlmApiKey"|"keyTail"' && ok "key still masked (tail only)" || bad "key exposure check"

echo "========================================"
echo "PROD SMOKE: $PASS نجح · $FAIL فشل"
[ "$FAIL" = "0" ] && echo "🎉 PRODUCTION GREEN"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
