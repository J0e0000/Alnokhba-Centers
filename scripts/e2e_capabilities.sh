#!/bin/bash
# ============================================================
# E2E — قدرات المركز + الحضور الموحد (spec sections 1,2,3,4,5,14,15,16)
#   Center A: name + static فقط (dynamic/self-scan/staff_qr/fingerprint OFF, late OFF)
#   Center B: dynamic + self_scan + staff_qr + fingerprint(3) — name/static OFF
# يفحص: API enforcement (مش مجرد إخفاء UI) + الأحداث الموحدة + بصمة + QR موظفين + حضور مدرس تلقائي
# Run: bash scripts/e2e_capabilities.sh
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-caps2
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3  ($4)";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected $2, got $3  ($4)"; fi; }

login() { curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null; }

rm -rf $JAR && mkdir -p $JAR

# ============ تجهيز المركزين ============
SETUP=$(npx tsx scripts/caps_test_setup.ts 2>/dev/null | tail -n +1)
A_ID=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['a']['centerId'])")
A_GRP=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['a']['groupId'])")
A_TEACHER=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['a']['teacherId'])")
A_SCODE=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['a']['studentCode'])")
A_SPHONE=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['a']['studentPhone'])")
B_ID=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['b']['centerId'])")
B_GRP=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['b']['groupId'])")
B_TEACHER=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['b']['teacherId'])")
B_SCODE=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['b']['studentCode'])")
B_SPHONE=$(echo "$SETUP" | python3 -c "import json,sys; print(json.load(sys.stdin)['b']['studentPhone'])")

login capsmgr_a nokhba123 mgrA
login capsrec_a nokhba123 recA
login capsmgr_b nokhba123 mgrB
login capsrec_b nokhba123 recB

# ============ 1) capabilities API ============
U1=$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/center/capabilities)
check "caps GET unauth → 401" "401" "$U1" "guarded"

P1=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/center/capabilities -b $JAR/recA.jar -H "Content-Type: application/json" -d '{"capabilities":[{"key":"dynamic_qr","enabled":true}]}')
check "caps PATCH receptionist → 403" "403" "$P1" "account-permission × capability separation"

P2=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH $BASE/api/center/capabilities -b $JAR/mgrA.jar -H "Content-Type: application/json" -d '{"capabilities":[{"key":"hack_x","enabled":true}]}')
check "caps PATCH unknown key → 400" "400" "$P2" "catalog validation"

curl -s -X PATCH $BASE/api/center/capabilities -b $JAR/mgrB.jar -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"fingerprint","enabled":true,"config":{"maxUsers":99}}]}' > /dev/null
MX=$(curl -s -b $JAR/mgrB.jar $BASE/api/center/capabilities | python3 -c "import json,sys; print(json.load(sys.stdin)['capabilities']['fingerprint']['config']['maxUsers'])")
check "caps config clamp maxUsers 99→10" "10" "$MX" "safety bounds"

# استعادة حد 3 للبصمة في B + تعديل فعلي في A (للفحص الأودت)
curl -s -X PATCH $BASE/api/center/capabilities -b $JAR/mgrB.jar -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"fingerprint","enabled":true,"config":{"maxUsers":3}}]}' > /dev/null
curl -s -X PATCH $BASE/api/center/capabilities -b $JAR/mgrA.jar -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"late_checkin","enabled":false}]}' > /dev/null

AUD=$(curl -s -b $JAR/mgrA.jar "$BASE/api/audit?page=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('items') or d.get('logs') or []
print('yes' if any('ميزات المركز' in (i.get('action','') or '') or i.get('action')=='CAPABILITIES_UPDATED' for i in items) else 'no')" 2>/dev/null)
check "capabilities change audited" "yes" "$AUD" "audit trail"

# ============ 2) Center A — اسم + QR ثابت بس ============
# فتح حصة في A (ad-hoc)
SA=$(curl -s -b $JAR/mgrA.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"groupId\":\"$A_GRP\",\"startTime\":\"23:00\",\"endTime\":\"23:59\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session',{}).get('id',''))")
[ -n "$SA" ] || { echo "NO SESSION A — abort"; exit 1; }

S1=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/mgrA.jar -X POST $BASE/api/attendance/session-qr/slot -H "Content-Type: application/json" -d "{\"sessionId\":\"$SA\"}")
check "A: dynamic QR issue → 403 (disabled)" "403" "$S1" "backend enforces capability"

M1=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/mgrA.jar -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SA\",\"studentId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["a"]["studentId"])')\",\"status\":\"PRESENT\",\"method\":\"MANUAL\"}")
check "A: name attendance mark → 200 (enabled)" "200" "$M1" "name_attendance ON"

M2=$(curl -s -w '\n%{http_code}' -b $JAR/mgrA.jar -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SA\",\"studentId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["a"]["studentId"])')\",\"status\":\"LATE\",\"method\":\"MANUAL\"}" | tail -1)
check "A: LATE mark → 403 (late_checkin OFF)" "403" "$M2" "backend enforces capability"

# طالب جديد لحالة LATE (الأول حضر خلاص)
CQ=$(curl -s -b $JAR/mgrA.jar -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SA\",\"studentId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["a"]["studentId"])')\",\"status\":\"PRESENT\",\"method\":\"MANUAL\"}")
check "A: duplicate mark tolerated (alreadyAttended)" "True" "$(echo $CQ | python3 -c "import json,sys; print(json.load(sys.stdin).get('alreadyAttended'))" 2>/dev/null)" "idempotent"

ST=$(curl -s -b $JAR/recA.jar -X POST $BASE/api/attendance/scan -H "Content-Type: application/json" \
  -d '{"query":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sessionId":""}')
check "A: static QR scan allowed (static ON)" "0" "$(echo "$ST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(0 if 'مقفول' not in (d.get('message') or '') else 1)" 2>/dev/null)" "static_qr ON"

F1=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/mgrA.jar -X POST $BASE/api/attendance/fingerprint/enroll -H "Content-Type: application/json" \
  -d '{"personType":"STAFF","label":"x","template":"aaaaaaaaaaaaaaaa"}')
check "A: fingerprint enroll → 403 (disabled)" "403" "$F1" "backend enforces capability"

K1=$(curl -s -w '\n%{http_code}' -b $JAR/recA.jar -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" -d '{"token":"abcdefabcdefabcdefabcdefabcdefabcdef1234"}' | tail -1)
check "A: staff QR claim → 403 (disabled)" "403" "$K1" "backend enforces capability"

# ============ 3) Center B — dynamic + self_scan + staff_qr + fingerprint ============
SB=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"groupId\":\"$B_GRP\",\"startTime\":\"23:00\",\"endTime\":\"23:59\"}")
SLB=$(echo "$SB" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session',{}).get('id',''))")
TA=$(echo "$SB" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('teacherAutoAttendance',{}).get('teacherName','') if d.get('teacherAutoAttendance') else '')")
[ -n "$SLB" ] || { echo "NO SESSION B — abort"; exit 1; }
check "B: session open → teacher auto-attended (SESSION_START)" "مستر اختبار" "$TA" "teacher attendance automatic"

TE=$(curl -s -b $JAR/mgrB.jar "$BASE/api/attendance/staff-events?days=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
evs=d.get('events',[])
print('yes' if any(e['method']=='SESSION_START' and e['name']=='مستر اختبار' for e in evs) else 'no')")
check "B: teacher SESSION_START event in unified log" "yes" "$TE" "unified attendance core"

SL=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/session-qr/slot -H "Content-Type: application/json" -d "{\"sessionId\":\"$SLB\"}")
BTOK=$(echo "$SL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))")
check "B: dynamic QR issue → token (enabled)" "40" "${#BTOK}" "slot token issued"

# دخول طالب البورتال + claim (self-scan)
curl -s -X POST $BASE/api/portal -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"code\":\"$B_SCODE\",\"phone\":\"$B_SPHONE\"}" -c $JAR/portalB.jar > /dev/null
CL=$(curl -s -b $JAR/portalB.jar -X POST $BASE/api/attendance/session-qr/claim -H "Content-Type: application/json" -d "{\"token\":\"$BTOK\"}")
CLOK=$(echo "$CL" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('alreadyAttended') else 'no')" 2>/dev/null)
check "B: student self-scan claim → ok" "ok" "$CLOK" "student_self_scan ON"

M3=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/mgrB.jar -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SLB\",\"studentId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["b"]["studentId"])')\",\"status\":\"PRESENT\",\"method\":\"MANUAL\"}")
check "B: name mark → 403 (name_attendance OFF)" "403" "$M3" "backend enforces capability"

SC=$(curl -s -b $JAR/recB.jar -X POST $BASE/api/attendance/scan -H "Content-Type: application/json" -d '{"query":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
check "B: static QR scan blocked (static OFF)" "1" "$(echo "$SC" | python3 -c "import json,sys; d=json.load(sys.stdin); print(1 if 'مقفول' in (d.get('message') or '') else 0)" 2>/dev/null)" "graceful RED — no crash"

# ===== حضور الموظفين بشاشة QR =====
DEV=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/staff-qr/device -H "Content-Type: application/json" -d '{"name":"شاشة الاختبار"}')
DKEY=$(echo "$DEV" | python3 -c "import json,sys; print(json.load(sys.stdin).get('deviceKey',''))")
check "B: device registered + key shown once" "48" "${#DKEY}" "key 24 bytes hex"

IS=$(curl -s -X POST $BASE/api/attendance/staff-qr/issue -H "Content-Type: application/json" -d "{\"deviceKey\":\"$DKEY\"}")
KT1=$(echo "$IS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))")
KSLOT=$(echo "$IS" | python3 -c "import json,sys; print(json.load(sys.stdin).get('slotSeconds','0'))")
check "B: staff QR issued by device" "5" "$KSLOT" "slotSeconds from capability config"
check "B: staff QR token shape 40-hex" "40" "${#KT1}" "opaque token"

K2=$(curl -s -b $JAR/recB.jar -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" -d "{\"token\":\"$KT1\"}")
K2OK=$(echo "$K2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') and not d.get('alreadyCheckedIn') else 'no')" 2>/dev/null)
check "B: receptionist QR check-in → ok" "ok" "$K2OK" "staff attendance recorded"

K3=$(curl -s -b $JAR/recB.jar -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" -d "{\"token\":\"$KT1\"}")
K3D=$(echo "$K3" | python3 -c "import json,sys; print(json.load(sys.stdin).get('alreadyCheckedIn'))" 2>/dev/null)
check "B: duplicate check-in same day → alreadyCheckedIn" "True" "$K3D" "once per day"

# rotation → التوكن القديم يموت
curl -s -X POST $BASE/api/attendance/staff-qr/issue -H "Content-Type: application/json" -d "{\"deviceKey\":\"$DKEY\"}" > /dev/null
K4=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/recB.jar -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" -d "{\"token\":\"$KT1\"}")
check "B: old token after rotation → 410 (replay)" "410" "$K4" "replay protection"

K5=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/recA.jar -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" \
  -d "{\"token\":\"$(curl -s -X POST $BASE/api/attendance/staff-qr/issue -H "Content-Type: application/json" -d "{\"deviceKey\":\"$DKEY\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')\"}")
check "A: wrong-center staff QR claim → 403" "403" "$K5" "center binding"

K6=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" -d "{\"token\":\"$KT1\"}")
check "staff QR claim unauth → 401" "401" "$K6" "guarded"

# انتهاء صلاحية طبيعي (slot 5ث + grace 4ث)
SLOW=$(curl -s -X POST $BASE/api/attendance/staff-qr/issue -H "Content-Type: application/json" -d "{\"deviceKey\":\"$DKEY\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
sleep 10
K7=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/mgrB.jar -X POST $BASE/api/attendance/staff-qr/claim -H "Content-Type: application/json" -d "{\"token\":\"$SLOW\"}")
check "B: expired staff QR → 410 (photo dies)" "410" "$K7" "short lifetime"

# ===== البصمة =====
E1=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/fingerprint/enroll -H "Content-Type: application/json" \
  -d "{\"personType\":\"STAFF\",\"userId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["b"]["rec"]["id"])')\",\"label\":\"بصمة الاستقبال\",\"template\":\"fp-template-receptionist-001\"}")
E1OK=$(echo "$E1" | python3 -c "import json,sys; print('ok' if json.load(sys.stdin).get('enrollment') else 'no')" 2>/dev/null)
check "B: fingerprint enroll staff → 201" "ok" "$E1OK" "fingerprint ON"

curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/fingerprint/enroll -H "Content-Type: application/json" \
  -d "{\"personType\":\"TEACHER\",\"teacherId\":\"$B_TEACHER\",\"label\":\"بصمة المدرس\",\"template\":\"fp-template-teacher-002\"}" > /dev/null
curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/fingerprint/enroll -H "Content-Type: application/json" \
  -d "{\"personType\":\"STUDENT\",\"studentId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["b"]["studentId"])')\",\"label\":\"بصمة الطالب\",\"template\":\"fp-template-student-003\"}" > /dev/null
E4=$(curl -s -o /dev/null -w '%{http_code}' -b $JAR/mgrB.jar -X POST $BASE/api/attendance/fingerprint/enroll -H "Content-Type: application/json" \
  -d "{\"personType\":\"STAFF\",\"userId\":\"$(echo $SETUP | python3 -c 'import json,sys; print(json.load(sys.stdin)["b"]["mgr"]["id"])')\",\"label\":\"الرابعة\",\"template\":\"fp-template-manager-004\"}")
check "B: 4th fingerprint beyond max 3 → 400" "400" "$E4" "maxUsers enforced"

V1=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/fingerprint/event -H "Content-Type: application/json" \
  -d '{"template":"fp-template-receptionist-001"}')
V1OK=$(echo "$V1" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') else 'no')" 2>/dev/null)
check "B: fingerprint verify match → event" "ok" "$V1OK" "SERVER_MATCH mode"

V2=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/fingerprint/event -H "Content-Type: application/json" \
  -d '{"template":"unknown-template-xyz"}')
V2OK=$(echo "$V2" | python3 -c "import json,sys; d=json.load(sys.stdin); print('no' if not d.get('ok') and d.get('reason')=='NO_MATCH' else 'yes')" 2>/dev/null)
check "B: unregistered fingerprint → graceful NO_MATCH" "no" "$V2OK" "no crash, clean 200"

# جهاز بصمة مسجل → X-Device-Key
FDEV=$(curl -s -b $JAR/mgrB.jar -X POST $BASE/api/attendance/staff-qr/device -H "Content-Type: application/json" -d '{"name":"قارئ البصمة","kind":"FINGERPRINT_SCANNER"}')
FKEY=$(echo "$FDEV" | python3 -c "import json,sys; print(json.load(sys.stdin).get('deviceKey',''))")
V3=$(curl -s -X POST $BASE/api/attendance/fingerprint/event -H "Content-Type: application/json" -H "X-Device-Key: $FKEY" \
  -d '{"template":"fp-template-teacher-002"}')
V3OK=$(echo "$V3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') else 'no')" 2>/dev/null)
check "B: fingerprint device event (X-Device-Key) → ok" "ok" "$V3OK" "hardware integration path"

# بصمة مدرس → تسمح بـ requireCenterPresence في A؟ اختبار البوابة في A:
curl -s -X PATCH $BASE/api/center/capabilities -b $JAR/mgrA.jar -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"teacher_auto_attendance","enabled":true,"config":{"requireCenterPresence":true}}]}' > /dev/null
SA2=$(curl -s -w '\n%{http_code}' -b $JAR/mgrA.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"groupId\":\"$A_GRP\",\"startTime\":\"00:10\",\"endTime\":\"00:50\"}" | tail -1)
check "A: requireCenterPresence ON + no teacher event → 403" "403" "$SA2" "physical-presence gate"
curl -s -X PATCH $BASE/api/center/capabilities -b $JAR/mgrA.jar -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"teacher_auto_attendance","enabled":true,"config":{"requireCenterPresence":false}}]}' > /dev/null

# ============ 4) Q&A المدرك للدور (unit) ============
QA=$(npx tsx -e "
import { FAQ_ITEMS } from './src/components/nokhba/help-content';
import { filterQa } from './src/components/nokhba/help';
import { defaultCapabilityMap } from './src/lib/capabilities';

const capsOff = defaultCapabilityMap();
capsOff.student_self_scan.enabled = false;
capsOff.dynamic_qr.enabled = false;

const studentOn = filterQa(FAQ_ITEMS, { role: 'STUDENT' }).filter(f => f.view === 'student-portal');
const studentOff = filterQa(FAQ_ITEMS, { role: 'STUDENT', caps: capsOff }).filter(f => f.view === 'student-portal');
const selfScanQ = (list: typeof FAQ_ITEMS) => list.some(f => f.q.includes('أسجّل حضوري بنفسي'));
const rec = filterQa(FAQ_ITEMS, { role: 'RECEPTIONIST' });
const recSeesSettings = rec.some(f => f.view === 'settings');
const mgr = filterQa(FAQ_ITEMS, { role: 'MANAGER' });
const mgrSeesSettings = mgr.some(f => f.view === 'settings' && f.q.includes('أفعّل/أقفل'));
console.log(JSON.stringify({
  studentSeesSelfScanWhenOn: selfScanQ(studentOn),
  studentLosesSelfScanWhenOff: !selfScanQ(studentOff),
  recBlockedFromSettings: !recSeesSettings,
  mgrSeesCapabilityConfig: mgrSeesSettings,
}));
" 2>/dev/null | tail -1)
check "QA: student sees self-scan Q when enabled" "True" "$(echo $QA | python3 -c "import json,sys; print(json.load(sys.stdin)['studentSeesSelfScanWhenOn'])" 2>/dev/null)" "role+context aware"
check "QA: student loses self-scan Q when disabled" "True" "$(echo $QA | python3 -c "import json,sys; print(json.load(sys.stdin)['studentLosesSelfScanWhenOff'])" 2>/dev/null)" "capability aware"
check "QA: receptionist blocked from settings Q" "True" "$(echo $QA | python3 -c "import json,sys; print(json.load(sys.stdin)['recBlockedFromSettings'])" 2>/dev/null)" "role gating"
check "QA: manager sees capability config Q" "True" "$(echo $QA | python3 -c "import json,sys; print(json.load(sys.stdin)['mgrSeesCapabilityConfig'])" 2>/dev/null)" "role gating"

echo ""
echo -e "================= RESULTS =================\n$RESULTS\n"
echo "PASS=$PASS FAIL=$FAIL"
