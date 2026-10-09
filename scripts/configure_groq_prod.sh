#!/bin/bash
# Configure + verify Zaki's brain (Groq) on PRODUCTION — via the app's own Settings API
# The llm-test runs from Vercel egress (US) — the definitive test since this sandbox is HK-blocked by Groq.
set -u
BASE="https://alnokhba-centers.vercel.app"
KEY="${1:-}"
JAR=/tmp/zk_groq_jar.txt
rm -f "$JAR"

PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo "== 1) login manager =="
code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth" \
  -H "Content-Type: application/json" -d '{"username":"manager","password":"nokhba123"}')
[ "$code" = "200" ] && ok "auth 200" || { bad "auth $code"; exit 1; }

echo "== 2) settings BEFORE =="
curl -s -b "$JAR" "$BASE/api/settings" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('  before agentLlm:',JSON.stringify(j.center?.agentLlm||j.agentLlm||'n/a'))})"

echo "== 3) save Groq config =="
if [ -z "$KEY" ]; then echo "  (no key arg — skip save, test stored config only)"; else
code=$(curl -s -b "$JAR" -o /tmp/zk_settings_out.json -w "%{http_code}" -X PATCH "$BASE/api/settings" \
  -H "Content-Type: application/json" \
  -d "{\"agentLlmBaseUrl\":\"https://api.groq.com/openai/v1\",\"agentLlmModel\":\"openai/gpt-oss-120b\",\"agentLlmApiKey\":\"$KEY\"}")
[ "$code" = "200" ] && ok "settings saved 200" || { bad "settings $code"; cat /tmp/zk_settings_out.json; }
fi

echo "== 4) settings AFTER (masked) =="
curl -s -b "$JAR" "$BASE/api/settings" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const a=j.center?.agentLlm||j.agentLlm||{};console.log('  after agentLlm:',JSON.stringify(a));const t=a.keyTail||'';if(a.hasKey&&t)console.log('  keyTail='+t)})"

echo "== 5) llm-test from VERCEL egress (definitive key test) =="
curl -s -b "$JAR" -X POST "$BASE/api/agent/llm-test" -H "Content-Type: application/json" -d '{}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const r=j.result||j;if(r.ok)console.log('  ✓ GROQ LIVE — model='+r.model+' latency='+r.latencyMs+'ms sample='+JSON.stringify(r.sample));else{console.log('  ✗ test failed: '+r.error);if(r.raw)console.log('    raw: '+r.raw);process.exit(3)}})"

echo "== 6) agent status =="
curl -s -b "$JAR" "$BASE/api/agent/status" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const r=j.result||j;console.log('  status:',JSON.stringify({source:r.source,model:r.model,brainFirst:r.brainFirst,split:r.split||r.byProvider||undefined}))})"

echo
echo "PASS=$PASS FAIL=$FAIL"
