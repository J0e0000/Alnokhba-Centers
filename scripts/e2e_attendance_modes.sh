#!/bin/bash
# ============================================================
# E2E test — وضعا الحضور: ROSTER (كشف/مجموعة) + OPEN (حضور مفتوح)
# spec: Database Attendance when a roster exists / Open Attendance when it doesn't
#   - الحضور المفتوح: اسم + كود بطول قابل للضبط (3..12) — مفيش hardcode 5
#   - الكشف: مطابقة بالكود + allowUnregistered + غياب مُشتق بعد القفل
#   - قفل الجهاز بيطبق على الوضعين: unique(sessionId, deviceId) في الداتابيز
#   - CSV export بعد القفل: BOM + أعمدة نظيفة + من غير بيانات أمنية
# Run: bash scripts/e2e_attendance_modes.sh  (dev server on :3000)
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-modes
mkdir -p $JAR
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected [$2], got [$3]"; fi; }
checkcontains() { if echo "$3" | grep -q "$2"; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → contains [$2]";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → missing [$2]"; fi; }
checknotcontains() { if echo "$3" | grep -q "$2"; then FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → should NOT contain [$2]";
  else PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → clean (no [$2])"; fi; }

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

# ── تنظيف حصص الاختبار من تشغيلات سابقة (تعارض مدرس/وقت) ──
(cd /home/z/my-project && bun scripts/cleanup_mode_tests.ts 2>/dev/null | tail -1) > /dev/null

# ── تجهيزات: مجموعة + طلاب كشف (idempotent — نفس سكريبت قفل الجهاز) ──
FIX=$(cd /home/z/my-project && bun scripts/make_lock_students.ts 2>/dev/null | tail -1)
RSESSION=$(jget "$FIX" sessionId)
RGROUP=$(jget "$FIX" groupId)
RC1=$(jget "$FIX" codes[0]); RC2=$(jget "$FIX" codes[1]); RC3=$(jget "$FIX" codes[2]); RC4=$(jget "$FIX" codes[3])
echo "roster session: $RSESSION | group: $RGROUP | codes: $RC1..$RC4"
[ -n "$RSESSION" ] || { echo "NO FIXTURE — abort"; exit 1; }

D1="aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1"
D2="aaaaaaaa-2222-4222-8222-aaaaaaaaaaa2"
D3="aaaaaaaa-3333-4333-8333-aaaaaaaaaaa3"
D4="aaaaaaaa-4444-4444-8444-aaaaaaaaaaa4"
D9="aaaaaaaa-9999-4999-8999-aaaaaaaaaaa9"

issue_slot() { curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$1\",\"slotSeconds\":60}" 2>/dev/null; }
peek() { curl -s "$BASE/api/attendance/public/peek?token=$1&deviceId=$2" 2>/dev/null; }
checkin() { # token device name code [pv]
  PV="$5"; [ -n "$PV" ] || PV="x"
  curl -s -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
    -d "{\"token\":\"$1\",\"deviceId\":\"$2\",\"name\":\"$3\",\"code\":\"$4\",\"pv\":\"$PV\"}" 2>/dev/null; }

TODAY=$(date +%F)

# ============================================================
# أ) الحضور المفتوح — طول كود 5
# ============================================================
O1=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"studentSource\":\"OPEN\",\"name\":\"اختبار مفتوح 5\",\"studentCodeLength\":5,\"startTime\":\"05:00\",\"endTime\":\"06:00\"}")
OS1=$(jget "$O1" session.id)
check "create OPEN session (codeLen=5)" "25" "${#OS1}"

SL1=$(issue_slot "$OS1")
T1=$(jget "$SL1" token)
check "slot QR works for OPEN session" "40" "${#T1}"

P1=$(peek "$T1" "$D1")
check "peek OPEN → studentSource" "OPEN" "$(jget "$P1" studentSource)"
check "peek OPEN → expectedCodeLength=5" "5" "$(jget "$P1" expectedCodeLength)"

R1=$(checkin "$T1" "$D1" "محمد علي إبراهيم" "43210")
check "OPEN check-in (name + 5-digit)" "True" "$(jget "$R1" ok)"

R2=$(checkin "$T1" "$D1" "شخص تاني خالص" "55555")
check "same device 2nd student → DEVICE_LOCKED" "DEVICE_LOCKED" "$(jget "$R2" reason)"

R3=$(checkin "$T1" "$D2" "سمير حسن" "4321")
check "wrong length (4 digits) rejected" "INVALID_CODE_LENGTH" "$(jget "$R3" reason)"

R4=$(checkin "$T1" "$D2" "سمير حسن" "432109")
check "wrong length (6 digits) rejected" "INVALID_CODE_LENGTH" "$(jget "$R4" reason)"

R5=$(checkin "$T1" "$D2" "سمير حسن قنديل" "43213")
# كود مختلف للطالب التاني — قفل الكود الجديد بيمنع تكرار نفس الكود من جهازين (مضاد النيابة)
check "2nd device different student (different code) OK" "True" "$(jget "$R5" ok)"

# 🆕 قفل الكود: نفس الكود من جهاز تاني → CODE_ALREADY_USED (كان مسموح قبل طبقة مكافحة الغش)
# (D4 لسه ماعندوش صف في OS1 — عشان نعزل قفل الكود عن قفل الجهاز)
R5B=$(checkin "$T1" "$D4" "سمير حسن قنديل" "43210")
check "same code from 2nd device → CODE_ALREADY_USED (anti-proxy)" "CODE_ALREADY_USED" "$(jget "$R5B" reason)"

R6=$(checkin "$T1" "$D3" "نور الهدى محمد, درجة" "43211")
check "name with comma accepted (CSV-safe later)" "True" "$(jget "$R6" ok)"

# ============================================================
# ب) الحضور المفتوح — طول كود 7 (مفيش hardcode)
# ============================================================
O2=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"studentSource\":\"OPEN\",\"name\":\"اختبار مفتوح 7\",\"studentCodeLength\":7,\"startTime\":\"06:00\",\"endTime\":\"07:00\"}")
OS2=$(jget "$O2" session.id)
SL2=$(issue_slot "$OS2")
T2=$(jget "$SL2" token)

R7=$(checkin "$T2" "$D4" "كريم عبد الرحمن" "7654321")
check "codeLen=7 → 7-digit works" "True" "$(jget "$R7" ok)"

R8=$(checkin "$T2" "$D9" "ميناء حسن" "54321")
check "codeLen=7 → 5-digit rejected" "INVALID_CODE_LENGTH" "$(jget "$R8" reason)"

# سباق متزامن: نفس الجهاز طالبين مرة واحدة → 1 قبول + 1 قفل جهاز
RS1=$(curl -s -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
  -d "{\"token\":\"$T2\",\"deviceId\":\"$D9\",\"name\":\"سباق واحد\",\"code\":\"1111111\"}" & 
  curl -s -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
  -d "{\"token\":\"$T2\",\"deviceId\":\"$D9\",\"name\":\"سباق اتنين\",\"code\":\"2222222\"}" &
  wait)
ACC=$(echo "$RS1" | grep -c '"ok":true'); LOCK=$(echo "$RS1" | grep -c 'DEVICE_LOCKED')
check "parallel same-device → 1 accepted" "1" "$ACC"
check "parallel same-device → 1 locked" "1" "$LOCK"

# ============================================================
# ج) قفل الحصة المفتوحة + CSV
# ============================================================
CL1=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/sessions/$OS1" -H "Content-Type: application/json" -d '{"action":"close"}')
check "close OPEN session" "True" "$(jget "$CL1" closed)"
check "close OPEN → mode=OPEN" "OPEN" "$(jget "$CL1" mode)"

R9=$(checkin "$T1" "$D4" "بعد القفل" "43212")
check "check-in after close rejected" "CLOSED_SESSION" "$(jget "$R9" reason)"

# CSV قبل القفل ممنوع
EX0=$(curl -s -b $JAR/mgr.jar -o /dev/null -w "%{http_code}" "$BASE/api/sessions/$OS2/export")
check "CSV before close → 400" "400" "$EX0"

EX=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions/$OS1/export")
BOM=$(echo "$EX" | head -c 3 | od -An -tx1 | tr -d ' \n')
check "CSV has UTF-8 BOM (efbbbf)" "efbbbf" "$BOM"
checkcontains "CSV header (اسم الطالب)" "اسم الطالب" "$EX"
checkcontains "CSV contains اسم with comma (quoted)" "نور الهدى محمد, درجة" "$EX"
checknotcontains "CSV has NO deviceId" "aaaaaaaa-1" "$EX"
checknotcontains "CSV has NO token" "$T1" "$EX"
checknotcontains "CSV has NO risk/device columns" "DEVICE" "$EX"

CNT=$(echo "$EX" | grep -c "43210\|43211\|43213")
check "CSV row count = 3 successful records" "3" "$CNT"

# غير مصرح ليه؟
EX1=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/sessions/$OS1/export")
check "CSV unauth → 401" "401" "$EX1"

# ============================================================
# د) وضع الكشف (ROSTER) — مطابقة + allowUnregistered
# ============================================================
P2=$(issue_slot "$RSESSION"); T3=$(jget "$P2" token)
P3=$(peek "$T3" "$D1")
check "peek ROSTER → studentSource" "ROSTER" "$(jget "$P3" studentSource)"
check "peek ROSTER → no code length" "" "$(jget "$P3" expectedCodeLength)"

RR1=$(checkin "$T3" "$D1" "احمد محمد سيد" "$RC1")
check "ROSTER valid student accepted" "True" "$(jget "$RR1" ok)"
check "ROSTER response = name from DB" "True" "$(echo "$RR1" | grep -q 'اختبار' && echo True || echo False)"

RR2=$(checkin "$T3" "$D2" "محدش يعرفه" "99999")
check "ROSTER unknown code rejected (allowUnreg=off)" "INVALID_STUDENT" "$(jget "$RR2" reason)"

# حصة كشف جديدة مع allowUnregistered=true
RRO=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/sessions -H "Content-Type: application/json" \
  -d "{\"studentSource\":\"ROSTER\",\"groupId\":\"$RGROUP\",\"startTime\":\"07:00\",\"endTime\":\"08:00\",\"allowUnregistered\":true}")
RROS=$(jget "$RRO" session.id)
P4=$(issue_slot "$RROS"); T4=$(jget "$P4" token)

RR3=$(checkin "$T4" "$D2" "زائر غير مسجل" "99998")
check "ROSTER+allowUnreg unknown code accepted" "True" "$(jget "$RR3" ok)"
check "ROSTER+allowUnreg → raw name echoed" "زائر غير مسجل" "$(jget "$RR3" studentName)"

RR4=$(checkin "$T4" "$D3" "" "99997")
check "ROSTER+allowUnreg without name rejected" "INVALID_NAME" "$(jget "$RR4" reason)"

RR5=$(checkin "$T4" "$D3" "احمد محمد سعيد الشريف" "$RC2")
check "ROSTER name-variant still accepted (soft check)" "True" "$(jget "$RR5" ok)"

# قفل حصة الكشف — الحسابات زي ما هي + CSV شغال
CL2=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/sessions/$RROS" -H "Content-Type: application/json" -d '{"action":"close"}')
check "close ROSTER session" "True" "$(jget "$CL2" closed)"
check "close ROSTER → mode=ROSTER" "ROSTER" "$(jget "$CL2" mode)"

EXR=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions/$RROS/export")
checkcontains "ROSTER CSV has registered student name" "طالب اختبار" "$EXR"
checkcontains "ROSTER CSV has نوع التسجيل" "نوع التسجيل" "$EXR"

# غياب مُشتق (من غير زرار): في تفاصيل حصة الكشف المقفولة
DET=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions/$RSESSION")
check "roster detail returns absent (derived)" "True" "$(echo "$DET" | grep -q '"absent":\[' && echo True || echo False)"

# التحضير الجماعي على حصة مفتوحة مرفوض
BK=$(curl -s -b $JAR/mgr.jar -X POST $BASE/api/attendance/mark -H "Content-Type: application/json" \
  -d "{\"bulk\":true,\"sessionId\":\"$OS2\"}")
check "bulk-mark on OPEN session rejected" "True" "$(echo "$BK" | grep -q 'حضور مفتوح' && echo True || echo False)"

# قائمة الحصص فيها بيانات المصدر
LST=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions")
check "sessions list has studentSource=OPEN" "OPEN" "$(echo "$LST" | python3 -c "
import json,sys
d=json.load(sys.stdin)
xs=[s for s in d['sessions'] if s['id']=='$OS1']
print(xs[0]['studentSource'] if xs else 'MISSING')")"
check "sessions list has studentSource=ROSTER" "ROSTER" "$(echo "$LST" | python3 -c "
import json,sys
d=json.load(sys.stdin)
xs=[s for s in d['sessions'] if s['id']=='$RSESSION']
print(xs[0]['studentSource'] if xs else 'MISSING')")"

# اقفل OS2 في الآخر (عشان ميفضلش مفتوح ويأثر على تشغيلات e2e تانية)
CL0=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/sessions/$OS2" -H "Content-Type: application/json" -d '{"action":"close"}')
check "close 2nd OPEN session" "True" "$(jget "$CL0" closed)"

echo ""
echo -e "$RESULTS"
echo "========================================"
echo "PASS: $PASS | FAIL: $FAIL"
[ $FAIL -eq 0 ] && echo "🎉 ALL CHECKS GREEN" || echo "⚠️ SOME CHECKS FAILED"

# ── تنظيف حصص الاختبار (عشان e2e_qr_slot يلاقي حصة الكشف بتاعة الـ fixture أول واحدة) ──
(cd /home/z/my-project && bun scripts/cleanup_mode_tests.ts 2>/dev/null | tail -1) > /dev/null
