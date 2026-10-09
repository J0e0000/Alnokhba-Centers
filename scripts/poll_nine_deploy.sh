#!/bin/bash
# مراقبة نشر nine: نستنى علامة commit تتغير + نشوف مصدر العقل
BASE="https://alnokhba-centers-nine.vercel.app"
JAR=/tmp/nine_poll.txt
for i in $(seq 1 28); do
  rm -f "$JAR"
  code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth" -H "Content-Type: application/json" -d '{"username":"manager","password":"nokhba123"}' --max-time 20)
  st=$(curl -s -b "$JAR" "$BASE/api/agent/status" --max-time 20 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const r=j.result||j;console.log(JSON.stringify({source:r.source,model:r.model,commit:r.commit??'NO-FIELD'}))}catch(e){console.log('parse-error')}})")
  echo "[$i] auth=$code status=$st"
  if echo "$st" | grep -q "4c00ec5"; then echo "DEPLOY-LANDED"; break; fi
  sleep 30
done
