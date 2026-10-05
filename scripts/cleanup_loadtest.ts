import { PrismaClient } from "@prisma/client";

/**
 * تنظيف حصص اختبار الحمل (loadtest) — dev فقط:
 * بيحذف الحصص الاسم بيبدأ بـ"loadtest" ومعاها التوكنز والمحاولات والحضور (cascade).
 */
const p = new PrismaClient();

async function main() {
  const olds = await p.sessionInstance.findMany({
    where: { name: { startsWith: "loadtest" } },
    select: { id: true },
  });
  let attempts = 0;
  for (const s of olds) {
    attempts += await p.checkInAttempt.deleteMany({ where: { sessionId: s.id } }).then((r) => r.count);
    await p.sessionQRToken.deleteMany({ where: { sessionId: s.id } });
    await p.sessionInstance.delete({ where: { id: s.id } }); // الحضور بيتحذف cascade
  }
  console.log(JSON.stringify({ sessions: olds.length, attemptsDeleted: attempts }));
}
main().finally(() => p.$disconnect());
