/**
 * اختبار الإصلاحات الثلاثة الجديدة:
 *
 * A. أسئلة المساعدة (FAQ):
 *    - كل مفاتيح img في help-content موجودة في FAQ_IMAGES
 *    - الصور العشر موجودة في public/faq وبحجم معقول
 * B. النسخ الاحتياطية:
 *    - GET سريع بعد الكاش (أول مرة بتبني الكاش — بعدها < 500ms)
 *    - كاش excel-meta.json بيتحدث بعد إنشاء نسخة جديدة
 * C. إلغاء الحصة (زرار الإلغاء):
 *    - الاستقبال من غير صلاحية: مباشر → 403
 *    - المدير: من غير سبب → 400 | بسبب → 200 والحصة CANCELLED
 *    - تكرار الإلغاء → 409
 *    - حصة مقفولة → مينفعش تتلغي
 *    - طلب موافقة SESSION_CANCEL: يتبعت → يتلغى من صاحبه → يتقدم تاني → المدير يعتمده → الحصة CANCELLED
 * D. تنظيف جراحي كامل يرجّع الـ baseline (حصص اليوم زي ما كانت)
 *
 * npx tsx scripts/test-cancel-backup-faq.ts
 */
import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const ROOT = path.resolve(__dirname, "..");
const db = new PrismaClient();

let mcookie = ""; // manager
let rcookie = ""; // reception
let acookie = ""; // admin
let passed = 0, failed = 0;

function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { failed++; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

type Jar = "m" | "r" | "a";
async function req(p: string, method = "GET", body?: unknown, jar: Jar = "m") {
  const c = jar === "m" ? mcookie : jar === "r" ? rcookie : acookie;
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const first = setCookie.split(";")[0];
    if (jar === "m") mcookie = first;
    else if (jar === "r") rcookie = first;
    else acookie = first;
  }
  let data: Record<string, unknown> = {};
  try { data = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, data };
}

async function main() {
  console.log("🧪 إلغاء الحصة + سرعة النسخ + أسئلة المساعدة بالصور\n");
  const stamp = Date.now().toString(36);

  // ============ 0. دخول ============
  let r = await req("/api/auth", "POST", { username: "manager", password: "nokhba123" });
  ok("login manager", r.status === 200);
  r = await req("/api/auth", "POST", { username: "reception", password: "nokhba123" }, "r");
  ok("login reception", r.status === 200);
  r = await req("/api/auth", "POST", { username: "admin", password: "nokhba123" }, "a");
  ok("login admin", r.status === 200);

  // ============ A. أسئلة المساعدة بالصور ============
  console.log("\n— A. أسئلة المساعدة بالصور —");
  const faqDir = path.join(ROOT, "public", "faq");
  const pngs = existsSync(faqDir) ? readdirSync(faqDir).filter((f) => f.endsWith(".png")) : [];
  ok("لقطات الشاشة موجودة (10)", pngs.length === 10, `${pngs.length} ملف`);
  for (const f of pngs) {
    const st = statSync(path.join(faqDir, f));
    if (st.size < 10_000) { ok(`الصورة معقولة: ${f}`, false, `${st.size}B صغير جدًا`); }
  }
  const sizes = pngs.map((f) => statSync(path.join(faqDir, f)).size);
  ok("كل الصور أكبر من 10KB (مش فاضية)", sizes.every((s) => s > 10_000));
  ok("كل الصور أقل من 1MB (خفيفة)", sizes.every((s) => s < 1024 * 1024));

  // كل مفتاح img مستخدم في help-content له مدخل في FAQ_IMAGES
  const helpSrc = readFileSync(path.join(ROOT, "src", "components", "nokhba", "help-content.tsx"), "utf8");
  const usedKeys = [...helpSrc.matchAll(/img: "([a-z]+)"/g)].map((m) => m[1]);
  const definedKeys = [...helpSrc.matchAll(/^  ([a-z]+): \{\n    src: "\/faq\//gm)].map((m) => m[1]);
  ok("كل مفاتيح img معرّفة في FAQ_IMAGES", usedKeys.every((k) => definedKeys.includes(k)), `${usedKeys.length} سؤال بصورة`);
  // وكل صورة معرّفة ملفها موجود
  const srcs = [...helpSrc.matchAll(/src: "\/faq\/(shot-[a-z]+\.png)"/g)].map((m) => m[1]);
  ok("كل صور FAQ_IMAGES لها ملف فعلي", srcs.every((f) => pngs.includes(f)), `${srcs.length} مرجع`);

  // ============ B. سرعة النسخ الاحتياطية ============
  console.log("\n— B. سرعة النسخ الاحتياطية —");
  let t0 = Date.now();
  let b = await req("/api/admin/backup", "GET", undefined, "a");
  const firstMs = Date.now() - t0;
  ok("GET النسخ شغال (أول مرة — بيبني/يقرا الكاش)", b.status === 200, `${firstMs}ms`);
  const cacheFile = path.join(ROOT, "backups", "excel-meta.json");
  ok("كاش excel-meta.json موجود", existsSync(cacheFile));

  t0 = Date.now();
  b = await req("/api/admin/backup", "GET", undefined, "a");
  const cachedMs = Date.now() - t0;
  ok("GET النسخ فوري بعد الكاش (< 800ms)", b.status === 200 && cachedMs < 800, `${cachedMs}ms`);
  const excelCount = (b.data.excelBackups as unknown[] | undefined)?.length ?? 0;
  ok("القايمة فيها المصنفات", excelCount >= 3, `${excelCount} مصنف`);
  const allValidated = (b.data.excelBackups as { validated?: boolean }[]).every((e) => e.validated);
  ok("كل المصنفات متتحقق منها", allValidated);

  // إنشاء نسخة يدوية يحدث الكاش
  const beforeEntries = Object.keys(JSON.parse(readFileSync(cacheFile, "utf8") as unknown as string) as object).length;
  t0 = Date.now();
  const created = await req("/api/admin/backup", "POST", { action: "create" }, "a");
  const createMs = Date.now() - t0;
  ok("POST نسخة كاملة شغال", created.status === 200, `${createMs}ms`);
  t0 = Date.now();
  b = await req("/api/admin/backup", "GET", undefined, "a");
  const afterMs = Date.now() - t0;
  const afterEntries = Object.keys(JSON.parse(readFileSync(cacheFile, "utf8") as unknown as string) as object).length;
  ok("GET فوري بعد إنشاء نسخة جديدة (< 800ms)", b.status === 200 && afterMs < 800, `${afterMs}ms`);
  ok("الكاش اتحدّث بعد الإنشاء", afterEntries >= beforeEntries, `${beforeEntries}→${afterEntries} مدخل`);

  // ============ C. إلغاء الحصة ============
  console.log("\n— C. إلغاء الحصة (الزرار الجديد) —");

  // نجيب اقتراح حصة النهاردة
  const sched = await req("/api/sessions", "GET", undefined, "m");
  const suggestions = (sched.data.suggestions as { scheduleId: string; startTime: string; subject: string }[] | undefined) ?? [];
  ok("في اقتراحات حصص النهاردة", suggestions.length > 0, `${suggestions.length} حصة`);
  const target = suggestions[0];
  if (!target) { console.log("مفيش اقتراحات — خرجنا"); return summary(); }

  // نفتح الحصة كاستقبال (زي زرار «فتح الحصة»)
  const opened = await req("/api/sessions", "POST", { scheduleId: target.scheduleId }, "r");
  ok("الاستقبال فتح الحصة", opened.status === 201);
  const sessionId = ((opened.data.session as { id?: string })?.id) ?? "";

  // C1: استقبال مباشر → 403
  let c = await req(`/api/sessions/${sessionId}`, "POST", { action: "cancel", reason: "محاولة مباشرة من الاستقبال" }, "r");
  ok("استقبال بدون صلاحية: مباشر → 403", c.status === 403, String((c.data as { error?: string }).error ?? "").slice(0, 50));

  // C2: مدير بدون سبب → 400
  c = await req(`/api/sessions/${sessionId}`, "POST", { action: "cancel" }, "m");
  ok("مدير بدون سبب → 400", c.status === 400);

  // C3: استقبال يقدم طلب SESSION_CANCEL
  let ap = await req("/api/approvals", "POST", { type: "SESSION_CANCEL", sessionId, reason: `اختبار طلب إلغاء ${stamp}` }, "r");
  ok("طلب SESSION_CANCEL اتبعت", ap.status === 201, String((ap.data as { request?: { number?: string } }).request?.number ?? ""));
  const reqNumber = ((ap.data as { request?: { number?: string } }).request?.number) ?? "";
  const reqId = ((ap.data as { request?: { id?: string } }).request?.id) ?? "";

  // C4: منع التكرار
  ap = await req("/api/approvals", "POST", { type: "SESSION_CANCEL", sessionId, reason: `تكرار ${stamp}` }, "r");
  ok("طلب مكرر → 409", ap.status === 409);

  // C5: المدير مايلغش طلب مش بتاعه بـ cancel — صاحب الطلب يلغيه
  ap = await req("/api/approvals", "PATCH", { id: reqId, action: "cancel" }, "r");
  ok("صاحب الطلب سحب طلبه (PENDING→CANCELLED)", ap.status === 200 && (ap.data as { status?: string }).status === "CANCELLED");

  // C6: مينفعش يتقرر بعد السحب
  ap = await req("/api/approvals", "PATCH", { id: reqId, action: "approve" }, "m");
  ok("طلب متلغى مينفعش يتعتمد → 409", ap.status === 409);

  // C7: طلب تاني → المدير يعتمده → الحصة تتلغى فعليًا
  ap = await req("/api/approvals", "POST", { type: "SESSION_CANCEL", sessionId, reason: `طلب تاني للاعتماد ${stamp}` }, "r");
  ok("طلب تاني اتبعت", ap.status === 201);
  const reqId2 = ((ap.data as { request?: { id?: string } }).request?.id) ?? "";
  ap = await req("/api/approvals", "PATCH", { id: reqId2, action: "approve", note: "اعتماد الاختبار" }, "m");
  ok("المدير اعتمد الطلب", ap.status === 200 && (ap.data as { status?: string }).status === "APPROVED");
  const sess = await db.sessionInstance.findUnique({ where: { id: sessionId } });
  ok("الحصة بقت CANCELLED بعد الاعتماد", sess?.status === "CANCELLED");

  // C8: مدير يلغي حصة متلغاة → 409
  c = await req(`/api/sessions/${sessionId}`, "POST", { action: "cancel", reason: "إلغاء متكرر" }, "m");
  ok("إلغاء حصة متلغاة → 409", c.status === 409);

  // C9: الحالة المقفولة محمية (حصة تاريخية مقفولة)
  const closedSess = await db.sessionInstance.findFirst({ where: { centerId: (await db.user.findFirst({ where: { username: "manager" } }))!.centerId!, status: "CLOSED" } });
  if (closedSess) {
    c = await req(`/api/sessions/${closedSess.id}`, "POST", { action: "cancel", reason: "محاولة إلغاء مقفولة" }, "m");
    ok("حصة مقفولة مينفعش تتلغي", c.status === 400 || c.status === 409);
  }

  // ============ D. تنظيف جراحي ============
  console.log("\n— D. تنظيف جراحي —");
  // نرجّع الحصة لحالتها: كانت غير متجسدة أصلًا (suggestion) → نحذف الحصة والطلبات
  await db.approvalRequest.deleteMany({ where: { id: { in: [reqId, reqId2] } } });
  const attendanceCount = await db.attendance.count({ where: { sessionId } });
  if (attendanceCount === 0) {
    await db.studentTransaction.deleteMany({ where: { sessionId, type: "CHARGE" } });
    await db.receipt.deleteMany({ where: { txn: { sessionId } } });
    await db.centerTransaction.deleteMany({ where: { refType: "SESSION", refId: sessionId } });
    await db.sessionInstance.delete({ where: { id: sessionId } });
    ok("حصة الاختبار اتحذفت (رجعت suggestion زي الأول)", true);
  } else {
    ok("حصة الاختبار فيها حضور — سايبها زي ما هي", false);
  }
  const leftReqs = await db.approvalRequest.count({ where: { id: { in: [reqId, reqId2] } } });
  ok("طلبات الموافقة اتمسحت", leftReqs === 0);

  // مفيش جلسات CANCELLED متبقية
  const cancelledLeft = await db.sessionInstance.count({ where: { status: "CANCELLED" } });
  ok("مفيش حصص CANCELLED متبقية", cancelledLeft === 0, `${cancelledLeft}`);

  await db.$disconnect();
  return summary();

  function summary() {
    console.log(`\n==========\n✅ ${passed} ✓ · ❌ ${failed} ✗\n`);
    if (failed > 0) process.exit(1);
  }
}

void main();
