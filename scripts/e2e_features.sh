#!/bin/bash
# E2E — الامتحانات + الواجبات + QR الحضور (spec phases 1/2/3/5)
BASE=${BASE:-http://localhost:3000}
J=${E2E_DIR:-/tmp/nk-e2e}; mkdir -p $J
PASS=0; FAIL=0
curl() { command curl --max-time 30 "$@"; }
ck() { # ck <name> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1"; else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected=$2 got=$3)"; fi
}
jqv() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$2" 2>/dev/null; }

echo "========== 1) STAFF: LOGIN + EXAM CREATION =========="
curl -s -c $J/mgr.jar -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"manager","password":"nokhba123"}' -o $J/mgr.json
ck "manager login" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/mgr.jar $BASE/api/exams)"

NOW=$(python3 -c "from datetime import datetime,timedelta,timezone; print(datetime.now(timezone.utc).isoformat())")
START=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat())")
END=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=2)).isoformat())")
PAST_END=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(hours=1)).isoformat())")
PAST_START=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(hours=3)).isoformat())")
DEADLINE=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=5)).isoformat())")
PAST_DEADLINE=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(minutes=30)).isoformat())")
GROUP=cmufickak001eiqo9tkb8o3hc  # فيزياء — الطالب 10001 مسجل فيها

# امتحان عادي (WARNING): MCQ + TF + NUM — الدرجة الكلية 2+1+2=5
curl -s -b $J/mgr.jar -X POST $BASE/api/exams -H 'Content-Type: application/json' -o $J/exam1.json -d "{
  \"groupId\":\"$GROUP\",\"title\":\"امتحان تجربة E2E — فيزياء\",\"instructions\":\"اقرأ كل سؤال كويس\",
  \"startAt\":\"$START\",\"endAt\":\"$END\",\"durationMin\":30,
  \"shuffleQuestions\":true,\"shuffleOptions\":true,\"securityMode\":\"WARNING\",\"publish\":true,
  \"questions\":[
    {\"text\":\"وحدة قياس القوة؟\",\"type\":\"MCQ\",\"points\":2,\"options\":[\"نيوتن\",\"جول\",\"واط\"],\"correctAnswer\":\"0\"},
    {\"text\":\"الجاذبية بتسقط الأجسام لتحت\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"},
    {\"text\":\"تسارع الجاذبية الأرضي (م/ث²)\",\"type\":\"NUM\",\"points\":2,\"correctAnswer\":\"9.8\"}
  ]}"
EXAM1=$(jqv x "$(<$J/exam1.json)" 2>/dev/null; python3 -c "import json; print(json.load(open('$J/exam1.json'))['exam']['id'])")
ck "exam1 created+published" "PUBLISHED" "$(python3 -c "import json; print(json.load(open('$J/exam1.json'))['exam']['status'])")"

# امتحان صارم (STRICT)
curl -s -b $J/mgr.jar -X POST $BASE/api/exams -H 'Content-Type: application/json' -o $J/exam2.json -d "{
  \"groupId\":\"$GROUP\",\"title\":\"امتحان صارم E2E\",\"startAt\":\"$START\",\"endAt\":\"$END\",\"durationMin\":30,
  \"securityMode\":\"STRICT\",\"publish\":true,
  \"questions\":[{\"text\":\"2+2؟\",\"type\":\"NUM\",\"points\":1,\"correctAnswer\":\"4\"}]}"
EXAM2=$(python3 -c "import json; print(json.load(open('$J/exam2.json'))['exam']['id'])")

# امتحان خلص وقته (MISSED) + امتحان لسه ما فتحش (NOT_YET)
curl -s -b $J/mgr.jar -X POST $BASE/api/exams -H 'Content-Type: application/json' -o /dev/null -d "{
  \"groupId\":\"$GROUP\",\"title\":\"امتحان قديم (missed)\",\"startAt\":\"$PAST_START\",\"endAt\":\"$PAST_END\",\"durationMin\":10,
  \"publish\":true,\"questions\":[{\"text\":\"س؟\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"}]}"
FUT_START=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=3)).isoformat())")
FUT_END=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=5)).isoformat())")
curl -s -b $J/mgr.jar -X POST $BASE/api/exams -H 'Content-Type: application/json' -o /dev/null -d "{
  \"groupId\":\"$GROUP\",\"title\":\"امتحان مستقبلي (notyet)\",\"startAt\":\"$FUT_START\",\"endAt\":\"$FUT_END\",\"durationMin\":10,
  \"publish\":true,\"questions\":[{\"text\":\"س؟\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"}]}"

# واجب مستقبلي + واجب فات ميعاده
curl -s -b $J/mgr.jar -X POST $BASE/api/assignments -H 'Content-Type: application/json' -o $J/asg1.json -d "{
  \"groupId\":\"$GROUP\",\"title\":\"واجب E2E — الترموديناميك\",\"deadline\":\"$DEADLINE\",\"publish\":true,
  \"questions\":[
    {\"text\":\"وحدة الحرارة؟\",\"type\":\"MCQ\",\"points\":2,\"options\":[\"جول\",\"نيوتن\"],\"correctAnswer\":\"0\"},
    {\"text\":\"الحرارة بتنتقل من الساخن للبارد\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"}
  ]}"
ASG1=$(python3 -c "import json; print(json.load(open('$J/asg1.json'))['assignment']['id'])")
ck "assignment created" "PUBLISHED" "$(python3 -c "import json; print(json.load(open('$J/asg1.json'))['assignment']['status'])")"
curl -s -b $J/mgr.jar -X POST $BASE/api/assignments -H 'Content-Type: application/json' -o /dev/null -d "{
  \"groupId\":\"$GROUP\",\"title\":\"واجب قديم (late test)\",\"deadline\":\"$PAST_DEADLINE\",\"publish\":false,
  \"questions\":[{\"text\":\"س؟\",\"type\":\"TRUE_FALSE\",\"points\":1,\"correctAnswer\":\"true\"}]}"
ASG_OLD=$(curl -s -b $J/mgr.jar $BASE/api/assignments -o $J/asgs.json; python3 -c "
import json
for a in json.load(open('$J/asgs.json'))['assignments']:
    if a['title']=='واجب قديم (late test)': print(a['id']); break")
# نشره عشان الطالب يشوفه ويتقفل عنده بالميعاد
curl -s -b $J/mgr.jar -X PATCH $BASE/api/assignments/$ASG_OLD -H 'Content-Type: application/json' -o /dev/null -d '{"action":"publish"}'

echo "========== 2) STUDENT: LOGIN + LIST + STATES =========="
curl -s -c $J/stu.jar -X POST $BASE/api/portal -H 'Content-Type: application/json' -d '{"action":"login","code":"10001","phone":"01055551111"}' -o $J/stu.json
ck "student portal login" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b $J/stu.jar $BASE/api/portal/exams)"
curl -s -b $J/stu.jar $BASE/api/portal/exams -o $J/exams_list.json
ck "exam AVAILABLE listed" "AVAILABLE" "$(python3 -c "
import json
for e in json.load(open('$J/exams_list.json'))['exams']:
    if e['id']=='$EXAM1': print(e['state']); break")"
ck "missed exam state" "MISSED" "$(python3 -c "
import json
for e in json.load(open('$J/exams_list.json'))['exams']:
    if e['title']=='امتحان قديم (missed)': print(e['state']); break")"
ck "notyet exam state" "NOT_YET" "$(python3 -c "
import json
for e in json.load(open('$J/exams_list.json'))['exams']:
    if e['title']=='امتحان مستقبلي (notyet)': print(e['state']); break")"

echo "========== 3) EXAM: START / ANSWER / REFRESH / SUBMIT =========="
# بداية المحاولة — لازم يرجع running بأسئلة من غير إجابات صحيحة
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -d '{"action":"start"}' -o $J/run1.json
ck "start → running" "running" "$(python3 -c "import json; print(json.load(open('$J/run1.json'))['phase'])")"
ck "no answer key leaked" "False" "$(python3 -c "
import json; d=json.load(open('$J/run1.json'))
print(any('correctAnswer' in q or 'correct' in q for q in d['questions']))")"
ATTEMPT1=$(python3 -c "import json; print(json.load(open('$J/run1.json'))['attemptId'])")
QCOUNT=$(python3 -c "import json; print(len(json.load(open('$J/run1.json'))['questions']))")
ck "3 questions delivered" "3" "$QCOUNT"
REMAINING=$(python3 -c "import json; d=json.load(open('$J/run1.json')); print(d['remainingMs']>0 and d['remainingMs']<=30*60*1000)")
ck "remainingMs server-authoritative window" "True" "$REMAINING"

# إجابات: الطالب بيختار بالنص اللي قدامه (الاختيارات متخلط لكل محاولة)
# MCQ: ندور على "نيوتن" في الاختيارات المعروضة — ده اللي بيثبت إن الـ shuffle mapping بيشتغل صح
MCQ_Q=$(python3 -c "
import json
for q in json.load(open('$J/run1.json'))['questions']:
    if q['type']=='MCQ': print(q['id']); break")
MCQ_IDX=$(python3 -c "
import json
for q in json.load(open('$J/run1.json'))['questions']:
    if q['type']=='MCQ': print(q['options'].index('نيوتن')); break")
TF_Q=$(python3 -c "
import json
for q in json.load(open('$J/run1.json'))['questions']:
    if q['type']=='TRUE_FALSE': print(q['id']); break")
NUM_Q=$(python3 -c "
import json
for q in json.load(open('$J/run1.json'))['questions']:
    if q['type']=='NUM': print(q['id']); break")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"answer\",\"questionId\":\"$MCQ_Q\",\"answer\":\"$MCQ_IDX\"}"
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"answer\",\"questionId\":\"$TF_Q\",\"answer\":\"true\"}"
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"answer\",\"questionId\":\"$NUM_Q\",\"answer\":\"٩٫٨\"}"  # أرقام عربية = 9.8

# محاولة تانية مرفوضة (duplicate start)
DUP=$(curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -d '{"action":"start"}' -o /dev/null -w '%{http_code}')
# duplicate start بيرجع running الحالي (مش 409) — لأنه نفس المحاولة resume
ck "duplicate start resumes (200)" "200" "$DUP"

# REFRESH — GET بيرجع running بنفس الأسئلة + الإجابات المحفوظة
curl -s -b $J/stu.jar $BASE/api/portal/exams/$EXAM1 -o $J/resume1.json
ck "refresh keeps running" "running" "$(python3 -c "import json; print(json.load(open('$J/resume1.json'))['phase'])")"
SAVEDCOUNT=$(python3 -c "import json; print(len(json.load(open('$J/resume1.json'))['answers']))")
ck "3 answers restored from server" "3" "$SAVEDCOUNT"
ck "same attempt after refresh" "$ATTEMPT1" "$(python3 -c "import json; print(json.load(open('$J/resume1.json'))['attemptId'])")"

# سؤال غبي: questionId غريب مرفوض
BADQ=$(curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -d '{"action":"answer","questionId":"fake","answer":"0"}' -o /dev/null -w '%{http_code}')
ck "invalid questionId rejected" "400" "$BADQ"

# تسليم يدوي — التصحيح سيرفر، NUM بالأرقام العربية لازم يتصحح صح
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -d '{"action":"submit"}' -o $J/sub1.json
ck "submitted phase" "result" "$(python3 -c "import json; print(json.load(open('$J/sub1.json'))['phase'])")"
ck "server-graded score=5 (incl arabic-num normalize)" "5" "$(python3 -c "import json; print(json.load(open('$J/sub1.json'))['score'])")"
ck "status SUBMITTED" "SUBMITTED" "$(python3 -c "import json; print(json.load(open('$J/sub1.json'))['status'])")"

# REPLAY: تسليم تاني بيرجع نفس النتيجة من غير تغيير
REPLAY=$(curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM1 -H 'Content-Type: application/json' -d '{"action":"submit"}' -o $J/sub1b.json)
ck "replay submit idempotent" "True" "$(python3 -c "
import json; a=json.load(open('$J/sub1.json')); b=json.load(open('$J/sub1b.json'))
print(a['score']==b['score'] and a['status']==b['status'])")"

echo "========== 4) STRICT MODE: LEAVE → INSTANT TERMINATION =========="
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM2 -H 'Content-Type: application/json' -d '{"action":"start"}' -o $J/run2.json
ck "strict exam started" "running" "$(python3 -c "import json; print(json.load(open('$J/run2.json'))['phase'])")"
ck "strict mode flag sent" "STRICT" "$(python3 -c "import json; print(json.load(open('$J/run2.json'))['securityMode'])")"
# الطالب ساب الشاشة → event TAB_HIDDEN → السيرفر بيلغي فورًا + بيمسح الجلسة
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM2 -H 'Content-Type: application/json' -d '{"action":"event","type":"TAB_HIDDEN"}' -o $J/term.json
ck "strict → terminated" "True" "$(python3 -c "import json; print(json.load(open('$J/term.json')).get('terminated'))")"
# الجلسة اتقفلت (spec §4) — أي طلب بعدها 401
curl -s -b $J/stu.jar $BASE/api/portal/exams -o /dev/null -w '%{http_code}' > $J/auth_code.txt
ck "portal session destroyed by strict policy" "401" "$(cat $J/auth_code.txt)"
# إعادة دخول — المحاولة INVALIDATED
curl -s -c $J/stu.jar -X POST $BASE/api/portal -H 'Content-Type: application/json' -d '{"action":"login","code":"10001","phone":"01055551111"}' -o /dev/null
curl -s -b $J/stu.jar $BASE/api/portal/exams -o $J/list2.json
ck "attempt INVALIDATED in list" "INVALIDATED" "$(python3 -c "
import json
for e in json.load(open('$J/list2.json'))['exams']:
    if e['id']=='$EXAM2': print(e['state']); break")"

echo "========== 5) AUTO-SUBMIT بعد انتهاء المدة (امتحان دقيقة واحدة) =========="
SHORT_END=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat())")
curl -s -b $J/mgr.jar -X POST $BASE/api/exams -H 'Content-Type: application/json' -o $J/exam3.json -d "{
  \"groupId\":\"$GROUP\",\"title\":\"امتحان قصير (autosubmit)\",\"startAt\":\"$START\",\"endAt\":\"$SHORT_END\",\"durationMin\":1,
  \"publish\":true,\"questions\":[{\"text\":\"3+3؟\",\"type\":\"NUM\",\"points\":3,\"correctAnswer\":\"6\"}]}"
EXAM3=$(python3 -c "import json; print(json.load(open('$J/exam3.json'))['exam']['id'])")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM3 -H 'Content-Type: application/json' -d '{"action":"start"}' -o $J/run3.json
NUM3=$(python3 -c "
import json
for q in json.load(open('$J/run3.json'))['questions']:
    if q['type']=='NUM': print(q['id']); break")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/exams/$EXAM3 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"answer\",\"questionId\":\"$NUM3\",\"answer\":\"6\"}"
echo "   ... waiting 70s for expiry ..."
sleep 70
curl -s -b $J/stu.jar $BASE/api/portal/exams/$EXAM3 -o $J/after3.json
ck "server auto-submitted after expiry" "result" "$(python3 -c "import json; print(json.load(open('$J/after3.json'))['phase'])")"
ck "auto-submitted score=3" "3" "$(python3 -c "import json; print(json.load(open('$J/after3.json'))['score'])")"
ck "status AUTO_SUBMITTED" "AUTO_SUBMITTED" "$(python3 -c "import json; print(json.load(open('$J/after3.json'))['status'])")"

echo "========== 6) ASSIGNMENTS: SAVE / RESUME / DEADLINE =========="
curl -s -b $J/stu.jar $BASE/api/portal/assignments/$ASG1 -o $J/asg1_open.json
ck "assignment open" "open" "$(python3 -c "import json; print(json.load(open('$J/asg1_open.json'))['phase'])")"
AMCQ=$(python3 -c "
import json
for q in json.load(open('$J/asg1_open.json'))['questions']:
    if q['type']=='MCQ': print(q['id']); break")
# حفظ مسودة
curl -s -b $J/stu.jar -X POST $BASE/api/portal/assignments/$ASG1 -H 'Content-Type: application/json' -o /dev/null -d "{\"action\":\"save\",\"answers\":[{\"questionId\":\"$AMCQ\",\"answer\":\"0\"}]}"
# RESUME — المسودة راجعة من السيرفر
curl -s -b $J/stu.jar $BASE/api/portal/assignments/$ASG1 -o $J/asg1_resume.json
ck "draft restored (leave/return)" "1" "$(python3 -c "
import json; d=json.load(open('$J/asg1_resume.json'))
print(len(d.get('answers',[])))")"
# تسليم — تصحيح فوري
ATF=$(python3 -c "
import json
for q in json.load(open('$J/asg1_open.json'))['questions']:
    if q['type']=='TRUE_FALSE': print(q['id']); break")
curl -s -b $J/stu.jar -X POST $BASE/api/portal/assignments/$ASG1 -H 'Content-Type: application/json' -o $J/asg1_sub.json -d "{\"action\":\"submit\",\"answers\":[{\"questionId\":\"$AMCQ\",\"answer\":\"0\"},{\"questionId\":\"$ATF\",\"answer\":\"true\"}]}"
ck "assignment submitted+graded" "3" "$(python3 -c "import json; print(json.load(open('$J/asg1_sub.json'))['score'])")"
# واجب فات ميعاده → التسليم مرفوض 410
LATE=$(curl -s -b $J/stu.jar -X POST $BASE/api/portal/assignments/$ASG_OLD -H 'Content-Type: application/json' -d '{"action":"submit","answers":[]}' -o /dev/null -w '%{http_code}')
ck "late submission rejected (410)" "410" "$LATE"

echo "========== 7) DYNAMIC QR: issue / claim / duplicate / replay =========="
# حصة مفتوحة النهاردة لمجموعة الفيزياء — في اللحية: SESS_ID من env (supabase live)،
# محليًا: حصة نضيفة sqlite كل تشغيل
TODAY=$(date +%F)
if [ -n "$SESS_ID" ]; then
  SESS=$SESS_ID
  echo "   using provided session $SESS"
else
SESS=$(python3 -c "
import sqlite3, uuid
con = sqlite3.connect('db/custom.db')
sid = 'sess-' + uuid.uuid4().hex[:20]
con.execute('INSERT INTO SessionInstance (id, centerId, groupId, date, startTime, endTime, price, teacherPercent, status, createdAt) VALUES (?,?,?,?,?,?,?,?,?,datetime(\"now\"))',
  (sid, 'cmufick570003iqo9fnqvrh2c', '$GROUP', '$TODAY', '17:00', '18:30', 5000, 50, 'OPEN'))
con.commit()
print(sid)")
echo "   created fresh session $SESS for today"
fi
curl -s -b $J/mgr.jar -X POST $BASE/api/attendance/session-qr -H 'Content-Type: application/json' -d "{\"sessionId\":\"$SESS\",\"rotateSeconds\":12}" -o $J/qr1.json
ck "QR issued (12s rotation)" "12" "$(python3 -c "import json; print(json.load(open('$J/qr1.json')).get('rotateSeconds'))")"
TOKEN1=$(python3 -c "import json; print(json.load(open('$J/qr1.json'))['token'])")
# الطالب الحاضر بجهازه الموثوق (فيه جلسة بورتال) — بدون أي تسجيل دخول
curl -s -b $J/stu.jar -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN1\"}" -o $J/claim1.json
ck "QR claim success (no login)" "True" "$(python3 -c "import json; print(json.load(open('$J/claim1.json')).get('ok'))")"
ck "charged like normal attendance" "5000" "$(python3 -c "import json; print(json.load(open('$J/claim1.json')).get('charged'))")"
# duplicate — نفس الطالب يمسح تاني
curl -s -b $J/stu.jar -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN1\"}" -o $J/claim2.json
ck "duplicate attendance blocked" "True" "$(python3 -c "import json; print(json.load(open('$J/claim2.json')).get('alreadyAttended'))")"
# replay — كود متدوّر (نولّد جديد فالقديم يتقفل)
curl -s -b $J/mgr.jar -X POST $BASE/api/attendance/session-qr -H 'Content-Type: application/json' -d "{\"sessionId\":\"$SESS\",\"rotateSeconds\":12}" -o $J/qr2.json
REPLAY=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN1\"}")
ck "rotated-out token rejected (410)" "410" "$REPLAY"
# طالب من غير جهاز موثوق → NEED_ACTIVATE (مش كود لوحده)
curl -s -X POST $BASE/api/attendance/session-qr/claim -H 'Content-Type: application/json' -d "{\"token\":\"$(python3 -c "import json; print(json.load(open('$J/qr2.json'))['token'])")\"}" -o $J/claim3.json
ck "anonymous claim → NEED_ACTIVATE" "NEED_ACTIVATE" "$(python3 -c "import json; print(json.load(open('$J/claim3.json')).get('reason'))")"

echo ""
echo "========== RESULTS: $PASS PASS / $FAIL FAIL =========="
