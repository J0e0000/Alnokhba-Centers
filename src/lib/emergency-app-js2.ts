// الجزء الثاني من تطبيق الطوارئ: محرك المعاملات ETX + العمليات + الحصص + التصدير + الإقلاع.

export const APP_JS_2 = `
"use strict";

// ================= محرك معاملات الطوارئ (ETX) =================
var LOCK = { tabId: Math.random().toString(36).slice(2, 10) };
var bc = null;
var RECENT = {}; // بصمات العمليات الأخيرة — ضد الدبل-كليك

function addNote(type, details, ref) {
  ST.notes.push({ type: type, details: details, ref: ref || null, at: new Date(clockNow()).toISOString() });
  persistState();
}
async function withLock(fn) {
  var lock = await storage.get("lock");
  var now = clockNow();
  if (lock && lock.tab !== LOCK.tab && now - (lock.ts || 0) < 8000) {
    throw new Error("في تاب تاني شغّال على نفس الحزمة دلوقتي — استخدمه هو أو استنى شوية");
  }
  await storage.set("lock", { tab: LOCK.tab, ts: now });
  try {
    return await fn();
  } finally {
    var cur = await storage.get("lock");
    if (!cur || cur.tab === LOCK.tab) await storage.set("lock", { tab: LOCK.tab, ts: 0 });
  }
}
async function makeTxn(op, entityType, entityId, prev, next, payload) {
  if (ST.expired) {
    addNote("مرفوض (الرخصة منتهية)", op, entityId);
    throw new Error("فترة الطوارئ خلصت — مش ممكن تعمل عمليات جديدة. صدّر بياناتك وارفعها للنظام الأساسي.");
  }
  if (!ST.actor) { chooseActor(); throw new Error("اختار مين شغّال الأول"); }
  var fp = op + "|" + (entityId || "") + "|" + canonical(payload || {});
  var now = clockNow();
  if (RECENT[fp] && now - RECENT[fp] < 2000) {
    throw new Error("العملية دي اتعملت حالًا — مش هنكررها");
  }
  RECENT[fp] = now;
  var txn = {
    id: "ETX-" + uuid(),
    packageId: ST.license.packageId,
    centerId: ST.license.centerId,
    seq: ST.seq + 1,
    ts: new Date(now).toISOString(),
    actor: ST.actor.name,
    actorId: ST.actor.id,
    actorRole: ST.actor.role,
    op: op,
    entityType: entityType,
    entityId: entityId || null,
    prev: prev || null,
    next: next || null,
    payload: payload || null,
  };
  txn.sum = await sha256Hex(canonical(txn));
  ST.seq += 1;
  ST.txns.push(txn);
  if (bc) { try { bc.postMessage({ t: "txn", id: txn.id }); } catch (e) {} }
  return txn;
}
async function applyBalance(studentId, delta) {
  var before = ST.balances[studentId] || 0;
  ST.balances[studentId] = before + delta;
  return { before: before, after: ST.balances[studentId] };
}
async function persistState() {
  await storage.set("persisted", {
    sessions: ST.sessions,
    att: ST.att,
    balances: ST.balances,
    txns: ST.txns,
    notes: ST.notes,
    seq: ST.seq,
    studentsLocal: ST.studentsLocal,
    studentUpdates: ST.studentUpdates,
  });
}
async function reloadFromStorage() {
  var p = await storage.get("persisted");
  if (!p) return;
  importSnapshot();
  ST.sessions = p.sessions || [];
  ST.sessionsById = {};
  for (var i = 0; i < ST.sessions.length; i++) ST.sessionsById[ST.sessions[i].id] = ST.sessions[i];
  ST.att = p.att || {};
  ST.balances = p.balances || {};
  ST.txns = p.txns || [];
  ST.notes = p.notes || [];
  ST.seq = p.seq || 0;
  ST.studentsLocal = p.studentsLocal || [];
  ST.studentUpdates = p.studentUpdates || {};
  applyLocalStudents();
  if (ST.view) go(ST.view);
}

// ================= الحضور =================
async function setAttendance(sessionId, studentId, status) {
  return withLock(async function () {
    var key = sessionId + "|" + studentId;
    var existing = ST.att[key];
    var ses = sessionById(sessionId);
    if (!ses) throw new Error("الحصة مش موجودة");
    if (ses.status === "ENDED" || ses.status === "CANCELLED") throw new Error("الحصة " + (ses.status === "ENDED" ? "اتقفلت" : "اتلغت") + " — مش ممكن تسجّل فيها");
    var student = ST.studentsById[studentId];
    if (!student) throw new Error("الطالب مش موجود");
    var charge = status === "PRESENT" || status === "LATE" ? effectivePrice(student, ses.groupId) : 0;
    var at = new Date(clockNow()).toISOString();
    if (existing) {
      var oldCharge = existing.charged || 0;
      var bal = await applyBalance(studentId, oldCharge - charge); // فرق الخصم
      var txn = await makeTxn("ATTENDANCE_UPDATED", "ATTENDANCE", key, { status: existing.status, charged: oldCharge }, { status: status, charged: charge }, { sessionId: sessionId, studentId: studentId, charge: charge, sessionDate: ses.date });
      ST.att[key] = { sessionId: sessionId, studentId: studentId, status: status, charged: charge, at: at, txnId: txn.id, fromSnapshot: false };
      await applyBalancePersist();
      await persistState();
      return { txn: txn, balance: bal, updated: true };
    }
    var bal2 = await applyBalance(studentId, -charge);
    var txn2 = await makeTxn("ATTENDANCE_RECORDED", "ATTENDANCE", key, null, { status: status, charged: charge }, { sessionId: sessionId, studentId: studentId, charge: charge, sessionDate: ses.date });
    ST.att[key] = { sessionId: sessionId, studentId: studentId, status: status, charged: charge, at: at, txnId: txn2.id, fromSnapshot: false };
    await applyBalancePersist();
    await persistState();
    return { txn: txn2, balance: bal2, updated: false };
  });
}
async function applyBalancePersist() {
  await storage.set("balances", ST.balances);
}

// ================= الدفع =================
async function recordPayment(student, opts) {
  return withLock(async function () {
    var paid = Math.round(opts.amount);
    if (!Number.isFinite(paid) || paid <= 0) throw new Error("اكتب مبلغ أكبر من صفر");
    if (paid > 10000000) throw new Error("المبلغ كبير بشكل غير منطقي");
    var returned = Math.round(opts.changeReturned || 0);
    if (returned < 0 || returned > paid) throw new Error("الباقي مش منطقي");
    var ledger = paid - returned; // الباقي المرجوع كاش مش بيدخل المحفظة
    var bal = await applyBalance(student.id, ledger);
    var op = opts.kind === "RENEWAL" ? "SUBSCRIPTION_RENEWED" : "PAYMENT_RECORDED";
    var txn = await makeTxn(op, "STUDENT", student.id,
      { balance: bal.before },
      { balance: bal.after },
      {
        amount: ledger, paid: paid, changeReturned: returned,
        changeAction: returned > 0 ? "RETURNED" : "WALLET",
        method: opts.method || "CASH", sessionId: opts.sessionId || null,
        note: opts.note || null, balanceBefore: bal.before, balanceAfter: bal.after,
      });
    await applyBalancePersist();
    await persistState();
    return { txn: txn, balance: bal };
  });
}

// ================= الحصص =================
async function sessionStart(ses) {
  return withLock(async function () {
    if (ses.status === "ACTIVE") throw new Error("الحصة شغّالة خلاص");
    if (ses.status === "ENDED") throw new Error("الحصة دي اتقفلت — مش ممكن تتفتح تاني");
    var txn = await makeTxn("SESSION_STARTED", "SESSION", ses.id, { status: ses.status }, { status: "ACTIVE", actualStart: new Date(clockNow()).toISOString() }, { date: ses.date, groupId: ses.groupId, startTime: ses.startTime, reopened: ses.status === "CANCELLED" });
    ses.status = "ACTIVE";
    ses.actualStart = new Date(clockNow()).toISOString();
    await persistState();
    return txn;
  });
}
async function sessionEnd(ses) {
  return withLock(async function () {
    if (ses.status !== "ACTIVE") throw new Error("الحصة مش شغّالة");
    var present = 0, revenue = 0;
    for (var k in ST.att) {
      var a = ST.att[k];
      if (a.sessionId === ses.id && (a.status === "PRESENT" || a.status === "LATE")) {
        present++;
        revenue += a.charged || 0;
      }
    }
    var pct = ses.teacherPercent != null ? ses.teacherPercent : (ST.groupsById[ses.groupId] ? ST.groupsById[ses.groupId].teacherPercent : 50);
    var teacherShare = Math.round((revenue * pct) / 100);
    var centerShare = revenue - teacherShare;
    var txn = await makeTxn("SESSION_ENDED", "SESSION", ses.id,
      { status: "ACTIVE" },
      { status: "ENDED", presentCount: present, totalRevenue: revenue, teacherShare: teacherShare, centerShare: centerShare, actualEnd: new Date(clockNow()).toISOString() },
      { date: ses.date, groupId: ses.groupId, presentCount: present, totalRevenue: revenue, teacherShare: teacherShare, centerShare: centerShare });
    ses.status = "ENDED";
    ses.presentCount = present;
    ses.totalRevenue = revenue;
    ses.teacherShare = teacherShare;
    ses.centerShare = centerShare;
    ses.actualEnd = new Date(clockNow()).toISOString();
    await persistState();
    return { txn: txn, present: present, revenue: revenue, teacherShare: teacherShare, centerShare: centerShare };
  });
}
async function sessionCancel(ses) {
  return withLock(async function () {
    if (ses.status === "CANCELLED") throw new Error("الحصة ملغاة خلاص");
    if (ses.status === "ENDED") throw new Error("الحصة اتقفلت — مش ممكن تتلغى");
    var txn = await makeTxn("SESSION_CANCELLED", "SESSION", ses.id, { status: ses.status }, { status: "CANCELLED", at: new Date(clockNow()).toISOString() }, { date: ses.date, groupId: ses.groupId });
    ses.status = "CANCELLED";
    await persistState();
    return txn;
  });
}
async function manualSession(groupId, date, startTime, endTime, room) {
  return withLock(async function () {
    var g = ST.groupsById[groupId];
    if (!g) throw new Error("المجموعة مش موجودة");
    var id = "MS-" + uuid();
    var txn = await makeTxn("SESSION_STARTED", "SESSION", id, null, { status: "ACTIVE" }, { date: date, groupId: groupId, startTime: startTime, endTime: endTime, room: room, manual: true });
    var ses = { id: id, groupId: groupId, date: date, startTime: startTime, endTime: endTime, room: room || null, price: g.sessionPrice, teacherPercent: g.teacherPercent, status: "ACTIVE", actualStart: new Date(clockNow()).toISOString(), manual: true };
    ST.sessions.push(ses);
    ST.sessionsById[id] = ses;
    await persistState();
    return ses;
  });
}

// ================= الطلاب =================
function nextStudentCode() {
  var max = 10000;
  var used = {};
  for (var i = 0; i < ST.students.length; i++) used[ST.students[i].code] = true;
  var code = max;
  while (used[String(code)] && code < 99999) code++;
  return String(code);
}
async function addStudentLocal(data) {
  return withLock(async function () {
    if (!data.name || data.name.trim().length < 3) throw new Error("اكتب اسم الطالب كامل");
    var student = {
      id: "LS-" + uuid(),
      code: data.code || nextStudentCode(),
      qrToken: null, // محلي — يتعمل على السيرفر وقت الاستيراد
      name: data.name.trim(),
      phone: data.phone || null,
      parentPhone: data.parentPhone || null,
      gradeId: data.gradeId || null,
      status: "ACTIVE",
      createdAt: new Date(clockNow()).toISOString(),
      regs: data.groupId ? [{ groupId: data.groupId, priceOverride: null, since: new Date(clockNow()).toISOString() }] : [],
      local: true,
    };
    if (ST.studentsById[student.id]) throw new Error("خطأ داخلي — حاول تاني");
    ST.students.push(student);
    ST.studentsById[student.id] = student;
    ST.studentsLocal = ST.studentsLocal || [];
    ST.studentsLocal.push(student);
    ST.balances[student.id] = 0;
    var txn = await makeTxn("STUDENT_ADDED", "STUDENT", student.id, null, { name: student.name, code: student.code }, { name: student.name, code: student.code, phone: student.phone, parentPhone: student.parentPhone, gradeId: student.gradeId, groupId: data.groupId || null });
    await persistState();
    return { student: student, txn: txn };
  });
}
async function updateStudentLocal(student, changes) {
  return withLock(async function () {
    var prev = { phone: student.phone, parentPhone: student.parentPhone };
    if (changes.phone === student.phone && changes.parentPhone === student.parentPhone) throw new Error("مفيش تغيير");
    var txn = await makeTxn("STUDENT_UPDATED", "STUDENT", student.id, prev, changes, { phone: changes.phone, parentPhone: changes.parentPhone });
    student.phone = changes.phone;
    student.parentPhone = changes.parentPhone;
    ST.studentUpdates = ST.studentUpdates || {};
    ST.studentUpdates[student.id] = changes;
    await persistState();
    return txn;
  });
}

// ================= المودال =================
function openModal(headTitle, headSub) {
  var root = document.getElementById("nk-modal-root");
  root.innerHTML =
    '<div class="nk-modal-bg" id="nk-modal-bg"><div class="nk-modal">' +
      '<div class="nk-modal-head"><div class="tt"><b>' + esc(headTitle) + "</b>" + (headSub ? "<span>" + esc(headSub) + "</span>" : "") + '</div><button class="x" id="nk-modal-x">' + icon("x", 16) + "</button></div>" +
      '<div class="nk-modal-body" id="nk-modal-body"></div>' +
    "</div></div>";
  document.getElementById("nk-modal-x").onclick = closeModal;
  document.getElementById("nk-modal-bg").onclick = function (ev) { if (ev.target.id === "nk-modal-bg") closeModal(); };
  return document.getElementById("nk-modal-body");
}
function closeModal() { document.getElementById("nk-modal-root").innerHTML = ""; }
function busyBtn(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  if (on) btn.dataset.label = btn.innerHTML, btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" style="animation:nkrot .8s linear infinite"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>';
  else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
}

// ================= كارت الطالب (سير العمل الأساسي) =================
function openStudent(studentId) {
  var s = ST.studentsById[studentId];
  if (!s) return;
  var body = openModal(s.name, "كود " + s.code + (s.local ? " · مضاف في الطوارئ" : ""));
  renderStudentMain(s, body);
}
function renderStudentMain(s, body) {
  var bal = ST.balances[s.id] || 0;
  var grade = ST.gradesById[s.gradeId];
  var groupNames = (s.regs || []).map(function (r) { var g = ST.groupsById[r.groupId]; return g ? groupLabel(g) : "—"; });
  body.innerHTML =
    (ST.expired ? '<div class="nk-locked">' + icon("ban", 15) + "الرخصة منتهية — عرض بس</div>" : "") +
    '<div class="nk-grid2" style="margin-bottom:12px">' +
      '<div class="nk-card" style="box-shadow:none">' +
        '<div class="nk-kv"><span class="k">الرصيد</span><span class="v mono" style="font-size:17px;color:' + (bal >= 0 ? "#16A34A" : "#EA580C") + '">' + egpSigned(bal) + " ج</span></div>" +
        '<div class="nk-kv"><span class="k">المرحلة</span><span class="v">' + esc(grade ? grade.name : "—") + "</span></div>" +
        '<div class="nk-kv"><span class="k">الموبايل</span><span class="v mono">' + esc(s.phone || "—") + "</span></div>" +
        '<div class="nk-kv"><span class="k">ولي الأمر</span><span class="v mono">' + esc(s.parentPhone || "—") + "</span></div>" +
      "</div>" +
      '<div class="nk-card" style="box-shadow:none">' +
        '<p style="margin:0 0 6px;font-weight:800;font-size:13px;color:var(--navy)">المجموعات والاشتراكات</p>' +
        (groupNames.length ? groupNames.map(function (g) { return '<div class="nk-kv"><span class="k">' + esc(g) + "</span></div>"; }).join("") : '<div class="nk-empty" style="padding:10px">مش مسجّل في مجموعة</div>') +
      "</div>" +
    "</div>" +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<button class="nk-btn primary" id="st-att">' + icon("check") + " حضور</button>" +
      '<button class="nk-btn gold" id="st-pay">' + icon("wallet") + " دفعة</button>" +
      '<button class="nk-btn" id="st-renew">' + icon("refresh") + " تجديد اشتراك</button>" +
      '<button class="nk-btn" id="st-adj">' + icon("cash") + " تسوية رصيد</button>" +
      '<button class="nk-btn" id="st-subs" style="grid-column:1/-1">' + icon("book") + " تفاصيل الاشتراكات والاشتراك</button>" +
      '<button class="nk-btn" id="st-edit" style="grid-column:1/-1">' + icon("user") + " تعديل بيانات التواصل</button>" +
    "</div>";
  document.getElementById("st-att").onclick = function () { attendancePicker(s); };
  document.getElementById("st-pay").onclick = function () { paymentModal(s, { kind: "PAYMENT" }); };
  document.getElementById("st-renew").onclick = function () { paymentModal(s, { kind: "RENEWAL" }); };
  document.getElementById("st-adj").onclick = function () { adjustModal(s); };
  document.getElementById("st-subs").onclick = function () { subsModal(s); };
  document.getElementById("st-edit").onclick = function () { editStudentModal(s); };
}

// ===== اختيار الحصة للحضور =====
function attendancePicker(s) {
  var today = todayStr();
  var mine = ST.sessions.filter(function (ses) {
    if (ses.date !== today || ses.status !== "ACTIVE") return false;
    return (s.regs || []).some(function (r) { return r.groupId === ses.groupId; });
  });
  var anyActive = ST.sessions.filter(function (ses) { return ses.date === today && ses.status === "ACTIVE"; });
  var options = mine.length ? mine : anyActive;
  if (options.length === 0) {
    toast("مفيش حصة شغّالة النهاردة لمجموعاته — افتحها من صفحة الحصص الأول", "err");
    go("sessions");
    return;
  }
  if (options.length === 1) { attendanceForSession(s, options[0]); return; }
  var body = openModal("اختار الحصة", s.name);
  var list = el("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:8px";
  for (var i = 0; i < options.length; i++) {
    (function (ses) {
      var b = el("button", "nk-btn wide", icon("clock") + "<span>" + esc(groupLabel(ST.groupsById[ses.groupId])) + " · " + ses.startTime + "</span>");
      b.style.justifyContent = "flex-start";
      b.onclick = function () { attendanceForSession(s, ses); };
      list.appendChild(b);
    })(options[i]);
  }
  body.appendChild(list);
}
function attendanceForSession(s, ses) {
  var key = ses.id + "|" + s.id;
  var existing = ST.att[key];
  var price = effectivePrice(s, ses.groupId);
  var body = openModal(s.name, "حضور — " + groupLabel(ST.groupsById[ses.groupId]) + " · " + ses.startTime);
  var due = existing ? (existing.charged || 0) : amountDueToday(price, ST.balances[s.id] || 0);
  body.innerHTML =
    '<div class="nk-kv"><span class="k">سعر الحصة للطالب</span><span class="v mono">' + egp(price) + " ج</span></div>" +
    '<div class="nk-kv"><span class="k">الرصيد الحالي</span><span class="v mono">' + egpSigned(ST.balances[s.id] || 0) + " ج</span></div>" +
    (existing
      ? '<div class="nk-kv"><span class="k">حالته الحالية</span><span class="v">' + attBadge(existing.status) + " · خصم " + egp(existing.charged || 0) + " ج</span></div>"
      : '<div class="nk-kv"><span class="k">المطلوب لو حضر</span><span class="v mono">' + egp(due) + " ج</span></div>") +
    '<p class="nk-hint" style="margin:10px 0 8px">غيّر حالة الحضور (الخصم بيتظبط تلقائي):</p>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      attBtn(s, ses, "PRESENT", "حاضر", existing) +
      attBtn(s, ses, "LATE", "متأخر", existing) +
      attBtn(s, ses, "EXCUSED", "بعذر", existing) +
      attBtn(s, ses, "ABSENT", "غياب", existing) +
    "</div>" +
    '<button class="nk-btn primary wide" id="att-and-pay" style="margin-top:10px">' + icon("wallet") + " حضور + دفع في خطوة</button>";
  document.getElementById("att-and-pay").onclick = function () { attendanceThenPay(s, ses, existing); };
}
function attBadge(status) {
  var map = { PRESENT: ["g", "حاضر"], LATE: ["a", "متأخر"], EXCUSED: ["n", "بعذر"], ABSENT: ["r", "غياب"] };
  var m = map[status] || ["m", status];
  return '<span class="nk-badge ' + m[0] + '">' + m[1] + "</span>";
}
function attBtn(s, ses, status, label, existing) {
  var on = existing && existing.status === status;
  return '<button class="nk-btn' + (on ? " primary" : "") + '" data-att="' + status + '"' + (on ? " disabled" : "") + " id='att-" + status + "'>" + esc(label) + (on ? " ✓" : "") + "</button>";
}
function bindAttButtons(s, ses, existing) {
  var body = document.getElementById("nk-modal-body");
  var btns = body.querySelectorAll("[data-att]");
  for (var i = 0; i < btns.length; i++) {
    (function (b) {
      b.onclick = async function () {
        busyBtn(b, true);
        try {
          var res = await setAttendance(ses.id, s.id, b.getAttribute("data-att"));
          toast(res.updated ? "اتعدّل الحضور — والخصم اتصحح" : "اتسجّل الحضور" + (res.txn.payload.charge ? " — اتخصم " + egp(res.txn.payload.charge) + " ج" : " من غير خصم"), "ok");
          attendanceForSession(s, ses);
          renderStudentMainRefresh();
        } catch (e) { toast(e.message, "err"); }
        finally { busyBtn(b, false); }
      };
    })(btns[i]);
  }
}
async function attendanceThenPay(s, ses, existing) {
  var btn = document.getElementById("att-and-pay");
  busyBtn(btn, true);
  try {
    var status = existing ? existing.status : "PRESENT";
    if (!existing) {
      var res = await setAttendance(ses.id, s.id, "PRESENT");
      existing = ST.att[ses.id + "|" + s.id];
      toast("اتسجّل الحضور", "ok");
    }
    paymentModal(s, { kind: "PAYMENT", sessionId: ses.id });
  } catch (e) { toast(e.message, "err"); }
  finally { busyBtn(btn, false); }
}
function renderStudentMainRefresh() { /* إعادة رسم الكارت لو مفتوح */ var s = null; }

// ===== الدفع (مع الباقي) =====
function paymentModal(s, opts) {
  var kind = opts.kind || "PAYMENT";
  var price = 0;
  var regGroup = (s.regs || [])[0];
  if (regGroup) price = effectivePrice(s, regGroup.groupId);
  var due = amountDueToday(price, ST.balances[s.id] || 0);
  if (opts.sessionId) {
    var ses = sessionById(opts.sessionId);
    if (ses) { price = effectivePrice(s, ses.groupId); due = amountDueToday(price, ST.balances[s.id] || 0); }
  }
  var isRenew = kind === "RENEWAL";
  var suggest = isRenew ? price * 4 : due;
  var body = openModal(isRenew ? "تجديد اشتراك" : "دفعة — " + s.name, "كود " + s.code);

  body.innerHTML =
    '<div class="nk-kv"><span class="k">' + (isRenew ? "سعر الحصة" : "المطلوب") + '</span><span class="v mono">' + egp(isRenew ? price : due) + " ج" + (isRenew && price ? " × 4 حصص تقريبًا" : "") + "</span></div>" +
    '<div class="nk-kv"><span class="k">الرصيد الحالي</span><span class="v mono">' + egpSigned(ST.balances[s.id] || 0) + " ج</span></div>" +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">هيدفع كام؟ (بالجنيه)</label>' +
    '<input class="nk-input mono" id="pay-amt" inputmode="decimal" placeholder="0.00" value="' + (suggest > 0 ? egp(suggest).replace(/\\.00$/, "") : "") + '">' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px" id="pay-chips">' +
      (isRenew ? "" : '<button class="nk-chip" data-amt="' + (due / 100) + '">المطلوب (' + egp(due) + ")</button>") +
      (isRenew ? '<button class="nk-chip gold" data-amt="' + (price * 4 / 100) + '">شهر (4 حصص)</button>' + '<button class="nk-chip" data-amt="' + (price * 8 / 100) + '">شهرين</button>' : "") +
      '<button class="nk-chip" data-amt="50">50</button>' +
      '<button class="nk-chip" data-amt="100">100</button>' +
      '<button class="nk-chip" data-amt="200">200</button>' +
    "</div>" +
    '<label class="nk-hint" style="display:block;margin:12px 0 6px">طريقة الدفع</label>' +
    '<div style="display:flex;gap:6px" id="pay-methods">' +
      '<button class="nk-chip on" data-m="CASH">كاش</button>' +
      '<button class="nk-chip" data-m="VODAFONE">فودافون كاش</button>' +
      '<button class="nk-chip" data-m="INSTAPAY">انستاباي</button>' +
    "</div>" +
    '<div id="pay-change-box" style="margin-top:12px"></div>' +
    '<button class="nk-btn primary wide" id="pay-go" style="margin-top:12px">' + icon("check") + (isRenew ? " سجّل التجديد" : " سجّل الدفعة") + "</button>" +
    '<button class="nk-btn wide" id="pay-skip" style="margin-top:8px">مش هيدفع دلوقتي</button>";

  var state = { method: "CASH", changeAction: "WALLET" };
  var amt = document.getElementById("pay-amt");
  var changeBox = document.getElementById("pay-change-box");
  var methodBox = document.getElementById("pay-methods");

  methodBox.querySelectorAll("[data-m]").forEach?.(function () {});
  var mBtns = methodBox.querySelectorAll("[data-m]");
  for (var mi = 0; mi < mBtns.length; mi++) {
    (function (b) {
      b.onclick = function () {
        state.method = b.getAttribute("data-m");
        for (var j = 0; j < mBtns.length; j++) mBtns[j].classList.remove("on");
        b.classList.add("on");
      };
    })(mBtns[mi]);
  }
  var chips = document.getElementById("pay-chips").querySelectorAll("[data-amt]");
  for (var ci = 0; ci < chips.length; ci++) {
    (function (b) {
      b.onclick = function () {
        amt.value = b.getAttribute("data-amt");
        refreshChange();
      };
    })(chips[ci]);
  }
  function paidPiastres() { return Math.round(parseFloat(normDigits(amt.value).replace(/,/g, "")) * 100) || 0; }
  function refreshChange() {
    var paid = paidPiastres();
    var over = paid - due;
    if (isRenew) over = 0;
    if (over > 0 && changeBox) {
      changeBox.innerHTML =
        '<div class="nk-card" style="box-shadow:none;background:var(--gold-soft);border-color:#EBD9AC">' +
          '<p style="margin:0 0 8px;font-weight:800;font-size:13px">الباقي <span class="mono">' + egp(over) + "</span> ج — يعمل بيه إيه؟</p>" +
          '<div style="display:flex;gap:6px">' +
            '<button class="nk-btn sm' + (state.changeAction === "RETURNED" ? " primary" : "") + '" data-ch="RETURNED">رجّع الباقي كاش</button>' +
            '<button class="nk-btn sm' + (state.changeAction === "WALLET" ? " primary" : "") + '" data-ch="WALLET">حطّه في المحفظة</button>' +
          "</div>" +
        "</div>";
      var chBtns = changeBox.querySelectorAll("[data-ch]");
      for (var i = 0; i < chBtns.length; i++) {
        (function (b) {
          b.onclick = function () {
            state.changeAction = b.getAttribute("data-ch");
            refreshChange();
          };
        })(chBtns[i]);
      }
    } else changeBox.innerHTML = "";
  }
  amt.oninput = refreshChange;
  refreshChange();

  document.getElementById("pay-go").onclick = async function () {
    var btn = this;
    busyBtn(btn, true);
    try {
      var paid = paidPiastres();
      if (paid <= 0) throw new Error("اكتب المبلغ الأول");
      var returned = 0;
      if (!isRenew) {
        var over = paid - due;
        if (over > 0 && state.changeAction === "RETURNED") returned = over;
      }
      var res = await recordPayment(s, {
        amount: paid, changeReturned: returned, method: state.method,
        sessionId: opts.sessionId || null,
        note: isRenew ? "تجديد اشتراك (طوارئ)" : (opts.sessionId ? "دفع وقت الحضور (طوارئ)" : null),
        kind: kind,
      });
      var newBal = res.balance.after;
      body.innerHTML =
        '<div class="nk-status-hero ok">' +
          '<div style="font-size:40px">✅</div>' +
          '<p style="margin:6px 0 2px;font-weight:800;font-size:16px">' + (isRenew ? "اتسجّل التجديد" : "اتسجّلت الدفعة") + " — " + egp(res.txn.payload.amount) + " ج (" + (state.method === "CASH" ? "كاش" : state.method === "VODAFONE" ? "فودافون" : "انستاباي") + ")</p>" +
          (returned > 0 ? '<p style="margin:2px 0;font-weight:700;color:var(--gold-deep)">الباقي ' + egp(returned) + " ج رجع كاش</p>" : paid - due > 0 && !isRenew ? '<p style="margin:2px 0;font-weight:700;color:#16A34A">الباقي ' + egp(paid - due - returned) + " ج اتحط في المحفظة</p>" : "") +
          '<p class="mono" style="margin:6px 0 0;font-weight:800;font-size:15px">الرصيد دلوقتي: ' + egpSigned(newBal) + " ج</p>" +
          '<p class="mono nk-hint" style="margin:4px 0 0" dir="ltr">' + res.txn.id + "</p>" +
        "</div>" +
        '<button class="nk-btn primary wide" id="pay-done" style="margin-top:12px">جاهز للطالب الجاي</button>';
      document.getElementById("pay-done").onclick = function () { closeModal(); };
      renderDashboardQuiet();
    } catch (e) {
      toast(e.message, "err");
      busyBtn(btn, false);
    }
  };
  document.getElementById("pay-skip").onclick = function () {
    closeModal();
    renderStudentMain(s, document.getElementById("nk-modal-body") || openModal(s.name, "كود " + s.code));
  };
}
function renderDashboardQuiet() { if (ST.view === "dash") renderDashboard(); else if (ST.view === "txns") renderTxns(); }

// ===== تسوية الرصيد =====
function adjustModal(s) {
  var body = openModal("تسوية رصيد — " + s.name, "الرصيد الحالي: " + egpSigned(ST.balances[s.id] || 0) + " ج");
  body.innerHTML =
    '<label class="nk-hint" style="display:block;margin-bottom:6px">المبلغ (بالجنيه — بالسالب لو خصم/تصحيح دين)</label>' +
    '<input class="nk-input mono" id="adj-amt" inputmode="decimal" placeholder="0.00">' +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">السبب</label>' +
    '<input class="nk-input" id="adj-reason" placeholder="مثال: تصحيح رصيد / خصم / إضافة رصيد">' +
    '<button class="nk-btn primary wide" id="adj-go" style="margin-top:12px">' + icon("check") + " سجّل التسوية</button>";
  document.getElementById("adj-go").onclick = async function () {
    var btn = this;
    busyBtn(btn, true);
    try {
      var amount = Math.round(parseFloat(normDigits(document.getElementById("adj-amt").value)) * 100) || 0;
      if (amount === 0) throw new Error("اكتب مبلغ مش صفر");
      var reason = document.getElementById("adj-reason").value.trim() || "تسوية طوارئ";
      var bal = await applyBalance(s.id, amount);
      var txn = await makeTxn("BALANCE_UPDATED", "STUDENT", s.id, { balance: bal.before }, { balance: bal.after }, { amount: amount, reason: reason, balanceBefore: bal.before, balanceAfter: bal.after });
      await persistState();
      toast("اتسجلت التسوية — الرصيد " + egpSigned(bal.after) + " ج", "ok");
      closeModal();
      openStudent(s.id);
    } catch (e) { toast(e.message, "err"); busyBtn(btn, false); }
  };
}

// ===== الاشتراكات =====
function subsModal(s) {
  var body = openModal("اشتراكات — " + s.name, "كود " + s.code);
  var rows = "";
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
    var paidTotal = 0;
    for (var t = 0; t < ST.txns.length; t++) {
      var tx = ST.txns[t];
      if (tx.entityId === s.id && (tx.op === "PAYMENT_RECORDED" || tx.op === "SUBSCRIPTION_RENEWED")) paidTotal += tx.payload.amount || 0;
    }
    rows +=
      '<div class="nk-card" style="box-shadow:none;margin-bottom:10px">' +
        '<p style="margin:0 0 4px;font-weight:800;color:var(--navy)">' + esc(groupLabel(g)) + "</p>" +
        '<div class="nk-kv"><span class="k">سعر الحصة</span><span class="v mono">' + egp(price) + " ج</span></div>" +
        '<div class="nk-kv"><span class="k">تاريخ التسجيل</span><span class="v">' + fmtDateAr(r.since) + "</span></div>" +
        '<div class="nk-kv"><span class="k">حصص اتعملت (لقطة + طوارئ)</span><span class="v mono">' + used + "</span></div>" +
        '<div class="nk-kv"><span class="k">إجمالي مدفوع (طوارئ)</span><span class="v mono">' + egp(paidTotal) + " ج</span></div>" +
        '<div class="nk-kv"><span class="k">الرصيد الحالي</span><span class="v mono">' + egpSigned(ST.balances[s.id] || 0) + " ج</span></div>" +
        '<div class="nk-kv"><span class="k">الحالة</span><span class="v">' + (ST.balances[s.id] || 0) >= 0 ? '<span class="nk-badge g">نشط</span>' : '<span class="nk-badge o">عليه ' + egp(-(ST.balances[s.id] || 0)) + ' ج</span>' + "</span></div>" +
      "</div>";
  });
  body.innerHTML = rows || '<div class="nk-empty"><div class="big">📚</div>الطالب مش مسجّل في مجموعات — سجّله من النظام الأساسي أو هنا لو جديد</div>';
}

// ===== تعديل بيانات التواصل =====
function editStudentModal(s) {
  var body = openModal("تعديل بيانات — " + s.name, "بيانات التواصل بس (الاسم والكود بيتغيروا من النظام الأساسي)");
  body.innerHTML =
    '<label class="nk-hint" style="display:block;margin-bottom:6px">موبايل الطالب</label>' +
    '<input class="nk-input mono" id="ed-phone" value="' + esc(s.phone || "") + '" inputmode="tel">' +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">موبايل ولي الأمر</label>' +
    '<input class="nk-input mono" id="ed-parent" value="' + esc(s.parentPhone || "") + '" inputmode="tel">' +
    '<button class="nk-btn primary wide" id="ed-go" style="margin-top:12px">' + icon("check") + " احفظ</button>";
  document.getElementById("ed-go").onclick = async function () {
    busyBtn(this, true);
    try {
      var changes = { phone: document.getElementById("ed-phone").value.trim() || null, parentPhone: document.getElementById("ed-parent").value.trim() || null };
      await updateStudentLocal(s, changes);
      toast("اتحفظ — هيتزامن مع النظام الأساسي", "ok");
      closeModal();
      openStudent(s.id);
    } catch (e) { toast(e.message, "err"); busyBtn(this, false); }
  };
}

// ===== طالب جديد =====
function addStudentModal() {
  var body = openModal("طالب جديد", "بيتسجّل محليًا في الطوارئ — ويتزامن وقت الاستيراد");
  var gradeOpts = ST.grades.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>"; }).join("");
  var groupOpts = '<option value="">— من غير مجموعة —</option>' + ST.groups.filter(function (g) { return g.isActive; }).map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(groupLabel(g)) + " (" + egp(g.sessionPrice) + ' ج)</option>'; }).join("");
  body.innerHTML =
    '<label class="nk-hint" style="display:block;margin-bottom:6px">الاسم *</label>' +
    '<input class="nk-input" id="ns-name" placeholder="الاسم رباعي">' +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">الموبايل</label>' +
    '<input class="nk-input mono" id="ns-phone" inputmode="tel">' +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">موبايل ولي الأمر</label>' +
    '<input class="nk-input mono" id="ns-parent" inputmode="tel">' +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">المرحلة</label>' +
    '<select class="nk-input" id="ns-grade"><option value="">—</option>' + gradeOpts + "</select>" +
    '<label class="nk-hint" style="display:block;margin:10px 0 6px">المجموعة</label>' +
    '<select class="nk-input" id="ns-group">' + groupOpts + "</select>" +
    '<button class="nk-btn primary wide" id="ns-go" style="margin-top:12px">' + icon("plus") + " سجّل الطالب</button>";
  document.getElementById("ns-go").onclick = async function () {
    busyBtn(this, true);
    try {
      var data = {
        name: document.getElementById("ns-name").value.trim(),
        phone: document.getElementById("ns-phone").value.trim() || null,
        parentPhone: document.getElementById("ns-parent").value.trim() || null,
        gradeId: document.getElementById("ns-grade").value || null,
        groupId: document.getElementById("ns-group").value || null,
      };
      var res = await addStudentLocal(data);
      toast("اتسجّل " + res.student.name + " — كود " + res.student.code, "ok");
      closeModal();
      openStudent(res.student.id);
    } catch (e) { toast(e.message, "err"); busyBtn(this, false); }
  };
}
`;
