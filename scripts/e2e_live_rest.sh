#!/bin/bash
# Live E2E — الأقسام المتبقية: autosubmit + assignments + QR (يعتمد على كوكيز /tmp/nk-live)
BASE=https://alnokhba-centers.vercel.app
J=/tmp/nk-live
PASS=0; FAIL=0
curl() { command curl --max-time 30 "$@"; }
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected=$2 got=$3)"; fi; }
SESS=cmupji4970001poawa330qy92
GROUP=cmufickak001eiqo9tkb8o3hc

START=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat())")
SHORT_END=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat())")
PAST_DEADLINE=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(minutes=30)).isoformat())")
DEADLINE=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=5)).isoformat())")

echo "========== 5L) AUTO-SUBMIT LIVE =========="
curl -s -b $J/mgr.jar -X POST $BASE/api/exams -H 'Content-Type: application/json' -o $J/exam3.json -d "{
  \"groupId\":\"$GROUP\",\"title\":\"امتحان قصير LIVE (autosubmit)\",\"startAt\":\"$START\",\"endAt\":\"$SHORT_END\",\"durationMin\":1,
  \"publish\":true,\"questions\":[{\"text\":\"3+3؟\",\"type\":\"NUM\",\"points\":3,\"correctAnswer\":\"6\"}]}"
EXAM3=$(python3 -c "import json; print(json.load(open('$J/exam3.json'))['exam']['id'])")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM3 -H 'Content-Type: application/json' -d '{"action":"start"}' -o $J/run3.json
NUM3=$(python3 -c "
import json
for q in json.load(open('$J/run3.json'))['questions']:
    if q['type']=='NUM': print(q['id']); break")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM3 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"answer\",\"questionId\":\"$NUM3\",\"answer\":\"6\"}"
echo "   waiting 70s for expiry..."
sleep 70
curl -s -b $J/stu.jar $BASE/api/portal/exams/$EXAM3 -o $J/after3.json
ck "LIVE server auto-submitted after expiry" "result" "$(python3 -c "import json; print(json.load(open('$J/after3.json'))['phase'])")"
ck "LIVE auto-submitted score=3" "3" "$(python3 -c "import json; print(json.load(open('$J/after3.json'))['score'])")"
ck "LIVE status AUTO_SUBMITTED" "AUTO_SUBMITTED" "$(python3 -c "import json; print(json.load(open('$J/after3.json'))['status'])")"

echo "========== 6L) ASSIGNMENTS LIVE =========="
curl -s -b $J/mgr.jar -X POST $BASE/api/assignments -H 'Content-Type: application/json' -o $J/asg1.json -d "{
  \"groupId\":\"$GROUP\",\"title\":\"واجب LIVE E2E\",\"deadline\":\"$DEADLINE\",\"publish\":true,
  \"questions\":[
    {\"text\":\"وحدة الحرارة؟\",\"type\":\"MCQ\",\"points\":2,\"options\":[\"جول\",\"نيوتن\"],\"correctAnswer\":\"0\"},
    {\"text\":\"الحرارة بتنتقل من الساخن للبارد\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"}
  ]}"
ASG1=$(python3 -c "import json; print(json.load(open('$J/asg1.json'))['assignment']['id'])")
curl -s -b $J/stu.jar $BASE/api/portal/assignments/$ASG1 -o $J/asg1_open.json
ck "LIVE assignment open" "open" "$(python3 -c "import json; print(json.load(open('$J/asg1_open.json'))['phase'])")"
AMCQ=$(python3 -c "
import json
for q in json.load(open('$J/asg1_open.json'))['questions']:
    if q['type']=='MCQ': print(q['id']); break")
ATF=$(python3 -c "
import json
for q in json.load(open('$J/asg1_open.json'))['questions']:
    if q['type']=='TRUE_FALSE': print(q['id']); break")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/assignments/$ASG1 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"save\",\"answers\":[{\"questionId\":\"$AMCQ\",\"answer\":\"0\"}]}"
curl -s -b $J/stu.jar $BASE/api/portal/assignments/$ASG1 -o $J/asg1_resume.json
ck "LIVE draft restored (leave/return)" "1" "$(python3 -c "
import json; d=json.load(open('$J/asg1_resume.json'))
print(len(d.get('answers',[])))")"
curl -s -b $J/stu.jar -X POST $BASE/api/portal/assignments/$ASG1 -H 'Content-Type: application/json' -o $J/asg1_sub.json -d "{\"action\":\"submit\",\"answers\":[{\"questionId\":\"$AMCQ\",\"answer\":\"0\"},{\"questionId\":\"$ATF\",\"answer\":\"true\"}]}"
ck "LIVE assignment graded" "3" "$(python3 -c "import json; print(json.load(open('$J/asg1_sub.json'))['score'])")"
# واجب فات ميعاده → 410
curl -s -b $J/mgr.jar -X POST $BASE/api/assignments -H 'Content-Type: application/json' -o /dev/null -d "{
  \"groupId\":\"$GROUP\",\"title\":\"واجب LIVE late test\",\"deadline\":\"$PAST_DEADLINE\",\"publish\":true,
  \"questions\":[{\"text\":\"س؟\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"}]}"
ASG_OLD=$(curl -s -b $J/mgr.jar $BASE/api/assignments -o $J/asgs.json; python3 -c "
import json
for a in json.load(open('$J/asgs.json'))['assignments']:
    if a['title']=='واجب LIVE late test': print(a['id']); break")
LATE=$(curl -s -b $J/stu.jar -X POST $BASE/api/portal/assignments/$ASG_OLD -H 'Content-Type: application/json' -d '{"action":"submit","answers":[]}' -o /dev/null -w '%{http_code}')
ck "LIVE late submission rejected (410)" "410" "$LATE"

echo "========== 7L) DYNAMIC QR LIVE =========="
curl -s -b $J/mgr.jar -X POST $BASE/api/attendance/session-qr -H 'Content-Type: application/json' -d "{\"sessionId\":\"$SESS\",\"rotateSeconds\":12}" -o $J/qr1.json
ck "LIVE QR issued (12s rotation)" "12" "$(python3 -c "import json; print(json.load(open('$J/qr1.json')).get('rotateSeconds'))")"
TOKEN1=$(python3 -c "import json; print(json.load(open('$J/qr1.json'))['token'])")
curl -s -b $J/stu.jar -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN1\"}" -o $J/claim1.json
ck "LIVE QR claim success (trusted device, no login)" "True" "$(python3 -c "import json; print(json.load(open('$J/claim1.json')).get('ok'))")"
ck "LIVE charged like normal attendance" "5000" "$(python3 -c "import json; print(json.load(open('$J/claim1.json')).get('charged'))")"
curl -s -b $J/stu.jar -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN1\"}" -o $J/claim2.json
ck "LIVE duplicate attendance blocked" "True" "$(python3 -c "import json; print(json.load(open('$J/claim2.json')).get('alreadyAttended'))")"
curl -s -b $J/mgr.jar -X POST $BASE/api/attendance/session-qr -H 'Content-Type: application/json' -d "{\"sessionId\":\"$SESS\",\"rotateSeconds\":12}" -o $J/qr2.json
REPLAY=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN1\"}")
ck "LIVE rotated-out token rejected (410)" "410" "$REPLAY"
curl -s -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$(python3 -c "import json; print(json.load(open('$J/qr2.json'))['token'])")\"}" -o $J/claim3.json
ck "LIVE anonymous claim → NEED_ACTIVATE" "NEED_ACTIVATE" "$(python3 -c "import json; print(json.load(open('$J/claim3.json')).get('reason'))")"

echo ""
echo "========== LIVE-REST RESULTS: $PASS PASS / $FAIL FAIL =========="
