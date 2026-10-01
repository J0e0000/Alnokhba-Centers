#!/bin/bash
# SEC-1 regression — permission model changes (run against local standalone)
BASE=${BASE:-http://localhost:3111}
J=/tmp/nk-sec; rm -rf $J; mkdir -p $J
PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected=$2 got=$3)"; fi }

# 1) manager login
curl -s -c $J/mgr.jar -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"manager","password":"nokhba123"}' -o /dev/null
ck "manager accounting GET 200 (money reports)" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/mgr.jar $BASE/api/accounting)"
ck "manager audit GET 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/mgr.jar $BASE/api/audit)"
ck "manager sees teacher loginCode" "True" "$(curl -s -b $J/mgr.jar $BASE/api/academics | python3 -c 'import json,sys; d=json.load(sys.stdin); print("loginCode" in (d.get("teachers") or [{}])[0])' 2>/dev/null)"

# 2) create TEACHER staff account
TS=$(date +%s)
curl -s -b $J/mgr.jar -X POST $BASE/api/staff -H 'Content-Type: application/json' -d "{\"name\":\"مدرس أمن $TS\",\"username\":\"secteacher$TS\",\"password\":\"teacher123\",\"role\":\"TEACHER\"}" -o $J/staff.json
TID=$(python3 -c "import json; print(json.load(open('$J/staff.json'))['staff']['id'])" 2>/dev/null)

# 3) teacher login (through session) — must NOT resolve as receptionist
curl -s -c $J/tea.jar -X POST $BASE/api/auth -H 'Content-Type: application/json' -d "{\"username\":\"secteacher$TS\",\"password\":\"teacher123\"}" -o /dev/null
ROLE=$(curl -s -b $J/tea.jar $BASE/api/auth | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['role'])" 2>/dev/null)
ck "teacher session role stays TEACHER (no coercion)" "TEACHER" "$ROLE"

# 4) teacher CANNOT record payment (was the V-5 hole)
S=$(curl -s -b $J/mgr.jar "$BASE/api/students?take=1" | python3 -c "import json,sys; print(json.load(sys.stdin)['students'][0]['id'])" 2>/dev/null)
ck "teacher payment POST → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar -X POST $BASE/api/payments -H 'Content-Type: application/json' -d "{\"studentId\":\"$S\",\"amount\":50,\"method\":\"CASH\",\"type\":\"PAYMENT\"}")"
ck "teacher accounting GET → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar $BASE/api/accounting)"
ck "teacher audit GET → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar $BASE/api/audit)"
ck "teacher attendance PATCH → 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar -X PATCH $BASE/api/attendance/mark -H 'Content-Type: application/json' -d '{"attendanceId":"x","status":"EXCUSED"}')"
ck "teacher does NOT see loginCode" "False" "$(curl -s -b $J/tea.jar $BASE/api/academics | python3 -c 'import json,sys; d=json.load(sys.stdin); print("loginCode" in (d.get("teachers") or [{}])[0])' 2>/dev/null)"
ck "teacher exams GET still 200 (their job)" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar $BASE/api/exams)"
ck "teacher staff POST still 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/tea.jar -X POST $BASE/api/staff -H 'Content-Type: application/json' -d '{"name":"x y z","username":"zzz'$TS'","password":"123456"}')"

# 5) receptionist CAN still record payment (core workflow preserved)
curl -s -c $J/rec.jar -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"reception","password":"nokhba123"}' -o /dev/null
RROLE=$(curl -s -b $J/rec.jar $BASE/api/auth | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['role'])" 2>/dev/null)
ck "receptionist role intact" "RECEPTIONIST" "$RROLE"
AMT=$(curl -s -b $J/rec.jar "$BASE/api/students?take=1" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d['students'][0]; print(str(s.get('balanceDue', 0)))" 2>/dev/null)
ck "receptionist payment POST → 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/rec.jar -X POST $BASE/api/payments -H 'Content-Type: application/json' -d "{\"studentId\":\"$S\",\"amount\":5,\"method\":\"CASH\",\"type\":\"PAYMENT\"}")"

# 6) unauthenticated hits
ck "unauth payments → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/payments -H 'Content-Type: application/json' -d '{}')"
ck "headers: X-Frame-Options DENY" "DENY" "$(curl -sI $BASE/login | grep -i x-frame-options | awk '{print $2}' | tr -d '\r')"
ck "headers: CSP present" "1" "$(curl -sI $BASE/login | grep -ci content-security-policy)"

echo "=============================="
echo "SEC-1 RESULT: PASS=$PASS FAIL=$FAIL"
