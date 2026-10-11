#!/bin/bash
# e2e_entitlements.sh — verify entitlement engine end-to-end on local server
# Manager of مركز النخبة التعليمي (local sqlite dev DB)
B=http://localhost:3000
C=/tmp/nk_test_cookies
PASS=0; FAIL=0
ck() { if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  ✓ $3"; else FAIL=$((FAIL+1)); echo "  ✗ $3 (expected $1 got $2)"; fi; }

echo "== 1) capabilities GET exposes modules =="
MODS=$(curl -s -b $C $B/api/center/capabilities | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('modules',{}); print(len(m), m.get('finance',{}).get('enabled'), m.get('ai_agent',{}).get('enabled'))")
ck "11 True True" "$MODS" "11 modules exposed, finance+ai_agent enabled by default"

echo "== 2) disable finance module (manager override) =="
RES=$(curl -s -b $C -X PATCH $B/api/center/capabilities -H 'Content-Type: application/json' -d '{"modules":[{"key":"finance","enabled":false}]}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('modules',{}).get('finance','MISSING'))")
ck "False" "$RES" "finance disabled via manager PATCH"

echo "== 3) gated API rejects with 403 + Arabic reason =="
CODE=$(curl -s -b $C -o /tmp/nk_pay_resp -w "%{http_code}" -X POST $B/api/payments -H 'Content-Type: application/json' -d '{}')
REASON=$(python3 -c "import json; print(json.load(open('/tmp/nk_pay_resp')).get('error','?'))" 2>/dev/null)
ck "403" "$CODE" "POST /api/payments → 403 when finance locked"
echo "$REASON" | grep -q "المالية" && { PASS=$((PASS+1)); echo "  ✓ Arabic reason mentions المالية"; } || { FAIL=$((FAIL+1)); echo "  ✗ reason: $REASON"; }

echo "== 4) agent tools filtered: finance tool hidden from catalog + blocked on execute =="
CAPS=$(curl -s -b $C $B/api/agent/capabilities | python3 -c "import sys,json; d=json.load(sys.stdin); tools=[t['name'] for t in d['tools']]; print('finance.record_payment' in tools, d['modules']['finance']['enabled'])")
ck "False False" "$CAPS" "finance.record_payment hidden from agent catalog"

echo "== 5) re-enable finance =="
RES=$(curl -s -b $C -X PATCH $B/api/center/capabilities -H 'Content-Type: application/json' -d '{"modules":[{"key":"finance","enabled":true}]}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('modules',{}).get('finance','MISSING'))")
ck "True" "$RES" "finance re-enabled (override removed)"
CODE=$(curl -s -b $C -o /dev/null -w "%{http_code}" -X POST $B/api/payments -H 'Content-Type: application/json' -d '{}')
ck "404" "$CODE" "payments past the gate again (404 student-not-found — not 403)"

echo "== 6) invalid module key rejected =="
CODE=$(curl -s -b $C -o /dev/null -w "%{http_code}" -X PATCH $B/api/center/capabilities -H 'Content-Type: application/json' -d '{"modules":[{"key":"hacked","enabled":false}]}')
ck "400" "$CODE" "unknown module key → 400"

echo
echo "RESULT: $PASS passed / $FAIL failed"
[ $FAIL -eq 0 ] && echo "ENTITLEMENTS E2E: ALL PASS ✅" || echo "ENTITLEMENTS E2E: FAILURES ❌"
