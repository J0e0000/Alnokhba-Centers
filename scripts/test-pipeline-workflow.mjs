// E2E validation for the core-aligned lessons workflow (مسار الحصص)
// Run: node scripts/test-pipeline-workflow.mjs
// Uses the QAE manager account (full permissions).
const BASE = process.env.BASE || "http://localhost:3000";

let cookie = "";
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

// ─── 1) Login as QAE manager ───
console.log("═ 1) LOGIN");
const login = await req("/api/auth", { method: "POST", body: JSON.stringify({ username: "qae-mgr-99", password: "Qae#2026" }) });
check("manager login", login.status === 200 && login.body?.user?.role === "MANAGER", `status=${login.status}`);

// ─── 2) Home pipeline data: GET /api/sessions?date=today with rosterTotal + suggestions.students ───
console.log("═ 2) PIPELINE HOME DATA");
const today = new Date();
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const list = await req(`/api/sessions?date=${todayStr}`);
check("sessions list 200", list.status === 200, `status=${list.status}`);
check("sessions is array", Array.isArray(list.body?.sessions));
const anySession = list.body.sessions[0];
if (anySession) {
  check("session card has rosterTotal", "rosterTotal" in anySession, `rosterTotal=${anySession.rosterTotal}`);
}
check("suggestions have students count", list.body?.suggestions?.every?.((s) => typeof s.students === "number") !== false);
// past day: no suggestions (never create past sessions)
const past = await req(`/api/sessions?date=2025-01-06`);
check("past day returns list (no create path)", past.status === 200 && Array.isArray(past.body?.sessions));

// ─── 3) Open a session (materialize from schedule or ad-hoc) ───
console.log("═ 3) OPEN SESSION");
let sessionId = null;
const sugs = list.body?.suggestions ?? [];
for (const cand of sugs.slice(0, 8)) {
  const opened = await req("/api/sessions", { method: "POST", body: JSON.stringify({ scheduleId: cand.scheduleId }) });
  if (opened.status === 201) { sessionId = opened.body?.session?.id; break; }
}
if (!sessionId) {
  // ad-hoc: find a group from schedule, use a unique late time to dodge conflicts
  const sched = await req("/api/schedule");
  const g = sched.body?.groups?.[0];
  const opened = await req("/api/sessions", { method: "POST", body: JSON.stringify({ groupId: g.id, startTime: "23:31", endTime: "23:58" }) });
  check("open ad-hoc session", opened.status === 201, `status=${opened.status} body=${JSON.stringify(opened.body).slice(0, 120)}`);
  sessionId = opened.body?.session?.id;
} else {
  check("open planned session", true, `from ${sugs.length} suggestions`);
}
check("session id returned", !!sessionId);

// ─── 4) Session detail: new fields ───
console.log("═ 4) SESSION DETAIL (new fields)");
const detail = await req(`/api/sessions/${sessionId}`);
check("detail 200", detail.status === 200, `status=${detail.status} body=${JSON.stringify(detail.body).slice(0,100)}`);
if (detail.status !== 200) { console.log(results.join("\n")); console.log("ABORT"); process.exit(1); }
check("lessonTopic field", "lessonTopic" in detail.body.session);
check("homeworkText field", "homeworkText" in detail.body.session);
check("videoLink field", "videoLink" in detail.body.session);
check("exam field (null)", detail.body.exam === null);
check("examScores array", Array.isArray(detail.body.examScores));
check("attendance rows have homeworkStatus", detail.body.attendance.every((a) => "homeworkStatus" in a && "interactionPlus" in a && "interactionMinus" in a));
check("absent rows have phone", detail.body.absent.every((a) => "phone" in a && "parentPhone" in a));

// ─── 5) Attendance: mark + unmark (⟲) with charge reversal ───
console.log("═ 5) ATTENDANCE MARK/UNMARK");
const absentStudent = detail.body.absent?.[0];
let markedRow = null;
if (absentStudent) {
  const mark = await req("/api/attendance/mark", { method: "POST", body: JSON.stringify({ studentId: absentStudent.studentId, sessionId, status: "PRESENT" }) });
  check("mark present 200", mark.status === 200, `charged=${mark.body?.charged}`);
  const detail2 = await req(`/api/sessions/${sessionId}`);
  markedRow = detail2.body.attendance.find((a) => a.studentId === absentStudent.studentId);
  check("row appears in detail", !!markedRow);
  if (markedRow) {
    const unmark = await req(`/api/attendance/mark?attendanceId=${markedRow.id}`, { method: "DELETE" });
    check("unmark (⟲) 200", unmark.status === 200, `reversed=${unmark.body?.reversed}`);
    const detail3 = await req(`/api/sessions/${sessionId}`);
    check("row removed after unmark", !detail3.body.attendance.some((a) => a.id === markedRow.id));
    // re-mark for the pedagogy tests
    const remark = await req("/api/attendance/mark", { method: "POST", body: JSON.stringify({ studentId: absentStudent.studentId, sessionId, status: "PRESENT" }) });
    check("re-mark present", remark.status === 200);
  }
}

// ─── 6) Records: homework + interaction ───
console.log("═ 6) RECORDS (homework + interaction)");
const detail4 = await req(`/api/sessions/${sessionId}`);
const presentRow = detail4.body.attendance.find((a) => a.studentId);
if (presentRow) {
  const hw = await req(`/api/sessions/${sessionId}/records`, { method: "POST", body: JSON.stringify({ studentId: presentRow.studentId, homeworkStatus: "DONE" }) });
  check("homework DONE saved", hw.status === 200 && hw.body?.homeworkStatus === "DONE");
  const inter = await req(`/api/sessions/${sessionId}/records`, { method: "POST", body: JSON.stringify({ studentId: presentRow.studentId, interaction: "plus" }) });
  check("interaction +1 saved", inter.status === 200 && inter.body?.interactionPlus === 1);
  const inter2 = await req(`/api/sessions/${sessionId}/records`, { method: "POST", body: JSON.stringify({ studentId: presentRow.studentId, interaction: "minus", interactionDelta: 2 }) });
  check("interaction -2 saved", inter2.status === 200 && inter2.body?.interactionMinus === 2);
  const hwClear = await req(`/api/sessions/${sessionId}/records`, { method: "POST", body: JSON.stringify({ studentId: presentRow.studentId, homeworkStatus: null }) });
  check("homework clear (null)", hwClear.status === 200 && hwClear.body?.homeworkStatus === null);
  const hwBad = await req(`/api/sessions/${sessionId}/records`, { method: "POST", body: JSON.stringify({ studentId: presentRow.studentId, homeworkStatus: "WEIRD" }) });
  check("invalid homework rejected", hwBad.status === 400);
  // absent student rejected (no row)
  const absent2 = detail4.body.absent?.[1];
  if (absent2) {
    const rec = await req(`/api/sessions/${sessionId}/records`, { method: "POST", body: JSON.stringify({ studentId: absent2.studentId, homeworkStatus: "DONE" }) });
    check("absent student rejected for records", rec.status === 404, `msg=${rec.body?.error?.slice(0, 40)}`);
  }
} else {
  check("present row available", false, "no attendance row to test records");
}

// ─── 7) Session exam: setup + scores ───
console.log("═ 7) SESSION EXAM");
const d5 = await req(`/api/sessions/${sessionId}`);
const presentIds = d5.body.attendance.filter((a) => a.studentId).map((a) => a.studentId);
const noExamScores = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ scores: [{ studentId: presentIds[0], score: 10 }] }) });
check("scores without exam rejected", noExamScores.status === 400);
const setup = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ title: "امتحان اختبار E2E", maxScore: 20 }) });
check("exam setup created", setup.status === 200 && setup.body?.exam?.maxScore === 20);
const scores = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ scores: presentIds.map((id, i) => ({ studentId: id, score: 10 + i })) }) });
check("batch scores saved", scores.status === 200 && scores.body?.scores?.length === presentIds.length, `n=${scores.body?.scores?.length}`);
const overScore = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ scores: [{ studentId: presentIds[0], score: 99 }] }) });
check("score over max rejected", overScore.status === 400);
// max down with existing higher scores → rejected
const maxDown = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ title: "امتحان اختبار E2E", maxScore: 5 }) });
check("max below existing scores rejected", maxDown.status === 400, `msg=${maxDown.body?.error?.slice(0, 50)}`);
// absent student (not in attendance) → rejected
const absent3 = d5.body.absent?.[0];
if (absent3) {
  const absentScore = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ scores: [{ studentId: absent3.studentId, score: 10 }] }) });
  check("absent student score rejected", absentScore.status === 400);
}
const maxUp = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ title: "امتحان اختبار E2E", maxScore: 50 }) });
check("max up accepted (no rescale)", maxUp.status === 200 && maxUp.body?.exam?.maxScore === 50);
const d5b = await req(`/api/sessions/${sessionId}`);
check("scores unchanged after max change", d5b.body.examScores.every((s) => s.score < 50), JSON.stringify(d5b.body.examScores));

// ─── 8) Save details (lesson report) ───
console.log("═ 8) SAVE DETAILS");
const saved = await req(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "save-details", lessonTopic: "الدرس الخامس — الجبر", homeworkText: "حل التمارين 5 و 6 صفحة 30", videoLink: "https://youtu.be/abc" }) });
check("save-details 200", saved.status === 200);
const d6 = await req(`/api/sessions/${sessionId}`);
check("details persisted", d6.body.session.lessonTopic === "الدرس الخامس — الجبر" && d6.body.session.homeworkText.includes("صفحة 30"));

// ─── 9) Close (finish) + aggregates unchanged + details survive ───
console.log("═ 9) CLOSE (finish)");
const close = await req(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "close" }) });
check("close 200", close.status === 200, `present=${close.body?.economics?.presentCount}`);
const d7 = await req(`/api/sessions/${sessionId}`);
check("status CLOSED", d7.body.session.status === "CLOSED");
check("details survive close", d7.body.session.lessonTopic === "الدرس الخامس — الجبر");
check("exam survives close", d7.body.exam?.title === "امتحان اختبار E2E");
// records after close without permission → manager passes; but test the exam still editable by manager:
const postCloseScore = await req(`/api/sessions/${sessionId}/exam`, { method: "POST", body: JSON.stringify({ scores: [{ studentId: presentIds[0], score: 12 }] }) });
check("manager can edit exam after close (edit-past semantics)", postCloseScore.status === 200);
// save-details after close as manager → allowed
const postCloseDetails = await req(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "save-details", lessonTopic: "الدرس الخامس — الجبر (معدل)" }) });
check("manager save-details after close", postCloseDetails.status === 200);

// ─── 10) Reopen (money reversal) ───
console.log("═ 10) REOPEN");
const reopen = await req(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "reopen", reason: "اختبار E2E لإعادة الفتح" }) });
check("reopen 200", reopen.status === 200);
const d8 = await req(`/api/sessions/${sessionId}`);
check("status OPEN after reopen", d8.body.session.status === "OPEN");
check("details survive reopen", d8.body.session.lessonTopic.includes("معدل"));

// ─── cleanup: cancel the test session ───
await req(`/api/sessions/${sessionId}`, { method: "POST", body: JSON.stringify({ action: "cancel", reason: "تنظيف اختبار E2E لمسار الحصص" }) });

console.log(results.join("\n"));
console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);
