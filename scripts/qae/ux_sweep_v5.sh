#!/bin/bash
# UX Sweep v5 — مصفوفة كاملة: دور × ثيم × 6 فيوبورتات × كل الشاشات
# المخرجات: qae/results/ux-sweep-v5.jsonl (مقاييس) + لقطات في qae/results/ux5/
OUT=/home/z/my-project/qae/results/ux5
JSONL=/home/z/my-project/qae/results/ux-sweep-v5.jsonl
B=http://localhost:3000
mkdir -p "$OUT"
: > "$JSONL"

VIEWS="home today scan students messages payments accounting books reports schedule groups teachers approvals emergency settings"
VIEWPORTS="360x800 390x844 768x1024 1024x768 1280x800 1440x900"

# ===== دالة قياس الصفحة (overflow + تغطية عناصر تفاعلية بشاشات عائمة) =====
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

shot() { # $1 = name
  agent-browser screenshot "$OUT/$1.png" >/dev/null 2>&1
}

sweep_role() { # $1=role(user) $2=shotspec(m360,m390,...) — أمثلة: light:m360,m390
  local user="$1" themeshots="$2"
  for vp in $VIEWPORTS; do
    W=${vp%x*}; H=${vp#*x}
    agent-browser set viewport "$W" "$H" >/dev/null 2>&1
    for theme in light dark; do
      case "$theme" in light) agent-browser set media light >/dev/null 2>&1;; dark) agent-browser set media dark >/dev/null 2>&1;; esac
      # هل الثيم ده من ضمن اللي هنصوره؟
      TAKE_SHOT=0
      case ",$themeshots," in *",${theme}:${vp},"*) TAKE_SHOT=1;; esac
      for v in $VIEWS; do
        agent-browser open "$B/app?r=$RANDOM#$v" >/dev/null 2>&1
        sleep 2
        M=$(measure)
        echo "{\"role\":\"$user\",\"theme\":\"$theme\",\"vp\":\"$vp\",\"view\":\"$v\",\"m\":$M}" >> "$JSONL"
        [ "$TAKE_SHOT" = "1" ] && shot "${user}-${theme}-${vp}-${v}"
      done
      echo "… $user $theme $vp done ($(wc -l < "$JSONL") rows)" >&2
    done
  done
}

# ===== تسجيل الدخول لكل دور =====
login_user() {
  agent-browser cookies clear >/dev/null 2>&1
  agent-browser open "$B/login" >/dev/null 2>&1
  sleep 2
  agent-browser find label "اسم المستخدم" fill "$1" >/dev/null 2>&1 || return 1
  agent-browser find label "كلمة السر" fill "nokhba123" >/dev/null 2>&1
  agent-browser find role button click --name "دخول" >/dev/null 2>&1
  sleep 3.5
  agent-browser get url 2>/dev/null | grep -q "/app" && echo "login ok: $1" >&2 || { echo "LOGIN FAILED: $1" >&2; return 1; }
}

echo "=== warm-up (تسخين compile الديف) ==="
login_user manager
agent-browser set viewport 1280 800 >/dev/null 2>&1
for v in $VIEWS; do agent-browser open "$B/app?r=$RANDOM#$v" >/dev/null 2>&1; sleep 2.5; done
echo "warm-up done" >&2

echo "=== MANAGER: light[m360,m390,t768,d1280] + dark[m390] ==="
sweep_role manager "light:360x800,light:390x844,light:768x1024,light:1280x800,dark:390x844"

echo "=== RECEPTION: light[m360,m390] + dark[m390] ==="
login_user reception
sweep_role reception "light:360x800,light:390x844,dark:390x844"

echo "=== TEACHER PORTAL: light[m390,d1024] ==="
agent-browser cookies clear >/dev/null 2>&1
agent-browser open "$B/teacher" >/dev/null 2>&1
sleep 2
agent-browser find label "رقم الموبايل" fill "01011112222" >/dev/null 2>&1
agent-browser find label "كود المدرس" fill "1234" >/dev/null 2>&1
agent-browser find role button click --name "دخول" >/dev/null 2>&1
sleep 3
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser set media light >/dev/null 2>&1
for t in home schedule message; do
  agent-browser open "$B/teacher?r=$RANDOM#t=$t" >/dev/null 2>&1
  sleep 2
  M=$(measure)
  echo "{\"role\":\"teacher\",\"theme\":\"light\",\"vp\":\"390x844\",\"view\":\"$t\",\"m\":$M}" >> "$JSONL"
  shot "teacher-light-390x844-$t"
done
agent-browser set viewport 1024 768 >/dev/null 2>&1
for t in home schedule message; do
  agent-browser open "$B/teacher?r=$RANDOM#t=$t" >/dev/null 2>&1
  sleep 2
  M=$(measure)
  echo "{\"role\":\"teacher\",\"theme\":\"light\",\"vp\":\"1024x768\",\"view\":\"$t\",\"m\":$M}" >> "$JSONL"
  shot "teacher-light-1024x768-$t"
done

echo "=== SWEEP V5 DONE: $(wc -l < "$JSONL") measurements ==="
