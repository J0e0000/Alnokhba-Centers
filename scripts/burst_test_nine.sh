#!/bin/bash
# اختبار تكراري: 8 طلبات متوازية بنفس الكوكي — هل في 401 عشوائي زي المتصفح؟
BASE="https://alnokhba-centers-nine.vercel.app"
JAR=/tmp/nine_burst.txt
rm -f "$JAR"
code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth" -H "Content-Type: application/json" -d '{"username":"manager","password":"nokhba123"}' --max-time 25)
echo "login=$code"
TOKEN=$(grep nokhba_session "$JAR" | awk '{print $7}')
echo "token=${TOKEN:0:8}..."

PATHS=("/api/auth" "/api/undo" "/api/today" "/api/dashboard" "/api/sessions" "/api/center/capabilities" "/api/preferences" "/api/notifications/staff")

for round in 1 2 3 4 5; do
  echo "--- round $round ---"
  for p in "${PATHS[@]}"; do
    ( c=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: nokhba_session=$TOKEN" "$BASE$p" --max-time 30); echo "$p -> $c" ) &
  done
  wait
done
