#!/bin/bash
# إعادة توليد لقطات شاشة الحضور على الموبايل — بشكل صحيح ومكرر
# الإصلاح: ?r=$RANDOM يفرض تحميل صفحة حقيقي (التنقل بالهاش بس مش بيرندر تاب جديد)
OUT=/home/z/my-project/qae/results
B=http://localhost:3000

agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser set media light >/dev/null 2>&1

# 1) لوحة الحضور الموحدة — أعلى الشاشة
agent-browser open "$B/app?r=$RANDOM#scan" >/dev/null 2>&1
sleep 3.5
agent-browser screenshot "$OUT/t1-att-mobile-top.png" >/dev/null 2>&1
M1=$(agent-browser eval "[...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>t&&t.length>15&&!t.includes('AlNokhba'))?.slice(0,40)" 2>/dev/null | tail -1)
echo "t1 (light, scan): $M1"

# 2) لوحة الحضور — الوضع الغامق
agent-browser set media dark >/dev/null 2>&1
agent-browser open "$B/app?r=$RANDOM#scan" >/dev/null 2>&1
sleep 3
agent-browser screenshot "$OUT/t2-att-mobile-dark.png" >/dev/null 2>&1
M2=$(agent-browser eval "[...document.querySelectorAll('p')].map(p=>p.textContent).find(t=>t&&t.length>15&&!t.includes('AlNokhba'))?.slice(0,40)" 2>/dev/null | tail -1)
echo "t2 (dark, scan): $M2"

agent-browser set media light >/dev/null 2>&1
echo "DONE"
