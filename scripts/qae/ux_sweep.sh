#!/bin/bash
# UX sweep v4: /app + hash + cache-buster — كل الشاشات × المقاسات
OUT=/home/z/my-project/qae/results/sweep
mkdir -p "$OUT"
VIEWS="home today scan students messages payments accounting books reports schedule groups teachers approvals emergency settings"
agent-browser set media light 2>/dev/null >/dev/null
for sk in m390 t768 d1280 d1440; do
  case $sk in
    m390) W=390; H=844;; t768) W=768; H=1024;; d1280) W=1280; H=800;; d1440) W=1440; H=900;;
  esac
  agent-browser set viewport $W $H >/dev/null 2>&1
  for v in $VIEWS; do
    R=$((RANDOM))
    agent-browser open "http://localhost:3000/app?r=$R#$v" >/dev/null 2>&1
    sleep 2.6
    METRIC=$(agent-browser eval "JSON.stringify({v:'$v',s:'$sk',sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,h:document.documentElement.scrollHeight})" 2>/dev/null | tail -1)
    echo "$METRIC"
    agent-browser screenshot "$OUT/${v}-${sk}.png" >/dev/null 2>&1
  done
done
echo "=== SWEEP DONE ==="
