#!/bin/bash
# ============================================================
# E2E test — Slot QR (الموديل النهائي بعد تجربة الدفعة المتحركة):
# 1) نداء واحد بيطلع كود واحد سليم (40 hex) — أي سكانر عادي بيقراه
#    - الإيقاع: الكود ثابت 10 ثواني على الشاشة (قابل للضبط 5..30)
#    - TTL الكود = السلوت + هامش شبكة 4ث (14ث) وبعده بيموت نهائيًا
# 2) clamps: slotSeconds 1→5 (أسرع من كده الكاميرا مش بتلحق)، 99→30
# 3) من غير تسجيل دخول → 401
# 4) "الكود اللي قبله يتلغي": الكود القديم بيكمل شغال خلال هامش 4ث بس
#    وبعدها ميت (410) — الصورة/السكرين شوت بيمسك كود ميت خلال ثواني
# 5) claim كامل من البورتال (حضور فوري أو alreadyAttended)
# 6) سماحية التفعيل الأول: توكن انتهى خلال 90ث + afterActivation → يتعبد
#    (الطالب اللي فتح الرابط وهو حاضر وبيكتب كوده وموبايله بياخد وقت)،
#    ونفس التوكن من غير afterActivation → مرفوض 410
# Run: bash scripts/e2e_qr_slot.sh
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-qslot
mkdir -p $JAR
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3  ($4)";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected $2, got $3  ($4)"; fi; }

login() { curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null; }

login manager nokhba123 mgr

# ── 0) من غير تسجيل دخول → 401 ──
UNAUTH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d '{"sessionId":"x"}')
check "slot issue unauth → 401" "401" "$UNAUTH" "route guarded"

# ── 1) حصة مفتوحة النهاردة ──
SESSION=$(curl -s -b $JAR/mgr.jar "$BASE/api/today" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ss=d.get('sessions') or d.get('today',{}).get('sessions') or []
open_s=[s for s in ss if s.get('status') in ('OPEN','LIVE')]
print(open_s[0]['id'] if open_s else (ss[0]['id'] if ss else ''))" 2>/dev/null)
echo "session: $SESSION"
[ -n "$SESSION" ] || { echo "NO SESSION TODAY — abort"; exit 1; }

# ── 2) إصدار كود (الإيقاع الافتراضي 10ث) ──
B1=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}")
python3 - "$B1" <<'PY' > /tmp/qr_s1.env
import json, sys, re
from datetime import datetime, timezone
d = json.loads(sys.argv[1])
toks = [c.get("token","") for c in (d.get("codes") or [d] if d.get("token") else [])] or [d.get("token","")]
tok = d.get("token","")
exp = d.get("expiresAt")
ok_single = bool(tok) and not d.get("codes")  # كود واحد مش دفعة
ok_shape = bool(re.fullmatch(r"[0-9a-f]{40}", tok))
ttl_s = int((datetime.fromisoformat(exp.replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds()) if exp else 0
# السلوت 10ث + هامش 4ث = 14ث (نسمح بانحراف ثانية)
ok_ttl = 12 <= ttl_s <= 16
ok_slot = d.get("slotSeconds") == 10
print(f"SINGLE={'ok' if ok_single else 'bad'}")
print(f"SHAPE={'ok' if ok_shape else 'bad'}")
print(f"TTL={'ok' if ok_ttl else 'bad'}")
print(f"SLOT={'ok' if ok_slot else 'bad'}")
print(f"T1={tok}")
PY
source /tmp/qr_s1.env
check "slot: single token (no batch)" "ok" "$SINGLE" "Slot QR model"
check "slot: token shape 40-hex" "ok" "$SHAPE" "same as claim regex"
check "slot: TTL = slot+4s (~14s)" "ok" "$TTL" "photo dies in seconds"
check "slot: slotSeconds=10 (camera-readable)" "ok" "$SLOT" "user-requested pace"
[ -n "$T1" ] || { echo "NO TOKEN — abort"; exit 1; }

# ── 3) clamps: slotSeconds 1→5 (حد الكاميرا)، 99→30 ──
SL=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\",\"slotSeconds\":1}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('slotSeconds'))" 2>/dev/null)
check "slot: floor 1→5 (camera keeps up)" "5" "$SL" "readability floor"
SH=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\",\"slotSeconds\":99}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('slotSeconds'))" 2>/dev/null)
check "slot: ceiling 99→30" "30" "$SH" "freshness ceiling"

# ── 4) دخول الطالب (بورتال) ──
read -r SCODE SPHONE <<< $(npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const s = await p.sessionInstance.findUnique({ where: { id: '$SESSION' }, select: { groupId: true } });
  const reg = await p.studentGroup.findFirst({ where: { groupId: s.groupId, status: 'ACTIVE' }, include: { student: { select: { code: true, phone: true } } } });
  console.log(reg.student.code, reg.student.phone);
  await p.\$disconnect();
})();
" 2>/dev/null | head -1)
echo "student: $SCODE / $SPHONE"
curl -s -X POST "$BASE/api/portal" -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"code\":\"$SCODE\",\"phone\":\"$SPHONE\"}" -c "$JAR/portal.jar" > /dev/null

# ── 5) التوكن الأول شغال ──
A1=$(curl -s -b $JAR/portal.jar -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T1\"}")
check "current slot token alive (200)" "200" "$A1" "normal scanning works"

# ── 6) كود جديد بيتولد → القديم لسه شغال خلال هامش 4ث بس ──
sleep 2
B2=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}")
T2=$(echo "$B2" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null)
A2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T1\"}")
check "previous token alive within 4s grace" "200" "$A2" "in-flight claims safe"
sleep 12
D1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T1\"}")
check "previous token dead after grace (410)" "410" "$D1" "photo/screenshot dies — old code invalidated"
A3=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T2\"}")
check "new slot token alive (200)" "200" "$A3" "rotation seamless"

# ── 7) claim كامل من البورتال ──
CLAIM=$(curl -s -b $JAR/portal.jar -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T2\"}")
COK=$(echo "$CLAIM" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('alreadyAttended') else 'no')" 2>/dev/null)
check "portal claim with slot token" "ok" "$COK" "end-to-end attendance"

# ── 8) سماحية التفعيل الأول: توكن انتهى + afterActivation ──
B4=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}")
T4=$(echo "$B4" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null)
echo "waiting 15s for token expiry (activation-grace test)…"
sleep 15
DEAD4=$(curl -s -b $JAR/portal.jar -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T4\"}")
check "expired token without afterActivation → 410" "410" "$DEAD4" "no bypass by default"
GRACE4=$(curl -s -b $JAR/portal.jar -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T4\",\"afterActivation\":true}" -w "\n%{http_code}")
GCODE=$(echo "$GRACE4" | tail -1)
GOK=$(echo "$GRACE4" | head -n -1 | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('alreadyAttended') else 'no')" 2>/dev/null)
check "expired token + afterActivation → 200" "200" "$GCODE" "first-activation flow survives typing time"
check "activation-grace claim succeeds" "ok" "$GOK" "student who scanned the screen isn't punished"

echo ""
echo -e "================= RESULTS =================\n$RESULTS\n"
echo "PASS=$PASS FAIL=$FAIL"
