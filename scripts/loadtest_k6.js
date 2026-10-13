/* ============================================================
   loadtest_k6.js — خطة حمل قابلة للتكرار وغير مدمرة (PHASE 5)
   تشغيلها ضد STAGING فقط (أو preview deployment) — ممنوع ضد الإنتاج.
   سيناريوهات واقعية بترتيب تدريجي: تسجيل دخول → قوائم → بحث →
   حضور (قراءة/كتابة محدودة) → تقارير → مزيج.

   المتطلبات:
     k6 installed:  https://k6.io  (brew install k6 / apt)
     متغيرات بيئة:
       BASE_URL   = https://<staging-or-preview-url>
       USER_1..3  = حسابات اختبار تركيبية (مش مستخدمين حقيقيين)
       PASS_1..3  = كلمات السر بتاعتها

   التشغيل:
     BASE_URL=https://xxx.vercel.app k6 run scripts/loadtest_k6.js
============================================================ */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const dbTime = new Trend("api_db_heavy_ms", true);
const errRate = new Rate("api_errors");

// تدريج آمن: ابدأ صغير وزوّد حسب نتيجة p95 — متفتحش 50+ concurrency على قاعدة حقيقية
export const options = {
  stages: [
    { duration: "1m", target: 5 },   // إحماء
    { duration: "3m", target: 10 },  // حمل أساسي
    { duration: "2m", target: 20 },  // ضغط متوسط
    { duration: "1m", target: 0 },   // تهدئة
  ],
  thresholds: {
    http_req_duration: ["p(50)<800", "p(95)<2500", "p(99)<5000"],
    http_req_failed: ["rate<0.05"],
  },
};

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const users = [1, 2, 3]
  .map((i) => ({ u: __ENV[`USER_${i}`], p: __ENV[`PASS_${i}`] }))
  .filter((x) => x.u);

function login(user) {
  const res = http.post(`${BASE}/api/auth/login`,
    JSON.stringify({ username: user.u, password: user.p }),
    { headers: { "Content-Type": "application/json" } });
  check(res, { "login 2xx": (r) => r.status >= 200 && r.status < 300 });
  errRate.add(res.status >= 400);
  return res;
}

export default function () {
  const user = users[__VU % users.length] || { u: __ENV.USER_1, p: __ENV.PASS_1 };

  group("login + dashboard", () => {
    const res = login(user);
    if (res.status >= 400) { sleep(3); return; }
    const dash = http.get(`${BASE}/api/today`);
    check(dash, { "today 2xx": (r) => r.status < 400 });
    dbTime.add(dash.timings.duration);
    errRate.add(dash.status >= 400);
  });

  group("student browse + search", () => {
    const list = http.get(`${BASE}/api/students?page=1&limit=25`);
    check(list, { "students 2xx": (r) => r.status < 400 });
    dbTime.add(list.timings.duration);
    const search = http.get(`${BASE}/api/students?q=%D8%A7%D8%AD%D9%85%D8%AF&page=1`);
    check(search, { "search 2xx": (r) => r.status < 400 });
    dbTime.add(search.timings.duration);
    errRate.add(search.status >= 500);
  });

  group("attendance read (no fake writes)", () => {
    const sessions = http.get(`${BASE}/api/sessions?status=OPEN&limit=10`);
    check(sessions, { "sessions 2xx": (r) => r.status < 400 });
    dbTime.add(sessions.timings.duration);
    errRate.add(sessions.status >= 500);
  });

  group("reports aggregates", () => {
    const rep = http.get(`${BASE}/api/reports/summary?range=week`);
    check(rep, { "report 2xx (or 403 by role)": (r) => r.status < 500 });
    dbTime.add(rep.timings.duration);
    errRate.add(rep.status >= 500);
  });

  sleep(Math.random() * 2 + 1); // تفكير بشري
}

/* ============================================================
   بروتوكول القياس (خدّه في الاعتبار قبل التشغيل):
   1) شغّل على نفس الـ BASE_URL مرتين (قبل/بعد التحسين) بنفس السيناريو.
   2) سجّل p50/p95/p99 + throughput + error rate + مزامنة توقيت القياس.
   3) ممنوع إنشاء بيانات حضور/امتحانات وهمية على الإنتاج — الكتابة الحقيقية
      تتجرب فقط على staging بحسابات تركيبية (زي ما اتعاد في QA السابق).
   4) لو مفيش staging: بلّغ BLOCKED وحدد المطلوب (بيئة preview + حسابات اختبار).
============================================================ */
