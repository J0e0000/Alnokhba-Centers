/** التحقق من الإصلاح — الدوال الحقيقية المصلحة جوه transaction باتصال واحد
 *  DATABASE_URL لازم يتبعت من الخارج بـ connection_limit=1 (زي رابط الإنتاج).
 *  تشغيل: DATABASE_URL="postgresql://...:5433/nokhba?connection_limit=1&pool_timeout=15&pgbouncer=true" \
 *          npx tsx --tsconfig scripts/pgtest/tsconfig.test.json scripts/pgtest/verify-fix.ts
 */
import { PrismaClient } from "@prisma/client";
import { assertStudentQuotaTx } from "@/lib/entitlements";
import { generateStudentCode } from "@/lib/auth";

// عميل مستقل للسكريبت بنفس رابط الإنتاج (db.ts داخل الليب هيصنع عميله بنفس الرابط)
const url = process.env.DATABASE_URL!;
const db = new PrismaClient({ datasources: { db: { url } } });

const sub = await db.subscription.findFirst({ select: { centerId: true, plan: { select: { name: true, maxStudents: true } } } });
const centerId = sub?.centerId ?? (await db.center.findFirst({ select: { id: true } }))!.id;
console.log(`سنتر الفحص: ${centerId} — خطة: ${sub?.plan?.name ?? "مفيش"} (حد: ${sub?.plan?.maxStudents ?? "بلا حد"})`);

const t = async (label: string, fn: () => Promise<unknown>) => {
  const t0 = Date.now();
  try { await fn(); console.log(`✅ ${label} — ${Date.now() - t0}ms`); return true; }
  catch (e: unknown) {
    const code = (e as { code?: string }).code ?? "-";
    console.log(`❌ ${label} — ${Date.now() - t0}ms — ${code}: ${String((e as Error).message).slice(0, 180)}`);
    return false;
  }
};

let pass = 0, fail = 0;

// 1) الدالة المصلحة — نفس استدعاء POST /api/students بالظبط
(await t("assertStudentQuotaTx(tx) — المسار الفردي المصلح", async () => {
  await db.$transaction(async (tx) => { await assertStudentQuotaTx(tx, centerId); });
})) ? pass++ : fail++;

// 2) توليد الكود عبر tx — نفس استدعاء الـ bulk المصلح
(await t("generateStudentCode(centerId, tx) — مسار الدفعة المصلح", async () => {
  await db.$transaction(async (tx) => {
    const code = await generateStudentCode(centerId, tx);
    if (!/^\d{5}$/.test(code)) throw new Error("كود غلط " + code);
  });
})) ? pass++ : fail++;

// 3) الحصة بحد فعلي — سنتر جديد بخطة حد 1 وطالب واحد → تسجيل تاني لازم يرمي ApiError 403
(await t("منطق الحصة: حد خطة 1 مع طالب موجود → 403", async () => {
  const center2 = await db.center.create({ data: { name: "فحص حصة — سنتر مؤقت", slug: `fahs-${Date.now()}`, status: "ACTIVE" } });
  const rnd = Math.floor(Math.random() * 90000 + 10000);
  const st0 = await db.student.create({ data: { centerId: center2.id, code: String(rnd), qrToken: `f${Date.now()}${rnd}`.padEnd(48, "f").slice(0, 48), name: "طالب موجود فحص", phone: "01000000001", parentName: "ولي", parentPhone: "01000000002" } });
  const plan = await db.subscriptionPlan.create({ data: { name: "فحص حد 1", maxStudents: 1, features: null, pricePerStudent: 0 } });
  await db.subscription.create({ data: { centerId: center2.id, planId: plan.id, status: "ACTIVE", paymentStatus: "PAID", startDate: "2026-10-15", renewalDate: "2026-11-15" } });
  try {
    await db.$transaction(async (tx) => { await assertStudentQuotaTx(tx, center2.id); });
    throw new Error("المفروض ارتمى 403");
  } catch (e: unknown) {
    const msg = String((e as Error).message);
    if (msg.includes("الأقصى")) return; // ده المطلوب
    throw e;
  } finally {
    await db.subscription.deleteMany({ where: { centerId: center2.id } });
    await db.subscriptionPlan.delete({ where: { id: plan.id } }).catch(() => {});
    await db.student.delete({ where: { id: st0.id } }).catch(() => {});
    await db.center.delete({ where: { id: center2.id } }).catch(() => {});
  }
})) ? pass++ : fail++;

// 4) تحكم سلبي: القراءة العامة من جوه tx لسه بتعمل deadlock (إثبات صلاحية الاختبار)
(await t("تحكم سلبي: getSubscriptionState جوه tx لازم تفشل P2028", async () => {
  const { getSubscriptionState } = await import("@/lib/entitlements");
  try {
    await db.$transaction(async () => { await getSubscriptionState(centerId); });
    throw new Error("المفروض فشلت بالـ P2028 بس نجحت!");
  } catch (e: unknown) {
    const msg = String((e as Error).message);
    if (msg.includes("P2028") || msg.includes("Transaction API") || msg.includes("Transaction already closed")) return; // ده المطلوب
    throw e;
  }
})) ? pass++ : fail++;

console.log(`\n=== النتيجة: ${pass} نجح / ${fail} فشل ===`);
await db.$disconnect();
process.exit(fail > 0 ? 1 : 0);
