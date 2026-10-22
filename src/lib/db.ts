import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

// Deploy-safe fallback: if DATABASE_URL is not set, resolve the committed demo
// database instead of crashing. On serverless (Vercel) the bundle filesystem is
// read-only, so copy the sqlite file to /tmp first — everything works, with
// ephemeral writes, until a real DATABASE_URL (postgres) is configured.
if (!process.env.DATABASE_URL) {
  const candidates = [
    path.join(process.cwd(), 'db', 'custom.db'),
    path.join(process.cwd(), '..', 'db', 'custom.db'),
    path.join(process.cwd(), '..', '..', 'db', 'custom.db')
  ]
  const bundled = candidates.find((p) => fs.existsSync(p))
  if (process.env.VERCEL === '1' && bundled) {
    const tmpDb = '/tmp/nokhba-demo.db'
    try {
      if (!fs.existsSync(tmpDb)) fs.copyFileSync(bundled, tmpDb)
      process.env.DATABASE_URL = 'file:' + tmpDb
    } catch {
      process.env.DATABASE_URL = 'file:' + bundled
    }
  } else {
    process.env.DATABASE_URL = 'file:' + (bundled ?? path.join(process.cwd(), 'db', 'custom.db'))
  }
}

// ============================================================
// توسعة قاعدة البيانات (Task R) — ضبط الاتصال حسب نوع الداتابيز:
// - Postgres مُدار: connection_limit افتراضي آمن لكل lambda (بيمنع استنزاف
//   اتصالات الداتابيز لما موجة طلبة تمسح في نفس الثانية) + pool_timeout.
//   يتعاد الضبط بمتغير البيئة NK_DB_CONNECTION_LIMIT من غير deploy جديد.
// - SQLite (تطوير/اختبار): journal_mode=WAL — القراءات مش بتحجب الكاتب
//   والعكس (الوضع دايم على مستوى ملف الداتابيز — تنفيذ واحد كفاية).
// ============================================================
if (process.env.DATABASE_URL.startsWith('postgres')) {
  try {
    const u = new URL(process.env.DATABASE_URL)
    if (!u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', process.env.NK_DB_CONNECTION_LIMIT ?? '10')
    }
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '15')
    process.env.DATABASE_URL = u.toString()
  } catch {
    // URL غير قياسي — سيبه زي ما هو
  }
}

// SQLite: pool=1 — SQLite كاتب واحد أصلًا، والـ pool الواحد بيلغي SQLITE_BUSY
// بين طلبات متزامنة جوه نفس العملية (سباق الدفعات المتزامنة — spec المرحلة 3)
// وبيخلي PRAGMA (WAL/busy_timeout) متطبق فعلًا على الكونكشن الوحيد.
// التوسّع الأفقي بيفضل شغال عبر busy_timeout على مستوى الملف لو حصلت عمليات متعددة.
if (process.env.DATABASE_URL.startsWith('file:')) {
  try {
    const u = new URL(process.env.DATABASE_URL)
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1')
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '15')
    process.env.DATABASE_URL = u.toString()
  } catch {
    // file: URL غير قياسي (path بدون scheme صحيح) — سيبه
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * وضع قاعدة البيانات الحالي — بيتكشف مرة واحدة لكل عملية:
 * - postgres: DATABASE_URL حقيقي مرتبط (الإنتاج السليم — الكتابة بتتحفظ)
 * - demo: على Vercel من غير DATABASE_URL → SQLite مؤقت لكل نسخة lambda:
 *   الجلسات والبيانات بتضيع عشوائيًا بين النسخ («دخول وخروج فوري») —
 *   وضع معروض للتنبيه بس، مش وضع تشغيل حقيقي.
 * - local: تطوير محلي بـ SQLite — ده الوضع المقصود للتطوير.
 */
export function dbMode(): 'postgres' | 'demo' | 'local' {
  const url = process.env.DATABASE_URL ?? ''
  if (url.startsWith('postgres')) return 'postgres'
  if (process.env.VERCEL === '1') return 'demo'
  return 'local'
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  })

// SQLite WAL (توسعة Task R) — mode دايم على مستوى الملف؛ تنفيذ أول تشغيل كفاية
// (فشل صامت لو الملف مقفول من عملية تانية — المرة الجاية هيتم)
// busy_timeout: كتّاب متزامنين بيستنوا في الدور (حتى 5ث) بدل ما يفشلوا فورًا بـ
// SQLITE_BUSY — أساس idempotency-race في الدفعات (spec المرحلة 3).
if (process.env.DATABASE_URL.startsWith('file:')) {
  db.$queryRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {})
  db.$queryRawUnsafe('PRAGMA busy_timeout=5000;').catch(() => {})
}

// ============================================================
// حماية من حالة SQLite التالفة عند الإقلاع (وجة هجوم حقيقي 2026-10-15):
// لو عملية اتحطمت والـ WAL اتشال والـ -shm فضل قديم → أي query (حتى قراءة)
// بيرمي "disk I/O error" والنظام بيرد «حدث خطأ في السيرفر» لكل حاجة.
// التشخيص عند الإقلاع: probe بسيط — لو فشل بخطأ I/O بننضف الملفات الجانبية
// بالترتيب الآمن (-shm الأول، وبعدين -wal كحل أخير) وبنكتب في اللوج بوضوح.
// ============================================================
if (process.env.DATABASE_URL.startsWith('file:')) {
  void (async () => {
    const dbFile = process.env.DATABASE_URL!.slice('file:'.length);
    const probe = () => db.$queryRawUnsafe('SELECT 1 FROM sqlite_master LIMIT 1');
    try {
      await probe();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/disk I\/O|malformed|not a database/i.test(msg)) return; // مشكلة تانية — مش بتاعتنا
      console.error('[db-recovery] SQLite بيرمي خطأ I/O عند الإقلاع — بجرب إصلاح ملفات WAL الجانبية:', msg);
      for (const suffix of ['-shm', '-wal']) {
        try { fs.rmSync(dbFile + suffix, { force: true }); } catch { /* تجاهل — بنجرب برضه */ }
        try {
          await probe();
          console.error(`[db-recovery] الداتابيز رجعت شغالة بعد مسح ${suffix} — يُراجع السجل المفقود يدويًا لو فيه كتابات مهمة.`);
          return;
        } catch { /* لسه فاشلة — نكمل */ }
      }
      console.error('[db-recovery] الداتابيز لسه فاشلة بعد التنظيف — محتاجة تدخل يدوي (استعن بـ .recover).');
    }
  })();
}

// Cache on EVERY environment (incl. production): Next.js bundles this module
// into each route's serverless bundle — without globalThis caching, every
// route in a lambda instance would spin its own PrismaClient + engine,
// wasting CPU (slow cold start) and connections.
globalForPrisma.prisma = db