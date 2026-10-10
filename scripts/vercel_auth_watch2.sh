#!/bin/bash
# Watch for second device-flow login (the account that owns alnokhba-centers-nine).
# On success: whoami + projects + (if nine found) link + env ls + storage list.
LOG=/home/z/my-project/scripts/vercel_login2.log
OUT=/home/z/my-project/scripts/vercel_auth2_ok.log
: > "$OUT"
for i in $(seq 1 120); do
  if grep -q "Congratulations\|signed in" "$LOG" 2>/dev/null; then
    echo "AUTH2 COMPLETED at $(date -u +%H:%M:%S) UTC" >> "$OUT"
    npx vercel whoami >> "$OUT" 2>&1
    echo "--- projects ---" >> "$OUT"
    npx vercel projects ls >> "$OUT" 2>&1
    if npx vercel projects ls 2>/dev/null | grep -q "alnokhba-centers-nine"; then
      echo "--- nine FOUND: link + env ls + storage ---" >> "$OUT"
      cd /home/z/my-project || exit 0
      npx vercel link --yes --project alnokhba-centers-nine >> "$OUT" 2>&1
      npx vercel env ls >> "$OUT" 2>&1
      npx vercel storage list >> "$OUT" 2>&1
    else
      echo "--- nine NOT in this scope ---" >> "$OUT"
    fi
    exit 0
  fi
  if grep -qi "expired\|denied\|error" "$LOG" 2>/dev/null; then
    echo "AUTH2 FAILED/EXPIRED" >> "$OUT"; tail -3 "$LOG" >> "$OUT"; exit 1
  fi
  sleep 15
done
echo "AUTH2 WATCH TIMEOUT (30 min)" >> "$OUT"
