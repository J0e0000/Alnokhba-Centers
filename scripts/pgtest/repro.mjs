/**
 * REPRO — إثبات آلية العطل: قراءة عامة (db) جوه interactive transaction
 * على pool بـ connection_limit=1 (إعدادات رابط الإنتاج الموصى بها) → تعليق → P2028@5s
 * ومقارنتها بالنسخة المصلحة (قراءة عبر tx نفسه).
 */
import { PrismaClient } from "@prisma/client";

const url = "postgresql://postgres:postgres@127.0.0.1:5433/nokhba?connection_limit=1&pool_timeout=15&pgbouncer=true";
// عميل واحد بس — نفس بيئة التطبيق (src/lib/db بيصنع عميل واحد)
const db = new PrismaClient({ datasources: { db: { url } }, log: ["error"] });

const center = await db.center.findFirst({ select: { id: true, name: true } });
const grade = await db.grade.findFirst({ where: { centerId: center.id }, select: { id: true, name: true } });
console.log(`سنتر الفحص: ${center.name} — مرحلة: ${grade?.name}`);

const mkName = () => `فحص آلي ${Math.floor(Math.random() * 90000 + 10000)}`;

async function attempt(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`✅ ${label} — نجحت في ${Date.now() - t0}ms`);
    return true;
  } catch (e) {
    console.log(`❌ ${label} — فشلت بعد ${Date.now() - t0}ms`);
    console.log(`   الكود: ${e.code ?? "-"}`);
    console.log(`   الرسالة: ${String(e.message).slice(0, 400)}`);
    return false;
  }
}

// تنظيف بقايا فحوصات سابقة
await db.student.deleteMany({ where: { name: { startsWith: "فحص آلي" } } });

// ===== اختبار 1: نفس آلية POST /api/students الحالي — assertStudentQuotaTx بيقرأ الاشتراك بـ db العام جوه الـ tx =====
await attempt("A) قراءة اشتراك بـ db العام من جوه الـ transaction (كود الإنتاج الحالي)", async () => {
  await db.$transaction(async (tx) => {
    const sub = await db.subscription.findUnique({ where: { centerId: center.id } }); // ← getSubscriptionState (بالكاش أو بدونه — بنجبره هنا)
    if (sub?.planId) await db.subscriptionPlan.findUnique({ where: { id: sub.planId } }); // safePlanFeaturesRaw نفس النمط
    const active = await tx.student.count({ where: { centerId: center.id, status: "ACTIVE" } });
    await tx.student.create({
      data: {
        centerId: center.id, code: String(Math.floor(Math.random() * 90000 + 10000)),
        qrToken: "t".repeat(48), name: mkName(), phone: `010${Math.floor(Math.random() * 90000000 + 10000000)}`,
        parentName: "فحص", parentPhone: `011${Math.floor(Math.random() * 90000000 + 10000000)}`, gradeId: grade?.id ?? null,
      },
    });
    return active;
  });
});

// ===== اختبار 2: نفس العملية بس القراءة عبر tx (الإصلاح المقترح) =====
await attempt("B) كل القراءات عبر tx نفسه (الإصلاح المقترح)", async () => {
  await db.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { centerId: center.id } }); // ← عبر tx
    if (sub?.planId) await tx.subscriptionPlan.findUnique({ where: { id: sub.planId } });
    await tx.student.count({ where: { centerId: center.id, status: "ACTIVE" } });
    await tx.student.create({
      data: {
        centerId: center.id, code: String(Math.floor(Math.random() * 90000 + 10000)),
        qrToken: "t".repeat(48), name: mkName(), phone: `010${Math.floor(Math.random() * 90000000 + 10000000)}`,
        parentName: "فحص", parentPhone: `011${Math.floor(Math.random() * 90000000 + 10000000)}`, gradeId: grade?.id ?? null,
      },
    });
  });
});

// ===== اختبار 3: آلية الـ bulk الحالي — generateStudentCode (db عام) جوه الـ tx =====
await attempt("C) generateStudentCode بـ db العام من جوه الـ transaction (كود الـ bulk الحالي)", async () => {
  await db.$transaction(async (tx) => {
    const exists = await db.student.findUnique({ where: { centerId_code: { centerId: center.id, code: "99999" } } }); // generateStudentCode يستخدم db العام
    await tx.student.create({
      data: {
        centerId: center.id, code: String(Math.floor(Math.random() * 90000 + 10000)),
        qrToken: "t".repeat(48), name: mkName(), phone: `010${Math.floor(Math.random() * 90000000 + 10000000)}`,
        parentName: "فحص", parentPhone: `011${Math.floor(Math.random() * 90000000 + 10000000)}`, gradeId: grade?.id ?? null,
      },
    });
    return exists;
  });
});

await db.student.deleteMany({ where: { name: { startsWith: "فحص آلي" } } });
await db.$disconnect();
