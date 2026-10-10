#!/bin/bash
# Watch for Vercel device-flow login completion, then run the first recon commands.
# Once auth lands: whoami + project list + storage list, saved to vercel_auth_ok.log
LOG=/home/z/my-project/scripts/vercel_login.log
OUT=/home/z/my-project/scripts/vercel_auth_ok.log
: > "$OUT"
for i in $(seq 1 60); do
  if grep -q "Congratulations\|logged in\|Success" "$LOG" 2>/dev/null; then
    echo "AUTH COMPLETED at $(date -u +%H:%M:%S) UTC" >> "$OUT"
    npx vercel whoami >> "$OUT" 2>&1
    echo "--- projects ---" >> "$OUT"
    npx vercel ls >> "$OUT" 2>&1
    exit 0
  fi
  if grep -q "expired\|denied\|error" "$LOG" 2>/dev/null; then
    echo "AUTH FAILED/EXPIRED at $(date -u +%H:%M:%S) UTC" >> "$OUT"
    tail -3 "$LOG" >> "$OUT"
    exit 1
  fi
  sleep 15
done
echo "WATCH TIMEOUT (15 min) at $(date -u +%H:%M:%S) UTC" >> "$OUT"
