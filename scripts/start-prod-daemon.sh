#!/bin/bash
# مشغّل خادم الإنتاج كخُدم (daemon) حقيقي — double-fork حتى ينجو من تنظيف الجلسة
# الاستخدام: bash scripts/start-prod-daemon.sh
# (السيرفر بيشغّل .next/standalone/server.js — بناء الإنتاج)
cd /home/z/my-project

# لو البناء مش موجود — ارفض
if [ ! -f .next/standalone/server.js ]; then
  echo "ERROR: no production build at .next/standalone/server.js — run: bun run build"
  exit 1
fi

# لو شغال خلاص — اطلع
if [ -f /tmp/next-prod.pid ]; then
  OLD=$(cat /tmp/next-prod.pid)
  if kill -0 "$OLD" 2>/dev/null; then
    echo "prod server already running (pid $OLD)"
    exit 0
  fi
fi

# اقتل أي عملية نايمة على البورت (dev server أو نسخة قديمة)
fuser -k 3000/tcp 2>/dev/null || true
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "next-server (v" 2>/dev/null || true
sleep 1

setsid python3 -c "
import os
if os.fork() > 0: os._exit(0)
os.setsid()
if os.fork() > 0: os._exit(0)
os.chdir('/home/z/my-project')
f = os.open('/home/z/my-project/server.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
os.dup2(f, 1); os.dup2(f, 2)
os.environ['NODE_ENV'] = 'production'
os.execvp('bun', ['bun', '.next/standalone/server.js'])
" < /dev/null > /dev/null 2>&1 &

# استنى الجاهزية
for i in $(seq 1 40); do
  if curl -sf -o /dev/null http://localhost:3000/ 2>/dev/null; then
    PID=$(ps aux | grep 'standalone/server.js' | grep -v grep | awk '{print $2}' | head -1)
    echo "$PID" > /tmp/next-prod.pid
    echo "prod server ready (pid $PID)"
    exit 0
  fi
  sleep 1
done
echo "prod server failed to start — check server.log"
exit 1
