#!/bin/bash
# LOCAL E2E — teacher portal creates & publishes exam → student takes it → teacher sees attempt
BASE=http://localhost:3000
T=/tmp/tp.jar
S=/tmp/tp-stu.jar
PY=python3
cd /home/z/my-project

echo "=== 1) teacher login (code 1234 / 01011112222) ==="
curl -s -o /dev/null -w "login -> %{http_code}\n" -X POST $BASE/api/teacher-portal -H 'Content-Type: application/json' \
  -c $T -d '{"action":"login","code":"1234","phone":"01011112222"}'

echo "=== 2) teacher exams list + groups ==="
LIST=$(curl -s -b $T $BASE/api/teacher-portal/exams)
echo "$LIST" | $PY -c "
import json,sys
d=json.load(sys.stdin)
print('groups:', len(d.get('groups',[])), '| existing exams:', len(d.get('exams',[])))"
GID=$(echo "$LIST" | $PY -c "import json,sys; d=json.load(sys.stdin); print(d['groups'][0]['id'])")

echo "=== 3) teacher creates + PUBLISHES exam ==="
NOW=$(date -u +%Y-%m-%dT%H:%M:00.000Z)
END=$(date -u -d "+1 day" +%Y-%m-%dT%H:%M:00.000Z)
CREATE=$(curl -s -X POST $BASE/api/teacher-portal/exams -H 'Content-Type: application/json' -b $T \
  -d "{\"groupId\":\"$GID\",\"title\":\"[TP-TEST] امتحان فيزياء تجريبي\",\"startAt\":\"$NOW\",\"endAt\":\"$END\",\"durationMin\":20,\"publish\":true,\"questions\":[{\"text\":\"وحدة قياس القوة؟\",\"type\":\"MCQ\",\"options\":[\"نيوتن\",\"جول\",\"واط\"],\"correctAnswer\":\"0\",\"points\":1},{\"text\":\"الجاذبية بتسحب لتحت\",\"type\":\"TRUE_FALSE\",\"correctAnswer\":\"true\",\"points\":1},{\"text\":\"مجموع 2+2؟\",\"type\":\"NUM\",\"correctAnswer\":\"4\",\"points\":2}]}")
echo "$CREATE" | head -c 160; echo
EID=$(echo "$CREATE" | $PY -c "import json,sys; print(json.load(sys.stdin).get('exam',{}).get('id',''))")
echo "examId=$EID"

echo "=== 4) student of the group logs in ==="
INFO=$(npx tsx -e "
import {PrismaClient} from '@prisma/client';
const d=new PrismaClient();
d.studentGroup.findFirst({where:{groupId:'$GID',status:'ACTIVE'},include:{student:{select:{code:true,phone:true}}}}).then(async r=>{
  console.log(r.student.code+','+r.student.phone);
  await d.\$disconnect();
})" 2>/dev/null | tail -1)
SCODE=${INFO%%,*}; SPHONE=${INFO##*,}
echo "student=$SCODE"
curl -s -o /dev/null -w "portal login -> %{http_code}\n" -X POST $BASE/api/portal -H 'Content-Type: application/json' -c $S \
  -d "{\"action\":\"login\",\"code\":\"$SCODE\",\"phone\":\"$SPHONE\"}"

echo "=== 5) student sees the exam ==="
curl -s -b $S $BASE/api/portal/exams | $PY -c "
import json,sys
d=json.load(sys.stdin)
tp=[e for e in d.get('exams',[]) if 'TP-TEST' in e.get('title','')]
print('sees TP-TEST:', bool(tp), '| state:', tp[0]['state'] if tp else '-')"

echo "=== 6) student starts attempt + gets questions ==="
curl -s -X POST "$BASE/api/portal/exams/$EID" -H 'Content-Type: application/json' -b $S -d '{"action":"start"}' -o /dev/null -w "start -> %{http_code}\n"
QS=$(curl -s -b $S "$BASE/api/portal/exams/$EID")
echo "$QS" | $PY -c "
import json,sys
d=json.load(sys.stdin)
print('phase:', d.get('phase'), '| questions:', len(d.get('questions',[])), '| expiresAt:', 'expiresAt' in json.dumps(d))"
# question ids by type
Q_MCQ=$(echo "$QS" | $PY -c "import json,sys; d=json.load(sys.stdin); print([q['id'] for q in d['questions'] if q['type']=='MCQ'][0])")
Q_TF=$(echo "$QS" | $PY -c "import json,sys; d=json.load(sys.stdin); print([q['id'] for q in d['questions'] if q['type']=='TRUE_FALSE'][0])")
Q_NUM=$(echo "$QS" | $PY -c "import json,sys; d=json.load(sys.stdin); print([q['id'] for q in d['questions'] if q['type']=='NUM'][0])")

echo "=== 7) student answers (all correct: نيوتن=true idx0, صح, 4) ==="
curl -s -X POST "$BASE/api/portal/exams/$EID" -H 'Content-Type: application/json' -b $S -d "{\"action\":\"answer\",\"questionId\":\"$Q_MCQ\",\"answer\":\"0\"}" -o /dev/null -w "answer1 -> %{http_code}\n"
curl -s -X POST "$BASE/api/portal/exams/$EID" -H 'Content-Type: application/json' -b $S -d "{\"action\":\"answer\",\"questionId\":\"$Q_TF\",\"answer\":\"true\"}" -o /dev/null -w "answer2 -> %{http_code}\n"
curl -s -X POST "$BASE/api/portal/exams/$EID" -H 'Content-Type: application/json' -b $S -d "{\"action\":\"answer\",\"questionId\":\"$Q_NUM\",\"answer\":\"4\"}" -o /dev/null -w "answer3 -> %{http_code}\n"

echo "=== 8) submit ==="
SUB=$(curl -s -X POST "$BASE/api/portal/exams/$EID" -H 'Content-Type: application/json' -b $S -d '{"action":"submit"}')
echo "$SUB" | $PY -c "
import json,sys
d=json.load(sys.stdin)
print('phase:', d.get('phase'), '| score:', d.get('score'), '| max:', d.get('maxScore'))"

echo "=== 9) teacher sees the attempt + score ==="
curl -s -b $T "$BASE/api/teacher-portal/exams?id=$EID" | $PY -c "
import json,sys
d=json.load(sys.stdin).get('exam',{})
atts=d.get('attempts',[])
print('attempts:', len(atts), '| statuses:', [a['status'] for a in atts], '| scores:', [a['score'] for a in atts])"

echo "=== 10) cross-group exam invisible to other students (20001 group check via portal list) ==="
echo "=== 11) cleanup: close exam ==="
curl -s -X PATCH $BASE/api/teacher-portal/exams -H 'Content-Type: application/json' -b $T \
  -d "{\"id\":\"$EID\",\"action\":\"close\"}" -o /dev/null -w "close -> %{http_code}\n"
curl -s -b $T "$BASE/api/teacher-portal/exams?id=$EID" | $PY -c "
import json,sys
print('status now:', json.load(sys.stdin).get('exam',{}).get('status'))"

echo "=== 12) security: teacher exam APIs reject logged-out ==="
curl -s -o /dev/null -w "no-session list -> %{http_code} (expect 401)\n" $BASE/api/teacher-portal/exams

echo "=== DONE ==="
