// seed بيئة اختبار الجدول v2 في سنتر QAE1 (سنتر الاختبار المعزول في الـ dev)
// idempotent — مش بيضاعف. تشغيل: bun scripts/qae/seed_schedule_env.ts
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();
const CID = "cmvbb396y0000ovy9n6gmecjy"; // QAE1 — سنتر اختبار فاضي

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function main() {
  console.log("=== seed بيئة الجدول في QAE1 ===");

  // قاعات
  for (const [i, name] of ["قاعة 1", "قاعة 2"].entries()) {
    await db.room.upsert({
      where: { centerId_name: { centerId: CID, name } },
      update: {},
      create: { centerId: CID, name, capacity: 20, order: i },
    });
  }

  // مواد وصفوف
  const subjectNames = ["عربي", "رياضيات"];
  const subjects: Record<string, string> = {};
  for (const name of subjectNames) {
    const existing = await db.subject.findFirst({ where: { centerId: CID, name } });
    subjects[name] = existing?.id ?? (await db.subject.create({ data: { centerId: CID, name } })).id;
  }
  const gradeNames = ["صف أول ثانوي", "صف تالت ثانوي"];
  const grades: Record<string, string> = {};
  for (const name of gradeNames) {
    const existing = await db.grade.findFirst({ where: { centerId: CID, name } });
    grades[name] = existing?.id ?? (await db.grade.create({ data: { centerId: CID, name } })).id;
  }

  // مدرسين
  const teachers: Record<string, string> = {};
  for (const name of ["أ. محمد", "أ. سارة"]) {
    const existing = await db.teacher.findFirst({ where: { centerId: CID, name } });
    teachers[name] = existing?.id ?? (await db.teacher.create({ data: { centerId: CID, name } })).id;
  }

  // مجموعات
  const groupDefs = [
    { key: "عربي-أ", subject: "عربي", grade: "صف أول ثانوي", teacher: "أ. محمد", price: 5000, pct: 50 },
    { key: "رياضيات-أ", subject: "رياضيات", grade: "صف تالت ثانوي", teacher: "أ. سارة", price: 6000, pct: 60 },
    { key: "رياضيات-ب", subject: "رياضيات", grade: "صف أول ثانوي", teacher: "أ. سارة", price: 6000, pct: 60 },
  ];
  const groups: Record<string, string> = {};
  for (const g of groupDefs) {
    const existing = await db.group.findFirst({ where: { centerId: CID, name: g.key } });
    groups[g.key] = existing?.id ?? (await db.group.create({
      data: {
        centerId: CID, name: g.key, gradeId: grades[g.grade], subjectId: subjects[g.subject],
        teacherId: teachers[g.teacher], sessionPrice: g.price, teacherPercent: g.pct,
      },
    })).id;
  }

  // سلوتات: متوازي سليم + تعارض مدرس مقصود للاختبار
  const slotDefs = [
    { group: "عربي-أ", dow: 6, start: "16:00", end: "18:00", room: "قاعة 1" },      // سليم
    { group: "رياضيات-أ", dow: 6, start: "16:00", end: "18:00", room: "قاعة 2" },   // متوازي سليم (مدرس/قاعة مختلفين)
    { group: "رياضيات-ب", dow: 6, start: "17:00", end: "19:00", room: "قاعة 1" },   // تعارض مدرس (سارة) مع رياضيات-أ
    { group: "عربي-أ", dow: 0, start: "16:00", end: "20:00", room: "قاعة 1" },      // 4 ساعات = بلوكان متصلين
  ];
  let created = 0;
  for (const s of slotDefs) {
    const exists = await db.scheduleSlot.findFirst({
      where: { centerId: CID, dayOfWeek: s.dow, startTime: s.start, groupId: groups[s.group] },
    });
    if (!exists) {
      await db.scheduleSlot.create({
        data: { centerId: CID, dayOfWeek: s.dow, startTime: s.start, endTime: s.end, groupId: groups[s.group], room: s.room },
      });
      created++;
    }
  }

  // باسورد مدير معروف للاختبار
  await db.user.updateMany({ where: { username: "qae-mgr-ob" }, data: { passwordHash: hashPassword("Qae#2026") } });

  console.log(`slots created=${created}, total=${await db.scheduleSlot.count({ where: { centerId: CID } })}`);
  console.log("login: qae-mgr-ob / Qae#2026");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
