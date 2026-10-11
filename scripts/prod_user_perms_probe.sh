#!/bin/bash
# ============================================================
# PROD PROBES — per-user permissions/features + Zaki 28 tools
# قراءة فقط + كتابة واحدة قابلة للعكس على حساب موقوف (agent_teach_t)
# Run: BASE=https://alnokhba-centers-nine.vercel.app bash scripts/prod_user_perms_probe.sh
# ============================================================
BASE="${BASE:-https://alnokhba-centers-nine.vercel.app}"
J=/tmp/prod-perms-jars
PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "✅ $1 → $3"; else FAIL=$((FAIL+1)); echo "❌ $1 → expected $2, got $3  ($4)"; fi; }

login() { curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"nokhba123\"}" -c "$J/$2.jar" -o /dev/null; }

rm -rf $J && mkdir -p $J
sleep 1

echo "── 1) new deploy marker: userModules in capabilities ──"
login manager mgr
UM=$(curl -s -b $J/mgr.jar $BASE/api/center/capabilities | python3 -c "import sys,json; d=json.load(sys.stdin); print('userModules' in d)")
ck "capabilities exposes userModules (new build live)" "True" "$UM"

echo "── 2) admin: users payload with permissions + moduleGrants ──"
login admin adm
ADM=$(curl -s -b $J/adm.jar $BASE/api/admin | python3 -c "
import sys,json; d=json.load(sys.stdin)
us=d.get('users',[])
print(len(us), all('permissions' in u and 'moduleGrants' in u for u in us))")
ck "admin users payload (count + perms fields)" "y" "$(echo "$ADM" | rg -q "True$" && echo y || echo n)"

echo "── 3) manager: 28 tools catalog ──"
CNT=$(curl -s -b $J/mgr.jar $BASE/api/agent/capabilities | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('tools',[])))")
ck "manager agent tool count" "28" "$CNT"
NEW=$(curl -s -b $J/mgr.jar $BASE/api/agent/capabilities | python3 -c "
import sys,json; d=json.load(sys.stdin)
names=[t['name'] for t in d['tools']]
need=['approvals.list','approvals.decide','finance.record_expense','books.sell_book','students.set_status','announcements.send','exams.list','audit.recent','subscription.status']
print(sum(1 for n in need if n in names))")
ck "9 new tools live" "9" "$NEW"

echo "── 4) manager: staff payload has modules + grants ──"
ST=$(curl -s -b $J/mgr.jar $BASE/api/staff | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d.get('staff',[])
print(len(s), all('modules' in x and 'moduleGrants' in x for x in s), all('centerModules' in d for _ in [0]))")
echo "staff: $ST"
ck "staff payload fields" "y" "$(echo "$ST" | rg -q "True True" && echo y || echo n)"

echo "── 5) reversible write: grant→verify→revoke on deactivated agent_teach_t ──"
TARGET=$(curl -s -b $J/adm.jar $BASE/api/admin | python3 -c "
import sys,json; d=json.load(sys.stdin)
u=[x for x in d['users'] if x['username']=='agent_teach_t']
print(u[0]['id'] if u else '')")
if [ -n "$TARGET" ]; then
  R=$(curl -s -b $J/adm.jar -X POST $BASE/api/admin -H "Content-Type: application/json" \
    -d "{\"action\":\"set-user-permissions\",\"targetUserId\":\"$TARGET\",\"permissions\":{\"VIEW_REPORTS\":true}}" -o /dev/null -w '%{http_code}')
  ck "admin set-user-permissions (grant on deactivated acct)" "200" "$R"
  NOW=$(curl -s -b $J/adm.jar $BASE/api/admin | python3 -c "
import sys,json; d=json.load(sys.stdin)
u=[x for x in d['users'] if x['username']=='agent_teach_t'][0]
print('VIEW_REPORTS' in u['permissions'])")
  ck "grant visible in payload" "True" "$NOW"
  R2=$(curl -s -b $J/adm.jar -X POST $BASE/api/admin -H "Content-Type: application/json" \
    -d "{\"action\":\"set-user-permissions\",\"targetUserId\":\"$TARGET\",\"permissions\":{\"VIEW_REPORTS\":false}}" -o /dev/null -w '%{http_code}')
  ck "revoke (reversible, audited)" "200" "$R2"
  AFTER=$(curl -s -b $J/adm.jar $BASE/api/admin | python3 -c "
import sys,json; d=json.load(sys.stdin)
u=[x for x in d['users'] if x['username']=='agent_teach_t'][0]
print('VIEW_REPORTS' in u['permissions'])")
  ck "revoked clean" "False" "$AFTER"
else
  echo "⚠️ agent_teach_t not found — skipping reversible write"
fi

echo "── 6) audit trail contains the admin edits ──"
AUD=$(curl -s -b $J/adm.jar $BASE/api/admin | python3 -c "
import sys,json; d=json.load(sys.stdin)
acts=[l['action'] for l in d.get('recentLogs',[])]
print('تعديل صلاحيات حساب' in acts)")
ck "audit logs the permission edits" "True" "$AUD"

echo "════════════════════════"
echo "PROD PROBES: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "ALL GREEN ✅" || echo "HAS FAILURES ❌"
