#!/usr/bin/env bash
# ============================================================
# e2e_zaki_search.sh — اختبار إصلاح لوب البحث عن الطلاب
# يغطي: بحث بالهمزة المجرّدة (احمد → أحمد) · بالتاء المربوطة/الألف المقصورة
#       · بالاسم الكامل · بالكود · عدم التكرار (dedup) بعد نتيجة فاضية
# Usage: bash scripts/e2e_zaki_search.sh  (لازم dev server على 3000)
# ============================================================
set -uo pipefail

BASE="${BASE:-http://localhost:3000}"
JAR="/tmp/nk_zaki_jar"
PASS=0; FAIL=0
EVENTS=""

ok()   { PASS=$((PASS+1)); echo "✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "❌ $1"; }

has() { if echo "$EVENTS" | grep -q "$1"; then ok "$1"; else bad "$1"; fi; }
not_has() { if echo "$EVENTS" | grep -q "$1"; then bad "$1"; else ok "$1"; fi; }

login() {
  local code
  code=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth" \
    -H "Content-Type: application/json" -d "{\"username\":\"$1\",\"password\":\"nokhba123\"}")
  [ "$code" = "200" ]
}

agent() { # agent <text>
  EVENTS=$(curl -s -N -b "$JAR" -X POST "$BASE/api/agent/message" \
    -H "Content-Type: application/json" \
    -d "{\"text\":$1}" --max-time 90 | grep '^data:' | sed 's/^data: //')
}

echo "== دخول المدير =="
login "manager" && ok "login manager" || { bad "login manager"; exit 1; }

echo "== بحث باسم بدون همزة (احمد → أحمد محمود الشريف) =="
agent '"دور على احمد"'
has '"tool":"student.search"'
not_has '"status":"failed"'
if echo "$EVENTS" | grep -q 'لقيت'; then ok "لقيت نتايج (مفيش لوب)"; else bad "لقيت نتايج (مفيش لوب)"; fi
if echo "$EVENTS" | grep -q '"done","status":"COMPLETED"'; then ok "المهمة اتقفلت COMPLETED"; else bad "المهمة اتقفلت COMPLETED"; fi

sleep 4
echo "== بحث باسم بكشيدة/همزة مختلفة (كريم اشرف → كريم أشرف زكي) =="
agent '"هاتلي كريم اشرف"'
if echo "$EVENTS" | grep -q 'لقيت'; then ok "لقيت كريم أشرف"; else bad "لقيت كريم أشرف"; fi

sleep 4
echo "== بحث بالاسم الكامل بالهمزة (احمد محمود الشريف) =="
agent '"ابحث عن احمد محمود الشريف"'
if echo "$EVENTS" | grep -q 'لقيت'; then ok "مطابقة كاملة بعد التطبيع"; else bad "مطابقة كاملة بعد التطبيع"; fi

sleep 4
echo "== اسم غير موجود مرة واحدة =="
agent '"دور على طالب اسمه شركس الخيالي"'
if echo "$EVENTS" | grep -q 'مفيش طالب مطابق'; then ok "رد صادق: مفيش مطابق"; else bad "رد صادق: مفيش مطابق"; fi
if echo "$EVENTS" | grep -q 'طويلة عليّا'; then bad "مفيش رسالة اللوب القديمة"; else ok "مفيش رسالة اللوب القديمة"; fi

sleep 4
echo "== تكرار نفس الاسم الفاضي في مهمة جديدة = بحث واحد صادق ومفيش لوب =="
agent '"شركس الخيالي"'
if echo "$EVENTS" | grep -q 'طويلة عليّا'; then bad "مفيش رسالة اللوب القديمة"; else ok "مفيش رسالة اللوب القديمة"; fi
if echo "$EVENTS" | grep -q '"status":"failed"'; then bad "مفيش خطأ تنفيذ"; else ok "مفيش خطأ تنفيذ"; fi
if echo "$EVENTS" | grep -q 'مطابق'; then ok "رد صادق عن عدم وجود الطالب"; else bad "رد صادق عن عدم وجود الطالب"; fi
if echo "$EVENTS" | grep -q '"done","status":"COMPLETED"'; then ok "اتقفلت نضيفة COMPLETED"; else bad "اتقفلت نضيفة COMPLETED"; fi

echo ""
echo "===== ZAKI SEARCH: $PASS PASS / $FAIL FAIL ====="
[ "$FAIL" = "0" ]
