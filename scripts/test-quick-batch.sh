#!/bin/bash
# اختبار شامل: إضافة طالب فردي + دفعة سريعة (السيناريوهات الجديدة)
set -e
BASE=http://localhost:3000
JAR=/tmp/qae-mgr-cookies.txt

echo "== 0) login =="
curl -s -c $JAR -X POST $BASE/api/auth -H 'Content-Type: application/json' \
  -d '{"mode":"staff","username":"qae-mgr-99","password":"Qae#2026"}' | head -c 80; echo

GRADE=$(curl -s -b $JAR "$BASE/api/academics" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['grades'][0]['id'])")
echo "gradeId=$GRADE"

TS=$(date +%s)
SUF=$(echo $TS | rev | cut -c1-4 | rev)

echo "== 1) single create (full data) =="
curl -s -b $JAR -X POST $BASE/api/students -H 'Content-Type: application/json' \
  -d "{\"name\":\"أحمد تجربة الفردى $TS\",\"phone\":\"0100000$SUF\",\"parentName\":\"محمد تجربة\",\"parentPhone\":\"0110000$SUF\",\"gradeId\":\"$GRADE\"}" | head -c 300; echo

echo "== 2) bulk quick: صفوف صغيرة (اسم + رقم واحد بس، من غير مرحلة) =="
curl -s -b $JAR -X POST $BASE/api/students/bulk -H 'Content-Type: application/json' -d "{\"students\":[
  {\"name\":\"يوسف السيد إبراهيم $TS\",\"phone\":\"0120000$SUF\",\"gradeId\":\"$GRADE\"},
  {\"name\":\"مريم أحمد علي $TS\",\"parentPhone\":\"0150000$SUF\"}
]}" | head -c 400; echo

echo "== 3) bulk: صف من غير أي رقم (لازم يفشل الصف ده بس → 422) =="
curl -s -b $JAR -X POST $BASE/api/students/bulk -H 'Content-Type: application/json' -d "{\"students\":[
  {\"name\":\"طالب من غير رقم $TS\",\"phone\":\"0121111$SUF\"},
  {\"name\":\"طالب تاني من غير رقم $TS\"}
]}" | python3 -m json.tool 2>/dev/null | head -20

echo "== 4) bulk: تكرار جوّه الدفعة =="
curl -s -b $JAR -X POST $BASE/api/students/bulk -H 'Content-Type: application/json' -d "{\"students\":[
  {\"name\":\"مكرر اختبار دفعة $TS\",\"phone\":\"0122222$SUF\"},
  {\"name\":\"مكرر اختبار دفعة تاني $TS\",\"phone\":\"0122222$SUF\"}
]}" | head -c 400; echo

echo "== 5) bulk all-or-nothing: اتسجل حاجة من الاختبار 3 و4؟ (المفروض صفر) =="
curl -s -b $JAR -G "$BASE/api/students" --data-urlencode "q=من غير رقم" | python3 -c "import sys,json; print('count:', json.load(sys.stdin)['total'])"
curl -s -b $JAR -G "$BASE/api/students" --data-urlencode "q=مكرر اختبار دفعة" | python3 -c "import sys,json; print('count:', json.load(sys.stdin)['total'])"

echo "== 6) الاحتياطي: اسم بس + رقم ولي أمر → موبايل الطالب بياخد نفس الرقم =="
curl -s -b $JAR -X POST $BASE/api/students/bulk -H 'Content-Type: application/json' -d "{\"students\":[
  {\"name\":\"سيف الدين محمود $TS\",\"parentPhone\":\"0109999$SUF\"}
]}" | head -c 300; echo
curl -s -b $JAR -G "$BASE/api/students" --data-urlencode "q=سيف الدين محمود $TS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d['students'][0] if d['students'] else {}
print('phone:', s.get('phone'), '| parentPhone:', s.get('parentPhone'))"
