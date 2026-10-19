#!/bin/bash
# UX Sweep v5 — تكملة من حيث توقف (reception من 768x1024 dark + teacher)
OUT=/home/z/my-project/qae/results/ux5
JSONL=/home/z/my-project/qae/results/ux-sweep-v5.jsonl
B=http://localhost:3000
mkdir -p "$OUT"

VIEWS="home today scan students messages payments accounting books reports schedule groups teachers approvals emergency settings"
VIEWPORTS="768x1024 1024x768 1280x800 1440x900"

measure() {
  agent-browser eval "
(() => {
  const vw = document.documentElement.clientWidth;
  const overflowX = document.documentElement.scrollWidth - vw;
  const fixed = [...document.querySelectorAll('body *')].filter(el => {
    const s = getComputedStyle(el);
    return (s.position === 'fixed' || s.position === 'sticky') && s.display !== 'none' && el.offsetWidth > 0 && el.offsetHeight > 0;
  });
  const frects = fixed.map(el => ({el, r: el.getBoundingClientRect()})).filter(x => x.r.width > 4 && x.r.height > 4);
  const btns = [...document.querySelectorAll('button, a, input, [role=button], [role=tab]')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.pointerEvents !== 'none';
  });
  let covered = 0; const samples = [];
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    for (const f of frects) {
      if (f.el.contains(b) || b.contains(f.el)) continue;
      if (cx >= f.r.left && cx <= f.r.right && cy >= f.r.top && cy <= f.r.bottom) {
        covered++;
        if (samples.length < 2) samples.push(((b.textContent||b.getAttribute('aria-label')||'btn').trim().slice(0,22)) + ' covered-by(' + (f.el.className||'').toString().split(' ')[0].slice(0,20) + ')');
        break;
      }
    }
  }
  return JSON.stringify({o: overflowX, c: covered, n: btns.length, s: samples});
})()
" 2>/dev/null | tail -1
}

shot() { agent-browser screenshot "$OUT/$1.png" >/dev/null 2>&1; }

# reception مازال مسجل — كمّل من 768x1024 (light فات مسبقًا، هنعيدها مش مشكلة؟ لأ — استبعدناها)
agent-browser get url 2>/dev/null | grep -q "/app" || { echo "NOT LOGGED IN — abort"; exit 1; }

for vp in $VIEWPORTS; do
  W=${vp%x*}; H=${vp#*x}
  agent-browser set viewport "$W" "$H" >/dev/null 2>&1
  for theme in light dark; do
    [ "$theme" = light ] && agent-browser set media light >/dev/null 2>&1 || agent-browser set media dark >/dev/null 2>&1
    TAKE_SHOT=0
    case ",light:390x844,dark:390x844," in *",${theme}:${vp},"*) TAKE_SHOT=1;; esac
    for v in $VIEWS; do
      agent-browser open "$B/app?r=$RANDOM#$v" >/dev/null 2>&1
      sleep 1.7
      M=$(measure)
      echo "{\"role\":\"reception\",\"theme\":\"$theme\",\"vp\":\"$vp\",\"view\":\"$v\",\"m\":$M}" >> "$JSONL"
      [ "$TAKE_SHOT" = "1" ] && shot "reception-${theme}-${vp}-${v}"
    done
    echo "reception $theme $vp done" >&2
  done
done

# ===== TEACHER =====
agent-browser cookies clear >/dev/null 2>&1
agent-browser open "$B/teacher" >/dev/null 2>&1
sleep 2
agent-browser find label "رقم الموبايل" fill "01011112222" >/dev/null 2>&1
agent-browser find label "كود المدرس" fill "1234" >/dev/null 2>&1
agent-browser find role button click --name "دخول" >/dev/null 2>&1
sleep 3
agent-browser set media light >/dev/null 2>&1
for vp in 390x844 1024x768; do
  W=${vp%x*}; H=${vp#*x}
  agent-browser set viewport "$W" "$H" >/dev/null 2>&1
  for t in home schedule message; do
    agent-browser open "$B/teacher?r=$RANDOM" >/dev/null 2>&1
    sleep 2
    M=$(measure)
    echo "{\"role\":\"teacher\",\"theme\":\"light\",\"vp\":\"$vp\",\"view\":\"$t\",\"m\":$M}" >> "$JSONL"
    shot "teacher-light-${vp}-$t"
  done
done

echo "=== RESUME DONE: $(wc -l < "$JSONL") total ==="
