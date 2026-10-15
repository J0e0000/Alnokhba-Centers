#!/bin/bash
# فحص دخاني شامل لكل مسارات المنتج الحرجة — بحساب مدير سنتر الـ 5000 طالب
BASE="http://localhost:3000"
CJ="/tmp/qae-mgr.cookies"
PASS=0; FAIL=0
chk() { # name, method, url, [body]
  local name="$1" method="$2" url="$3" body="$4"
  if [ -n "$body" ]; then
    R=$(curl -s -X "$method" "$BASE$url" -H "Content-Type: application/json" -b "$CJ" -d "$body" -w "\n%{http_code}" --max-time 25)
  else
    R=$(curl -s -X "$method" "$BASE$url" -b "$CJ" -w "\n%{http_code}" --max-time 25)
  fi
  CODE=$(echo "$R" | tail -1)
  if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); echo "✅ $name [$CODE]";
  else FAIL=$((FAIL+1)); echo "❌ $name [$CODE] → $(echo "$R" | head -1 | head -c 200)"; fi
}

echo "=== CORE ==="
chk "dashboard"        GET "/api/dashboard"
chk "students list"    GET "/api/students?page=1&pageSize=10"
chk "students search"  GET "/api/students?q=%D8%B7%D8%A7%D9%84%D8%A8&page=1&pageSize=10"
chk "grades+groups"    GET "/api/academics"
chk "schedule"         GET "/api/schedule"
chk "rooms"            GET "/api/rooms"

echo "=== FINANCE ==="
chk "payments list"    GET "/api/payments?page=1&pageSize=10"
chk "accounting"       GET "/api/accounting"
chk "reports attendance" GET "/api/reports?type=attendance"
chk "reports finance"  GET "/api/reports?type=finance"

echo "=== SESSIONS/ATTENDANCE ==="
chk "sessions list"    GET "/api/sessions"
chk "today view"      GET "/api/today"

echo "=== EDU ==="
chk "exams"            GET "/api/exams"
chk "quizzes"          GET "/api/quizzes"
chk "assignments"      GET "/api/assignments"
chk "books"            GET "/api/books"

echo "=== PLATFORM ==="
chk "notifications"    GET "/api/notifications/staff"
chk "staff list"      GET "/api/staff"
chk "audit log"        GET "/api/audit"
chk "approvals"        GET "/api/approvals"
chk "preferences"      GET "/api/preferences"
chk "announcements"    GET "/api/announcements"
chk "message queue"    GET "/api/queue"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
