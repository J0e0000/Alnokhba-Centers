#!/usr/bin/env bash
# ============================================================
# prod_verify_context_voice.sh — تحقق إنتاجي صادق على nine
# (1) db-status postgres (2) نسخة الجيت نزلت (3) capabilities
# (4) إحالة ضمير على داتا حقيقية بالمسار القرائي فقط:
#     «هاتلي X» ← مهمة جديدة «تقريره» ← نفس الطالب (بدون أي كتابة على الإنتاج)
# (5) صوت E2E بصوت حقيقي: speak (TTS حقيقي من سلسلة المزودين) → transcribe → نص
# Usage: bash scripts/prod_verify_context_voice.sh
# ============================================================
set -uo pipefail
BASE="https://alnokhba-centers-nine.vercel.app"
JAR="/tmp/nine_probe_jar"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "❌ $1"; }

echo "===== 1) db-status ====="
DB=$(curl -s "$BASE/api/system/db-status" --max-time 15)
echo "$DB"
echo "$DB" | grep -q '"mode":"postgres"' && ok "db-status postgres" || bad "db-status ($DB)"

echo "===== 2) login + نسخة الجيت ====="
CODE=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth" \
  -H "Content-Type: application/json" -d '{"username":"manager","password":"nokhba123"}' --max-time 20)
[ "$CODE" = "200" ] && ok "login manager" || bad "login ($CODE)"
ST=$(curl -s -b "$JAR" "$BASE/api/agent/status" --max-time 20)
COMMIT=$(echo "$ST" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).commit??'?')}catch{console.log('?')}})")
echo "   deployed commit: $COMMIT · brain: $(echo "$ST" | head -c 120)"
[ "$COMMIT" = "25d707e" ] && ok "النسخة الجديدة نزلت (commit marker)" || bad "commit marker ($COMMIT)"

echo "===== 3) capabilities ====="
CAPS=$(curl -s -b "$JAR" "$BASE/api/agent/capabilities" --max-time 20)
NCAP=$(echo "$CAPS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log((JSON.parse(d).tools??[]).length)}catch{console.log(0)}})")
[ "${NCAP:-0}" -ge 18 ] && ok "capabilities ($NCAP أداة)" || bad "capabilities ($NCAP)"

echo "===== 4) إحالة ضمير — قراءة فقط على داتا الإنتاج ====="
# طالب حقيقي باسم فريد من قاعدة الإنتاج (قراءة بس)
REF=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && NK_E2E_PG="$(grep -h DATABASE_URL_POOLED scripts/.env.prod-url 2>/dev/null | cut -d'"' -f2)" node -e "
const {PrismaClient}=require('./generated/prisma-pg');const p=new PrismaClient({datasources:{db:{url:process.env.NK_E2E_PG}}});
(async()=>{
  const ss=await p.student.findMany({where:{status:'ACTIVE'},select:{id:true,name:true,code:true},take:200});
  const seen=new Map();for(const s of ss)seen.set(s.name,(seen.get(s.name)??0)+1);
  const one=ss.filter(s=>seen.get(s.name)===1)[0]??null;
  console.log(JSON.stringify(one));await p.\$disconnect();})()" 2>/dev/null)
RID=$(echo "$REF" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).id)}catch{console.log('')}})")
RNAME=$(echo "$REF" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).name)}catch{console.log('')}})")
RCODE=$(echo "$REF" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).code)}catch{console.log('')}})")
if [ -z "$RID" ]; then bad "مفيش طالب باسم فريد في الإنتاج — جرب يدويًا"; else
  echo "   طالب الإحالة: $RNAME (كود $RCODE)"
  curl -s -N -b "$JAR" -X POST "$BASE/api/agent/message" -H "Content-Type: application/json" \
    -d "{\"text\":\"هاتلي $RNAME\",\"context\":{\"view\":\"students\"}}" --max-time 60 | grep -q '"tool":"student.search"' \
    && ok "بحث الإحالة نفّذ على الإنتاج" || bad "بحث الإحالة"
  sleep 3
  EV=$(curl -s -N -b "$JAR" -X POST "$BASE/api/agent/message" -H "Content-Type: application/json" \
    -d '{"text":"تقريره","context":{"view":"students"}}' --max-time 90)
  echo "$EV" | grep -q '"tool":"reports.get_student_report"' && ok "«تقريره» → تقرير طالب (إحالة بين مهام)" || bad "«تقريره» ما وصلش لتقرير"
  HIT=$(echo "$EV" | grep -c "$RID" || true)
  [ "$HIT" -ge 1 ] && ok "التقرير على نفس الطالب ($RNAME)" || bad "التقرير على طالب تاني (hits=$HIT)"
fi

echo "===== 5) صوت E2E — صوت حقيقي من TTS → transcribe ====="
curl -s -b "$JAR" -X POST "$BASE/api/agent/speak" -H "Content-Type: application/json" \
  -d '{"text":"مين غايب النهارده؟"}' -o /tmp/nine_speak.wav -w "speak: http=%{http_code} bytes=%{size_download}\n" --max-time 90
[ -s /tmp/nine_speak.wav ] && ok "TTS رجّع ملف صوت حقيقي" || bad "TTS مفيش ملف"
B64=$(base64 -w0 /tmp/nine_speak.wav 2>/dev/null)
if [ -n "$B64" ]; then
  cat > /tmp/nine_asr.json <<EOF
{"audio":"$B64","mime":"audio/wav"}
EOF
  TR=$(curl -s -b "$JAR" -X POST "$BASE/api/agent/transcribe" -H "Content-Type: application/json" -d @/tmp/nine_asr.json --max-time 90)
  echo "$TR" | head -c 300; echo
  TXT=$(echo "$TR" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).text??'')}catch{console.log('')}})")
  PRV=$(echo "$TR" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).provider??'')}catch{console.log('')}})")
  [ -n "$TXT" ] && ok "صوت → نص اشتغل (provider=$PRV, نص: «$TXT»)" || bad "transcribe مفيش نص"
else
  bad "مفيش صوت للتحويل"
fi

echo "========================================"
echo "PASS: $PASS | FAIL: $FAIL"
[ "$FAIL" = "0" ] && echo "🎉 PRODUCTION VERIFIED"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
