// الجزء الثالث من تطبيق الطوارئ: صفحة الحصص + سجل العمليات + التصدير + الإقلاع.

export const APP_JS_3 = `
"use strict";

// ================= صفحة الحصص =================
var SES_FILTER = "ALL";
function renderSessions() {
  var main = document.getElementById("nk-main");
  if (!ST.sessionDate) ST.sessionDate = todayStr();
  var issuedDate = ST.license.issuedAt.slice(0, 10);
  var expireDate = ST.license.expiresAt.slice(0, 10);

  var days = [];
  var start = issuedDate > todayStr() ? issuedDate : todayStr();
  // شريط أيام: النهاردة ± أيام الرخصة (داخل النافذة)
  for (var d = -1; d <= 6; d++) {
    var ds = addDays(start, d);
    if (ds < issuedDate || ds > expireDate) continue;
    days.push(ds);
  }

  var strip = "";
  for (var i = 0; i < days.length; i++) {
    var on = days[i] === ST.sessionDate;
    strip += '<button class="nk-day' + (on ? " on" : "") + (days[i] === todayStr() ? " today" : "") + '" data-date="' + days[i] + '"><b>' + dayNameAR(days[i]) + "</b><span class='mono'>" + days[i].slice(5) + "</span></button>";
  }

  main.innerHTML =
    '<div class="nk-card brand" style="margin-bottom:12px">' +
      '<h2 class="nk-sec-title">الحصص</h2>' +
      '<p class="nk-sec-sub">مواعيد الحصة مش بتفتحها لوحدها — لازم تضغط «ابدأ الحصة» · الحصص المتزامنة مدعومة</p>' +
      '<div class="nk-days-strip">' + strip + "</div>" +
      '<div class="nk-row">' +
        '<input type="date" class="nk-input" id="ses-date" value="' + ST.sessionDate + '" style="max-width:190px" min="' + issuedDate + '" max="' + expireDate + '">' +
        '<button class="nk-btn sm" id="ses-manual">' + icon("plus", 14) + " حصة يدوية</button>" +
        '<div style="flex:1"></div>' +
        '<select class="nk-input" id="ses-filter" style="max-width:160px;padding:8px 10px;min-height:40px">' +
          '<option value="ALL">كل الحالات</option>' +
          '<option value="SCHEDULED">المجدولة</option>' +
          '<option value="ACTIVE">شغّالة</option>' +
          '<option value="ENDED">خلصت</option>' +
          '<option value="CANCELLED">ملغاة</option>' +
        "</select>" +
      "</div>" +
    "</div>" +
    '<div id="ses-list" style="display:flex;flex-direction:column;gap:8px"></div>';

  var stripBtns = main.querySelectorAll("[data-date]");
  for (var sb = 0; sb < stripBtns.length; sb++) {
    (function (b) {
      b.onclick = function () {
        ST.sessionDate = b.getAttribute("data-date");
        renderSessions();
      };
    })(stripBtns[sb]);
  }
  document.getElementById("ses-date").onchange = function () {
    ST.sessionDate = this.value || todayStr();
    renderSessions();
  };
  document.getElementById("ses-filter").value = SES_FILTER;
  document.getElementById("ses-filter").onchange = function () {
    SES_FILTER = this.value;
    renderSessions();
  };
  document.getElementById("ses-manual").onclick = manualSessionModal;
  renderSessionList();
}
function renderSessionList() {
  var list = document.getElementById("ses-list");
  if (!list) return;
  var date = ST.sessionDate;
  var sessions = ST.sessions.filter(function (s) { return s.date === date; });
  sessions.sort(function (a, b) { return a.startTime < b.startTime ? -1 : 1; });
  if (SES_FILTER !== "ALL") sessions = sessions.filter(function (s) { return s.status === SES_FILTER; });
  list.innerHTML = "";
  if (sessions.length === 0) {
    list.innerHTML = '<div class="nk-empty"><div class="big">📭</div>مفيش حصص في اليوم ده</div>';
    return;
  }
  for (var i = 0; i < sessions.length; i++) list.appendChild(sessionRow(sessions[i]));
}
function sesBadge(status) {
  var map = {
    SCHEDULED: ["m", "مجدولة"],
    ACTIVE: ["g", "شغّالة"],
    ENDED: ["n", "خلصت"],
    CANCELLED: ["r", "ملغاة"],
  };
  var m = map[status] || ["m", status];
  return '<span class="nk-badge ' + m[0] + '">' + m[1] + "</span>";
}
function sessionRow(ses) {
  var g = ST.groupsById[ses.groupId];
  var live = ses.status === "ACTIVE";
  var attCount = 0;
  for (var k in ST.att) {
    var a = ST.att[k];
    if (a.sessionId === ses.id && (a.status === "PRESENT" || a.status === "LATE")) attCount++;
  }
  var card = el("div", "nk-ses" + (live ? " live" : ""),
    '<div class="tm mono">' + esc(ses.startTime) + "<small>" + esc(ses.endTime || "") + "</small></div>" +
    '<div class="info"><b>' + esc(groupLabel(g)) + "</b><span>" + esc(teacherName(g ? g.teacherId : null)) + (ses.room ? " · " + esc(ses.room) : "") +
      (ses.manual ? " · يدوية" : "") + (ses.status === "ENDED" && ses.presentCount != null ? " · حضور " + ses.presentCount + " · إيراد " + egp(ses.totalRevenue || 0) + " ج" : "") +
    "</span></div>" +
    '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' + sesBadge(ses.status) +
      (attCount && live ? '<span class="nk-badge a mono">' + attCount + " حاضر</span>" : "") +
    "</div>");

  var actions = el("div");
  actions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;width:100%;padding-top:8px;border-top:1px dashed var(--border);margin-top:8px";
  if (ses.status === "SCHEDULED" || ses.status === "CANCELLED") {
    var bStart = el("button", "nk-btn sm primary", icon("play", 14) + (ses.status === "CANCELLED" ? " افتحها تاني" : " ابدأ الحصة"));
    bStart.onclick = async function () {
      busyBtn(this, true);
      try { await sessionStart(ses); toast("الحصة بدأت", "ok"); renderSessionList(); }
      catch (e) { toast(e.message, "err"); busyBtn(this, false); }
    };
    actions.appendChild(bStart);
  }
  if (ses.status === "ACTIVE") {
    var bAtt = el("button", "nk-btn sm", icon("users", 14) + " الحضور (" + attCount + ")");
    bAtt.onclick = function () { attendanceModal(ses); };
    var bEnd = el("button", "nk-btn sm ghost-ok", icon("stop", 14) + " قفل الحصة");
    bEnd.onclick = async function () {
      busyBtn(this, true);
      try {
        var res = await sessionEnd(ses);
        toast("اتقفلت — حضور " + res.present + " · إيراد " + egp(res.revenue) + " ج · نصيب المدرس " + egp(res.teacherShare) + " ج", "ok");
        renderSessionList();
      } catch (e) { toast(e.message, "err"); busyBtn(this, false); }
    };
    actions.appendChild(bAtt);
    actions.appendChild(bEnd);
  }
  if (ses.status === "ENDED") {
    var bView = el("button", "nk-btn sm", icon("users", 14) + " الحضور (" + (ses.presentCount != null ? ses.presentCount : attCount) + ")");
    bView.onclick = function () { attendanceModal(ses); };
    actions.appendChild(bView);
  }
  if (ses.status === "SCHEDULED" || ses.status === "ACTIVE") {
    var bCancel = el("button", "nk-btn sm danger", icon("ban", 14) + " إلغاء");
    bCancel.onclick = async function () {
      if (!confirm("تلغي الحصة دي؟")) return;
      busyBtn(this, true);
      try { await sessionCancel(ses); toast("اتلغت الحصة", "ok"); renderSessionList(); }
      catch (e) { toast(e.message, "err"); busyBtn(this, false); }
    };
    actions.appendChild(bCancel);
  }
  card.appendChild(actions);
  return card;
}
function manualSessionModal() {
  var body = openModal("حصة يدوية", "لمجموعة — بتفتح فورًا");
  var opts = ST.groups.filter(function (g) { return g.isActive; }).map(function (g) {
    return '<option value="' + esc(g.id) + '">' + esc(groupLabel(g)) + "</option>";
  }).join("");
  body.innerHTML =
    '<label class="nk-hint" style="display:block;margin-bottom:6px">المجموعة</label>' +
    '<select class="nk-input" id="ms-group">' + opts + "</select>" +
    '<div class="nk-row" style="margin-top:10px">' +
      '<div style="flex:1"><label class="nk-hint" style="display:block;margin-bottom:4px">من</label><input type="time" class="nk-input" id="ms-from" value="18:00"></div>' +
      '<div style="flex:1"><label class="nk-hint" style="display:block;margin-bottom:4px">إلى</label><input type="time" class="nk-input" id="ms-to" value="19:30"></div>' +
    "</div>" +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">القاعة</label>' +
    '<select class="nk-input" id="ms-room"><option value="">—</option>' + ST.rooms.map(function (r) { return '<option value="' + esc(r.name) + '">' + esc(r.name) + "</option>"; }).join("") + "</select>" +
    '<button class="nk-btn primary wide" id="ms-go" style="margin-top:12px">' + icon("play") + " افتح الحصة</button>";
  document.getElementById("ms-go").onclick = async function () {
    busyBtn(this, true);
    try {
      var ses = await manualSession(
        document.getElementById("ms-group").value,
        ST.sessionDate,
        document.getElementById("ms-from").value || "18:00",
        document.getElementById("ms-to").value || "19:30",
        document.getElementById("ms-room").value || null
      );
      toast("الحصة فتحت وشغّالة", "ok");
      closeModal();
      renderSessionList();
    } catch (e) { toast(e.message, "err"); busyBtn(this, false); }
  };
}

// ================= كشف الحضور للحصة =================
function attendanceModal(ses) {
  var g = ST.groupsById[ses.groupId];
  var body = openModal("حضور — " + groupLabel(g), ses.date + " · " + ses.startTime + " · " + sesBadge(ses.status));
  var students = ST.students.filter(function (s) {
    return (s.regs || []).some(function (r) { return r.groupId === ses.groupId; });
  });
  students.sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (students.length === 0) {
    body.innerHTML = '<div class="nk-empty"><div class="big">👥</div>مفيش طلاب مسجّلين في المجموعة دي في اللقطة</div>';
    return;
  }
  body.innerHTML =
    (ses.status !== "ACTIVE" ? '<div class="nk-locked">' + icon("alert", 14) + (ses.status === "ENDED" ? "الحصة اتقفلت — تعديل الحضور هيتزامن وقت الاستيراد" : "الحصة ملغاة") + "</div>" : "") +
    '<input class="nk-input" id="att-search" placeholder="دوّر على طالب…" style="margin-bottom:10px">' +
    '<div id="att-list" style="display:flex;flex-direction:column;gap:6px"></div>' +
    '<button class="nk-btn primary wide" id="att-close-done" style="margin-top:12px">خلصت — اقفل الكشف</button>';
  renderAttRows(ses, "");
  document.getElementById("att-search").oninput = function () { renderAttRows(ses, normDigits(this.value)); };
  document.getElementById("att-close-done").onclick = closeModal;
}
function renderAttRows(ses, filter) {
  var listEl = document.getElementById("att-list");
  listEl.innerHTML = "";
  var students = ST.students.filter(function (s) {
    if (filter && s.name.indexOf(filter) < 0 && s.code.indexOf(filter) < 0) return false;
    return (s.regs || []).some(function (r) { return r.groupId === ses.groupId; });
  });
  students.sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (students.length === 0) { listEl.innerHTML = '<div class="nk-empty">مفيش نتيجة</div>'; return; }
  var statusNames = { PRESENT: "حاضر", LATE: "متأخر", EXCUSED: "بعذر", ABSENT: "غياب" };
  for (var i = 0; i < students.length; i++) {
    (function (s) {
      var a = ST.att[ses.id + "|" + s.id];
      var price = effectivePrice(s, ses.groupId);
      var row = el("div", "nk-res" + (a ? " dim" : ""));
      row.innerHTML =
        '<span class="av">' + esc((s.name || "؟").charAt(0)) + "</span>" +
        '<span class="nm"><b>' + esc(s.name) + "</b><span>كود <b class='mono'>" + esc(s.code) + "</b> · " + egp(price) + " ج</span></span>" +
        '<span style="display:flex;gap:4px">' +
          (a ? attBadge(a.status) : "") +
        "</span>";
      var tools = el("div");
      tools.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;width:100%;padding-top:6px";
      var states = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];
      for (var st = 0; st < states.length; st++) {
        (function (status) {
          var on = a && a.status === status;
          var b = el("button", "nk-btn sm" + (status === "PRESENT" && !on ? " primary" : on ? " primary" : ""), statusNames[status] + (on ? " ✓" : ""));
          if (on) b.disabled = true;
          b.onclick = async function () {
            busyBtn(this, true);
            try {
              await setAttendance(ses.id, s.id, status);
              toast(s.name + ": " + statusNames[status], "ok");
              renderAttRows(ses, filter);
              renderSessionList();
            } catch (e) { toast(e.message, "err"); busyBtn(this, false); }
          };
          tools.appendChild(b);
        })(states[st]);
      }
      row.appendChild(tools);
      listEl.appendChild(row);
    })(students[i]);
  }
}

// ================= سجل العمليات =================
var TXN_FILTER = "ALL";
var TXN_LIMIT = 60;
var TXN_META = {
  PAYMENT_RECORDED: ["💰", "دفعة", "ok-soft"],
  SUBSCRIPTION_RENEWED: ["🔄", "تجديد اشتراك", "gold-soft"],
  ATTENDANCE_RECORDED: ["✅", "حضور", "ok-soft"],
  ATTENDANCE_UPDATED: ["✏️", "تعديل حضور", "amber-soft"],
  SESSION_STARTED: ["▶️", "بدء حصة", "navy-soft"],
  SESSION_ENDED: ["⏹️", "قفل حصة", "navy-soft"],
  SESSION_CANCELLED: ["🚫", "إلغاء حصة", "bad-soft"],
  BALANCE_UPDATED: ["⚖️", "تسوية رصيد", "amber-soft"],
  STUDENT_ADDED: ["🧑‍🎓", "طالب جديد", "ok-soft"],
  STUDENT_UPDATED: ["👤", "تعديل طالب", "navy-soft"],
};
function txnRow(txn) {
  var meta = TXN_META[txn.op] || ["•", txn.op, "navy-soft"];
  var amount = "";
  if (txn.payload && txn.payload.amount != null) {
    amount = '<span class="mono" style="font-weight:800">' + (txn.payload.amount > 0 ? "+" : "") + egp(txn.payload.amount) + " ج</span>";
  }
  var entity = "";
  if (txn.entityType === "STUDENT" || txn.entityType === "ATTENDANCE") {
    var sid = txn.entityType === "STUDENT" ? txn.entityId : txn.payload && txn.payload.studentId;
    var s = ST.studentsById[sid];
    if (s) entity = s.name;
  } else if (txn.entityType === "SESSION") {
    var ses = sessionById(txn.entityId);
    if (ses) entity = groupLabel(ST.groupsById[ses.groupId]) + " · " + ses.date;
  }
  var r = el("div", "nk-txn",
    '<span class="ic" style="background:var(--' + (meta[2] === "gold-soft" ? "gold-soft" : meta[2]) + ',#EEF2F6)">' + meta[0] + "</span>" +
    '<div class="bd"><b>#' + txn.seq + " · " + meta[1] + (entity ? " — " + esc(entity) : "") + "</b>" +
    '<div class="sub">' + esc(txn.actor) + " · " + fmtDateTime(txn.ts) + (amount ? " · " + amount : "") + ' · <span class="mono" dir="ltr">' + esc(txn.id) + "</span></div></div>");
  return r;
}
function renderTxns() {
  var main = document.getElementById("nk-main");
  main.innerHTML =
    '<div class="nk-card brand" style="margin-bottom:12px">' +
      '<h2 class="nk-sec-title">معاملات الطوارئ</h2>' +
      '<p class="nk-sec-sub">كل عملية ليها كود فريد (ETX) — بيتزامن كل حاجة مع النظام الأساسي من غير تكرار</p>' +
      '<div class="nk-row" id="txn-filters">' +
        '<button class="nk-chip' + (TXN_FILTER === "ALL" ? " on" : "") + '" data-f="ALL">الكل (' + ST.txns.length + ")</button>" +
        '<button class="nk-chip" data-f="PAY">دفعات</button>' +
        '<button class="nk-chip" data-f="ATT">حضور</button>' +
        '<button class="nk-chip" data-f="SES">حصص</button>' +
        '<button class="nk-chip" data-f="STU">طلاب</button>' +
      "</div>" +
    "</div>" +
    '<div id="txn-list" style="display:flex;flex-direction:column;gap:8px"></div>' +
    '<div style="text-align:center;margin-top:12px" id="txn-more"></div>';
  var fBtns = main.querySelectorAll("[data-f]");
  for (var i = 0; i < fBtns.length; i++) {
    (function (b) {
      b.onclick = function () {
        TXN_FILTER = b.getAttribute("data-f");
        TXN_LIMIT = 60;
        for (var j = 0; j < fBtns.length; j++) fBtns[j].classList.remove("on");
        if (TXN_FILTER === "ALL") b.classList.add("on");
        renderTxns();
      };
    })(fBtns[i]);
  }
  var filtered = ST.txns.filter(function (t) {
    if (TXN_FILTER === "PAY") return t.op === "PAYMENT_RECORDED" || t.op === "SUBSCRIPTION_RENEWED" || t.op === "BALANCE_UPDATED";
    if (TXN_FILTER === "ATT") return t.op.indexOf("ATTENDANCE") === 0;
    if (TXN_FILTER === "SES") return t.op.indexOf("SESSION") === 0;
    if (TXN_FILTER === "STU") return t.op.indexOf("STUDENT") === 0;
    return true;
  });
  var list = document.getElementById("txn-list");
  var show = filtered.slice(-TXN_LIMIT).reverse();
  if (show.length === 0) list.innerHTML = '<div class="nk-empty"><div class="big">🗒️</div>مفيش معاملات هنا لسه</div>';
  for (var k = 0; k < show.length; k++) list.appendChild(txnRow(show[k]));
  var more = document.getElementById("txn-more");
  if (filtered.length > TXN_LIMIT) {
    var btn = el("button", "nk-btn sm", "عرض المزيد (" + (filtered.length - TXN_LIMIT) + ")");
    btn.onclick = function () { TXN_LIMIT += 60; renderTxns(); };
    more.appendChild(btn);
  }
}

// ================= التصدير =================
function renderExport() {
  var main = document.getElementById("nk-main");
  var collected = 0;
  for (var i = 0; i < ST.txns.length; i++) if (ST.txns[i].op === "PAYMENT_RECORDED" || ST.txns[i].op === "SUBSCRIPTION_RENEWED") collected += (ST.txns[i].payload && ST.txns[i].payload.amount) || 0;
  main.innerHTML =
    (ST.expired ? '<div class="nk-ro-banner">' + icon("alert", 18) + "<div><b>الرخصة منتهية.</b> التصدير متاح — العمليات الجديدة مقفولة.</div></div>" : "") +
    '<div class="nk-card brand" style="margin-bottom:12px">' +
      '<h2 class="nk-sec-title">تصدير بيانات الطوارئ</h2>' +
      '<p class="nk-sec-sub">الإكسل للمراجعة والتدقيق · ملف الاسترداد هو اللي بيرجّع البيانات للنظام الأساسي</p>' +
      '<div class="nk-kv"><span class="k">المعاملات المسجّلة</span><span class="v mono">' + ST.txns.length + "</span></div>" +
      '<div class="nk-kv"><span class="k">تحصيلات الطوارئ</span><span class="v mono">' + egp(collected) + " ج</span></div>" +
      '<div class="nk-kv"><span class="k">ملاحظات/مرفوضات</span><span class="v mono">' + ST.notes.length + "</span></div>" +
    "</div>" +
    '<div class="nk-grid2">' +
      '<div class="nk-export-card">' +
        '<span class="ic" style="background:var(--ok-soft);color:var(--ok)">' + icon("download", 20) + "</span>" +
        '<div style="flex:1"><b style="font-size:15px">تقرير Excel</b>' +
        '<p class="nk-hint" style="margin:4px 0 10px">10 صفحات: لوحة + طلاب + اشتراكات + حضور + دفعات + حصص + مستحقات + معاملات + ملاحظات + معلومات</p>' +
        '<button class="nk-btn primary" id="ex-xlsx">' + icon("download") + " نزّل التقرير</button></div>" +
      "</div>" +
      '<div class="nk-export-card">' +
        '<span class="ic" style="background:var(--gold-soft);color:var(--gold-deep)">' + icon("sync", 20) + "</span>" +
        '<div style="flex:1"><b style="font-size:15px">ملف الاسترداد (JSON)</b>' +
        '<p class="nk-hint" style="margin:4px 0 10px">كل المعاملات بتوقيعات التحقق — ارفعه في النظام الأساسي من صفحة الطوارئ</p>' +
        '<button class="nk-btn gold" id="ex-json">' + icon("sync") + " نزّل ملف الاسترداد</button></div>" +
      "</div>" +
    "</div>" +
    '<div class="nk-card" style="margin-top:12px">' +
      '<h3 class="nk-sec-title" style="font-size:15px">إزاي ترجّع البيانات؟</h3><span class="nk-gate" style="width:44px"></span>' +
      '<div class="nk-flow">' +
        flowStep(1, "النت رجع — افتح النظام الأساسي") +
        '<div class="arrow"></div>' +
        flowStep(2, "افتح: الطوارئ ← استيراد ملف الاسترداد") +
        '<div class="arrow"></div>' +
        flowStep(3, "اعمل فحص (معاينة) وشوف التعارضات") +
        '<div class="arrow"></div>' +
        flowStep(4, "زامن — كل معاملة بتتطبق مرة واحدة بس") +
      "</div>" +
    "</div>";
  document.getElementById("ex-xlsx").onclick = exportExcel;
  document.getElementById("ex-json").onclick = exportRecovery;
}
function flowStep(n, text) {
  return '<div class="step"><span class="n mono">' + n + "</span><span>" + esc(text) + "</span></div>";
}
function safeName(s) {
  return String(s || "CENTER").replace(/[\\\\/:*?"<>|\\x00-\\x1F]/g, "").replace(/\\s+/g, "-").slice(0, 40) || "CENTER";
}
function downloadBlob(data, mime, name) {
  var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
}
async function exportExcel() {
  var btn = document.getElementById("ex-xlsx");
  busyBtn(btn, true);
  try {
    var d = buildExcelData();
    var bytes = window.NKEX.buildXlsx(d);
    var name = "ALNOKHBA_EMERGENCY_REPORT_" + safeName(ST.license.centerName) + "_" + ST.license.expiresAt.slice(0, 10) + ".xlsx";
    downloadBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
    toast("نزل التقرير — " + name, "ok");
  } catch (e) { toast("مش قادر أعمل التقرير: " + e.message, "err"); }
  busyBtn(btn, false);
}
async function exportRecovery() {
  var btn = document.getElementById("ex-json");
  busyBtn(btn, true);
  try {
    var pkg = buildRecoveryPackage();
    var name = "ALNOKHBA_EMERGENCY_RECOVERY_" + ST.license.packageId + ".json";
    downloadBlob(JSON.stringify(pkg, null, 2), "application/json", name);
    toast("نزل ملف الاسترداد — " + name, "ok");
  } catch (e) { toast("مش قادر أعمل الملف: " + e.message, "err"); }
  busyBtn(btn, false);
}
function buildExcelData() {
  var byDay = {};
  for (var i = 0; i < ST.txns.length; i++) {
    var t = ST.txns[i];
    if (t.op === "PAYMENT_RECORDED" || t.op === "SUBSCRIPTION_RENEWED") {
      var day = t.ts.slice(0, 10);
      if (!byDay[day]) byDay[day] = [day, 0, 0];
      byDay[day][1] += 1;
      byDay[day][2] += t.payload.amount || 0;
    }
  }
  var byDayArr = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });

  var students = ST.students.map(function (s) {
    var groups = (s.regs || []).map(function (r) { var g = ST.groupsById[r.groupId]; return g ? groupLabel(g) : "—"; }).join(" · ");
    var grade = ST.gradesById[s.gradeId];
    return [s.code, s.name, s.phone || "", s.parentPhone || "", grade ? grade.name : "—", groups, s.local ? "مضاف بالطوارئ" : "باللقطة", ST.balances[s.id] || 0];
  });
  var subs = [];
  ST.students.forEach(function (s) {
    (s.regs || []).forEach(function (r) {
      var g = ST.groupsById[r.groupId];
      if (!g) return;
      var price = r.priceOverride != null ? r.priceOverride : g.sessionPrice;
      var used = 0;
      for (var k in ST.att) {
        var a = ST.att[k];
        var ses = sessionById(a.sessionId);
        if (ses && ses.groupId === r.groupId && (a.status === "PRESENT" || a.status === "LATE")) used++;
      }
      subs.push([s.name, s.code, groupLabel(g), price, used, ST.balances[s.id] || 0, (ST.balances[s.id] || 0) >= 0 ? "نشط" : "عليه " + egp(-(ST.balances[s.id] || 0)) + " ج"]);
    });
  });
  var attRows = [];
  for (var key in ST.att) {
    var a2 = ST.att[key];
    var ses2 = sessionById(a2.sessionId);
    if (!ses2) continue;
    var st = ST.studentsById[a2.studentId];
    var names = { PRESENT: "حاضر", LATE: "متأخر", EXCUSED: "بعذر", ABSENT: "غياب" };
    attRows.push([ses2.date, groupLabel(ST.groupsById[ses2.groupId]), st ? st.name : "؟", st ? st.code : "—", names[a2.status] || a2.status, a2.charged || 0, fmtDateTime(a2.at), a2.txnId || (a2.fromSnapshot ? "لقطة" : "—")]);
  }
  attRows.sort(function (x, y) { return x[0] < y[0] ? 1 : -1; });
  var payRows = [];
  for (var pi = 0; pi < ST.txns.length; pi++) {
    var pt = ST.txns[pi];
    if (pt.op !== "PAYMENT_RECORDED" && pt.op !== "SUBSCRIPTION_RENEWED") continue;
    var ps = ST.studentsById[pt.entityId];
    payRows.push([pt.ts.slice(0, 10), ps ? ps.name : "؟", ps ? ps.code : "—", pt.payload.amount, pt.payload.method === "VODAFONE" ? "فودافون" : pt.payload.method === "INSTAPAY" ? "انستاباي" : "كاش", pt.payload.balanceBefore, pt.payload.balanceAfter, pt.id]);
  }
  var snapPays = (ST.snap && ST.snap.payments ? ST.snap.payments : []).map(function (p) {
    var s2 = ST.studentsById[p.studentId];
    return [p.createdAt.slice(0, 10), s2 ? s2.name : "؟", s2 ? s2.code : "—", p.amount, p.method === "VODAFONE" ? "فودافون" : p.method === "INSTAPAY" ? "انستاباي" : "كاش", null, null, "لقطة " + p.id];
  });
  payRows = payRows.concat(snapPays);
  payRows.sort(function (x, y) { return x[0] < y[0] ? 1 : -1; });

  var sesRows = ST.sessions.map(function (ses) {
    var g = ST.groupsById[ses.groupId];
    var stat = { SCHEDULED: "مجدولة", ACTIVE: "شغّالة", ENDED: "خلصت", CANCELLED: "ملغاة" }[ses.status] || ses.status;
    return [ses.date, groupLabel(g), teacherName(g ? g.teacherId : null), ses.startTime + "–" + (ses.endTime || ""), ses.room || "—", stat, ses.presentCount != null ? ses.presentCount : "", ses.totalRevenue || 0, ses.id.indexOf("S-") === 0 ? "لقطة " + ses.id : ses.id];
  });
  var earnMap = {};
  ST.teachers.forEach(function (t) {
    var snap = null;
    for (var i = 0; i < (ST.snap && ST.snap.teacherEarnings ? ST.snap.teacherEarnings.length : 0); i++) if (ST.snap.teacherEarnings[i].teacherId === t.id) snap = ST.snap.teacherEarnings[i];
    var emergency = 0;
    ST.txns.forEach(function (tx) {
      if (tx.op === "SESSION_ENDED" && tx.payload && tx.entityType === "SESSION") {
        var ses = sessionById(tx.entityId);
        if (ses && ST.groupsById[ses.groupId] && ST.groupsById[ses.groupId].teacherId === t.id) emergency += tx.payload.teacherShare || 0;
      }
    });
    var groups = t.groups.map(function (gid) { var g = ST.groupsById[gid]; return g ? groupLabel(g) : "—"; }).join(" · ");
    earnMap[t.id] = [t.name, groups, snap ? snap.earned : 0, emergency, (snap ? snap.earned : 0) + emergency];
  });
  var earnRows = Object.keys(earnMap).map(function (k) { return earnMap[k]; });

  var txnRows = ST.txns.map(function (t) {
    var meta = TXN_META[t.op] ? TXN_META[t.op][1] : t.op;
    var amount = t.payload && t.payload.amount != null ? t.payload.amount : null;
    return [t.seq, t.id, meta, t.entityType + (t.entityId ? " · " + String(t.entityId).slice(0, 18) : ""), t.actor, fmtDateTime(t.ts), amount, (t.sum || "").slice(0, 16) + "…"];
  });
  var notes = ST.notes.map(function (n) { return [n.type, n.details + (n.ref ? " — " + String(n.ref).slice(0, 20) : ""), n.at]; });
  notes.push(["إرشاد", "التعارضات النهائية بتتحدد وقت الاستيراد في النظام الأساسي (موازنة الرصيد القديم بالجديد)", "—"]);

  var outstanding = 0, activeSubs = 0;
  for (var sid2 in ST.balances) if (ST.balances[sid2] < 0) outstanding += -ST.balances[sid2];
  ST.students.forEach(function (s) { activeSubs += (s.regs || []).length; });
  var earningsTotal = 0;
  earnRows.forEach(function (r) { earningsTotal += r[4]; });

  return {
    centerName: ST.license.centerName,
    centerId: ST.license.centerId,
    packageId: ST.license.packageId,
    snapshotId: ST.license.snapshotId,
    snapshotDigest: ST.license.snapshotDigest,
    keyFp: ST.license.keyFp,
    appVersion: ST.license.appVersion,
    generatedAt: ST.license.issuedAt,
    expiresAt: ST.license.expiresAt,
    exportedAt: new Date(clockNow()).toISOString(),
    licenseInfo: "حزمة " + ST.license.packageId + " · بصمة " + ST.license.snapshotDigest.slice(0, 12) + "…",
    kpis: {
      students: ST.students.length,
      subs: activeSubs,
      sessions: ST.sessions.filter(function (s) { return s.status === "ACTIVE" || s.status === "ENDED"; }).length,
      attendance: Object.keys(ST.att).length,
      collected: Math.round(byDayArr.reduce(function (acc, x) { return acc + x[2]; }, 0) / 100),
      outstanding: Math.round(outstanding / 100),
      earnings: Math.round(earningsTotal / 100),
      txns: ST.txns.length,
      notes: notes.length,
    },
    byDay: byDayArr,
    students: students,
    subs: subs,
    att: attRows,
    pays: payRows,
    sess: sesRows,
    earn: earnRows,
    txns: txnRows,
    notes: notes,
  };
}
function buildRecoveryPackage() {
  return {
    v: 1,
    typ: "ALNOKHBA_EMERGENCY_RECOVERY",
    centerId: ST.license.centerId,
    centerName: ST.license.centerName,
    packageId: ST.license.packageId,
    snapshotId: ST.license.snapshotId,
    exportedAt: new Date(clockNow()).toISOString(),
    period: { from: ST.license.issuedAt, to: ST.license.expiresAt },
    appVersion: ST.license.appVersion,
    actorNow: ST.actor ? ST.actor.name : null,
    counts: { txns: ST.txns.length, notes: ST.notes.length },
    license: ST.licenseRaw,
    signature: (window.__NK_META__ && window.__NK_META__.signature) || "",
    txns: ST.txns,
    integrity: {
      algo: "SHA-256",
      field: "sum",
      note: "كل معاملة (ETX) فيها مجموع تحقق محسوب على JSON قياسي للمعاملة كلها",
      snapshotDigest: ST.license.snapshotDigest,
    },
  };
}

// ================= استيراد اللقطة + الإقلاع =================
function importSnapshot() {
  var snap = ST.snap;
  ST.students = snap.students.map(function (s) { return Object.assign({}, s); });
  ST.studentsById = {};
  for (var i = 0; i < ST.students.length; i++) ST.studentsById[ST.students[i].id] = ST.students[i];
  ST.groups = snap.groups; ST.groupsById = {};
  for (var g = 0; g < ST.groups.length; g++) ST.groupsById[ST.groups[g].id] = ST.groups[g];
  ST.teachers = snap.teachers; ST.teachersById = {};
  for (var t = 0; t < ST.teachers.length; t++) ST.teachersById[ST.teachers[t].id] = ST.teachers[t];
  ST.grades = snap.grades; ST.gradesById = {};
  for (var gr = 0; gr < ST.grades.length; gr++) ST.gradesById[ST.grades[gr].id] = ST.grades[gr];
  ST.subjects = snap.subjects; ST.subjectsById = {};
  for (var su = 0; su < ST.subjects.length; su++) ST.subjectsById[ST.subjects[su].id] = ST.subjects[su];
  ST.rooms = snap.rooms || [];
  ST.staff = snap.staff || [];
  ST.schedule = snap.schedule || [];
  ST.balances = Object.assign({}, snap.balances);

  // الجلسات: حقيقية (S-*) + مولّدة من الجدول (GS-*) طوال نافذة الطوارئ
  ST.sessions = [];
  ST.sessionsById = {};
  var statusMap = { OPEN: "ACTIVE", CLOSED: "ENDED", CANCELLED: "CANCELLED" };
  for (var s = 0; s < snap.sessions.length; s++) {
    var rs = snap.sessions[s];
    var ses = {
      id: rs.id, groupId: rs.groupId, date: rs.date, startTime: rs.startTime, endTime: rs.endTime,
      room: rs.room, price: rs.price, teacherPercent: rs.teacherPercent,
      status: statusMap[rs.status] || rs.status,
      presentCount: rs.presentCount, totalRevenue: rs.totalRevenue,
    };
    ST.sessions.push(ses); ST.sessionsById[ses.id] = ses;
  }
  var from = ST.license.issuedAt.slice(0, 10);
  var to = ST.license.expiresAt.slice(0, 10);
  var slotByDay = {};
  for (var sl = 0; sl < ST.schedule.length; sl++) {
    var slot = ST.schedule[sl];
    if (!slotByDay[slot.dayOfWeek]) slotByDay[slot.dayOfWeek] = [];
    slotByDay[slot.dayOfWeek].push(slot);
  }
  for (var d = new Date(from + "T12:00:00"), end = new Date(to + "T12:00:00"); d <= end; d.setDate(d.getDate() + 1)) {
    var dateStr = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    var dow = d.getDay();
    var slots = slotByDay[dow] || [];
    for (var si = 0; si < slots.length; si++) {
      var sl2 = slots[si];
      var grp = ST.groupsById[sl2.groupId];
      if (!grp || !grp.isActive) continue;
      var exists = false;
      for (var ex = 0; ex < ST.sessions.length; ex++) {
        if (ST.sessions[ex].groupId === sl2.groupId && ST.sessions[ex].date === dateStr && ST.sessions[ex].startTime === sl2.startTime) { exists = true; break; }
      }
      if (exists) continue;
      var id = "GS-" + sl2.id + "-" + dateStr;
      if (ST.sessionsById[id]) continue;
      var gses = {
        id: id, groupId: sl2.groupId, date: dateStr, startTime: sl2.startTime, endTime: sl2.endTime,
        room: sl2.room, price: grp.sessionPrice, teacherPercent: grp.teacherPercent,
        status: "SCHEDULED", generated: true,
      };
      ST.sessions.push(gses); ST.sessionsById[id] = gses;
    }
  }
  // حضور اللقطة (آخر 7 أيام) — للمرجع ومنع التكرار
  ST.att = {};
  var snapAtt = snap.attendance || [];
  for (var a = 0; a < snapAtt.length; a++) {
    var key = snapAtt[a].sessionId + "|" + snapAtt[a].studentId;
    ST.att[key] = {
      sessionId: snapAtt[a].sessionId, studentId: snapAtt[a].studentId,
      status: snapAtt[a].status, charged: snapAtt[a].charged,
      at: ST.license.issuedAt, fromSnapshot: true, txnId: null,
    };
  }
  ST.txns = []; ST.notes = []; ST.seq = 0;
  ST.studentsLocal = []; ST.studentUpdates = {};
}
function applyLocalStudents() {
  for (var i = 0; i < (ST.studentsLocal || []).length; i++) {
    var s = ST.studentsLocal[i];
    if (ST.studentsById[s.id]) continue;
    ST.students.push(s);
    ST.studentsById[s.id] = s;
  }
  for (var id2 in (ST.studentUpdates || {})) {
    var st = ST.studentsById[id2];
    if (st) Object.assign(st, ST.studentUpdates[id2]);
  }
}
function usageMerge(a, b) {
  if (!a && !b) return null;
  return {
    wallHigh: Math.max((a && a.wallHigh) || 0, (b && b.wallHigh) || 0),
    activeMs: Math.max((a && a.activeMs) || 0, (b && b.activeMs) || 0),
    firstOpen: Math.min((a && a.firstOpen) || Infinity, (b && b.firstOpen) || Infinity),
    bootCount: ((a && a.bootCount) || 0) + ((b && b.bootCount) || 0),
    lastBeat: Math.max((a && a.lastBeat) || 0, (b && b.lastBeat) || 0),
  };
}
function bootFail(title, msg) {
  document.body.innerHTML =
    '<div class="nk-boot"><div class="nk-boot-card">' +
      '<div class="nk-status-hero bad"><div style="font-size:42px">⛔</div>' +
      '<h2 style="margin:8px 0 4px;color:var(--bad)">' + esc(title) + "</h2>" +
      '<p style="font-weight:700;font-size:13px;margin:0">' + esc(msg) + "</p></div>" +
      '<p class="nk-hint" style="margin-top:14px">نزّل حزمة طوارئ جديدة من النظام الأساسي (صفحة الطوارئ) — الملفات المتعدلة مش بتشتغل.</p>' +
    "</div></div>";
}

async function boot() {
  try {
    ST.licenseRaw = textOf(TAGS.license);
    ST.license = JSON.parse(ST.licenseRaw);
    var meta = JSON.parse(textOf(TAGS.meta));
    window.__NK_META__ = meta;
  } catch (e) {
    bootFail("ملف الطوارئ تالف", "مش قادر أقرأ الرخصة من الملف.");
    return;
  }
  var verified = await verifyBoot(meta);
  if (!verified.ok) { bootFail("التحقق الأمني فشل", verified.reason); return; }
  try { ST.snap = JSON.parse(textOf(TAGS.snapshot)); }
  catch (e) { bootFail("ملف الطوارئ تالف", "بيانات اللقطة مش قابلة للقراءة."); return; }

  storage = (await openIDB()) || makeLS();
  var storedUsage = await storage.get("usage");
  USAGE = usageMerge(storedUsage, usageBackupRead()) || { wallHigh: clockNow(), activeMs: 0, firstOpen: clockNow(), bootCount: 0, lastBeat: 0 };
  await beatHeart(true);
  evalExpiry();

  var persisted = await storage.get("persisted");
  importSnapshot();
  if (persisted) {
    ST.sessions = persisted.sessions || [];
    ST.sessionsById = {};
    for (var i = 0; i < ST.sessions.length; i++) ST.sessionsById[ST.sessions[i].id] = ST.sessions[i];
    ST.att = persisted.att || {};
    ST.balances = persisted.balances || {};
    ST.txns = persisted.txns || [];
    ST.notes = persisted.notes || [];
    ST.seq = persisted.seq || 0;
    ST.studentsLocal = persisted.studentsLocal || [];
    ST.studentUpdates = persisted.studentUpdates || {};
    applyLocalStudents();
  } else {
    await persistState();
  }

  try { bc = new BroadcastChannel("nkemg-" + ST.license.packageId); } catch (e) { bc = null; }
  if (bc) bc.onmessage = function (ev) {
    if (ev.data && ev.data.t === "txn") {
      reloadFromStorage();
      toast("اتسجّلت عملية من تاب تاني", "ok");
    }
  };
  setInterval(async function () { await beatHeart(false); evalExpiry(); if (ST.expired) refreshTop(); }, 20000);
  setInterval(async function () {
    var lock = await storage.get("lock");
    if (lock && lock.tab !== LOCK.tab && clockNow() - (lock.ts || 0) > 15000) await storage.set("lock", { tab: LOCK.tab, ts: 0 });
  }, 5000);
  window.addEventListener("beforeunload", async function () {
    await storage.set("lock", { tab: LOCK.tab, ts: 0 });
    await beatHeart(false);
  });

  ST.actor = await storage.get("actor");
  renderShell();
  ST.booted = true;
  if (!ST.actor || !ST.staff.length || !ST.staff.some(function (u) { return u.id === (ST.actor && ST.actor.id); })) {
    if (ST.staff.length) chooseActor();
  }
  go("dash");

  // hooks للفحص (مش بتأثر على الأمان — بتقرأ وتزوّد التقييد بس)
  window.__NKDBG = {
    state: function () { return { expired: ST.expired, daysLeft: ST.daysLeft, txns: ST.txns.length, seq: ST.seq, storage: storage.kind, actor: ST.actor ? ST.actor.name : null, usage: USAGE }; },
    forceExpire: function () { ST.expired = true; ST.daysLeft = 0; refreshTop(); if (ST.view) go(ST.view); },
    setClockOffset: function (ms) { CLK.off = ms; evalExpiry(); refreshTop(); },
    effectiveNow: function () { return effectiveNow(); },
    search: function (q) { return searchStudents(q, 10).map(function (s) { return s.code + " " + s.name; }); },
    persist: persistState,
  };
}
window.addEventListener("DOMContentLoaded", function () { boot(); });
`;
