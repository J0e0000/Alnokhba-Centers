#!/usr/bin/env bash
# Poll Vercel OAuth token endpoint for device-flow approval.
# Usage: vercel-device-poll.sh [attempts] [interval_s]
# Exits 0 on success (writes auth.json), 1 on expiry/other error, 2 if still pending.
set -u
DC_FILE="/home/z/my-project/scripts/.device_code"
AUTH_DIR="$HOME/.local/share/com.vercel.cli"
AUTH_FILE="$AUTH_DIR/auth.json"
CLIENT_ID="cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"
ATTEMPTS="${1:-18}"
INTERVAL="${2:-5}"

[ -f "$DC_FILE" ] || { echo "ERR: no device_code file"; exit 1; }
DC=$(cat "$DC_FILE")

for i in $(seq 1 "$ATTEMPTS"); do
  RESP=$(curl -s -X POST https://api.vercel.com/login/oauth/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    --data-urlencode "device_code=$DC" \
    --data-urlencode "client_id=$CLIENT_ID")
  ERR=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
  if [ "$ERR" = "authorization_pending" ] || [ "$ERR" = "slow_down" ]; then
    sleep "$INTERVAL"
    continue
  fi
  if [ -n "$ERR" ]; then
    echo "ERR: $ERR"
    echo "$RESP" | head -c 400
    exit 1
  fi
  # success -> write auth.json in CLI format {token, expiresAt, refreshToken}
  mkdir -p "$AUTH_DIR" && chmod 700 "$AUTH_DIR"
  echo "$RESP" | python3 -c "
import json, sys, time, os
d = json.load(sys.stdin)
auth = {
  'token': d['access_token'],
  'expiresAt': int(time.time()) + int(d.get('expires_in', 0)),
  'refreshToken': d.get('refresh_token'),
}
p = os.path.expanduser('~/.local/share/com.vercel.cli/auth.json')
with open(p, 'w') as f:
    json.dump(auth, f)
os.chmod(p, 0o600)
print('WROTE', p)
"
  exit 0
done
echo "PENDING: still waiting after $ATTEMPTS attempts"
exit 2
