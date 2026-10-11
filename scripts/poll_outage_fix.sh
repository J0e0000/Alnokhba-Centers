#!/bin/bash
# Poll production until the outage-fix deploy (ad1fb8a) lands.
# Markers: unauth /api/sysdiag must flip 200→401 (gated in new build),
# then admin sysdiag shows commit ad1fb8a + schema sync, then the 500s must clear.
BASE="https://alnokhba-centers-nine.vercel.app"
AC=$(curl -s -m 20 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"admin","password":"nokhba123"}' -D - -o /dev/null | grep -i 'set-cookie' | sed 's/[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
MC=$(curl -s -m 20 -X POST $BASE/api/auth -H 'Content-Type: application/json' -d '{"username":"manager","password":"nokhba123"}' -D - -o /dev/null | grep -i 'set-cookie' | sed 's/[Ss]et-[Cc]ookie: //' | cut -d';' -f1)

for i in $(seq 1 40); do
  UNAUTH=$(curl -s -m 20 -o /dev/null -w "%{http_code}" $BASE/api/sysdiag)
  MGR_CAPS=$(curl -s -m 25 -b "$MC" -o /dev/null -w "%{http_code}" $BASE/api/center/capabilities)
  ADMIN_API=$(curl -s -m 25 -b "$AC" -o /dev/null -w "%{http_code}" $BASE/api/admin)
  DASH=$(curl -s -m 25 -b "$MC" -o /dev/null -w "%{http_code}" $BASE/api/dashboard)
  echo "[$i] unauth-sysdiag=$UNAUTH mgr-caps=$MGR_CAPS admin-api=$ADMIN_API dashboard=$DASH"
  if [ "$UNAUTH" = "401" ] && [ "$MGR_CAPS" = "200" ] && [ "$ADMIN_API" = "200" ] && [ "$DASH" = "200" ]; then
    echo "DEPLOY IS LIVE AND HEALTHY ✓"
    echo "== sysdiag (admin) =="
    curl -s -m 25 -b "$AC" $BASE/api/sysdiag | python3 -c "import json,sys; d=json.load(sys.stdin); print('commit:', d.get('commit')); print('schema:', d.get('schema'))"
    exit 0
  fi
  sleep 45
done
echo "TIMEOUT after ~30min — deploy not fully healthy yet"
exit 1
