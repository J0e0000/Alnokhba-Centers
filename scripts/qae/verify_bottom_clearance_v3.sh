#!/bin/bash
# التحقق v3 — سكرول بعجلة الماوس الحقيقية + فحص هندسي ثابت (من غير اعتماد على scrollTop)
B=http://localhost:3000
agent-browser set media light >/dev/null 2>&1

# فحص ثابت: آخر عنصر تفاعلي في الصفحة — هل بقع جوه منطقة الطوايف العائمة السفلية؟
STATIC='
(() => {
  const ih = innerHeight;
  // الطوايف السفلية الثابتة
  const fixedBottom = [...document.querySelectorAll("body *")].filter(el => {
    const s = getComputedStyle(el);
    if (s.position !== "fixed" || s.display === "none" || !el.offsetWidth) return false;
    const r = el.getBoundingClientRect();
    return r.top > ih * 0.6;
  });
  if (!fixedBottom.length) return JSON.stringify({noFixed: true});
  const zoneTop = Math.min(...fixedBottom.map(el => el.getBoundingClientRect().top));
  // آخر عنصر تفاعلي بإحداثيات المستند
  let last = null;
  for (const b of document.querySelectorAll("button, a, input, [role=button], [role=tab]")) {
    const s = getComputedStyle(b);
    if (s.visibility === "hidden" || s.pointerEvents === "none") continue;
    const r = b.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const docTop = r.top + scrollY;
    if (!last || docTop > last.docTop) last = {docTop, docBottom: docTop + r.height, label: (b.textContent||b.getAttribute("aria-label")||"btn").trim().slice(0,24)};
  }
  const safeBottom = document.documentElement.scrollHeight - zoneTop + scrollY;
  const overlap = last ? (last.docBottom - safeBottom) : 0;
  return JSON.stringify({zoneTopInDoc: Math.round(safeBottom), lastEl: last, overlapPx: Math.round(overlap)});
})()
'

for combo in "390 844 students" "390 844 messages" "390 844 payments" "390 844 settings" "768 1024 students" "768 1024 teachers" "768 1024 books" "1024 768 schedule" "390 844 scan" "360 800 home"; do
  set -- $combo
  agent-browser set viewport $1 $2 >/dev/null 2>&1
  agent-browser open "$B/app?r=$RANDOM#$3" >/dev/null 2>&1
  sleep 2.2
  R=$(agent-browser eval "$STATIC" 2>/dev/null | tail -1)
  echo "$3 @$1x$2 → $R"
done
