#!/bin/bash
# ============================================================
# E2E test — Dynamic Batch QR (الجيل الجديد من QR الحصة):
# 1) نداء واحد بيطلع 10 أكواد فريدة (40 hex) + batchExpiresAt + slotSeconds
# 2) count clamp (الأقصى 14)
# 3) من غير تسجيل دخول → 401
# 4) التدوير: دفعة جديدة بتقتل القديمة بعد هامش 8ث
#    - جوه الهامش: التوكن القديم لسه بيـresolve (claim بيرد NEED_ACTIVATE مش 410)
#    - بعد الهامش: التوكن القديم ميت (410) — الصورة/السكرين شوت بيموت
# 5) الدفعة الجديدة شغالة بعد التدوير
# 6) claim كامل من البورتال بتوكن من دفعة (حضور فوري أو alreadyAttended)
# Run: bash scripts/e2e_qr_batch.sh
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-qr
mkdir -p $JAR
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3  ($4)";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected $2, got $3  ($4)"; fi; }

login() { curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null; }

login manager nokhba123 mgr

# ── 0) من غير تسجيل دخول → 401 ──
UNAUTH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/batch" \
  -H "Content-Type: application/json" -d '{"sessionId":"x"}')
check "batch issue unauth → 401" "401" "$UNAUTH" "route guarded"

# ── 1) حصة مفتوحة النهاردة ──
SESSION=$(curl -s -b $JAR/mgr.jar "$BASE/api/today" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ss=d.get('sessions') or d.get('today',{}).get('sessions') or []
open_s=[s for s in ss if s.get('status')=='OPEN']
print(open_s[0]['id'] if open_s else (ss[0]['id'] if ss else ''))" 2>/dev/null)
echo "session: $SESSION"
[ -n "$SESSION" ] || { echo "NO SESSION TODAY — abort"; exit 1; }

# ── 2) إصدار دفعة ──
B1=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/batch" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}")
python3 - "$B1" <<'PY' > /tmp/qr_b1.env
import json, sys, re
d = json.loads(sys.argv[1])
codes = d.get("codes") or []
toks = [c.get("token","") for c in codes]
ok_count = len(toks) == 10
ok_unique = len(set(toks)) == len(toks)
ok_shape = all(re.fullmatch(r"[0-9a-f]{40}", t) for t in toks)
ok_exp = bool(d.get("batchExpiresAt"))
ok_slot = abs(float(d.get("slotSeconds", 0)) - 1.0) < 1e-6
print(f"COUNT={'ok' if ok_count else 'bad'}")
print(f"UNIQUE={'ok' if ok_unique else 'bad'}")
print(f"SHAPE={'ok' if ok_shape else 'bad'}")
print(f"EXP={'ok' if ok_exp else 'bad'}")
print(f"SLOT={'ok' if ok_slot else 'bad'}")
print(f"T0={toks[0] if toks else ''}")
PY
source /tmp/qr_b1.env
check "batch: 10 codes" "ok" "$COUNT" "issueSessionQrBatch"
check "batch: tokens unique" "ok" "$UNIQUE" "no reuse"
check "batch: token shape 40-hex" "ok" "$SHAPE" "same as claim regex"
check "batch: batchExpiresAt present" "ok" "$EXP" "uniform expiry"
check "batch: slotSeconds=1" "ok" "$SLOT" "fast cycling"
[ -n "$T0" ] || { echo "NO TOKENS — abort"; exit 1; }

# ── 3) count clamp (99 → 14 أقصى) ──
BC=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/batch" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\",\"count\":99}" \
  | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('codes',[])))" 2>/dev/null)
check "batch: count clamp 99→14" "14" "$BC" "server-side clamp"
# ملاحظة: النداء ده كان دفعة جديدة — القديمة اتقفلت بهامش 8ث

# ── 4) جوه هامش التدوير: توكن من الدفعة الأولى لسه بيـresolve (مش 410) ──
# (claim بدون جلسة بورتال بيرد NEED_ACTIVATE لو التوكن سليم)
IN_GRACE=$(curl -s -b $JAR/portal.jar -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T0\"}" -w "\n%{http_code}" | tail -1)
check "old token within 8s grace resolves (not 410)" "200" "$IN_GRACE" "mid-flight claims safe"

# ── 5) بعد الهامش: التوكن القديم ميت ──
sleep 9
DEAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T0\"}")
check "old token dead after rotation grace (410)" "410" "$DEAD" "photo/screenshot dies"

# ── 6) دفعة جديدة شغالة بعد التدوير ──
B2=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/batch" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}")
T1=$(echo "$B2" | python3 -c "import json,sys; print(json.load(sys.stdin)['codes'][0]['token'])" 2>/dev/null)
ALIVE=$(curl -s -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T1\"}" -o /dev/null -w '%{http_code}')
check "fresh batch token alive (200)" "200" "$ALIVE" "new batch works"

# ── 7) claim كامل من البورتال بتوكن من دفعة ──
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
CLAIM=$(curl -s -b $JAR/portal.jar -X POST "$BASE/api/attendance/session-qr/claim" \
  -H "Content-Type: application/json" -d "{\"token\":\"$T1\"}")
COK=$(echo "$CLAIM" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('alreadyAttended') else 'no')" 2>/dev/null)
check "portal claim with batch token" "ok" "$COK" "end-to-end attendance"

echo ""
echo -e "================= RESULTS =================\n$RESULTS\n"
echo "PASS=$PASS FAIL=$FAIL"
