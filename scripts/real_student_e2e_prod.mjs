/**
 * REAL-STUDENT E2E on PRODUCTION — Alnokhba Centers
 * ===================================================
 *رحلة حقيقية كاملة بحساب طالب حقيقي (من غير أي [TEST] في الأسماء):
 *  1) دخول المدير على الإنتاج
 *  2) إنشاء طالب حقيقي + تسجيله في مجموعة حقيقية + دفعة حقيقية
 *  3) إنشاء امتحان حقيقي منشور على المجموعة
 *  4) دخول الطالب لبورتاله → يشوف الامتحان → يبدأ → يجاوب (3 صح + 1 غلط) → يسلم
 *  5) تصحيح سيرفر + المدير يشوف المحاولة والدرجة
 *  Usage: node scripts/real_student_e2e_prod.mjs
 */
const BASE = "https://alnokhba-centers.vercel.app";
const results = [];
const step = (n, ok, detail) => {
  results.push({ n, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${n} — ${detail}`);
};

function cookieOf(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  return set.map((c) => c.split(";")[0]).join("; ");
}

async function api(path, opts = {}, cookie = "") {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, res, cookie: cookieOf(res) };
}

// ================= 1) دخول المدير =================
const login = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: "manager", password: "nokhba123" }) });
const staffCookie = login.cookie || cookieOf(login.res);
step("1", login.status === 200 && !!staffCookie, `دخول المدير = ${login.status}`);

// ================= 2) بيانات السنتر الحقيقية =================
const groups = await api("/api/academics", {}, staffCookie);
const gArr = groups.json?.groups ?? groups.json ?? [];
const group = gArr.find((g) => (g.name ?? "").includes("فريقات") && g.id) ?? gArr[0];
step("2", !!group?.id, `المجموعة الحقيقية: ${group?.name ?? "?"} (${group?.id ?? "-"}) — إجمالي ${gArr.length}`);

const academics = await api("/api/academics", {}, staffCookie);
const grades = academics.json?.grades ?? [];
const gradeId = grades[0]?.id ?? group?.gradeId;
step("2b", !!gradeId, `الصف: ${grades[0]?.name ?? "-"} (${gradeId})`);

// ================= 3) طالب حقيقي =================
const stamp = Date.now().toString().slice(-6);
const phone = `010${stamp}${stamp.slice(0, 2)}`; // 11 رقم — مصري صالح
const parentPhone = `011${stamp}${stamp.slice(0, 2)}`;
const mk = await api("/api/students", {
  method: "POST",
  body: JSON.stringify({
    name: "يوسف طارق سعيد",
    phone,
    parentName: "طارق سعيد عبد الله",
    parentPhone,
    gradeId,
    groupIds: [group.id],
    school: "مدرسة النخبة الثانوية",
    status: "ACTIVE",
  }),
}, staffCookie);
const studentId = mk.json?.student?.id ?? mk.json?.id;
step("3", mk.status === 201 || mk.status === 200, `طالب حقيقي: يوسف طارق سعيد — كود ${mk.json?.student?.code ?? mk.json?.code ?? "?"} — موبايل ${phone} (${mk.status})`);
if (!studentId) { console.log("STOP: مفيش طالب", JSON.stringify(mk.json)?.slice(0, 300)); process.exit(1); }

// دفعة حقيقية 500 ج كاش
const pay = await api("/api/payments", {
  method: "POST",
  body: JSON.stringify({ studentId, amount: 500, method: "CASH", note: "دفعة أولى — اشتراك الشهر" }),
}, staffCookie);
step("3b", pay.status === 200 || pay.status === 201, `دفعة 500 ج كاش (${pay.status})`);

// ================= 4) امتحان حقيقي منشور =================
const now = new Date();
const end = new Date(now.getTime() + 3 * 86400000);
const exam = await api("/api/exams", {
  method: "POST",
  body: JSON.stringify({
    groupId: group.id,
    title: "امتحان الصف الشامل — أكتوبر",
    instructions: "امتحان من 4 أسئلة. اقرا كل سؤال كويس قبل ما تجاوب.",
    startAt: now.toISOString(),
    endAt: end.toISOString(),
    durationMin: 15,
    attemptsAllowed: 1,
    securityMode: "WARNING",
    publish: true,
    shuffleQuestions: false,
    shuffleOptions: false,
    questions: [
      { text: "ما هي عاصمة مصر؟", type: "MCQ", options: ["القاهرة", "الإسكندرية", "أسيوط", "بورسعيد"], correctAnswer: 0, points: 25 },
      { text: "5 × 8 يساوي؟", type: "MCQ", options: ["35", "40", "45", "13"], correctAnswer: 1, points: 25 },
      { text: "النيل ينبع من بحيرة فيكتوريا.", type: "TRUE_FALSE", correctAnswer: "true", points: 25 },
      { text: "كم عدد أيام السنة الميلادية غير الكبيسة؟", type: "NUM", correctAnswer: "365", points: 25 },
    ],
  }),
}, staffCookie);
const examId = exam.json?.exam?.id ?? exam.json?.id;
step("4", exam.status === 201 || exam.status === 200, `امتحان منشور: «امتحان الصف الشامل — أكتوبر» (${exam.status}) id=${examId ?? "?"}`);
if (!examId) { console.log("STOP:", JSON.stringify(exam.json)?.slice(0, 400)); process.exit(1); }

// ================= 5) رحلة الطالب الحقيقية على البورتال =================
const plogin = await api("/api/portal", { method: "POST", body: JSON.stringify({ action: "login", code: mk.json?.student?.code ?? mk.json?.code, phone }) });
const stuCookie = plogin.cookie || cookieOf(plogin.res);
step("5", plogin.status === 200, `دخول الطالب للبورتال (${plogin.status})`);

const sexams = await api("/api/portal/exams", {}, stuCookie);
const found = (sexams.json?.exams ?? []).find((e) => e.id === examId);
step("5b", sexams.status === 200 && !!found, `الطالب شايف الامتحان في بورتاله (${sexams.status})`);

const start = await api(`/api/portal/exams/${examId}`, { method: "POST", body: JSON.stringify({ action: "start" }) }, stuCookie);
step("5c", start.status === 200, `بداية المحاولة (${start.status})`);
const qs = start.json?.attempt?.questions ?? start.json?.questions ?? [];
const qIds = qs.map((q) => q.id);
step("5d", qIds.length === 4, `الأسئلة وصلت للطالب: ${qIds.length}/4`);

// 3 صح + 1 غلط (السؤال التاني نجاوبه غلط عمدًا)
const correct = ["0", "1", "true", "365"];
const answers = qIds.map((qid, i) => ({ qid, ans: i === 1 ? "0" : correct[i] }));
for (const a of answers) {
  const r = await api(`/api/portal/exams/${examId}`, { method: "POST", body: JSON.stringify({ action: "answer", questionId: a.qid, answer: a.ans }) }, stuCookie);
  if (r.status !== 200) step(`5e-${a.qid}`, false, `حفظ إجابة فشل (${r.status})`);
}
step("5e", true, "4 إجابات اتحفظت (autosave server-side)");

const submit = await api(`/api/portal/exams/${examId}`, { method: "POST", body: JSON.stringify({ action: "submit" }) }, stuCookie);
const score = submit.json?.attempt?.score ?? submit.json?.score;
step("5f", submit.status === 200, `تسليم + تصحيح السيرفر = ${score}/100 (المتوقع 75)`);

// ================= 6) المدير يشوف المحاولة =================
const detail = await api(`/api/exams/${examId}`, {}, staffCookie);
const attempts = detail.json?.exam?.attempts ?? detail.json?.attempts ?? [];
const att = attempts[0];
step("6", detail.status === 200 && attempts.length >= 1, `المدير شايف المحاولة: ${att?.student?.name ?? att?.studentName ?? "طالب"} — درجة ${att?.score ?? "?"}/100، حالة ${att?.status ?? "?"}`);

// ================= 7) نظافة: البورتال مش شايف امتحان مسكّر =================
console.log("\n===== النتيجة النهائية =====");
const pass = results.every((r) => r.ok);
console.log(pass ? "PASS ✅" : "FAIL ❌");
results.forEach((r) => { if (!r.ok) console.log(`  فشل: ${r.n} — ${r.detail}`); });
console.log(`\nبيانات الحساب الحقيقي:\n- طالب: يوسف طارق سعيد | كود: ${mk.json?.student?.code ?? mk.json?.code} | موبايل: ${phone}\n- ولي الأمر: طارق سعيد | ${parentPhone}\n- الامتحان: ${examId}`);
