#!/bin/bash
# مشغّل خادم التطوير كخُدم (daemon) حقيقي — double-fork حتى ينجو من تنظيف الجلسة
# الاستخدام: bash scripts/start-dev-daemon.sh
cd /home/z/my-project

# لو شغال خلاص — اطلع
if [ -f /tmp/next-dev.pid ]; then
  OLD=$(cat /tmp/next-dev.pid)
  if kill -0 "$OLD" 2>/dev/null; then
    echo "dev server already running (pid $OLD)"
    exit 0
  fi
fi

# اقتل أي عملية نايمة على البورت
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

setsid python3 -c "
import os
if os.fork() > 0: os._exit(0)
os.setsid()
if os.fork() > 0: os._exit(0)
os.chdir('/home/z/my-project')
f = os.open('/home/z/my-project/dev.log', os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
os.dup2(f, 1); os.dup2(f, 2)
os.execvp('bun', ['bun', 'run', 'dev'])
" < /dev/null > /dev/null 2>&1 &

# استنى الجاهزية
for i in $(seq 1 40); do
  if curl -sf -o /dev/null http://localhost:3000/ 2>/dev/null; then
    PID=$(ps aux | grep 'next-server' | grep -v grep | awk '{print $2}' | head -1)
    echo "$PID" > /tmp/next-dev.pid
    echo "dev server ready (pid $PID)"
    exit 0
  fi
  sleep 1
done
echo "dev server failed to start — check dev.log"
exit 1
