/**
 * اختبار شامل للميزات الجديدة — تنفيذ مباشر على السيرفر (dev على 3000):
 * 1. محرك التسعير الشرائحي (unit — قيم محسوبة يدويًا)
 * 2. تعارض المدرس/القاعة في فتح الحصص
 * 3. طابور الرسائل: إنشاء/فلترة/dedupe/أفعال/استمرارية
 * 4. الكتب: تكلفة + حد إعادة طلب + idempotency + تقرير ربحي
 * 5. مزامنة الحضور الأوفلاين (idemKey)
 * 6. إيصالات: تسلسل فريد
 * 7. حدود students (pageSize cap 50)
 */
import { monthlyBillPiastres, pricingBreakdown, PRICING } from "../src/lib/pricing";

const BASE = "http://localhost:3000";
let cookie = "";
let passed = 0, failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  ✗ ${name} ${extra}`); }
}

async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function main() {
  console.log("=== 1) محرك التسعير الشرائحي (unit) ===");
  // قيم محسوبة يدويًا بالجنيه: 100→600 | 500→2,200 | 1000→4,200 | 2000→7,200 | 3000→9,700 | 10000→21,950
  const cases: [number, number][] = [
    [100, 60000], [500, 220000], [1000, 420000],
    [2000, 720000], [3000, 970000], [10000, 2195000],
  ];
  for (const [n, expected] of cases) {
    check(`فاتورة ${n.toLocaleString("en-US")} طالب = ${(expected / 100).toLocaleString("en-US")} ج`,
      monthlyBillPiastres(n) === expected, `got ${monthlyBillPiastres(n)}`);
  }
  check("0 طالب = الأساسي بس (600ج)", monthlyBillPiastres(0) === 60000);
  const bd = pricingBreakdown(1500);
  check("تفصيل 1500: شريحتين فعّالتين", bd.tiers.filter(t => t.count > 0).length === 2, JSON.stringify(bd.tiers.map(t => t.count)));
  check("تفصيل 1500: 600 + 900×4 + 500×3", bd.total === 60000 + 360000 + 150000, `got ${bd.total}`);
  check("الطالب الجاي بعد 1500 بـ 3ج", bd.nextStudentUnit === 300);
  check("تحذير 80% عند 8000", pricingBreakdown(8000).warnLevel === "WARN_80");
  check("تحذير 95% عند 9500", pricingBreakdown(9500).warnLevel === "WARN_95");
  check("الحد عند 10000", pricingBreakdown(10000).warnLevel === "LIMIT");
  check("متوسط 1000 طالب = 4.20ج", pricingBreakdown(1000).avgPerStudent === 420);

  console.log("=== 2) تسجيل الدخول ===");
  let r = await api("/api/auth", { method: "POST", body: { username: "manager", password: "nokhba123" } });
  check("دخول المدير", r.status === 200 && r.data.user?.role === "MANAGER");

  console.log("=== 3) تعارض المدرس والقاعة ===");
  // نجيب حصتين من نفس المدرس في وقت متداخل
  const academics = await api("/api/academics");
  const groups = academics.data.groups ?? [];
  check("في مجموعات للتجربة", groups.length >= 2, `got ${groups.length}`);
  const g1 = groups[0], g2 = groups[1];
  const today = new Date().toISOString().slice(0, 10);

  // حصة أصلية
  r = await api("/api/sessions", { method: "POST", body: { groupId: g1.id, date: today, startTime: "14:00", endTime: "15:30", room: "قاعة الاختبار أ" } });
  const baseSession = r.data.session?.id;
  check("فتح حصة أصلية", r.status === 201, JSON.stringify(r.data));

  if (baseSession) {
    // نفس القاعة + نفس الوقت → رفض
    r = await api("/api/sessions", { method: "POST", body: { groupId: g2.id, date: today, startTime: "14:30", endTime: "16:00", room: "قاعة الاختبار أ" } });
    check("رفض تعارض القاعة", r.status !== 201 && /القاعة محجوزة/.test(r.data.error ?? ""), r.data.error ?? "");

    // نفس المدرس (لو المجموعتين لنفس المدرس) — نجرب بمدرس مشترك: نعدل g2 يسلم لنفس مدرس g1
    if (g1.teacherId && g2.id !== g1.id) {
      // نجيب مدرس g1 لو موجود، ونسجل مجموعة تانية بمدرس g1... الأسهل: نفتح حصة من مجموعة ليها نفس المدرس
      const sameTeacherGroup = groups.find(x => x.teacherId && x.teacherId === g1.teacherId && x.id !== g1.id);
      if (sameTeacherGroup) {
        r = await api("/api/sessions", { method: "POST", body: { groupId: sameTeacherGroup.id, date: today, startTime: "15:00", endTime: "16:00", room: "قاعة تانية خالص" } });
        check("رفض تعارض المدرس (قاعة مختلفة)", r.status !== 201 && /المدرس محجوز/.test(r.data.error ?? ""), r.data.error ?? "");
      } else {
        console.log("  ~ مفيش مجموعتين بنفس المدرس — اختبار المدرس هيتعمل عبر الجدول");
        // جدول أسبوعي: نفس المدرس في قاعتين
        const day = new Date(`${today}T12:00:00Z`).getUTCDay();
        r = await api("/api/schedule", { method: "POST", body: { dayOfWeek: day, groupId: g1.id, startTime: "17:00", endTime: "18:00", room: "قاعة س1" } });
        check("إضافة slot أصلي", r.status === 201, r.data.error ?? "");
        const slotId = r.data.slot?.id;
        if (slotId) {
          // مجموعة تانية بنفس المدرس
          r = await api("/api/schedule", { method: "POST", body: { dayOfWeek: day, groupId: g1.id, startTime: "17:30", endTime: "18:30", room: "قاعة س2" } });
          check("رفض تعارض المدرس في الجدول (مجموعة نفسها = نفس المدرس)", r.status !== 201 && /المدرس محجوز/.test(r.data.error ?? ""), r.data.error ?? "");
          // حصص ملاصقة مسموحة
          r = await api("/api/schedule", { method: "POST", body: { dayOfWeek: day, groupId: g1.id, startTime: "18:00", endTime: "19:00", room: "قاعة س1" } });
          check("الحصة الملاصقة مسموحة", r.status === 201, r.data.error ?? "");
          await api("/api/schedule?id=" + slotId, { method: "DELETE" });
        }
      }
    }

    // حصة ملاصقة مسموحة (نهاية = بداية الأصلية)
    r = await api("/api/sessions", { method: "POST", body: { groupId: g2.id, date: today, startTime: "15:30", endTime: "17:00", room: "قاعة الاختبار أ" } });
    check("الحصة الملاصقة مسموحة (نفس القاعة)", r.status === 201, r.data.error ?? "");

    // ننضف حصص الاختبار
    for (const sid of [baseSession, r.data.session?.id]) {
      if (sid) await api(`/api/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
    }
  }

  console.log("=== 4) طابور الرسائل ===");
  // نشغّل تنبيهات الرصيد الأول
  const settingsRes = await api("/api/settings");
  // (لو في endpoint للإعدادات PATCH نشغله، وإلا نعدل الداتابيز مباشرة عبر API متاح)
  // نشوف إيه اللي موجود: نستخدم /api/settings لو فيه PATCH
  r = await api("/api/settings", { method: "PATCH", body: { waLowBalanceEnabled: true } }).catch(() => null);
  console.log("  ~ settings PATCH:", r ? r.status : "n/a");

  // نشوف الطلاب اللي رصيدهم سالب
  const studentsRes = await api("/api/students");
  console.log(`  ~ إجمالي الطلاب: ${studentsRes.data.total}`);

  // إنشاء دفعة low_balance
  r = await api("/api/queue", { method: "POST", body: { source: "low_balance" } });
  const lowBalanceQueue = r.data;
  console.log(`  ~ دفعة الرصيد:`, JSON.stringify({ created: lowBalanceQueue.created, deduped: lowBalanceQueue.deduped, invalidCount: lowBalanceQueue.invalidCount }));
  if (r.status === 201 && lowBalanceQueue.created > 0) {
    check("إنشاء دفعة رصيد منخفض", true);
    // dedupe: نفس الدفعة تاني = 0 جديد
    r = await api("/api/queue", { method: "POST", body: { source: "low_balance" } });
    check("dedupe شهري — مفيش تكرار", r.data.created === 0 && r.data.deduped > 0, JSON.stringify(r.data));

    // GET: الطابور والإحصائيات
    let q = await api("/api/queue");
    const firstItemId = q.data.current?.id;
    check("الطابور فيه current", !!q.data.current);
    check(`الإحصائيات مجموعها = الكل`, q.data.stats.total === q.data.stats.queued + q.data.stats.sending + q.data.stats.sent + q.data.stats.failed + q.data.stats.skipped + q.data.stats.cancelled);

    // فتح واتساب → SENDING
    if (firstItemId) {
      r = await api("/api/queue", { method: "PATCH", body: { action: "open", itemId: firstItemId } });
      check("فتح واتساب = SENDING (تم فتحها)", r.data.status === "SENDING");

      // تأكيد الإرسال → SENT
      r = await api("/api/queue", { method: "PATCH", body: { action: "confirm-sent", itemId: firstItemId } });
      check("تأكيد الموظف = SENT", r.data.status === "SENT");

      // retry على SENT مرفوض
      r = await api("/api/queue", { method: "PATCH", body: { action: "retry-item", itemId: firstItemId } });
      check("رفض إعادة اللي اتأكدت", r.status !== 200);
    }

    // استمرارية: بعد "refresh" (GET جديد) — current = أول QUEUED (مش اللي اتعملت)
    q = await api("/api/queue");
    const secondItem = q.data.current?.id;
    if (secondItem && secondItem !== firstItemId) {
      check("الاستمرارية: current انتقل للرسالة اللي بعدها", true);
      // تخطي
      r = await api("/api/queue", { method: "PATCH", body: { action: "skip", itemId: secondItem } });
      check("تخطي الرسالة", r.data.status === "SKIPPED");
    }

    // حملة عامة (كل الطلاب)
    r = await api("/api/queue", { method: "POST", body: { source: "all", customTitle: "حملة اختبارية" } });
    check("إنشاء حملة عامة", r.status === 201 && r.data.created > 0, JSON.stringify(r.data));

    // إيقاف الطابور
    r = await api("/api/queue", { method: "PATCH", body: { action: "stop" } });
    check("إيقاف الطابور — الباقي CANCELLED", (r.data.cancelled ?? 0) > 0);
  } else {
    check("إنشاء دفعة رصيد منخفض", false, r.data.error ?? JSON.stringify(r.data));
  }

  console.log("=== 5) الكتب: تكلفة/حد طلب/idempotency/تقرير ===");
  r = await api("/api/books", { method: "POST", body: { name: `كتاب اختبار الربح ${Date.now() % 1000}`, price: 200, costPrice: 120, stock: 10, reorderThreshold: 5 } });
  const testBookId = r.data.book?.id;
  check("إضافة كتاب بتكلفة وحد طلب", r.status === 201, r.data.error ?? "");
  if (testBookId) {
    // بيعة بمفتاح idempotency
    const idemKey = `test-sale-${Date.now()}`;
    r = await api("/api/books", { method: "PUT", body: { bookId: testBookId, qty: 2, buyerName: "زبون اختبار", method: "CASH", idemKey } });
    check("بيعة أولى نجحت", r.status === 201, r.data.error ?? "");
    const stockAfterFirst = r.data.sale?.remainingStock;
    // نفس المفتاح تاني → نفس البيعة من غير خصم
    r = await api("/api/books", { method: "PUT", body: { bookId: testBookId, qty: 2, buyerName: "زبون اختبار", method: "CASH", idemKey } });
    check("idempotency: نفس المفتاح = duplicate من غير خصم", r.data.duplicate === true && r.data.sale?.remainingStock === stockAfterFirst, JSON.stringify(r.data.sale));

    // التقرير الربحي — الكتاب ده بايع 2 × 200 = 400 إيراد، تكلفة 2 × 120 = 240، ربح 160
    const todayISO = new Date().toISOString().slice(0, 10);
    r = await api(`/api/books?report=sales&from=${todayISO}&to=${todayISO}`);
    const rep = r.data.report;
    check("التقرير رجع", !!rep);
    const thisBook = rep?.topSelling?.find((b: any) => b.name.includes("اختبار الربح"));
    check("سعر التكلفة متسجل في التقرير (ربح 160ج)", thisBook && thisBook.revenue - thisBook.cost === 16000, JSON.stringify(thisBook));
    check("الحد 5 → الكتاب (10-2=8) لسه مش تحذير", (rep?.lowStock ?? []).every((b: any) => !b.name.includes("اختبار الربح")));

    // تقرير lowStock بيستخدم threshold
    r = await api("/api/books");
    check("الإحصائيات فيها lowStockList", Array.isArray(r.data.stats?.lowStockList));

    // ننضف: حذف كتاب الاختبار (أرشفة لأن عليه مبيعات)
    r = await api(`/api/books?id=${testBookId}`, { method: "DELETE" });
    check("حذف كتاب عليه مبيعات = أرشفة", r.data.archived === true);
  }

  console.log("=== 6) مزامنة الحضور الأوفلاين (idemKey) ===");
  // نفتح حصة ونمسح طالب فيها
  r = await api("/api/sessions", { method: "POST", body: { groupId: groups[0].id, date: today, startTime: "20:00", endTime: "21:00", room: "قاعة السينك" } });
  const syncSessionId = r.data.session?.id;
  if (syncSessionId) {
    const st = (await api("/api/students")).data.students?.[0];
    if (st) {
      // الطالب لازم يكون مسجل في مجموعة الحصة — نجرب بمسح مباشر بكود طالب مسجل في المجموعة
      // ناخد طلاب المجموعة الأول (غير الأرشيف)
      const groupStudents = ((await api(`/api/students?groupId=${groups[0].id}`)).data.students ?? []).filter((s: any) => s.status !== "ARCHIVED");
      const target = groupStudents[0];
      if (target) {
        const key = `sync-test-${Date.now()}`;
        r = await api("/api/attendance/sync", { method: "POST", body: { sessionId: syncSessionId, query: target.code, idemKey: key } });
        check("مزامنة أوفلاين: تسجيل حضور", r.status === 200 && !!r.data.studentName, r.data.error ?? "");
        // نفس المفتاح تاني = نفس النتيجة (alreadyAttended)
        r = await api("/api/attendance/sync", { method: "POST", body: { sessionId: syncSessionId, query: target.code, idemKey: key } });
        check("idemKey: التكرار يرجّع نفس الحضور", r.status === 200 && r.data.alreadyAttended === true, JSON.stringify(r.data));
        // طالب مش في المجموعة → خطأ واضح
        const otherStudents = (await api(`/api/students?groupId=${groups[1]?.id ?? groups[0].id}`)).data.students ?? [];
        const outsider = otherStudents.find((s: any) => s.id !== target.id);
        if (outsider && groups[1]) {
          r = await api("/api/attendance/sync", { method: "POST", body: { sessionId: syncSessionId, query: outsider.code, idemKey: `x-${Date.now()}` } });
          check("طالب مش في المجموعة → خطأ واضح", r.status !== 200 && /مش مسجل في مجموعة/.test(r.data.error ?? ""), r.data.error ?? "");
        }
      } else {
        check("في طلاب في المجموعة", false);
      }
    }
    await api(`/api/sessions/${syncSessionId}`, { method: "DELETE" }).catch(() => {});
  }

  console.log("=== 7) الإيصالات: تسلسل فريد ===");
  const st2 = (await api("/api/students")).data.students ?? [];
  if (st2[0]) {
    r = await api("/api/payments", { method: "POST", body: { studentId: st2[0].id, amount: 50, method: "CASH", type: "PAYMENT" } });
    const num1 = r.data.receipt?.number;
    check("دفعة 1 مع إيصال", !!num1, JSON.stringify(r.data));
    r = await api("/api/payments", { method: "POST", body: { studentId: st2[0].id, amount: 50, method: "CASH", type: "PAYMENT" } });
    const num2 = r.data.receipt?.number;
    check("دفعة 2 بإيصال متسلسل مختلف", !!num2 && num2 !== num1, `${num1} → ${num2}`);
    // استرداد عشان نرجع الرصيد
    await api("/api/payments", { method: "POST", body: { studentId: st2[0].id, amount: 100, method: "CASH", type: "REFUND" } });
  }

  console.log("=== 8) الباجنيشن: حد أقصى 50 ===");
  r = await api("/api/students?pageSize=500");
  check("pageSize اتقصّ لـ 50", r.data.pageSize === 50, `got ${r.data.pageSize}`);
  r = await api("/api/students?pageSize=10");
  check("pageSize صغير مبيتغيرش", r.data.pageSize === 10);

  console.log("\n========================================");
  console.log(`النتيجة: ${passed} نجح · ${failed} فشل`);
  if (failures.length) {
    console.log("الفشل:");
    failures.forEach(f => console.log("  ✗ " + f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("خطأ في الاختبار:", e); process.exit(1); });
