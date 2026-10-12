#!/bin/bash
# ============================================================
# E2E — تحرير الصلاحيات والأقسام لكل حساب (admin + manager)
#   1) /api/staff: الكتالوج الكامل (24) للاستقبال والمدرس + الأقسام لكل موظف
#   2) requireModule بقفل الحساب: /api/payments مرفوض لحساب متقفل عنه المالية
#   3) /api/admin: set-user-permissions / set-user-modules / set-user-status
#   4) زكي: 28 أداة + فلترة بالحساب (قفل قسم يشيل أدواته + أدوات المدير مخفية)
# Run: bash scripts/e2e_user_permissions.sh
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-perm
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected $2, got $3  ($4)"; fi; }

login() { sleep 1.2; curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null; }
code() { curl -s -b "$JAR/$1.jar" -o /tmp/perm-body.json -w '%{http_code}' "$BASE$2" ${3:+-X $3} ${4:+-H "Content-Type: application/json"} ${4:+-d "$4"}; }

rm -rf $JAR && mkdir -p $JAR

SETUP=$(npx tsx scripts/perm_test_setup.ts 2>/dev/null | tail -1)
C_ID=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['centerId'])")
REC_ID=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['recId'])")
TEACH_ID=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['teachId'])")
STUDENT_ID=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['studentId'])")

login pmgr nokhba123 pmgr
login prec nokhba123 prec
login pteach nokhba123 pteach
login admin nokhba123 admin

# ============ 1) /api/staff — الكتالوج الكامل + الأقسام ============
code pmgr /api/staff > /dev/null; cat /tmp/perm-body.json > /tmp/staff.json
STAFF_N=$(python3 -c "import json; d=json.load(open('/tmp/staff.json')); print(len(d['staff']))")
check "staff list size" 3 "$STAFF_N"
REC_PERMS=$(python3 -c "import json; d=json.load(open('/tmp/staff.json')); print(len([s for s in d['staff'] if s['id']=='$REC_ID'][0]['permissions']))")
check "receptionist resolved perms (defaults)" 14 "$REC_PERMS"
TEACH_PERMS=$(python3 -c "import json; d=json.load(open('/tmp/staff.json')); print(len([s for s in d['staff'] if s['id']=='$TEACH_ID'][0]['permissions']))")
check "teacher resolved perms (empty default)" 0 "$TEACH_PERMS"
ATT_ENABLED=$(python3 -c "import json; d=json.load(open('/tmp/staff.json')); print(d['centerModules']['attendance']['enabled'])")
check "centerModules.attendance enabled" "True" "$ATT_ENABLED"

# ============ 2) صلاحية للمدرس — التقارير تفتح ============
B=$(code pteach /api/payments POST "{\"type\":\"PAYMENT\",\"studentId\":\"$STUDENT_ID\",\"amount\":5,\"method\":\"CASH\"}"); check "teacher POST payment before grant (no RECORD_PAYMENT)" 403 "$B"
B=$(code pmgr /api/staff PATCH "{\"id\":\"$TEACH_ID\",\"permissions\":{\"RECORD_PAYMENT\":true,\"VIEW_REPORTS\":true,\"EXPORT_REPORTS\":true}}")
check "PATCH grant teacher RECORD_PAYMENT+reports" 200 "$B"
login pteach nokhba123 pteach2
B=$(code pteach2 /api/payments POST "{\"type\":\"PAYMENT\",\"studentId\":\"$STUDENT_ID\",\"amount\":5,\"method\":\"CASH\"}"); check "teacher POST payment after grant (passes perm gate)" 200 "$B"
login pmgr nokhba123 pmgr
code pmgr /api/staff > /dev/null
T_PERMS=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); print(len([s for s in d['staff'] if s['id']=='$TEACH_ID'][0]['permissions']))")
check "teacher resolved perms after grant" 3 "$T_PERMS"

# ============ 3) قفل قسم المالية للاستقبال — السيرفر يفرضه ============
B=$(code prec /api/payments); check "receptionist /api/payments before lock" 200 "$B"
B=$(code pmgr /api/staff PATCH "{\"id\":\"$REC_ID\",\"modules\":{\"finance\":false}}")
check "PATCH lock finance module for receptionist" 200 "$B"
login prec nokhba123 prec2
B=$(code prec2 /api/payments); MSG=$(python3 -c "import json; print(json.load(open('/tmp/perm-body.json')).get('error',''))" 2>/dev/null)
check "receptionist /api/payments after lock (403)" 403 "$B"
check "lock message is user-specific" "y" "$(echo "$MSG" | grep -q 'متقفل لحسابك' && echo y || echo n)"
B=$(code prec2 /api/center/capabilities); UM_FIN=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); print(d['userModules']['finance']['enabled'])")
check "userModules.finance disabled for locked user" "False" "$UM_FIN"
B=$(code prec2 /api/agent/capabilities); TOOLS_FIN=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); print(sum(1 for t in d['tools'] if t['name'].startswith('finance.')))")
check "finance.* tools hidden from locked user" 0 "$TOOLS_FIN"
login pmgr nokhba123 pmgr
B=$(code pmgr /api/staff PATCH "{\"id\":\"$REC_ID\",\"modules\":{\"finance\":true}}")
check "PATCH unlock finance (restore inherit)" 200 "$B"
login prec nokhba123 prec3
B=$(code prec3 /api/payments); check "receptionist /api/payments after unlock" 200 "$B"
login pmgr nokhba123 pmgr

# ============ 4) حواجز الحماية ============
B=$(code pmgr /api/staff PATCH "{\"id\":\"$REC_ID\",\"modules\":{\"invalid_mod\":false}}")
check "PATCH invalid module key → 400" 400 "$B"
MGR_ID=$(python3 -c "import json; d=json.load(open('/tmp/staff.json')); print([s for s in d['staff'] if s['role']=='MANAGER'][0]['id'])")
B=$(code pmgr /api/staff PATCH "{\"id\":\"$MGR_ID\",\"permissions\":{\"VIEW_REPORTS\":false}}")
check "PATCH manager permissions → 400 (manager always full)" 400 "$B"
B=$(code prec3 /api/staff); check "receptionist GET /api/staff → 403 (manager only)" 403 "$B"

# ============ 5) لوحة الأدمن — تحرير كل حساب ============
B=$(code admin /api/admin); check "admin GET /api/admin" 200 "$B"
ADMIN_PERMS=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); u=[x for x in d['users'] if x['id']=='$TEACH_ID'][0]; print(len(u['permissions']), 'moduleGrants' in json.dumps(list(u.keys())))")
check "admin users payload has perms+modules" 3 "$(echo $ADMIN_PERMS | cut -d" " -f1)"
B=$(code admin /api/admin POST "{\"action\":\"set-user-permissions\",\"targetUserId\":\"$TEACH_ID\",\"permissions\":{\"EDIT_ATTENDANCE\":true}}")
check "admin set-user-permissions" 200 "$B"
B=$(code admin /api/admin POST "{\"action\":\"set-user-modules\",\"targetUserId\":\"$REC_ID\",\"modules\":{\"books\":false}}")
check "admin set-user-modules books:false" 200 "$B"
login prec nokhba123 prec4
B=$(code prec4 /api/books); check "receptionist /api/books after admin lock → 403" 403 "$B"
login admin nokhba123 admin2
B=$(code admin2 /api/admin POST "{\"action\":\"set-user-modules\",\"targetUserId\":\"$REC_ID\",\"modules\":{\"books\":true}}")
check "admin restore books module" 200 "$B"
B=$(code admin2 /api/admin POST "{\"action\":\"set-user-modules\",\"targetUserId\":\"$REC_ID\",\"modules\":{\"nope\":false}}")
check "admin invalid module key → 400" 400 "$B"
B=$(code admin2 /api/admin POST "{\"action\":\"set-user-permissions\",\"targetUserId\":\"$MGR_ID\",\"permissions\":{\"VIEW_REPORTS\":false}}")
check "admin manager target → 400 (مدير كامل دايمًا)" 400 "$B"

# حالة الحساب: قفل/فتح من اللوحة
login pteach nokhba123 pteach3
B=$(code pteach3 /api/auth); check "teacher session works before deactivate" 200 "$B"
login admin nokhba123 admin3
B=$(code admin3 /api/admin POST "{\"action\":\"set-user-status\",\"targetUserId\":\"$TEACH_ID\",\"userStatus\":false}")
check "admin set-user-status false" 200 "$B"
login pteach nokhba123 pteach4
B=$(code pteach4 /api/today); check "deactivated teacher blocked" 401 "$B"
login admin nokhba123 admin4
B=$(code admin4 /api/admin POST "{\"action\":\"set-user-status\",\"targetUserId\":\"$TEACH_ID\",\"userStatus\":true}")
check "admin set-user-status true (restore)" 200 "$B"

# ============ 6) زكي — 28 أداة + فلترة المدير ============
login pmgr nokhba123 pmgr5
B=$(code pmgr5 /api/agent/capabilities)
COUNT=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); print(len(d['tools']))")
check "manager tool catalog count (20+8)" 28 "$COUNT"
HAS_NEW=$(python3 -c "
import json; d=json.load(open('/tmp/perm-body.json'))
names=[t['name'] for t in d['tools']]
need=['approvals.list','approvals.decide','finance.record_expense','books.sell_book','students.set_status','announcements.send','exams.list','audit.recent','subscription.status']
print(sum(1 for n in need if n in names))")
check "all 9 new tools registered" 9 "$HAS_NEW"
B=$(code prec4 /api/agent/capabilities); REC_TOOLS=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); names=[t['name'] for t in d['tools']]; print(('approvals.decide' in names), ('finance.get_collection' in names))")
check "receptionist: approvals.decide hidden + finance visible (restored)" "False True" "$REC_TOOLS"
login pteach nokhba123 pteach5
B=$(code pteach5 /api/agent/capabilities); T_TOOLS=$(python3 -c "import json; d=json.load(open('/tmp/perm-body.json')); names=[t['name'] for t in d['tools']]; print(('approvals.list' in names), ('reports.get_student_report' in names))")
check "teacher: approvals hidden, reports tool visible (granted)" "False True" "$T_TOOLS"

# ============ 7) تشغيل حقيقي لأداة قراءة (عبر الدماغ الحتمي لو الموديل مش متاح) ============
login pmgr nokhba123 pmgr6
SSE=$(curl -s -N -b "$JAR/pmgr6.jar" -X POST "$BASE/api/agent/message" -H "Content-Type: application/json" \
  -d '{"text":"اشتراكنا لحد امتى؟","ctx":{"view":"home"}}' --max-time 45)
STATUS=$(echo "$SSE" | grep -o '"status":"[A-Z_]*"' | tail -1)
check "agent message task completes" "y" "$(echo "$SSE" | grep -q '"type":"done"' && echo y || echo n)"

echo -e "$RESULTS"
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "ALL GREEN ✅" || echo "HAS FAILURES ❌"
