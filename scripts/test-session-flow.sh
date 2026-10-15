#!/bin/bash
# E2E: فتح حصة من الجدول + تسجيل حضور + قفل الحصة — على داتا الـ 5000 طالب
BASE="http://localhost:3000"
CJ="/tmp/qae-mgr.cookies"
TODAY=$(date +%F)

# 1) هات اقتراح حصة النهاردة
SCHED=$(curl -s "$BASE/api/sessions?date=$TODAY" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
sugs=d.get('suggestions') or []
print(sugs[0]['scheduleId'] if sugs else '')")
echo "schedule slot: $SCHED"
if [ -z "$SCHED" ]; then echo "⚠️ مفيش اقتراحات النهاردة (ممكن الحصص مفتوحة خلاص) — نجرب sessions الموجودة"; fi

# 2) افتح الحصة (لو فيه اقتراح)
if [ -n "$SCHED" ]; then
  CODE=$(curl -s -X POST $BASE/api/sessions -H "Content-Type: application/json" -b $CJ -d "{\"scheduleId\":\"$SCHED\",\"date\":\"$TODAY\"}" -o /tmp/sess.json -w "%{http_code}")
  echo "open session: $CODE $(head -c 150 /tmp/sess.json)"
  SESSID=$(python3 -c "import json; print(json.load(open('/tmp/sess.json'))['session']['id'])" 2>/dev/null)
else
  SESSID=$(curl -s "$BASE/api/sessions?date=$TODAY" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
open_s=[s for s in d.get('sessions',[]) if not s.get('closed')]
print(open_s[0]['id'] if open_s else '')")
  echo "using existing open session: $SESSID"
fi
[ -z "$SESSID" ] && { echo "❌ مفيش جلسة للفحص"; exit 1; }

# 3) سجل حضور 3 طلاب (بالكود)
CODES=$(curl -s "$BASE/api/students?page=1&pageSize=3&status=ACTIVE" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps([s['code'] for s in d['students']]))")
echo "student codes: $CODES"
for CODE in $(echo $CODES | python3 -c "import json,sys; print(' '.join(json.load(sys.stdin)))"); do
  R=$(curl -s -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" -b $CJ -d "{\"sessionId\":\"$SESSID\",\"code\":\"$CODE\"}" -w "|%{http_code}")
  echo "mark $CODE → ${R##|}"
done

# 4) حالة الجلسة بعد الحضور
curl -s "$BASE/api/sessions?date=$TODAY" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=[x for x in d['sessions'] if x['id']=='$SESSID']
if s: print(f\"session: attendanceCount={s[0]['attendanceCount']} present={s[0]['presentCount']} closed={s[0]['closed']}\")"

# 5) اقفل الحصة
CODE=$(curl -s -X POST "$BASE/api/sessions/$SESSID" -H "Content-Type: application/json" -b $CJ -d '{"action":"close"}' -o /tmp/close.json -w "%{http_code}")
echo "close session: $CODE $(head -c 200 /tmp/close.json)"
