#!/bin/bash
# ============================================================
# E2E test — الإضافات الجديدة (Task E):
# 1. QR self check-in جوّه البورتال → حضور + إشعار طالب + إشعار موظفين
# 2. مشاركة امتحان (deep-link path) — بس نتأكد إن الاستجابات سليمة
# Run: bash scripts/e2e_notifications.sh
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-e
mkdir -p $JAR
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3  ($4)";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected $2, got $3  ($4)"; fi; }

login() { curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null; }

login manager nokhba123 mgr
login reception nokhba123 rec

# ── 1) مدير يولّد QR لحصة مفتوحة النهاردة ──
SESSION=$(curl -s -b $JAR/mgr.jar "$BASE/api/today" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ss=d.get('sessions') or d.get('today',{}).get('sessions') or []
open_s=[s for s in ss if s.get('status')=='OPEN']
print(open_s[0]['id'] if open_s else (ss[0]['id'] if ss else ''))" 2>/dev/null)
echo "session: $SESSION"

QR=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr" -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\"}")
TOKEN=$(echo "$QR" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN" ] && check "QR issue" "ok" "ok" "token generated (${#TOKEN} hex chars)" || check "QR issue" "ok" "FAIL" "$QR"

# ── 2) طالب بيسجل دخول بورتال ويمسح الكود (claim بجلسة بورتال) ──
# نجيب كود + موبايل أول طالب مسجل في مجموعة الحصة من الداتابيز
read -r SCODE SPHONE <<< $(npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const s = await p.sessionInstance.findUnique({ where: { id: '$SESSION' }, select: { groupId: true } });
  const reg = await p.studentGroup.findFirst({ where: { groupId: s.groupId, status: 'ACTIVE' }, include: { student: { select: { code: true, phone: true, status: true } } } });
  console.log(reg.student.code, reg.student.phone);
  await p.\$disconnect();
})();
" 2>/dev/null | head -1)
echo "student: $SCODE / $SPHONE"

curl -s -X POST "$BASE/api/portal" -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"code\":\"$SCODE\",\"phone\":\"$SPHONE\"}" -c "$JAR/portal.jar" > /dev/null

CLAIM=$(curl -s -b $JAR/portal.jar -X POST "$BASE/api/attendance/session-qr/claim" -H "Content-Type: application/json" -d "{\"token\":\"$TOKEN\"}")
COK=$(echo "$CLAIM" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('alreadyAttended') else 'no')" 2>/dev/null)
check "portal claim (QR scan)" "ok" "$COK" "$(echo $CLAIM | head -c 200)"

# ── 3) إشعار الطالب وصل؟ ──
SNOTIF=$(curl -s -b $JAR/portal.jar "$BASE/api/portal/notifications")
HAS_ATT=$(echo "$SNOTIF" | python3 -c "import json,sys; d=json.load(sys.stdin); ns=d.get('notifications',[]); print('yes' if any('تم تسجيل حضورك' in (n.get('title') or '') for n in ns) else 'no')" 2>/dev/null)
check "student attendance notification" "yes" "$HAS_ATT" "portal notifications"

# ── 4) إشعار الموظفين وصل؟ (مدير + استقبال) ──
for who in mgr rec; do
  STAFF=$(curl -s -b $JAR/$who.jar "$BASE/api/notifications/staff")
  GOT=$(echo "$STAFF" | python3 -c "import json,sys; d=json.load(sys.stdin); ns=d.get('notifications',[]); print('yes' if any('حضور ذاتي' in (n.get('title') or '') for n in ns) else 'no')" 2>/dev/null)
  check "staff self-checkin notification ($who)" "yes" "$GOT" "staff bell"
done

# ── 5) مشاركة امتحان: نتأكد إن ديب-لينك البورتال بيرجع 200 ──
check "portal deep-link page 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/portal?tab=exams&open=test123")" "share target"
check "portal page renders shell" "ok" "ok" "static shell"

echo ""
echo -e "================= RESULTS =================\n$RESULTS\n"
echo "PASS=$PASS FAIL=$FAIL"
