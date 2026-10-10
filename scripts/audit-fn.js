(() => {
  const cv = document.createElement("canvas");
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();

  function tryParse(color) {
    if (!color) return null;
    if (cache.has(color)) return cache.get(color);
    let out = null;
    if (color === "transparent" || color === "rgba(0, 0, 0, 0)") {
      out = [0, 0, 0, 0];
    } else {
      try {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = "#123456";
        const before = cx.fillStyle;
        cx.fillStyle = color;
        if (cx.fillStyle !== before || color.toLowerCase().replace("#", "") === "123456") {
          cx.fillRect(0, 0, 1, 1);
          const d = cx.getImageData(0, 0, 1, 1).data;
          out = [d[0], d[1], d[2], d[3] / 255];
        }
      } catch (e) { out = null; }
    }
    cache.set(color, out);
    return out;
  }

  function extractColorTokens(str) {
    const tokens = [];
    const re = /(#[0-9a-fA-F]{3,8})(?![0-9a-fA-F])|\b(rgba?|hsla?|color-mix|oklch|oklab|color)\(/g;
    let m;
    while ((m = re.exec(str))) {
      if (m[1]) { tokens.push(m[1]); continue; }
      let depth = 0, i = m.index + m[0].length - 1;
      for (; i < str.length; i++) {
        if (str[i] === "(") depth++;
        else if (str[i] === ")") { depth--; if (depth === 0) break; }
      }
      tokens.push(str.slice(m.index, i + 1));
    }
    return tokens;
  }

  function blend(top, bottom) {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [
      Math.round((top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / a),
      Math.round((top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / a),
      Math.round((top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / a),
      a,
    ];
  }

  function effectiveBackground(el) {
    let acc = null;
    let node = el;
    while (node && node instanceof Element) {
      const cs = getComputedStyle(node);
      const bi = cs.backgroundImage;
      if (bi && bi !== "none" && bi.indexOf("gradient") >= 0) {
        const toks = extractColorTokens(bi).map(tryParse).filter((t) => t && t[3] > 0);
        if (toks.length) {
          const cands = [];
          for (const t of toks) {
            if (t[3] >= 0.999) cands.push(t);
            else if (acc) cands.push(blend(t, acc));
          }
          if (cands.length) return cands;
        }
      }
      const c = tryParse(cs.backgroundColor);
      if (c && c[3] > 0) {
        acc = acc ? blend(c, acc) : c;
        if (acc[3] >= 0.995) return [acc];
      }
      node = node.parentElement;
    }
    const rootBg = tryParse(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1];
    if (!acc) return [rootBg[3] > 0 ? rootBg : [255, 255, 255, 1]];
    return [acc[3] >= 0.995 ? acc : blend(acc, rootBg[3] > 0 ? rootBg : [255, 255, 255, 1])];
  }

  function lum(rgb) {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function hex(c) {
    const p = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return "#" + p(c[0]) + p(c[1]) + p(c[2]) + (c[3] < 0.999 ? " a" + Math.round(c[3] * 100) / 100 : "");
  }

  function hasHiddenAncestor(el) {
    let n = el;
    while (n && n instanceof Element) {
      const cs = getComputedStyle(n);
      if (cs.opacity === "0") return true;
      if (cs.visibility === "hidden") return true;
      n = n.parentElement;
    }
    return false;
  }

  function pathOf(el) {
    let s = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") {
      const c = el.className.trim().split(/\s+/).slice(0, 3).join(".");
      if (c) s += "." + c;
    }
    return s;
  }

  const map = new Map();
  let checked = 0;

  function record(key, info) {
    if (!map.has(key)) map.set(key, Object.assign({}, info, { samples: [] }));
    const e = map.get(key);
    if (e.samples.length < 5) e.samples.push(info.sample);
  }

  function auditTextEl(el, text, colorCss, kind) {
    const cs = getComputedStyle(el);
    if (cs.display === "none") return;
    if (hasHiddenAncestor(el)) return;
    if ((el.className || "").toString().includes("sr-only")) return;
    const range = document.createRange();
    let rects;
    try {
      range.selectNodeContents(el.childNodes.length === 1 ? el.firstChild : el);
      rects = range.getClientRects();
    } catch (e) { return; }
    if (!rects.length || rects[0].width < 1 || rects[0].height < 1) return;

    const fg = tryParse(colorCss);
    if (!fg) return;
    const size = parseFloat(cs.fontSize) || 16;
    const weightNum = parseInt(cs.fontWeight, 10);
    const weight = isNaN(weightNum) ? (cs.fontWeight === "bold" ? 700 : 400) : weightNum;
    const bold = weight >= 700;
    const large = kind === "text" && (size >= 24 || (size >= 18.66 && bold));
    const disabled = kind === "text" && !!(el.closest("[disabled], [aria-disabled=true]") || cs.cursor === "not-allowed");
    const bgs = effectiveBackground(el);

    let worst = null;
    for (const bg of bgs) {
      const effFg = fg[3] >= 0.995 ? fg : blend(fg, bg);
      const r = contrast(effFg, bg);
      if (!worst || r < worst.ratio) worst = { ratio: r, fg: effFg, bg };
    }
    if (!worst) return;
    checked++;
    const need = disabled ? 3.0 : (large ? 3.0 : 4.5);
    if (worst.ratio < need) {
      const key = [hex(fg), hex(worst.bg), large, disabled, kind].join("|");
      record(key, {
        ratio: Math.round(worst.ratio * 100) / 100,
        fg: hex(fg), bg: hex(worst.bg),
        large, disabled, kind,
        size: Math.round(size * 10) / 10, weight,
        sample: text.slice(0, 48) + " ← " + pathOf(el),
      });
    }
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent && n.textContent.trim().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement;
    if (!el) continue;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    const text = node.textContent.trim();
    if (!text) continue;
    auditTextEl(el, text, getComputedStyle(el).color, "text");
  }

  document.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    if (hasHiddenAncestor(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const pcs = getComputedStyle(el, "::placeholder");
    auditTextEl(el, "[placeholder] " + (el.getAttribute("placeholder") || ""), pcs.color, "placeholder");
  });

  const issues = Array.from(map.values()).sort((a, b) => a.ratio - b.ratio);
  return { checked, issues };
})()
