#!/bin/bash
# TEACHER ROLE LIVE E2E — production https://alnokhba-centers.vercel.app
BASE=https://alnokhba-centers.vercel.app
J=/tmp/t1.jar; M=/tmp/mgr.jar

echo "=== 1) manager login ==="
curl -s -o /dev/null -w "manager -> %{http_code}\n" -X POST $BASE/api/auth -H 'Content-Type: application/json' \
  -d '{"username":"manager","password":"nokhba123"}' -c $M

echo "=== 2) create TEACHER account (teacher1) ==="
R=$(curl -s -X POST $BASE/api/staff -H 'Content-Type: application/json' -b $M \
  -d '{"name":"أ. محمد حسن — مدرس","username":"teacher1","password":"nokhba123","role":"TEACHER"}')
echo "$R" | head -c 300; echo

echo "=== 3) teacher1 login ==="
curl -s -o /dev/null -w "teacher1 -> %{http_code}\n" -X POST $BASE/api/auth -H 'Content-Type: application/json' \
  -d '{"username":"teacher1","password":"nokhba123"}' -c $J

echo "=== 4) teacher1 CAN read exams list ==="
curl -s -o /dev/null -w "GET /api/exams -> %{http_code}\n" -b $J $BASE/api/exams

echo "=== 5) teacher1 CAN read academics (groups for exam form) ==="
curl -s -o /dev/null -w "GET /api/academics -> %{http_code}\n" -b $J $BASE/api/academics

echo "=== 6) teacher1 DENIED money/staff APIs ==="
curl -s -o /dev/null -w "GET /api/dashboard -> %{http_code} (expect 200 but money KPIs hidden in UI; RBAC allows center user)\n" -b $J $BASE/api/dashboard
curl -s -o /dev/null -w "GET /api/staff -> %{http_code} (expect 403)\n" -b $J $BASE/api/staff
curl -s -X POST $BASE/api/payments -H 'Content-Type: application/json' -b $J -d '{}' -o /dev/null -w "POST /api/payments -> %{http_code} (expect 4xx)\n"

echo "=== 7) teacher1 creates a DRAFT exam (invisible to students) ==="
# fetch a real groupId from academics
GID=$(curl -s -b $J $BASE/api/academics | python3 -c "import json,sys; d=json.load(sys.stdin); gs=d.get('groups') or d.get('academics',{}).get('groups') or []; print(gs[0]['id'] if gs else '')")
echo "groupId=$GID"
if [ -n "$GID" ]; then
  NOW=$(date -u +%Y-%m-%dT%H:%M:00.000Z)
  END=$(date -u -d "+2 days" +%Y-%m-%dT%H:%M:00.000Z)
  CREATE=$(curl -s -X POST $BASE/api/exams -H 'Content-Type: application/json' -b $J \
    -d "{\"groupId\":\"$GID\",\"title\":\"[TEST] امتحان تجريبي — هيتمسح\",\"startAt\":\"$NOW\",\"endAt\":\"$END\",\"durationMin\":30,\"publish\":false,\"questions\":[{\"text\":\"عاصمة مصر؟\",\"type\":\"MCQ\",\"options\":[\"القاهرة\",\"اسوان\"],\"correctAnswer\":\"0\",\"points\":1}]}")
  echo "$CREATE" | head -c 200; echo
  EID=$(echo "$CREATE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('exam',{}).get('id',''))" 2>/dev/null)
  echo "examId=$EID"

  echo "=== 8) verify DRAFT not visible to students ==="
  P=/tmp/stu.jar
  curl -s -o /dev/null -X POST $BASE/api/portal -H 'Content-Type: application/json' -c $P -d '{"action":"login","code":"10001","phone":"01055551111"}'
  curl -s -b $P $BASE/api/portal/exams | python3 -c "
import json,sys
d=json.load(sys.stdin)
exams=d.get('exams',[])
test=[e for e in exams if '[TEST]' in e.get('title','')]
print('student sees TEST exam:', bool(test), '| total exams visible:', len(exams))"

  echo "=== 9) cleanup: delete DRAFT exam ==="
  curl -s -X DELETE $BASE/api/exams/$EID -b $J -o /dev/null -w "DELETE draft -> %{http_code} (expect 200)\n"
fi

echo "=== 10) student portal exams API healthy ==="
curl -s -o /dev/null -w "GET /api/portal/exams -> %{http_code}\n" -b /tmp/stu.jar $BASE/api/portal/exams

echo "=== DONE ==="
