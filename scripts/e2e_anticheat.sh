#!/bin/bash
# ============================================================
# E2E test — طبقة مكافحة الغش (anti-cheat layer)
#   1) قفل البصمة: نفس المتصفح بعد مسح البيانات/إنكوجنتو (deviceId جديد + نفس fp) → مرفوض
#   2) قفل الكود: كود الطالب من جهاز تاني (محاولة نيابة) → CODE_ALREADY_USED
#   3) كود القاعة المتغيّر (Room PIN): ناقص/غلط → مرفوض، صح → مقبول
#   4) شبكة القاعة المرجعية: تسجيل من IP مختلف → ACCEPTED + flag DIFFERENT_NETWORK
#   5) سباق البصمة: 4 أجهزة توازي بنفس fp → 1 مقبول + 3 مرفوض
#   6) idempotent ودّي: نفس الجهاز/نفس البصمة بنفس الكود → alreadyAttended (مش غش)
#   7) توافق رجعي: حصة من غير Room PIN → التسجيل بدون pin شغال
# Run: bash scripts/e2e_anticheat.sh  (dev server on :3000)
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-anticheat
mkdir -p $JAR
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected [$2], got [$3]"; fi; }
checkcontains() { if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → contains [$2]";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → missing [$2]"; fi; }

jget() { echo "$1" | python3 -c "
import json,sys,re
try: d=json.load(sys.stdin)
except: print(''); raise SystemExit
cur=d
for part in '$2'.split('.'):
    m=re.fullmatch(r'(\w+)\[(\d+)\]', part)
    if m:
        cur=(cur.get(m.group(1)) or [])[int(m.group(2))]
    else:
        cur=cur.get(part) if isinstance(cur,dict) else None
    if cur is None: break
print(cur if cur is not None else '')" 2>/dev/null; }

login() { curl -s -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$1\",\"password\":\"$2\"}" -c "$JAR/$3.jar" > /dev/null; }

login manager nokhba123 mgr

# ── تنظيف حصص الاختبار من تشغيلات سابقة (rerunnable) ──
(cd /home/z/my-project && bun scripts/cleanup_mode_tests.ts 2>/dev/null | tail -1) > /dev/null

# ── تجهيزات كشف (طلاب 99001..99008 — idempotent) ──
FIX=$(cd /home/z/my-project && bun scripts/make_lock_students.ts 2>/dev/null | tail -1)
RGROUP=$(jget "$FIX" groupId)
RC1=$(jget "$FIX" codes[0]); RC2=$(jget "$FIX" codes[1])
echo "roster fixture group: $RGROUP | codes: $RC1,$RC2"
[ -n "$RGROUP" ] || { echo "NO FIXTURE — abort"; exit 1; }

# أجهزة (deviceId عشوائي زي المتصفح) وبصمات ثابتة (زي نفس المتصفح الفيزيائي) — البصمات hex صالح 32 حرف
D1="b1000000-0000-4000-8000-000000000001"; FP1="$(printf 'a%.0s' {1..32})"   # موبايل أحمد
D2="b2000000-0000-4000-8000-000000000002"; # نفس المتصفح بعد مسح البيانات → deviceId جديد + نفس FP1
D3="b3000000-0000-4000-8000-000000000003"; FP3="$(printf 'b%.0s' {1..32})"   # موبايل حد تاني خالص
D4="b4000000-0000-4000-8000-000000000004"; FP4="$(printf 'c%.0s' {1..32})"
D5A="b5a00000-0000-4000-8000-00000000000a"; D5B="b5b00000-0000-4000-8000-00000000000b"
D5C="b5c00000-0000-4000-8000-00000000000c"; D5D="b5d00000-0000-4000-8000-00000000000d"
FP5="$(printf 'd%.0s' {1..32})"
D6="b6000000-0000-4000-8000-000000000006"; FP6="$(printf 'e%.0s' {1..32})"
D7="b7000000-0000-4000-8000-000000000007"; FP7="$(printf 'f%.0s' {1..32})"
D8="b8000000-0000-4000-8000-000000000008"; FP8="$(printf '9%.0s' {1..32})"

issue_slot() { curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$1\",\"slotSeconds\":10}" 2>/dev/null; }
peek() { curl -s "$BASE/api/attendance/public/peek?token=$1&deviceId=$2" 2>/dev/null; }
checkin() { # token device fp name code [pin] [ip]
  P="$6"; [ -n "$P" ] || P="x"
  IP="$7"; [ -n "$IP" ] || IP="203.0.113.10"
  curl -s -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
    -H "x-forwarded-for: $IP" \
    -d "{\"token\":\"$1\",\"deviceId\":\"$2\",\"fp\":\"$3\",\"name\":\"$4\",\"code\":\"$5\",\"pin\":\"$P\",\"pv\":\"x\"}" 2>/dev/null; }

TODAY=$(date +%F)
CROOM="203.0.113.10"   # شبكة القاعة (IP اللي بيتعلق عند إنشاء الحصة)

# ============================================================
# 1) حصة مفتوحة بكود قاعة (Room PIN) — الطبقات كلها
# ============================================================
O1=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -H "x-forwarded-for: $CROOM" \
  -d "{\"studentSource\":\"OPEN\",\"name\":\"اختبار مفتوح مكافحة الغش\",\"studentCodeLength\":5,\"startTime\":\"05:00\",\"endTime\":\"06:00\",\"requireRoomPin\":true}")
OS1=$(jget "$O1" session.id)
check "create OPEN session (roomPin=ON)" "25" "${#OS1}"

SL1=$(issue_slot "$OS1")
T1=$(jget "$SL1" token)
RP=$(jget "$SL1" roomPin)
check "slot returns roomPin" "4" "${#RP}"

PK1=$(peek "$T1" "$D1")
checkcontains "peek exposes requireRoomPin" '"requireRoomPin":true' "$PK1"
PV1=$(jget "$PK1" pv)
[ -n "$PV1" ] && PV1="$PV1" || PV1="x"

# (أ) الطالب الشرعي: أول تسجيل
R=$(checkin "$T1" "$D1" "$FP1" "أحمد محمد علي" "11111" "$RP" "$CROOM")
checkcontains "legal first check-in accepted" '"ok":true' "$R"

# (ب) نفس الجهاز نفس الكود (ريفرش/إعادة إرسال) → idempotent ودّي مش غش
R=$(checkin "$T1" "$D1" "$FP1" "أحمد محمد علي" "11111" "$RP" "$CROOM")
checkcontains "same device same code → idempotent ALREADY" '"alreadyAttended":true' "$R"

# (ج) نفس الجهاز كود تاني → DEVICE_LOCKED (قفل الجهاز)
R=$(checkin "$T1" "$D1" "$FP1" "محمد حسن" "22222" "$RP" "$CROOM")
checkcontains "same device different student → DEVICE_LOCKED" '"reason":"DEVICE_LOCKED"' "$R"

# (د) 🧪 الثغرة القديمة: مسح بيانات المتصفح/إنكوجنتو → deviceId جديد + نفس البصمة → مرفوض دلوقتي
R=$(checkin "$T1" "$D2" "$FP1" "أحمد تاني" "33333" "$RP" "$CROOM")
checkcontains "cleared-storage/incognito (new id + SAME fingerprint) → DEVICE_LOCKED" '"reason":"DEVICE_LOCKED"' "$R"

# (هـ) 🧪 النيابة: كود أحمد 11111 من موبايل تاني خالص → CODE_ALREADY_USED
R=$(checkin "$T1" "$D3" "$FP3" "كريم صاحب أحمد" "11111" "$RP" "$CROOM")
checkcontains "proxy attendance (same code, other device) → CODE_ALREADY_USED" '"reason":"CODE_ALREADY_USED"' "$R"

# (و) Room PIN غلط → WRONG_ROOM_PIN
WRONGPIN=$(python3 -c "p='$RP'; print(str((int(p[0])+1)%10)+p[1:])")
[ "$WRONGPIN" != "$RP" ] || WRONGPIN="0000"
R=$(checkin "$T1" "$D4" "$FP4" "سارة إبراهيم" "44444" "$WRONGPIN" "$CROOM")
checkcontains "wrong room PIN → WRONG_ROOM_PIN" '"reason":"WRONG_ROOM_PIN"' "$R"

# (ز) Room PIN صح + من شبكة تانية → مقبول + علم شبكة مختلفة
R=$(checkin "$T1" "$D4" "$FP4" "سارة إبراهيم" "44444" "$RP" "198.51.100.99")
checkcontains "correct PIN from different network → ACCEPTED" '"ok":true' "$R"

# (ح) سباق: 4 أجهزة متوازية بنفس البصمة → 1 بس بيكسب
rm -f /tmp/nk-race-*.json
checkin "$T1" "$D5A" "$FP5" "طالب سباق أحمد" "55555" "$RP" "$CROOM" > /tmp/nk-race-a.json &
checkin "$T1" "$D5B" "$FP5" "طالب سباق محمد" "66666" "$RP" "$CROOM" > /tmp/nk-race-b.json &
checkin "$T1" "$D5C" "$FP5" "طالب سباق كريم" "77777" "$RP" "$CROOM" > /tmp/nk-race-c.json &
checkin "$T1" "$D5D" "$FP5" "طالب سباق سارة" "88888" "$RP" "$CROOM" > /tmp/nk-race-d.json &
wait
OKS=$(cat /tmp/nk-race-*.json | grep -o '"ok":true' | wc -l)
LOCKED=$(cat /tmp/nk-race-*.json | grep -o '"reason":"DEVICE_LOCKED"' | wc -l)
check "fingerprint race (4 parallel, same fp) → exactly 1 winner" "1" "$OKS"
check "fingerprint race → 3 blocked" "3" "$LOCKED"

# ============================================================
# 2) حصة مفتوحة بدون Room PIN — توافق رجعي
# ============================================================
O2=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"studentSource\":\"OPEN\",\"name\":\"اختبار مفتوح من غير كود\",\"studentCodeLength\":6,\"startTime\":\"05:30\",\"endTime\":\"06:30\",\"requireRoomPin\":false}")
OS2=$(jget "$O2" session.id)
SL2=$(issue_slot "$OS2")
T2=$(jget "$SL2" token)
PK2=$(peek "$T2" "$D6")
checkcontains "peek: no room pin required" '"requireRoomPin":false' "$PK2"
PV2=$(jget "$PK2" pv)

R=$(checkin "$T2" "$D6" "$FP6" "منى خالد" "611111" "" "$CROOM")
checkcontains "no-PIN session: check-in without pin → ACCEPTED" '"ok":true' "$R"

# نفس الكود من جهاز تاني في الحصة دي كمان (قفل الكود شغال حتى بدون PIN)
R=$(checkin "$T2" "$D7" "$FP7" "هالة سمير" "611111" "" "$CROOM")
checkcontains "no-PIN session: code reuse from other device → CODE_ALREADY_USED" '"reason":"CODE_ALREADY_USED"' "$R"

# ============================================================
# 3) حصة كشف (ROSTER) بكود قاعة — الطالب الحقيقي
# ============================================================
O3=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -H "x-forwarded-for: $CROOM" \
  -d "{\"studentSource\":\"ROSTER\",\"groupId\":\"$RGROUP\",\"startTime\":\"07:00\",\"endTime\":\"08:00\",\"allowUnregistered\":true,\"requireRoomPin\":true}")
OS3=$(jget "$O3" session.id)
check "create ROSTER session (roomPin=ON)" "25" "${#OS3}"
SL3=$(issue_slot "$OS3")
T3=$(jget "$SL3" token)
RP3=$(jget "$SL3" roomPin)
check "roster slot returns roomPin" "4" "${#RP3}"

R=$(checkin "$T3" "$D7" "$FP7" "طالب اختبار القفل 1 محمد" "$RC1" "$RP3" "$CROOM")
checkcontains "roster: real student with correct PIN → ACCEPTED" '"ok":true' "$R"

# نفس الطالب من جهاز تاني (حتى ببصمة تانية) → ALREADY_SAME_STUDENT
R=$(checkin "$T3" "$D8" "$FP8" "طالب اختبار القفل 1 محمد" "$RC1" "$RP3" "$CROOM")
checkcontains "roster: same student other device → ALREADY (idempotent)" '"alreadyAttended":true' "$R"

# ============================================================
# 4) لوحة النشاط المشبوه — الأعلام الجديدة ظاهرة
# ============================================================
AT=$(curl -s -b $JAR/mgr.jar "$BASE/api/attendance/public/attempts?sessionId=$OS1" 2>/dev/null)
checkcontains "suspicious dashboard: DIFFERENT_NETWORK flag visible" "شبكة مختلفة" "$AT"
checkcontains "suspicious dashboard: code-reuse flag visible" "نيابة" "$AT"
checkcontains "suspicious dashboard: fingerprint-reuse flag visible" "نفس بصمة المتصفح" "$AT"
CODE_USED=$(echo "$AT" | grep -o "CODE_ALREADY_USED" | wc -l)
check "attempts log records CODE_ALREADY_USED outcome" "1" "$((CODE_USED > 0 ? 1 : 0))"

# ============================================================
# 5) تنظيف حصص الاختبار — عشان suites تانية (زي e2e_qr_slot) متتلخبطش
#    مع أول حصة OPEN في /api/today
# ============================================================
(cd /home/z/my-project && bun scripts/cleanup_mode_tests.ts 2>/dev/null | tail -1) > /dev/null

echo ""
echo "=================================================="
echo -e "$RESULTS"
echo "=================================================="
echo "PASS: $PASS | FAIL: $FAIL"
[ "$FAIL" = "0" ] && echo "ALL ANTICHEAT CHECKS GREEN ✅" || echo "❌ SOME CHECKS FAILED"
