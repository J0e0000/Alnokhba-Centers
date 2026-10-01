#!/bin/bash
# Verify each staff account actually logs in on PRODUCTION
BASE=https://alnokhba-centers.vercel.app
creds=(
  "admin:nokhba123"
  "manager:nokhba123"
  "manager2:nokhba123"
  "reception:nokhba123"
  "reception2:nokhba123"
  "aca-admin:academia123"
  "aca-manager:academia123"
  "aca-teacher1:academia123"
  "aca-student1:academia123"
)
for c in "${creds[@]}"; do
  u="${c%%:*}"; p="${c##*:}"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
    -X POST $BASE/api/auth -H 'Content-Type: application/json' \
    -d "{\"username\":\"$u\",\"password\":\"$p\"}")
  echo "$u -> HTTP $code"
done
# portal check: student 10001 + phone
pcode=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 \
  -X POST $BASE/api/portal -H 'Content-Type: application/json' \
  -d '{"code":"10001","phone":"01055551111"}')
echo "portal 10001/01055551111 -> HTTP $pcode"
