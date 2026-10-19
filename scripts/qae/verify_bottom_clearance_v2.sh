#!/bin/bash
# التحقق v2 — سكرول الحاوية الفعلية لآخرها وبعدين قيس
B=http://localhost:3000
agent-browser set media light >/dev/null 2>&1

CHECK='
(() => {
  // لاقي حاوية السكرول الفعلية (أول عنصر overflow-y auto/scroll ارتفاعه كبير)
  const cand = [...document.querySelectorAll("body *")].filter(el => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 80 && el.clientHeight > 300;
  }).sort((a,b) => b.clientHeight - a.clientHeight);
  cand.forEach(el => el.scrollTop = el.scrollHeight);
  document.documentElement.scrollTop = document.documentElement.scrollHeight;
  document.body.scrollTop = document.body.scrollHeight;
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
    res(JSON.stringify({covered, samples, scrolled: cand.map(c => c.className.toString().slice(0,18) + ">" + (c.scrollHeight - c.clientHeight))}));
  }, 600));
})()
'

for combo in "390 844 students" "390 844 settings" "390 844 messages" "768 1024 students" "1024 768 schedule" "768 1024 teachers"; do
  set -- $combo
  agent-browser set viewport $1 $2 >/dev/null 2>&1
  agent-browser open "$B/app?r=$RANDOM#$3" >/dev/null 2>&1
  sleep 2.2
  R=$(agent-browser eval "$CHECK" 2>/dev/null | tail -1)
  echo "$3 @$1x$2 → $R"
done
