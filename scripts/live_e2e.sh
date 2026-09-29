#!/bin/sh
# Post-deploy live E2E + timing verification (region fra1 + 1769MB)
BASE=https://alnokhba-centers.vercel.app

echo "=== ADMIN ACCOUNT E2E ==="
for i in 1 2 3; do
  curl -o /tmp/adm_body.json -s -w "admin-login#$i: %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" \
    -X POST $BASE/api/auth -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"nokhba123"}' -c /tmp/adm.jar
done
echo "login response: $(head -c 200 /tmp/adm_body.json)"

echo ""
echo "=== PROTECTED API (admin session) ==="
curl -o /dev/null -s -w "dashboard:  %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/api/dashboard -b /tmp/adm.jar
curl -o /dev/null -s -w "students:   %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/api/students -b /tmp/adm.jar
curl -o /dev/null -s -w "sessions:   %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/api/sessions -b /tmp/adm.jar

echo ""
echo "=== STATIC PAGES ==="
curl -o /dev/null -s -w "login-page:  %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/login
curl -o /dev/null -s -w "landing:     %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/

echo ""
echo "=== STUDENT PORTAL E2E ==="
curl -o /dev/null -s -w "portal-page: %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/portal
curl -o /tmp/stu_body.json -s -w "portal-login: %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" \
  -X POST $BASE/api/portal -H 'Content-Type: application/json' \
  -d '{"action":"login","code":"10001","phone":"01055551111"}' -c /tmp/stu.jar
echo "portal login response: $(head -c 200 /tmp/stu_body.json)"
curl -o /dev/null -s -w "portal-home: %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/api/portal -b /tmp/stu.jar
curl -o /dev/null -s -w "portal-msgs: %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/api/portal/notifications -b /tmp/stu.jar
curl -o /dev/null -s -w "portal-sched: %{http_code} | ttfb %{time_starttransfer}s | total %{time_total}s\n" $BASE/api/portal/schedule -b /tmp/stu.jar
