// الجزء الأول من تطبيق الطوارئ الأوفلاين (JS خالص، بدون أي مكتبات خارجية غير jsQR المدمج).
// يعمل كـ classic script عادي — بيتشارك المتغيرات العامة مع الجزء الثاني.

export const APP_JS_1 = `
// ================= ALNOKHBA MANAGEMENT — EMERGENCY MODE =================
"use strict";

var TAGS = { license: "nk-license-raw", snapshot: "nk-snapshot-raw", meta: "nk-meta" };
function textOf(id) {
  var el = document.getElementById(id);
  if (!el) return "";
  return (el.textContent || "").trim();
}
function b64ToBuf(b64) {
  var bin = atob(b64);
  var buf = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}
function hexOf(buf) {
  var arr = new Uint8Array(buf);
  var s = "";
  for (var i = 0; i < arr.length; i++) s += (arr[i] < 16 ? "0" : "") + arr[i].toString(16);
  return s;
}
function encUtf8(s) { return new TextEncoder().encode(s); }
function canonical(v) {
  var sort = function (x) {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") {
      var keys = Object.keys(x).sort();
      var o = {};
      for (var i = 0; i < keys.length; i++) o[keys[i]] = sort(x[keys[i]]);
      return o;
    }
    return x;
  };
  return JSON.stringify(sort(v));
}
async function sha256Hex(s) {
  var d = await crypto.subtle.digest("SHA-256", encUtf8(s));
  return hexOf(d);
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // fallback RFC4122 v4
  var b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var h = [];
  for (var i = 0; i < 16; i++) h.push((b[i] < 16 ? "0" : "") + b[i].toString(16));
  return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" + h.slice(10, 16).join("");
}
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// ================= الحالة العامة =================
var ST = {
  license: null, licenseRaw: "", snap: null,
  students: [], studentsById: {},
  groups: [], groupsById: {},
  teachers: [], teachersById: {},
  grades: [], gradesById: {},
  subjects: [], subjectsById: {},
  rooms: [], staff: [], schedule: [],
  sessions: [], sessionsById: {},
  att: {},            // "sessionId|studentId" -> سجل حضور
  balances: {},       // studentId -> piastres
  txns: [],           // معاملات الطوارئ ETX
  notes: [],          // ملاحظات/تحذيرات للتصدير
  actor: null,        // {id, name, role}
  seq: 0,
  expired: false, expiredReason: "",
  daysLeft: 0, effNow: 0,
  view: "dash",
  sessionDate: null,  // التاريخ المختار في صفحة الحصص
  booted: false,
};
var CLK = { off: 0 }; // إزاحة معملية لمحاكاة التلاعب بالساعة (اختبارات)
function clockNow() { return Date.now() + CLK.off; }

// ================= الفلوس (قروش — أرقام صحيحة دايمًا) =================
function egp(piastres) {
  var v = (piastres || 0) / 100;
  return (Math.round(v * 100) / 100).toFixed(2);
}
function egpSigned(piastres) {
  var p = piastres || 0;
  return (p > 0 ? "+" : "") + egp(p);
}
function amountDueToday(price, balance) {
  // نفس معادلة النظام الأساسي بالظبط (finance.ts)
  return Math.max(price - Math.max(balance, 0) + Math.abs(Math.min(balance, 0)), 0);
}
function effectivePrice(student, groupId) {
  for (var i = 0; i < (student.regs || []).length; i++) {
    if (student.regs[i].groupId === groupId && student.regs[i].priceOverride != null) return student.regs[i].priceOverride;
  }
  var g = ST.groupsById[groupId];
  return g ? g.sessionPrice : 0;
}

// ================= التخزين (IndexedDB مع fallback) =================
var storage = { kind: "none" };
function openIDB() {
  return new Promise(function (resolve) {
    var req;
    try { req = indexedDB.open("nkemg-" + ST.license.packageId, 1); }
    catch (e) { return resolve(null); }
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 4000);
    req.onupgradeneeded = function (ev) {
      var db = ev.target.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = function (ev) {
      if (done) return; done = true; clearTimeout(timer);
      var db = ev.target.result;
      resolve({
        kind: "idb",
        get: function (key) {
          return new Promise(function (res) {
            try {
              var tx = db.transaction("kv", "readonly").objectStore("kv").get(key);
              tx.onsuccess = function () { res(tx.result != null ? tx.result.value : null); };
              tx.onerror = function () { res(null); };
            } catch (e) { res(null); }
          });
        },
        set: function (key, value) {
          return new Promise(function (res) {
            try {
              var tx = db.transaction("kv", "readwrite").objectStore("kv").put({ key: key, value: value });
              tx.onsuccess = function () { res(true); };
              tx.onerror = function () { res(false); };
            } catch (e) { res(false); }
          });
        },
      });
    };
    req.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
    req.onblocked = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
  });
}
function makeLS() {
  var prefix = "nkemg-" + ST.license.packageId + ":";
  return {
    kind: "ls",
    get: function (key) {
      try { var v = localStorage.getItem(prefix + key); return v == null ? null : JSON.parse(v); }
      catch (e) { return null; }
    },
    set: function (key, value) {
      try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
  };
}
// نسخة احتياطية من سجل الاستخدام في localStorage دايمًا (ضد مسح IDB)
function usageBackup(v) {
  try { localStorage.setItem("nkemg-usage-" + ST.license.packageId, JSON.stringify(v)); } catch (e) {}
}
function usageBackupRead() {
  try { var v = localStorage.getItem("nkemg-usage-" + ST.license.packageId); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

// ================= سجل الاستخدام + منع التلاعب بالساعة =================
var USAGE = { wallHigh: 0, activeMs: 0, firstOpen: 0, bootCount: 0, lastBeat: 0 };
function effectiveNow() {
  var issued = new Date(ST.license.issuedAt).getTime();
  var byWall = USAGE.wallHigh || 0;
  var byActive = issued + (USAGE.activeMs || 0);
  return Math.max(clockNow(), byWall, byActive);
}
async function beatHeart(first) {
  var now = clockNow();
  if (first) {
    USAGE.firstOpen = USAGE.firstOpen || now;
    USAGE.bootCount = (USAGE.bootCount || 0) + 1;
    USAGE.lastBeat = now;
  } else if (USAGE.lastBeat) {
    var delta = now - USAGE.lastBeat;
    if (delta > 0 && delta < 120000) USAGE.activeMs = (USAGE.activeMs || 0) + delta; // حد أقصى دقيقتين للنبضة
    USAGE.lastBeat = now;
  }
  USAGE.wallHigh = Math.max(USAGE.wallHigh || 0, now);
  usageBackup(USAGE);
  await storage.set("usage", USAGE);
}
function evalExpiry() {
  ST.effNow = effectiveNow();
  var exp = new Date(ST.license.expiresAt).getTime();
  var issued = new Date(ST.license.issuedAt).getTime();
  ST.expired = ST.effNow >= exp || ST.effNow < issued - 6 * 3600 * 1000;
  ST.daysLeft = Math.max(0, Math.ceil((exp - ST.effNow) / 86400000));
}

// ================= التحقق من الرخصة والتوقيع =================
async function verifyBoot(meta) {
  if (!window.crypto || !crypto.subtle) return { ok: false, reason: "المتصفح ده مش بيدعم التحقق الأمني (WebCrypto) — افتح الملف بمتصفح حديث." };
  try {
    var key = await crypto.subtle.importKey("spki", b64ToBuf(meta.publicKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    var sigOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64ToBuf(meta.signature), encUtf8(ST.licenseRaw));
    if (!sigOk) return { ok: false, reason: "توقيع الرخصة مش صحيح — الملف اتعدّل أو مش موقّع من سيرفر AlNokhba Management." };
    var digest = await sha256Hex(textOf(TAGS.snapshot));
    if (digest !== ST.license.snapshotDigest) return { ok: false, reason: "بيانات اللقطة مش مطابقة للبصمة الموقّعة — الملف اتعدّل بعد التوليد." };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "فشل التحقق الأمني: " + (e && e.message ? e.message : e) };
  }
}

// ================= أدوات الواجهة =================
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function icon(name, size) {
  var paths = {
    dashboard: '<path d="M3 12h7V3H3v9zm11 9h7v-9h-7v9zM3 21h7v-6H3v6zm11-12h7V3h-7v6z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    sessions: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    history: '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>',
    export: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    refresh: '<path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2-9.5L23 10"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    sync: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  };
  var s = size || 18;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || "") + "</svg>";
}
var toastTimer = null;
function toast(msg, kind) {
  var holder = document.getElementById("nk-toast");
  if (!holder) return;
  holder.innerHTML = '<div class="nk-toast-in ' + (kind || "") + '">' + esc(msg) + "</div>";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { holder.innerHTML = ""; }, 3200);
}
function fmtDateTime(iso) {
  try {
    var t = new Date(iso);
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate()) + " " + pad2(t.getHours()) + ":" + pad2(t.getMinutes());
  } catch (e) { return ""; }
}
function fmtDateAr(iso) {
  var t = new Date(iso);
  var months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  return pad2(t.getDate()) + " " + months[t.getMonth()] + " " + t.getFullYear();
}
function todayStr() {
  var t = new Date(effectiveNow());
  return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
}
function addDays(dateStr, n) {
  var t = new Date(dateStr + "T12:00:00");
  t.setDate(t.getDate() + n);
  return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
}
function dayNameAR(dateStr) {
  var names = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return names[new Date(dateStr + "T12:00:00").getDay()];
}
function groupLabel(g) {
  if (!g) return "—";
  var sub = ST.subjectsById[g.subjectId];
  var gr = ST.gradesById[g.gradeId];
  return (sub ? sub.name : "—") + " — " + (gr ? gr.name : "—") + " (" + g.name + ")";
}
function teacherName(id) { var t = ST.teachersById[id]; return t ? t.name : "—"; }
function normDigits(s) {
  // تطبيع الأرقام العربية-الهندية + إزالة المسافات
  var map = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
  return String(s || "").replace(/[٠-٩۰-۹]/g, function (d) { return map[d]; }).replace(/\\s+/g, " ").trim();
}
function phoneTail(s) { return normDigits(s).replace(/[^0-9]/g, ""); }

// ================= الهيكل العام =================
function renderShell() {
  document.body.innerHTML =
    '<div class="nk-top"><div class="nk-top-in">' +
      '<img class="nk-logo" id="nk-logo-img" alt="AlNokhba Management">' +
      '<div class="nk-top-txt"><b>' + esc(ST.license.centerName) + '</b><span>ALNOKHBA MANAGEMENT — وضع الطوارئ</span></div>' +
      '<div class="nk-days" id="nk-days"></div>' +
      '<span class="nk-emg-badge"><span class="nk-dot"></span>طوارئ</span>' +
    '</div></div>' +
    '<div class="nk-warn"><div class="nk-warn-in">' + icon("alert", 15) +
      '<span>ده نظام طوارئ مؤقت — أي حاجة بتتعمل هنا لازم <b>تتصدّر وتتزامن مع النظام الأساسي</b> أول ما الخدمة ترجع.</span>' +
    '</div></div>' +
    '<div class="nk-tabs"><div class="nk-tabs-in" id="nk-tabs"></div></div>' +
    '<main class="nk-main" id="nk-main"></main>' +
    '<nav class="nk-bnav"><div class="nk-bnav-in" id="nk-bnav"></div></nav>' +
    '<div id="nk-modal-root"></div>' +
    '<div id="nk-scan-root"></div>' +
    '<div class="nk-toast" id="nk-toast"></div>';
  var logo = document.getElementById("nk-logo-img");
  var logoSrc = (window.__NK_META__ && window.__NK_META__.logo) || "";
  if (logoSrc) logo.src = logoSrc; else logo.remove();

  var tabs = [
    { id: "dash", t: "الرئيسية", ic: "dashboard" },
    { id: "search", t: "بحث الطلاب", ic: "search" },
    { id: "sessions", t: "الحصص", ic: "sessions" },
    { id: "txns", t: "العمليات", ic: "history" },
    { id: "export", t: "التصدير", ic: "download" },
  ];
  var tabsEl = document.getElementById("nk-tabs");
  var bnavEl = document.getElementById("nk-bnav");
  for (var i = 0; i < tabs.length; i++) {
    (function (tab) {
      var b = el("button", "nk-tab", icon(tab.ic, 20) + "<span>" + esc(tab.t) + "</span>");
      b.setAttribute("data-tab", tab.id);
      b.onclick = function () { go(tab.id); };
      tabsEl.appendChild(b);
      var b2 = b.cloneNode(true);
      b2.onclick = function () { go(tab.id); };
      bnavEl.appendChild(b2);
    })(tabs[i]);
  }
  refreshTop();
}
function refreshTop() {
  var days = document.getElementById("nk-days");
  if (!days) return;
  evalExpiry();
  days.innerHTML = ST.expired
    ? '<b style="color:#B91C1C">انتهت</b>فترة الطوارئ'
    : "<b>" + ST.daysLeft + "</b>يوم متبقي";
  var mark = ' <span class="nk-badge ' + (ST.expired ? "r" : "gold") + '">' + (ST.expired ? "منتهية" : ST.daysLeft + " أيام") + "</span>";
  days.innerHTML = days.innerHTML; // keep
  var tabs = document.querySelectorAll(".nk-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute("data-tab") === ST.view) tabs[i].classList.add("on");
    else tabs[i].classList.remove("on");
  }
}
function go(view) {
  ST.view = view;
  refreshTop();
  window.scrollTo(0, 0);
  if (view === "dash") renderDashboard();
  else if (view === "search") renderSearch();
  else if (view === "sessions") renderSessions();
  else if (view === "txns") renderTxns();
  else if (view === "export") renderExport();
}

// ================= لوحة الطوارئ =================
function renderDashboard() {
  var main = document.getElementById("nk-main");
  var today = todayStr();
  var todaysSessions = ST.sessions.filter(function (s) { return s.date === today && s.status !== "CANCELLED"; });
  var active = todaysSessions.filter(function (s) { return s.status === "ACTIVE"; });
  var presentToday = 0;
  for (var k in ST.att) if (ST.att[k].sessionId && sessionById(ST.att[k].sessionId) && sessionById(ST.att[k].sessionId).date === today) presentToday++;
  var collected = 0;
  for (var i = 0; i < ST.txns.length; i++) if (ST.txns[i].op === "PAYMENT_RECORDED" || ST.txns[i].op === "SUBSCRIPTION_RENEWED") collected += (ST.txns[i].payload && ST.txns[i].payload.amount) || 0;
  var outstanding = 0;
  for (var sid in ST.balances) if (ST.balances[sid] < 0) outstanding += -ST.balances[sid];

  var html = "";
  if (ST.expired) {
    html += '<div class="nk-ro-banner">' + icon("ban", 20) + "<div><b>فترة الطوارئ خلصت.</b><br>مش هتقدر تعمل عمليات جديدة — بس تراجع البيانات وتصدّرها. زوّد ملف استرداد للنظام الأساسي أو اطلب حزمة طوارئ جديدة من السيرفر.</div></div>";
  }
  html +=
    '<div class="nk-card brand" style="margin-bottom:14px">' +
      '<h2 class="nk-sec-title" style="font-size:19px">' + esc(ST.license.centerName) + " — وضع الطوارئ شغّال</h2>" +
      '<span class="nk-gate"></span>' +
      '<div class="nk-kv"><span class="k">حالة الطوارئ</span><span class="v">' + (ST.expired ? '<span class="nk-badge r">منتهية — قراءة وتصدير بس</span>' : '<span class="nk-badge g">شغّالة</span>') + "</span></div>" +
      '<div class="nk-kv"><span class="k">الأيام المتبقية</span><span class="v mono">' + (ST.expired ? "0" : ST.daysLeft) + ' يوم</span></div>' +
      '<div class="nk-kv"><span class="k">تاريخ توليد الحزمة</span><span class="v">' + fmtDateAr(ST.license.issuedAt) + "</span></div>" +
      '<div class="nk-kv"><span class="k">تاريخ الانتهاء</span><span class="v">' + fmtDateAr(ST.license.expiresAt) + "</span></div>" +
      '<div class="nk-kv"><span class="k">الفاعل الحالي</span><span class="v">' + esc(ST.actor ? ST.actor.name : "—") + ' <button class="nk-btn sm" style="margin-inline-start:8px" id="nk-actor-swap">غيّر</button></span></div>' +
    "</div>" +
    '<div class="nk-stats" style="margin-bottom:14px">' +
      statCard(todaysSessions.length, "حصص النهاردة") +
      statCard(active.length, "شغّالة دلوقتي") +
      statCard(presentToday, "حضور النهاردة") +
      statCard(egp(collected), "تحصيلات الطوارئ (ج)") +
      statCard(ST.txns.length, "معاملات طوارئ") +
      statCard(egp(outstanding), "مديونية (ج)", true) +
    "</div>" +
    '<div class="nk-grid2">' +
      '<div class="nk-card"><h3 class="nk-sec-title" style="font-size:15px">إجراءات سريعة</h3><span class="nk-gate" style="width:44px"></span><div style="display:flex;flex-direction:column;gap:8px">' +
        quickAction("search", "ابحث عن طالب (كود / اسم / موبايل / QR)", "search") +
        quickAction("sessions", "حصص النهاردة وافتح/اقفل", "sessions") +
        quickAction("txns", "سجل معاملات الطوارئ", "history") +
        quickAction("export", "تصدير الإكسل + ملف الاسترداد", "download") +
      "</div></div>" +
      '<div class="nk-card"><h3 class="nk-sec-title" style="font-size:15px">آخر المعاملات</h3><span class="nk-gate" style="width:44px"></span><div id="nk-dash-recent"></div></div>' +
    "</div>";
  main.innerHTML = html;
  var recent = document.getElementById("nk-dash-recent");
  var last = ST.txns.slice(-6).reverse();
  if (last.length === 0) recent.innerHTML = '<div class="nk-empty"><div class="big">📋</div>لسه مفيش معاملات طوارئ</div>';
  else {
    for (var t = 0; t < last.length; t++) recent.appendChild(txnRow(last[t]));
  }
  document.getElementById("nk-actor-swap").onclick = chooseActor;
}
function statCard(v, l, ghost) {
  return '<div class="nk-stat' + (ghost ? " ghost" : "") + '"><div class="v mono">' + esc(v) + '</div><div class="l">' + esc(l) + "</div></div>";
}
function quickAction(view, label, ic) {
  return '<button class="nk-btn wide" data-go="' + view + '" style="justify-content:flex-start">' + icon(ic) + "<span>" + esc(label) + "</span></button>";
}
function sessionById(id) { return ST.sessionsById[id]; }

// ================= البحث =================
function renderSearch() {
  var main = document.getElementById("nk-main");
  main.innerHTML =
    '<div class="nk-card brand" style="margin-bottom:12px">' +
      '<h2 class="nk-sec-title">بحث الطلاب</h2>' +
      '<p class="nk-sec-sub">امسح الكارت أو اكتب: كود 5 أرقام · الاسم · الموبايل · أو محتوى الـ QR</p>' +
      '<div class="nk-search">' +
        '<input class="nk-input" id="nk-q" placeholder="اكتب كود الطالب أو اسمه أو موبايله…" autocomplete="off">' +
        (typeof jsQR !== "undefined" ? '<button class="nk-btn primary" id="nk-qr-btn" title="امسح QR">' + icon("camera") + "</button>" : "") +
      "</div>" +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
        '<button class="nk-chip" id="nk-add-student">' + icon("plus", 13) + " طالب جديد</button>" +
        '<span class="nk-hint">Enter = بحث · كتابة الأرقام العربية بتتظبط لوحدها</span>' +
      "</div>" +
    "</div>" +
    '<div class="nk-results" id="nk-results"></div>';

  var input = document.getElementById("nk-q");
  var results = document.getElementById("nk-results");
  var timer = null;
  function run() {
    var q = normDigits(input.value);
    results.innerHTML = "";
    if (!q) return;
    var hits = searchStudents(q, 30);
    if (hits.length === 0) {
      results.innerHTML = '<div class="nk-empty"><div class="big">🔍</div>مفيش طالب بالبيانات دي</div>';
      return;
    }
    for (var i = 0; i < hits.length; i++) results.appendChild(resultRow(hits[i]));
  }
  input.oninput = function () { clearTimeout(timer); timer = setTimeout(run, 120); };
  input.onkeydown = function (ev) { if (ev.key === "Enter") { ev.preventDefault(); run(); } };
  var qrBtn = document.getElementById("nk-qr-btn");
  if (qrBtn) qrBtn.onclick = openScanner;
  document.getElementById("nk-add-student").onclick = addStudentModal;
  setTimeout(function () { input.focus(); }, 60);
}
function searchStudents(q, limit) {
  q = normDigits(q).toLowerCase();
  var qd = q.replace(/[^0-9]/g, "");
  var scored = [];
  for (var i = 0; i < ST.students.length; i++) {
    var s = ST.students[i];
    var score = -1;
    if (s.qrToken && s.qrToken === q) score = 100;
    else if (qd.length >= 4 && s.code === qd) score = 95;
    else if (qd.length >= 7 && phoneTail(s.phone).endsWith(qd)) score = 90;
    else if (qd.length >= 7 && phoneTail(s.parentPhone).endsWith(qd)) score = 85;
    else if (s.name && normDigits(s.name).toLowerCase().indexOf(q) >= 0) score = 50;
    if (score < 0) continue;
    scored.push({ s: s, score: score });
  }
  scored.sort(function (a, b) { return b.score - a.score || a.s.name.localeCompare(b.s.name); });
  return scored.slice(0, limit || 30).map(function (x) { return x.s; });
}
function resultRow(s) {
  var bal = ST.balances[s.id] || 0;
  var balCls = bal > 0 ? "pos" : bal < 0 ? "neg" : "zero";
  var grade = ST.gradesById[s.gradeId];
  var b = el("button", "nk-res",
    '<span class="av">' + esc((s.name || "؟").trim().charAt(0)) + "</span>" +
    '<span class="nm"><b>' + esc(s.name) + "</b><span>كود <b class='mono'>" + esc(s.code) + "</b>" + (grade ? " · " + esc(grade.name) : "") + (s.status !== "ACTIVE" ? ' · <span class="nk-badge o">' + (s.status === "PAUSED" ? "متوقف" : "—") + "</span>" : "") + "</span></span>" +
    '<span class="nk-bal ' + balCls + ' mono">' + egpSigned(bal) + " ج</span>"
  );
  b.onclick = function () { openStudent(s.id); };
  return b;
}

// ================= الكاميرا (QR) =================
function openScanner() {
  var root = document.getElementById("nk-scan-root");
  root.innerHTML =
    '<div class="nk-scan" id="nk-scan-box">' +
      '<div class="nk-scan-bar"></div>' +
      '<video id="nk-scan-video" playsinline muted></video>' +
      '<div class="nk-scan-ui">' +
        '<span style="width:34px;height:34px;border-radius:10px;background:rgba(16,185,129,.25);display:grid;place-items:center">' + icon("camera", 18) + "</span>" +
        '<span class="nk-scan-title">وجّه الكاميرا على كارت الطالب…</span>' +
        '<button class="nk-btn sm" id="nk-scan-close" style="background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.25)">' + icon("x", 14) + " إقفال</button>" +
      "</div>" +
    "</div>";
  var video = document.getElementById("nk-scan-video");
  var stream = null, raf = 0, stopped = false;
  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d", { willReadFrequently: true });

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    root.innerHTML = "";
  }
  document.getElementById("nk-scan-close").onclick = stop;

  function tick() {
    if (stopped) return;
    try {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        if (canvas.width > 0) {
          ctx.drawImage(video, 0, 0);
          var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var code = null;
          try { code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" }); } catch (e) {}
          if (code && code.data) {
            var token = String(code.data).trim();
            stop();
            var s = null;
            for (var i = 0; i < ST.students.length; i++) if (ST.students[i].qrToken === token) { s = ST.students[i]; break; }
            if (s) { toast("تم المسح: " + s.name, "ok"); openStudent(s.id); }
            else { toast("الكارت ده مش مسجّل في حزمة الطوارئ", "err"); go("search"); }
            return;
          }
        }
      }
    } catch (e) {}
    raf = requestAnimationFrame(tick);
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (str) {
    if (stopped) { try { str.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
    stream = str;
    video.srcObject = str;
    video.setAttribute("playsinline", "true");
    video.play().catch(function () {});
    raf = requestAnimationFrame(tick);
  }).catch(function () {
    stop();
    toast("مش قادر أفتح الكاميرا — اتأكد من الصلاحية أو اكتب الكود بإيدك", "err");
  });
}

// ================= اختيار الفاعل =================
function chooseActor() {
  var root = document.getElementById("nk-modal-root");
  root.innerHTML =
    '<div class="nk-modal-bg"><div class="nk-modal">' +
      '<div class="nk-modal-head"><div class="tt"><b>مين شغال دلوقتي؟</b><span>كل عملية بتتسجل باسمه</span></div></div>' +
      '<div class="nk-modal-body"><div style="display:flex;flex-direction:column;gap:8px" id="nk-actor-list"></div></div>' +
    "</div></div>";
  var list = document.getElementById("nk-actor-list");
  var roleMap = { MANAGER: "مدير", RECEPTIONIST: "استقبال", ADMIN: "أدمن" };
  for (var i = 0; i < ST.staff.length; i++) {
    (function (u) {
      var b = el("button", "nk-btn wide", icon("user") + "<span>" + esc(u.name) + " — " + (roleMap[u.role] || u.role) + "</span>");
      b.style.justifyContent = "flex-start";
      b.onclick = async function () {
        ST.actor = u;
        await storage.set("actor", u);
        root.innerHTML = "";
        toast("أهلًا " + u.name + " 👋", "ok");
        go(ST.view);
      };
      list.appendChild(b);
    })(ST.staff[i]);
  }
}
`;
