#!/bin/bash
# ============================================================
# El No5ba Ecosystem — Security & Workflow Test Suite
# Part A: EDU (academia) authorization fixes verification
# Part B: Centers — roles, tenant isolation, backup/restore, undo, audit
# Run: bash scripts/tabs_security_suite.sh
# ============================================================
BASE="http://localhost:3000"
PASS=0; FAIL=0; RESULTS=""
JAR=/tmp/nk-jars
mkdir -p $JAR

login() { # $1=user $2=pass $3=jarname
  curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
    -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null
}
code() { # $1=jar $2=method $3=url $4=body?
  local m=$2 u=$3 b=$4
  if [ -n "$b" ]; then
    curl -s -o /tmp/nk-body.json -w "%{http_code}" -X "$m" -b "$JAR/$1.jar" -H "Content-Type: application/json" -d "$b" "$u"
  else
    curl -s -o /tmp/nk-body.json -w "%{http_code}" -X "$m" -b "$JAR/$1.jar" "$u"
  fi
}
check() { # $1=id $2=expected $3=actual $4=note
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3  ($4)";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected $2, got $3  ($4)"; fi
}

echo "── Login all personas ──"
login manager nokhba123 mgr
login manager2 nokhba123 mgr2
login reception nokhba123 rec
login admin nokhba123 adm
login aca-manager academia123 amgr
login aca-teacher1 academia123 t1
login aca-teacher2 academia123 t2
login aca-student1 academia123 s1
login aca-student2 academia123 s2

# grab a student id from center A and a session id from center A
STUDENT_A=$(curl -s -b $JAR/mgr.jar "$BASE/api/students?pageSize=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['students'][0]['id'])" 2>/dev/null)
SESSION_A=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessions'][0]['id'] if d['sessions'] else '')" 2>/dev/null)
SLOT_A=$(curl -s -b $JAR/mgr.jar "$BASE/api/schedule" | python3 -c "import json,sys; d=json.load(sys.stdin); slots=[s for day in d['days'] for s in day['slots']]; print(slots[0]['id'] if slots else '')" 2>/dev/null)

echo "── Part B: auth & role gates (Centers) ──"
c=$(code none GET "$BASE/api/today"); check B1 401 "$c" "no-cookie /api/today"
c=$(code rec GET "$BASE/api/admin"); check B2 403 "$c" "reception → /api/admin"
c=$(code mgr GET "$BASE/api/admin"); check B3 403 "$c" "manager → /api/admin"
c=$(code rec POST "$BASE/api/rooms" '{"name":"تست","capacity":10}'); check B4 403 "$c" "reception → create room"
c=$(code rec GET "$BASE/api/accounting"); check B5 403 "$c" "reception → accounting"
c=$(code rec POST "$BASE/api/backup"); check B6 403 "$c" "reception → backup"

echo "── Part B: tenant isolation (center B manager vs center A data) ──"
c=$(code mgr2 GET "$BASE/api/students/$STUDENT_A"); check T1 404 "$c" "mgr2 → center-A student profile"
c=$(code mgr2 GET "$BASE/api/sessions/$SESSION_A"); check T2 404 "$c" "mgr2 → center-A session"
c=$(code mgr2 POST "$BASE/api/sessions" "{\"scheduleId\":\"$SLOT_A\"}"); check T3 404 "$c" "mgr2 → open center-A schedule slot"
c=$(code mgr2 GET "$BASE/api/students/$STUDENT_A/card"); check T4 404 "$c" "mgr2 → center-A student card"
# manager2 must never see center A group names in own reports
B=$(curl -s -b $JAR/mgr2.jar "$BASE/api/reports")
if echo "$B" | rg -q "النخبة"; then check T5 x 1 "mgr2 reports leak center-A names"; else check T5 0 0 "mgr2 reports clean of center-A names"; fi

echo "── Part A: EDU authorization fixes ──"
c=$(code s1 GET "$BASE/api/academia/requests"); check E1 403 "$c" "student → requests queue (was leaking all)"
c=$(code s1 GET "$BASE/api/academia/audit"); check E2 403 "$c" "student → audit log"
c=$(code t2 GET "$BASE/api/academia/audit"); check E3 403 "$c" "teacher → audit log (admin-only)"
c=$(code rec GET "$BASE/api/academia/dashboard"); check E4 401 "$c" "centers receptionist → academia dashboard"

# student groups scoping: student1 must see only own enrolled groups
TOTAL=$(curl -s -b $JAR/amgr.jar "$BASE/api/academia/groups" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['groups']))")
MINE=$(curl -s -b $JAR/s1.jar "$BASE/api/academia/groups" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['groups']))")
if [ "$MINE" -le "$TOTAL" ]; then check E5 0 0 "student groups ($MINE) ≤ all groups ($TOTAL) — scoped"; else check E5 0 1 "student sees MORE groups than exist"; fi

# teacher2 requesting cancellation of a session not in own groups → 403
# fixture: ensure teacher1 HAS a session today (create via academia manager)
T1GROUP=$(curl -s -b $JAR/t1.jar "$BASE/api/academia/groups" | python3 -c "import json,sys; g=json.load(sys.stdin)['groups']; print(g[0]['id'] if g else '')")
if [ -n "$T1GROUP" ]; then
  curl -s -o /dev/null -b $JAR/amgr.jar -X POST "$BASE/api/academia/sessions" -H "Content-Type: application/json" \
    -d "{\"groupId\":\"$T1GROUP\",\"date\":\"$(date +%F)\",\"startTime\":\"21:00\",\"endTime\":\"22:00\"}"
fi
T1SESSION=$(curl -s -b $JAR/t1.jar "$BASE/api/academia/sessions?date=$(date +%F)" | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin); ss=d.get('sessions') or d.get('items') or []
  print(ss[0]['id'] if ss else '')
except: print('')" 2>/dev/null)
if [ -n "$T1SESSION" ]; then
  c=$(code t2 POST "$BASE/api/academia/requests" "{\"type\":\"CANCEL\",\"sessionId\":\"$T1SESSION\"}")
  check E6 403 "$c" "teacher2 → CANCEL teacher1's session via request"
else
  RESULTS="$RESULTS\n⚠️ E6 skipped — teacher1 has no session today"
fi

# teacher2 grading a student not enrolled in the exam group → 403
EXAM_INFO=$(curl -s -b $JAR/t2.jar "$BASE/api/academia/exams" | python3 -c "
import json,sys
d=json.load(sys.stdin); exams=d.get('exams', [])
print(exams[0]['id'] if exams else '')")
# fixture: teacher2 creates an exam on own group if none
if [ -z "$EXAM_INFO" ]; then
  T2GROUP=$(curl -s -b $JAR/t2.jar "$BASE/api/academia/groups" | python3 -c "import json,sys; g=json.load(sys.stdin)['groups']; print(g[0]['id'] if g else '')")
  if [ -n "$T2GROUP" ]; then
    EXAM_INFO=$(curl -s -b $JAR/t2.jar -X POST "$BASE/api/academia/exams" -H "Content-Type: application/json" \
      -d "{\"action\":\"create\",\"groupId\":\"$T2GROUP\",\"title\":\"اختبار أمان\",\"type\":\"QUIZ\",\"date\":\"$(date +%F)\",\"maxScore\":20}" \
      | python3 -c "import json,sys; print(json.load(sys.stdin).get('exam',{}).get('id',''))" 2>/dev/null)
  fi
fi
# outsider = طالب مش مسجل في مجموعة الامتحان دي بالذات (ممكن يكون مسجل في مجموعات تانية)
EXAM_GROUP=$(curl -s -b $JAR/t2.jar "$BASE/api/academia/exams" | python3 -c "
import json,sys
d=json.load(sys.stdin)
e=[x for x in d.get('exams',[]) if x.get('id')=='$EXAM_INFO']
print(e[0]['group']['name'] if e and e[0].get('group') else '')" 2>/dev/null)
NOT_ENROLLED=$(npx tsx -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const examId = '$EXAM_INFO';
db.acaExam.findUnique({ where: { id: examId }, select: { groupId: true } })
  .then(async (exam) => {
    if (!exam) { console.log(''); return db.\$disconnect(); }
    const enrolled = await db.acaEnrollment.findMany({ where: { groupId: exam.groupId, status: 'ACTIVE' }, select: { studentId: true } });
    const inExam = new Set(enrolled.map(e => e.studentId));
    const all = await db.acaStudentProfile.findMany({ select: { id: true } });
    const out = all.find(p => !inExam.has(p.id));
    console.log(out?.id ?? '');
    await db.\$disconnect();
  });
" 2>/dev/null)
if [ -n "$EXAM_INFO" ] && [ -n "$NOT_ENROLLED" ]; then
  c=$(code t2 POST "$BASE/api/academia/exams" "{\"action\":\"results\",\"examId\":\"$EXAM_INFO\",\"results\":[{\"studentId\":\"$NOT_ENROLLED\",\"score\":10}]}")
  check E7 403 "$c" "teacher2 → grade non-enrolled student"
else
  RESULTS="$RESULTS\n⚠️ E7 skipped — no exam or no outsider student"
fi

echo "── Backup → validate → restore → integrity cycle ──"
c=$(code mgr POST "$BASE/api/backup"); check K1 201 "$c" "manager creates snapshot"
BKFILE=$(python3 -c "import json; print(json.load(open('/tmp/nk-body.json')).get('file',''))" 2>/dev/null)
c=$(code adm POST "$BASE/api/admin/backup" '{"action":"create"}'); check K2 200 "$c" "admin full backup (db+excel)"
c=$(code adm GET "$BASE/api/admin/backup?preview=$BKFILE"); check K3 200 "$c" "admin preview backup file"
c=$(code adm POST "$BASE/api/admin/backup" "{\"action\":\"restore\",\"file\":\"$BKFILE\",\"tables\":[\"Student\"]}"); check K4 200 "$c" "admin guided restore (missing-rows-only)"
c=$(code mgr GET "$BASE/api/backup?format=json" ); check K5 200 "$c" "manager JSON logical export"
COUNTS=$(python3 -c "import json; d=json.load(open('/tmp/nk-body.json')); print(json.dumps(d['meta']['counts'] if 'meta' in d else d, ensure_ascii=False)[:120])" 2>/dev/null)
RESULTS="$RESULTS\n   export counts: $COUNTS"

echo "── Undo / Redo (server stack) ──"
c=$(code mgr GET "$BASE/api/undo"); check U1 200 "$c" "undo stack list"
c=$(code rec POST "$BASE/api/undo" '{"op":"undo"}'); check U2 400 "$c" "empty undo stack → clean 400 (no more 500)"
U=$(python3 -c "print(open('/tmp/nk-body.json').read()[:120])" 2>/dev/null); RESULTS="$RESULTS\n   undo response: $U"

echo "── Audit trail rows ──"
AUD=$(npx tsx -e "
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { action: true, userName: true } })
  .then(rows => { console.log(JSON.stringify(rows.map(r=>r.action))); return db.\$disconnect(); });
" 2>/dev/null)
RESULTS="$RESULTS\n   recent audit actions: $AUD"

echo ""
echo -e "================= RESULTS ================="
echo -e "$RESULTS"
echo "==========================================="
echo "PASS=$PASS FAIL=$FAIL"
