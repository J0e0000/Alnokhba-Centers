#!/bin/bash
# E2E مصحح: حضور حصة بمجموعتها — أخذ studentId الحقيقيين من رستر المجموعة
BASE="http://localhost:3000"
CJ="/tmp/qae-mgr.cookies"
TODAY=$(date +%F)

# هات الحصة المفتوحة (اللي فتحناها) + معرف مجموعتها عبر الجلسات
SESS_JSON=$(curl -s "$BASE/api/sessions?date=$TODAY" -b $CJ)
SESSID=$(echo "$SESS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); s=[x for x in d['sessions'] if not x['closed']]; print(s[0]['id'] if s else '')")
# لو مفيش جلسة مفتوحة — افتح واحدة من الاقتراحات
if [ -z "$(echo "$SESS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); s=[x for x in d['sessions'] if not x['closed']]; print('x' if s else '')")" ]; then
  SCHED=$(echo "$SESS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); s=d.get('suggestions') or []; print(s[0]['scheduleId'] if s else '')")
  [ -n "$SCHED" ] && curl -s -X POST $BASE/api/sessions -H "Content-Type: application/json" -b $CJ -d "{\"scheduleId\":\"$SCHED\",\"date\":\"$TODAY\"}" -o /tmp/sess.json -w "opened: %{http_code}\n"
  SESS_JSON=$(curl -s "$BASE/api/sessions?date=$TODAY" -b $CJ)
  SESSID=$(echo "$SESS_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); s=[x for x in d['sessions'] if not x['closed']]; print(s[0]['id'] if s else '')")
fi
[ -z "$SESSID" ] && { echo "❌ مفيش جلسة مفتوحة"; exit 1; }
echo "session: $SESSID"

# هات مجموعة الحصة — من الجدول: الحصة جاية من scheduleId، نجيب المجموعة من الـ suggestions أو من أول مجموعة
GID=$(curl -s "$BASE/api/academics" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
groups=d.get('groups') or d.get('data',{}).get('groups') or []
print(groups[0]['id'] if groups else '')")
echo "group: $GID"

# طلاب المجموعة
SIDS=$(curl -s "$BASE/api/students?groupId=$GID&status=ACTIVE&pageSize=3" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(json.dumps([(s['id'],s['name']) for s in d['students'][:3]]))")
echo "roster students: $SIDS"

for ROW in $(echo "$SIDS" | python3 -c "import json,sys; [print(r[0]) for r in json.load(sys.stdin)]"); do
  CODE=$(curl -s -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" -b $CJ -d "{\"sessionId\":\"$SESSID\",\"studentId\":\"$ROW\",\"status\":\"PRESENT\"}" -o /tmp/mark.json -w "%{http_code}")
  echo "mark $ROW → $CODE $(head -c 120 /tmp/mark.json)"
done

# حالة الجلسة
curl -s "$BASE/api/sessions?date=$TODAY" -b $CJ | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=[x for x in d['sessions'] if x['id']=='$SESSID']
if s: print(f\"after: attendanceCount={s[0]['attendanceCount']} present={s[0]['presentCount']}\")"
