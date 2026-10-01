/**
 * Supabase live-test helper — إنشاء حصة اختبار اليوم + تنظيف بيانات الاختبار.
 * Usage:
 *   npx tsx scripts/supabase_test_helper.ts create-session
 *   npx tsx scripts/supabase_test_helper.ts cleanup
 */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import path from "path";
import { createRequire } from "module";

const require_ = createRequire(path.join(process.cwd(), "package.json"));
require_(".prisma/client/default").Prisma; // warm sqlite default binding (not used)

const url = process.env.SB_URL ?? "";
if (!url) { console.error("SB_URL env required"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url } } });

const GROUP = "cmufickak001eiqo9tkb8o3hc"; // فيزياء
const CENTER = "cmufick570003iqo9fnqvrh2c";
const STUDENT = "cmufickan001oiqo9a34egvv6"; // 10001

async function main() {
  const mode = process.argv[2] ?? "";
  if (mode === "create-session") {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    // حصة نضيفة كل تشغيل — التوقيت مختلف عشان مفيش تعارض
    const s = await db.sessionInstance.create({
      data: {
        centerId: CENTER, groupId: GROUP, date,
        startTime: `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`,
        endTime: "23:59", price: 5000, teacherPercent: 50, status: "OPEN",
      },
    });
    console.log("SESSION_ID=" + s.id);
  } else if (mode === "cleanup") {
    // بيانات اختبار بعناوين معروفة — امتحانات/واجبات/محاولات/تسليمات/حصص الاختبار
    const exams = await db.exam.findMany({ where: { OR: [
      { title: { contains: "E2E" } }, { title: { contains: "(autosubmit)" } },
      { title: { contains: "(missed)" } }, { title: { contains: "(notyet)" } },
      { title: { contains: "LIVE" } },
    ] }, select: { id: true, title: true } });
    for (const e of exams) {
      await db.examSecurityEvent.deleteMany({ where: { attempt: { examId: e.id } } });
      await db.examAnswer.deleteMany({ where: { attempt: { examId: e.id } } });
      await db.examAttempt.deleteMany({ where: { examId: e.id } });
      await db.exam.delete({ where: { id: e.id } });
    }
    const asgs = await db.assignment.findMany({ where: { OR: [
      { title: { contains: "E2E" } }, { title: { contains: "(late test)" } }, { title: { contains: "LIVE" } },
    ] }, select: { id: true } });
    for (const a of asgs) {
      await db.assignmentSubmission.deleteMany({ where: { assignmentId: a.id } });
      await db.assignmentQuestion.deleteMany({ where: { assignmentId: a.id } });
      await db.assignment.delete({ where: { id: a.id } });
    }
    // حصص الاختبار المفتوحة المزيفة (بتاعة اليوم بس اللي اتعملت للاختبار واتسجل عليها حضور QR)
    const sessions = await db.sessionInstance.findMany({ where: { groupId: GROUP, date: new Date().toISOString().slice(0, 10) }, select: { id: true } });
    for (const s of sessions) {
      await db.attendance.deleteMany({ where: { sessionId: s.id, studentId: STUDENT } });
      await db.studentTransaction.deleteMany({ where: { sessionId: s.id, studentId: STUDENT, createdBy: "SESSION_QR" } });
      await db.sessionQRToken.deleteMany({ where: { sessionId: s.id } });
      await db.sessionInstance.delete({ where: { id: s.id } });
    }
    console.log(`cleanup done: ${exams.length} exams, ${asgs.length} assignments, ${sessions.length} test sessions removed`);
  } else {
    console.error("mode: create-session | cleanup");
    process.exit(1);
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
