#!/bin/bash
# اختبار سريع: تسجيل دخول مدير + إضافة طالب جديد (التحقق من إصلاح خطأ السيرفر)
set -e
BASE=http://localhost:3000
JAR=/tmp/qae-mgr-cookies.txt

echo "== 1) login qae-mgr-99 =="
LOGIN=$(curl -s -c $JAR -X POST $BASE/api/auth -H 'Content-Type: application/json' \
  -d '{"mode":"staff","username":"qae-mgr-99","password":"Qae#2026"}')
echo "$LOGIN" | head -c 300; echo

echo "== 2) POST /api/students (single create) =="
NOW=$(date +%s)
SUF=$(echo $NOW | tail -c 5)
RESP=$(curl -s -b $JAR -X POST $BASE/api/students -H 'Content-Type: application/json' \
  -d "{\"name\":\"طالب اختبار سيرفر $NOW\",\"phone\":\"0100000$SUF\",\"parentName\":\"ولي اختبار\",\"parentPhone\":\"0110000$SUF\"}")
echo "$RESP" | head -c 500; echo

echo "== 3) POST /api/students/bulk (no gradeId — الحالة الحالية للـ UI القديم) =="
RESP2=$(curl -s -b $JAR -X POST $BASE/api/students/bulk -H 'Content-Type: application/json' \
  -d "{\"students\":[{\"name\":\"طالب دفعة تجربة $NOW\",\"phone\":\"0120000$SUF\",\"parentName\":\"ولي الدفعة\",\"parentPhone\":\"0150000$SUF\"}]}")
echo "$RESP2" | head -c 600; echo
