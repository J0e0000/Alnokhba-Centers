#!/bin/bash
# E2E: صلاحيات المستخدم (can/can't) — مدير يقفل/يفتح صلاحيات موظف + الأقسام، والسيرفر بيفعّل
BASE="http://localhost:3000"
MGR="/tmp/qae-mgr.cookies"
REC="/tmp/qae-rec.cookies"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "✅ $1"; }
bad() { FAIL=$((FAIL+1)); echo "❌ $1 → $2"; }

# 1) دخول الاستقبال
R=$(curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" -d '{"action":"login","username":"qae-rec-99","password":"Qae#2026"}' -c $REC -w "%{http_code}")
[ "$R" = "200" ] && ok "rec login" || bad "rec login" "$R"

# 2) جد كل الطلاب النشطين + صف حقيقي للتجربة
SID=$(curl -s "$BASE/api/students?page=1&pageSize=1&status=ACTIVE" -b $MGR | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['students'][0]['id'])")
echo "   test student: $SID"

# 3) الاستقبال يسجل دفعة دلوقتي (المفروض مسموح افتراضيًا)
GID=$(curl -s "$BASE/api/academics" -b $MGR | python3 -c "import json,sys; d=json.load(sys.stdin); g=d.get('groups') or d.get('data',{}).get('groups') or []; print(g[0]['id'] if g else '')")
BODY="{\"action\":\"record\",\"studentId\":\"$SID\",\"amount\":2500,\"note\":\"فحص صلاحيات - قبل القفل\"}"
CODE=$(curl -s -X POST $BASE/api/payments -H "Content-Type: application/json" -b $REC -d "$BODY" -o /tmp/pay1.json -w "%{http_code}")
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] && ok "rec records payment (before revoke)" || bad "rec records payment (before revoke)" "$CODE $(head -c 150 /tmp/pay1.json)"
PAYID=$(python3 -c "import json; d=json.load(open('/tmp/pay1.json')); print((d.get('payment') or d.get('data',{}).get('payment') or {}).get('id',''))" 2>/dev/null)
echo "   payment id: $PAYID"

# 4) المدير يقفل RECORD_PAYMENT على الاستقبال
CODE=$(curl -s -X PATCH $BASE/api/staff -H "Content-Type: application/json" -b $MGR -d "{\"action\":\"update\",\"id\":\"$(curl -s $BASE/api/staff -b $MGR | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('staff') or d.get('data',{}).get('staff') or d.get('staffMembers') or []; print([x for x in s if x['username']=='qae-rec-99'][0]['id'])")\",\"permissions\":{\"RECORD_PAYMENT\":false}}" -o /tmp/perm1.json -w "%{http_code}")
PERM=$(python3 -c "import json; d=json.load(open('/tmp/perm1.json')); print('RECORD_PAYMENT' in (d.get('permissions') or []))" 2>/dev/null)
[ "$CODE" = "200" ] && [ "$PERM" = "False" ] && ok "manager revokes RECORD_PAYMENT (resolved list drops it)" || bad "manager revokes RECORD_PAYMENT" "$CODE permStill=$PERM $(head -c 150 /tmp/perm1.json)"

# 5) الاستقبال يحاول يسجل دفعة تاني → لازم 403
CODE=$(curl -s -X POST $BASE/api/payments -H "Content-Type: application/json" -b $REC -d "{\"action\":\"record\",\"studentId\":\"$SID\",\"amount\":2500,\"note\":\"فحص - بعد القفل\"}" -o /tmp/pay2.json -w "%{http_code}")
[ "$CODE" = "403" ] && ok "revoked → payment API 403 enforced" || bad "revoked → payment API 403" "$CODE $(head -c 150 /tmp/pay2.json)"

# 6) المدير يرجّع الصلاحية
MGR_ID_JSON=$(curl -s $BASE/api/staff -b $MGR | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('staff') or d.get('data',{}).get('staff') or d.get('staffMembers') or []; print([x for x in s if x['username']=='qae-rec-99'][0]['id'])")
CODE=$(curl -s -X PATCH $BASE/api/staff -H "Content-Type: application/json" -b $MGR -d "{\"action\":\"update\",\"id\":\"$MGR_ID_JSON\",\"permissions\":{\"RECORD_PAYMENT\":true}}" -o /tmp/perm2.json -w "%{http_code}")
PERM=$(python3 -c "import json; d=json.load(open('/tmp/perm2.json')); print('RECORD_PAYMENT' in (d.get('permissions') or []))" 2>/dev/null)
[ "$CODE" = "200" ] && [ "$PERM" = "True" ] && ok "manager re-grants RECORD_PAYMENT" || bad "manager re-grants RECORD_PAYMENT" "$CODE perm=$PERM"

# 7) الاستقبال يسجل تاني → ينجح
CODE=$(curl -s -X POST $BASE/api/payments -H "Content-Type: application/json" -b $REC -d "{\"action\":\"record\",\"studentId\":\"$SID\",\"amount\":2500,\"note\":\"فحص - بعد الإرجاع\"}" -o /tmp/pay3.json -w "%{http_code}")
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] && ok "re-granted → payment works again" || bad "re-granted → payment works" "$CODE $(head -c 150 /tmp/pay3.json)"

# 8) قفل قسم المالية (modules) على الاستقبال
CODE=$(curl -s -X PATCH $BASE/api/staff -H "Content-Type: application/json" -b $MGR -d "{\"action\":\"update\",\"id\":\"$MGR_ID_JSON\",\"modules\":{\"finance\":false}}" -o /tmp/mod1.json -w "%{http_code}")
[ "$CODE" = "200" ] && ok "manager blocks finance module for receptionist" || bad "manager blocks finance module" "$CODE $(head -c 150 /tmp/mod1.json)"

# 9) الاستقبال يفتح صفحة المالية → القسم مرفوض (أو الـ API مرفوض)
CODE=$(curl -s "$BASE/api/payments?page=1&pageSize=5" -b $REC -o /tmp/pay4.json -w "%{http_code}")
[ "$CODE" = "403" ] && ok "blocked module → payments API 403" || bad "blocked module → payments 403" "$CODE $(head -c 150 /tmp/pay4.json)"

# 10) رجّع القسم
CODE=$(curl -s -X PATCH $BASE/api/staff -H "Content-Type: application/json" -b $MGR -d "{\"action\":\"update\",\"id\":\"$MGR_ID_JSON\",\"modules\":{\"finance\":true}}" -o /tmp/mod2.json -w "%{http_code}")
[ "$CODE" = "200" ] && ok "manager unblocks finance module" || bad "manager unblocks finance" "$CODE $(head -c 150 /tmp/mod2.json)"
CODE=$(curl -s "$BASE/api/payments?page=1&pageSize=5" -b $REC -o /dev/null -w "%{http_code}")
[ "$CODE" = "200" ] && ok "unblocked → payments 200 again" || bad "unblocked → payments 200" "$CODE"

# 11) الأدمن (لوحة المنصة) يعدّل نفس الصلاحيات
curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" -d '{"action":"login","username":"qae-admin","password":"Qae#2026"}' -c /tmp/qae-admin.cookies -o /dev/null
CODE=$(curl -s -X POST $BASE/api/admin -H "Content-Type: application/json" -b /tmp/qae-admin.cookies -d "{\"action\":\"set-user-permissions\",\"targetUserId\":\"$MGR_ID_JSON\",\"permissions\":{\"EXPORT_REPORTS\":false}}" -o /tmp/aperm.json -w "%{http_code}")
[ "$CODE" = "200" ] && ok "platform admin sets user permissions" || bad "platform admin sets permissions" "$CODE $(head -c 150 /tmp/aperm.json)"
# رجّعها
CODE=$(curl -s -X POST $BASE/api/admin -H "Content-Type: application/json" -b /tmp/qae-admin.cookies -d "{\"action\":\"set-user-permissions\",\"targetUserId\":\"$MGR_ID_JSON\",\"permissions\":{\"EXPORT_REPORTS\":true}}" -o /dev/null -w "%{http_code}")
[ "$CODE" = "200" ] && ok "platform admin re-grants (cleanup)" || bad "platform admin re-grants" "$CODE"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
