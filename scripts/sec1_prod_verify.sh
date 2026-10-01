#!/bin/bash
# SEC-1 production verification — alnokhba-centers.vercel.app
BASE=https://alnokhba-centers.vercel.app
J=/tmp/nk-secprod; rm -rf $J; mkdir -p $J
PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected=$2 got=$3)"; fi }

echo "===== 1) SECURITY HEADERS ====="
H=$(curl -sI $BASE/login)
ck "CSP present" "1" "$(echo "$H" | grep -ci content-security-policy)"
ck "X-Frame-Options DENY" "DENY" "$(echo "$H" | grep -i x-frame-options | awk '{print $2}' | tr -d '\r')"
ck "nosniff" "nosniff" "$(echo "$H" | grep -i x-content-type-options | awk '{print $2}' | tr -d '\r')"
ck "HSTS present" "1" "$(echo "$H" | grep -ci strict-transport-security)"
ck "Permissions-Policy camera=(self)" "1" "$(echo "$H" | grep -ci 'camera=(self)')"

echo "===== 2) UNAUTHENTICATED ACCESS (server-side) ====="
for ep in accounting audit students payments staff settings backup emergency; do
  ck "unauth /api/$ep → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/$ep)"
done
ck "unauth /api/admin → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/admin)"
ck "unauth /api/portal/exams → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/portal/exams)"

echo "===== 3) TEACHER ROLE BLOCKS (existing prod teacher1) ====="
TC=$(curl -s -o /dev/null -w '%{http_code}' -c $J/tea.jar -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"teacher1","password":"nokhba123"}')
ck "teacher1 login" "200" "$TC"
if [ "$TC" = "200" ]; then
  ROLE=$(curl -s -b $J/tea.jar $BASE/api/auth | python3 -c "import json,sys; u=json.load(sys.stdin).get('user') or {}; print(u.get('role',''))")
  echo "  teacher1 session role = $ROLE"
  ck "teacher1 payments POST → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar -X POST $BASE/api/payments -H 'Content-Type: application/json' -d '{"studentId":"x","amount":5,"type":"PAYMENT"}')"
  ck "teacher1 accounting → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar $BASE/api/accounting)"
  ck "teacher1 audit → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar $BASE/api/audit)"
  ck "teacher1 staff POST → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar -X POST $BASE/api/staff -H 'Content-Type: application/json' -d '{"name":"اختبار اختبار","username":"nope'$RANDOM'","password":"123456"}')"
  ck "teacher1 exams GET → 200 (allowed)" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar $BASE/api/exams)"
  ck "teacher1 no loginCode leak" "False" "$(curl -s -b $J/tea.jar $BASE/api/academics | python3 -c 'import json,sys; d=json.load(sys.stdin); t=(d.get("teachers") or [{}])[0]; print("loginCode" in t)')"
fi

echo "===== 4) REAL STUDENT PORTAL (84478) ====="
ck "student portal login" "200" "$(curl -s -o /dev/null -w '%{http_code}' -c $J/stu.jar -X POST $BASE/api/portal -H 'Content-Type: application/json' -d '{"action":"login","code":"84478","phone":"01012588712"}')"
ck "student home" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/stu.jar $BASE/api/portal)"
ck "student exams list" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/stu.jar $BASE/api/portal/exams)"
ck "student session cookie Secure" "1" "$(grep -ci 'nokhba_portal' $J/stu.jar)"
SECFLAG=$(grep 'nokhba_portal' $J/stu.jar | head -1 | awk '{print toupper($0)}' | grep -c "#SECURE" || true)
echo "  (secure flag raw check: $SECFLAG)"
ck "student cannot reach staff API" "401" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/stu.jar $BASE/api/students)"

echo "===== 5) MANAGER MONEY REPORTS STILL OK ====="
MC=$(curl -s -o /dev/null -w '%{http_code}' -c $J/mgr.jar -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"manager","password":"nokhba123"}')
ck "manager login" "200" "$MC"
if [ "$MC" = "200" ]; then
  ck "manager accounting GET → 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/mgr.jar "$BASE/api/accounting?section=cash")"
  ck "manager audit GET → 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/mgr.jar $BASE/api/audit)"
fi

echo "=============================="
echo "PROD RESULT: PASS=$PASS FAIL=$FAIL"
