#!/bin/bash
# التحقق النهائي: بعد سكرول لآخر الصفحة — مين لسه متغطي فعلاً؟ (دي البق الحقيقية)
B=http://localhost:3000
agent-browser set media light >/dev/null 2>&1
agent-browser cookies clear >/dev/null 2>&1
agent-browser open "$B/login?r=$RANDOM" >/dev/null 2>&1 && sleep 2
agent-browser find label "اسم المستخدم" fill "manager" >/dev/null 2>&1
agent-browser find label "كلمة السر" fill "nokhba123" >/dev/null 2>&1
agent-browser find role button click --name "دخول" >/dev/null 2>&1
sleep 3.5

CHECK='
(() => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  return new Promise(res => setTimeout(() => {
    const fixed = [...document.querySelectorAll("body *")].filter(el => {
      const s = getComputedStyle(el);
      return (s.position === "fixed" || s.position === "sticky") && s.display !== "none" && el.offsetWidth > 0 && el.offsetHeight > 0;
    });
    const frects = fixed.map(el => ({el, r: el.getBoundingClientRect()})).filter(x => x.r.width > 4 && x.r.height > 4);
    const btns = [...document.querySelectorAll("button, a, input, [role=button], [role=tab]")].filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.pointerEvents !== "none";
    });
    let covered = 0; const samples = [];
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      for (const f of frects) {
        if (f.el.contains(b) || b.contains(f.el)) continue;
        if (cx >= f.r.left && cx <= f.r.right && cy >= f.r.top && cy <= f.r.bottom) {
          covered++;
          if (samples.length < 3) samples.push(((b.textContent||b.getAttribute("aria-label")||"btn").trim().slice(0,20)) + " y=" + Math.round(r.top));
          break;
        }
      }
    }
    res(JSON.stringify({atBottom: true, covered, samples}));
  }, 600));
})()
'

for combo in "390 844 students" "390 844 scan" "390 844 settings" "390 844 messages" "768 1024 students" "768 1024 books" "768 1024 teachers" "1024 768 schedule" "360 800 schedule"; do
  set -- $combo
  agent-browser set viewport $1 $2 >/dev/null 2>&1
  agent-browser open "$B/app?r=$RANDOM#$3" >/dev/null 2>&1
  sleep 2.2
  R=$(agent-browser eval "$CHECK" 2>/dev/null | tail -1)
  echo "$3 @$1x$2 → $R"
done
