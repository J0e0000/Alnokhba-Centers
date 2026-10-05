#!/bin/bash
# ============================================================
# E2E test — الحضور العام بقفل الجهاز (Session-Scoped Device-Locked Attendance)
# القاعدة الأساسية: جهاز واحد = حضور واحد ناجح لكل حصة
#   unique(session_id, device_id) على مستوى الداتابيز = الحكم النهائي
#
# يغطي حواف الـ spec (Case 1..12):
#   peek عام + pv + مفيش IDs حساسة | حضور بدون تسجيل دخول | قفل الجهاز
#   | idempotent retry | سباقات متزامنة (نفس طالب/طالبين) | منتهي/متدوّر
#   | نافذة السماح بإثبات sighting | حصة مقفولة | IP علم مش رفض | قدرة OFF
# Run: bash scripts/e2e_device_lock.sh
# ============================================================
BASE="http://localhost:3000"
JAR=/tmp/nk-jars-dlock
mkdir -p $JAR
PASS=0; FAIL=0; RESULTS=""

check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); RESULTS="$RESULTS\n✅ $1 → $3";
  else FAIL=$((FAIL+1)); RESULTS="$RESULTS\n❌ $1 → expected [$2], got [$3]"; fi; }

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

# ── تجهيزات: حصة مفتوحة + 7 طلاب تجريبيين (idempotent) ──
FIX=$(cd /home/z/my-project && bun scripts/make_lock_students.ts 2>/dev/null | tail -1)
SESSION=$(jget "$FIX" sessionId)
C1=$(jget "$FIX" codes[0]); C2=$(jget "$FIX" codes[1]); C3=$(jget "$FIX" codes[2])
C4=$(jget "$FIX" codes[3]); C5=$(jget "$FIX" codes[4]); C6=$(jget "$FIX" codes[5]); C7=$(jget "$FIX" codes[6])
echo "session: $SESSION | codes: $C1..$C7"
[ -n "$SESSION" ] || { echo "NO SESSION — abort"; exit 1; }

D1="11111111-1111-4111-8111-111111111111"
D2="22222222-2222-4222-8222-222222222222"
D3="33333333-3333-4333-8333-333333333333"
D4="44444444-4444-4444-8444-444444444444"
D5="55555555-5555-4555-8555-555555555555"
D6="66666666-6666-4666-8666-666666666666"
D7="77777777-7777-4777-8777-777777777777"
D9="99999999-9999-4999-8999-999999999999"

issue_slot() { curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" \
  -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION\",\"slotSeconds\":$1}" 2>/dev/null; }
peek() { curl -s "$BASE/api/attendance/public/peek?token=$1&deviceId=$2" 2>/dev/null; }
checkin() { # token device code [pv] [xff-ip]
  curl -s -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
    ${5:+-H "X-Forwarded-For: $5"} \
    -d "{\"token\":\"$1\",\"deviceId\":\"$2\",\"code\":\"$3\"${4:+,\"pv\":\"$4\"}}" 2>/dev/null; }

# ══════════ 1) peek + إثبات sighting (pv) ══════════
S1=$(issue_slot 10); T1=$(jget "$S1" token)
P1=$(peek "$T1" "$D1")
check "peek valid + اسم الحصة" "True" "$(echo "$P1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(bool(d.get('valid')) and bool(d.get('sessionLabel')))")"
PV1=$(jget "$P1" pv)
check "peek يصدر إثبات sighting (pv)" "True" "$([ ${#PV1} -ge 50 ] && echo True || echo False)"
P_BAD=$(peek "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$D1")
# ملاحظة: resolveSessionQr بيدمج "مش موجود" مع "متدوّر" في نفس الكود INACTIVE عمدًا
# (مفيش oracle يكشف إيه التوكنات الموجودة) — فالمرتين بيرجعوا REPLAYED من الـ peek
check "peek توكن غير معروف → مرفوض (REPLAYED — دمج مقصود)" "REPLAYED" "$(jget "$P_BAD" reason)"

# ══════════ 2) طلب شكله غلط → 400 (spec §10 خطوة 1) ══════════
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
  -d "{\"token\":\"$T1\",\"deviceId\":\"not-a-uuid\",\"code\":\"$C1\"}")
check "device id شكله غلط → 400" "400" "$R"
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
  -d "{\"token\":\"$T1\",\"deviceId\":\"$D1\",\"code\":\"abc\"}")
check "كود بحروف → 400" "400" "$R"
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
  -d "{\"token\":\"$T1\",\"deviceId\":\"$D1\"}")
check "ناقص كود → 400" "400" "$R"

# ══════════ 3) الحضور الناجح الأول (Case 1) — بدون أي تسجيل دخول ══════════
R=$(checkin "$T1" "$D1" "$C1")
check "حضور ناجح (كود الطالب بس — بدون تسجيل دخول)" "False" "$(jget "$R" alreadyAttended)"
check "  → كود الطالب رجع في الرد" "$C1" "$(jget "$R" studentCode)"
check "  → مفيش بيانات مالية في الرد العام (خصوصية)" "False" "$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);print('balance' in d or 'amountDue' in d or 'charged' in d)")"

# ══════════ 4) نفس الجهاز → طالب تاني → ⛔ قفل الجهاز (Case 2/11) ══════════
S2=$(issue_slot 10); T2=$(jget "$S2" token)
P2=$(peek "$T2" "$D1"); PV2=$(jget "$P2" pv)
R=$(checkin "$T2" "$D1" "$C2" "$PV2")
check "نفس الجهاز + طالب تاني → DEVICE_LOCKED" "DEVICE_LOCKED" "$(jget "$R" reason)"

# ══════════ 5) إعادة المحاولة/الريفرش → idempotent (Case 3/4) ══════════
S3=$(issue_slot 10); T3=$(jget "$S3" token)
R=$(checkin "$T3" "$D1" "$C1")
check "نفس الجهاز + نفس الطالب → alreadyAttended" "True" "$(jget "$R" alreadyAttended)"
R=$(checkin "$T3" "$D2" "$C1")
check "نفس الطالب من جهاز تاني → alreadyAttended" "True" "$(jget "$R" alreadyAttended)"

# ══════════ 6) سباق متزامن — نفس الجهاز + نفس الطالب (Case 12) ══════════
S4=$(issue_slot 10); T4=$(jget "$S4" token)
checkin "$T4" "$D3" "$C3" > /tmp/dl_r1.json &
checkin "$T4" "$D3" "$C3" > /tmp/dl_r2.json &
wait
CNT=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions/$SESSION" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(sum(1 for a in d['attendance'] if a['code']=='$C3' and a.get('method')=='SESSION_QR'))")
check "سباق (نفس الجهاز+نفس الطالب): صف حضور واحد بالظبط" "1" "$CNT"

# ══════════ 7) سباق متزامن — نفس الجهاز + طالبين مختلفين (Case 11/12) ══════════
S5=$(issue_slot 10); T5=$(jget "$S5" token)
checkin "$T5" "$D7" "$C4" > /tmp/dl_r3.json &
checkin "$T5" "$D7" "$C5" > /tmp/dl_r4.json &
wait
TOT=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions/$SESSION" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(sum(1 for a in d['attendance'] if a['code'] in ('$C4','$C5') and a.get('method')=='SESSION_QR'))")
check "سباق طالبين من نفس الجهاز: حضور واحد بس اتعمل" "1" "$TOT"
LOSER=$(python3 -c "
import json
a=json.load(open('/tmp/dl_r3.json')); b=json.load(open('/tmp/dl_r4.json'))
if a.get('reason')=='DEVICE_LOCKED': print('$C4')
elif b.get('reason')=='DEVICE_LOCKED': print('$C5')
else: print('')")
check "  → واحد قُبل والتاني DEVICE_LOCKED" "True" "$([ -n "$LOSER" ] && echo True || echo False)"

# ══════════ 8) توكن منتهي بدون pv (Case 5) ══════════
S6=$(issue_slot 5); T6=$(jget "$S6" token)
sleep 11
R=$(checkin "$T6" "$D2" "$C2")
check "توكن منتهي + بدون pv → EXPIRED_TOKEN" "EXPIRED_TOKEN" "$(jget "$R" reason)"

# ══════════ 9) نافذة السماح: pv (شاف الكود وهو حي) بعد انتهاء التوكن ══════════
S7=$(issue_slot 5); T7=$(jget "$S7" token)
P7=$(peek "$T7" "$D5"); PV7=$(jget "$P7" pv)
sleep 11   # الكود مات — بس الطالب فتح الصفحة وهو حي وبيكتب كوده
R=$(checkin "$T7" "$D5" "$LOSER" "$PV7")
check "pv صحيح بعد انتهاء الكود → مقبول (grace)" "False" "$(jget "$R" alreadyAttended)"

# ══════════ 10) توكن متدوّر فعليًا = سكرين شوت (legacy rotate) + ربط pv بالجهاز ══════════
# موديل Slot: الأكواد بتموت بالعمر (مفيش deactivate) — التدوير الفعلي (قفل القديم) موجود
# في مسار issueSessionQr — بنستخدمه هنا نختبر REPLAYED الحقيقي.
LT=$(jget "$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\"}")" token)
PL=$(peek "$LT" "$D6"); PVL=$(jget "$PL" pv)
curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\"}" > /dev/null   # rotate → LT بقى غير نشط
R=$(checkin "$LT" "$D6" "$C6")
check "توكن متدوّر فعليًا بدون pv → REPLAYED_TOKEN" "REPLAYED_TOKEN" "$(jget "$R" reason)"
R=$(checkin "$LT" "$D6" "$C6" "$PVL")
check "توكن متدوّر + pv حي سابقًا (نفس الجهاز) → مقبول (grace)" "False" "$(jget "$R" alreadyAttended)"
# pv مربوط بالجهاز اللي شاف الكود — جهاز تاني ياخد نفس الـ pv → مرفوض
SL=$(issue_slot 5); TL=$(jget "$SL" token)
PVD=$(jget "$(peek "$TL" "$D6")" pv)
sleep 11
R=$(checkin "$TL" "$D2" "$C2" "$PVD")
check "pv جهاز تاني (سرقة pv) → مرفوض EXPIRED_TOKEN" "EXPIRED_TOKEN" "$(jget "$R" reason)"

# ══════════ 11) الحصة المقفولة (Case 6) — الـ QR بيموت مع القفل ══════════
# ننشئ حصة قصيرة (دقيقة واحدة — لتجنب تعارض تشغيلات سابقة) ونقفلها
S9ID=""; S9T=""
for try in 1 2 3 4 5; do
  M=$((RANDOM % 58))
  S9=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/sessions" -H "Content-Type: application/json" \
    -d "{\"groupId\":\"$(jget "$FIX" groupId)\",\"startTime\":\"23:$M\",\"endTime\":\"23:$((M+1))\"}")
  S9ID=$(jget "$S9" session.id); [ -n "$S9ID" ] || S9ID=$(jget "$S9" id)
  [ -n "$S9ID" ] && break
  sleep 1
done
S9T=$(jget "$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr/slot" -H "Content-Type: application/json" -d "{\"sessionId\":\"$S9ID\",\"slotSeconds\":15}")" token)
curl -s -b $JAR/mgr.jar -X POST "$BASE/api/sessions/$S9ID" -H "Content-Type: application/json" -d '{"action":"close"}' > /dev/null
R=$(checkin "$S9T" "$D6" "$C2")
check "حصة مقفولة → CLOSED_SESSION (حتى بكود ممكن يكون حي)" "CLOSED_SESSION" "$(jget "$R" reason)"
PB=$(peek "$S9T" "$D6")
check "peek لحصة مقفولة → valid:false CLOSED" "CLOSED" "$(jget "$PB" reason)"

# ══════════ 12) نفس الـ IP: علم مش رفض (Case 10 + §14/§15) ══════════
IP="41.35.77.12"
S10=$(issue_slot 10); T10=$(jget "$S10" token)
for i in 1 2 3 4; do checkin "$T10" "$D9" "99999" "" "$IP" > /dev/null; done
P10=$(peek "$T10" "$D9"); PV10=$(jget "$P10" pv)
R=$(checkin "$T10" "$D9" "$C7" "$PV10" "$IP")
check "طالب شرعي من IP عليه محاولات → عادي مقبول (IP مش هوية)" "False" "$(jget "$R" alreadyAttended)"
AT=$(curl -s -b $JAR/mgr.jar "$BASE/api/attendance/public/attempts?sessionId=$SESSION")
check "  → علم SAME_IP ظهر بالعربي (علم مش رفض)" "True" "$(echo "$AT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
fl=[f for a in d['attempts'] for f in a['riskFlags']]
print(any('SAME_IP' in f or 'نفس الشبكة' in f for f in fl))")"

# ══════════ 13) قدرة المركز dynamic_qr OFF → رفض server-side (مش إخفاء UI) ══════════
curl -s -b $JAR/mgr.jar -X PATCH "$BASE/api/center/capabilities" -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"dynamic_qr","enabled":false}]}' > /dev/null
# الإبطال الفوري للكاش بعد تبديل القدرات بقى تلقائي (clearPeekCache في PATCH)

PB=$(peek "$T10" "$D1")
check "dynamic_qr OFF → peek CAPABILITY_OFF" "CAPABILITY_OFF" "$(jget "$PB" reason)"
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attendance/public/check-in" -H "Content-Type: application/json" \
  -d "{\"token\":\"$T10\",\"deviceId\":\"$D1\",\"code\":\"$C1\"}")
check "dynamic_qr OFF → check-in 403" "403" "$R"
curl -s -b $JAR/mgr.jar -X PATCH "$BASE/api/center/capabilities" -H "Content-Type: application/json" \
  -d '{"capabilities":[{"key":"dynamic_qr","enabled":true}]}' > /dev/null
PB=$(peek "$T10" "$D1")
check "  → القدمة رجعت ON (restore)" "True" "$(jget "$PB" valid)"

# ══════════ 14) صلاحيات سجل المحاولات + الخصوصية ══════════
R=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/attendance/public/attempts?sessionId=$SESSION")
check "attempts API بدون جلسة → 401" "401" "$R"
AT=$(curl -s -b $JAR/mgr.jar "$BASE/api/attendance/public/attempts?sessionId=$SESSION")
check "attempts (مدير): رفض جهاز/منتهي/قديم كلها متسجلة" "True" "$(echo "$AT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
outs={a['outcome'] for a in d['attempts']}
need={'DEVICE_LOCKED','EXPIRED_TOKEN','REPLAYED_TOKEN','INVALID_STUDENT','CLOSED_SESSION'}
print(len(outs & need) >= 4)")"
check "  → الـ IP مُقنّع في العرض (41.35.•.•)" "True" "$(echo "$AT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ips=[a['ip'] for a in d['attempts'] if a['ip']]
print(bool(ips) and all(('•' in i or i.endswith('…')) for i in ips))")"

# ══════════ 15) بيانات اللوحة: علم خطورة على صف الحضور ══════════
SESS=$(curl -s -b $JAR/mgr.jar "$BASE/api/sessions/$SESSION")
check "حضور مقبول عليه علم خطورة (riskScore>0) ظاهر للوحة" "True" "$(echo "$SESS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(any((a.get('riskScore') or 0)>0 for a in d['attendance']))")"

# ══════════ 16) الرابط العام بدون IDs حساسة (spec §21) ══════════
LEG=$(curl -s -b $JAR/mgr.jar -X POST "$BASE/api/attendance/session-qr" -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION\"}")
check "مسار الـ QR العام = /a/<token> (توكن opaque بس)" "/a/" "$(echo "$LEG" | python3 -c "import json,sys;print(json.load(sys.stdin).get('path','')[:3])")"

# ══════════ 17) قاعدة الداتابيز النهائية: مفيش (sessionId,deviceId) مكرر ══════════
DBCHECK=$(cd /home/z/my-project && bun -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.attendance.groupBy({
    by: ['sessionId', 'deviceId'],
    where: { sessionId: '$SESSION', deviceId: { not: null } },
    _count: { _all: true },
  });
  const dup = rows.filter(r => r._count._all > 1);
  console.log(dup.length === 0 ? 'UNIQUE-OK' : 'DUP-FOUND');
  await p.\$disconnect();
})();
" 2>/dev/null | tail -1)
check "فحص الداتابيز مباشرة: unique(sessionId,deviceId) سليم" "UNIQUE-OK" "$DBCHECK"

echo ""
echo "═════════ Device-Lock Attendance Suite: $PASS passed, $FAIL failed ═════════"
echo -e "$RESULTS"
[ "$FAIL" = "0" ]
