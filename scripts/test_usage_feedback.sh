#!/bin/bash
# test_usage_feedback.sh — e2e للقياس + التقييم + اكتشاف القدرات (§8/§9)
# BASE=https://... ./scripts/test_usage_feedback.sh   (افتراضي localhost:3000)
set -u
BASE="${BASE:-http://localhost:3000}"
JAR=/tmp/nk_usage_jar
rm -f "$JAR"
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "== 0) login manager =="
code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth" \
  -H "Content-Type: application/json" -d '{"username":"manager","password":"nokhba123"}' --max-time 30)
[ "$code" = "200" ] && ok "auth 200" || { bad "auth $code"; exit 1; }

echo "== 1) GET /api/agent/capabilities — كتالوج مكتشف ديناميكيًا =="
CAPS=$(curl -s -b "$JAR" "$BASE/api/agent/capabilities" --max-time 30)
echo "$CAPS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);const t=j.tools||[];
  const names=t.map(x=>x.name);
  if(!names.includes('student.search')) process.exit(2);
  const s=t.find(x=>x.name==='student.search');
  if(!s.description||!('risk' in s)||!('requiresConfirmation' in s)) process.exit(3);
  const write=t.find(x=>x.name==='student.create');
  if(!write||write.requiresConfirmation!==true) process.exit(4);
  console.log('tools='+t.length);
})" && ok "capabilities: كتالوج حقيقي مفلتر بالمستخدم" || bad "capabilities structure"

echo "== 2) message بسيط (مخ حتمي محليًا) → رسالة assistant =="
EV=$(curl -s -N -b "$JAR" -X POST "$BASE/api/agent/message" -H "Content-Type: application/json" \
  -d '{"text":"إيه أهم حاجة محتاجة متابعة النهارده؟"}' --max-time 60)
echo "$EV" | grep -q '"type":"done"' && ok "message SSE done" || bad "message SSE"
TASK_ID=$(echo "$EV" | grep -o '"taskId":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$TASK_ID" ] && ok "taskId=$TASK_ID" || bad "taskId missing"

echo "== 3) هات آخر رسالة assistant من تاريخ المهمة =="
MSG_ID=$(curl -s -b "$JAR" "$BASE/api/agent/tasks/$TASK_ID" --max-time 30 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const ms=(j.task?.messages||[]).filter(m=>m.role==='assistant'&&m.kind!=='error');console.log(ms.length?ms[ms.length-1].id:'')})")
[ -n "$MSG_ID" ] && ok "assistant msg id=$MSG_ID" || { bad "no assistant message"; exit 1; }

echo "== 4) POST /api/agent/feedback UP =="
code=$(curl -s -b "$JAR" -o /tmp/nk_fb.json -w "%{http_code}" -X POST "$BASE/api/agent/feedback" \
  -H "Content-Type: application/json" -d "{\"messageId\":\"$MSG_ID\",\"feedback\":\"UP\"}" --max-time 30)
[ "$code" = "200" ] && ok "feedback 200" || bad "feedback $code: $(cat /tmp/nk_fb.json | head -c 100)"
grep -q '"feedback":"UP"' /tmp/nk_fb.json && ok "response echo UP" || bad "echo"

echo "== 5) تقييم رسالة مش بتاعتك → 404 =="
code=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/agent/feedback" \
  -H "Content-Type: application/json" -d '{"messageId":"cmforeignmsgnotexist000000","feedback":"DOWN"}' --max-time 30)
[ "$code" = "404" ] && ok "foreign message 404" || bad "expected 404 got $code"

echo "== 6) من غير جلسة → 401 =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/agent/feedback" \
  -H "Content-Type: application/json" -d "{\"messageId\":\"$MSG_ID\",\"feedback\":\"UP\"}" --max-time 30)
[ "$code" = "401" ] && ok "no-auth 401" || bad "expected 401 got $code"

echo "== 7) status: حقول usage + feedback ظاهرة =="
ST=$(curl -s -b "$JAR" "$BASE/api/agent/status" --max-time 30)
echo "$ST" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  if(!('usage' in j)) process.exit(2);
  if(!('feedback' in j)) process.exit(3);
  if(!j.feedback || j.feedback.up < 1) process.exit(4);
  console.log('usage.turns='+(j.usage?j.usage.turns:'null')+' tokens_in='+(j.usage?j.usage.inputTokens:'-')+' fb.up='+j.feedback.up+' fb.down='+j.feedback.down);
})" && ok "status aggregates live" || bad "status fields"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
