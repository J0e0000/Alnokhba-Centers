/**
 * AlNokhba Academia seed — realistic Egyptian academic demo data.
 * Run: bun prisma/seed-academia.ts
 * Creates: term, subjects + curriculum, teachers, students, groups with
 * recurring schedules (incl. TODAY), 3 weeks of sessions with attendance/
 * homework/interactions, 2 exams with results (one declining student for
 * insights), a pending request, notifications.
 * Logins: aca-admin / aca-manager / aca-teacher1..3 / aca-student1.. — password: academia123
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

let seedState = 7;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(arr: T[]): T { return arr[Math.floor(rnd() * arr.length)]; }

function cairoNow(): Date { return new Date(Date.now() + 2 * 3600 * 1000); }
function dateStr(offsetDays: number): string {
  return new Date(cairoNow().getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
}
function todayDow(): number { return cairoNow().getUTCDay(); }
function ws(): string {
  return JSON.stringify({ stages: { attendance: "pending", interaction: "pending", homework: "pending", exams: "pending", review: "pending" } });
}
function wsDone(): string {
  return JSON.stringify({ stages: { attendance: "done", interaction: "done", homework: "done", exams: "pending", review: "pending" } });
}

async function main() {
  console.log("🌱 Seeding AlNokhba Academia…");

  // wipe previous academia data (idempotent re-seed)
  await db.acaInsight.deleteMany();
  await db.acaInsightRun.deleteMany();
  await db.acaNotification.deleteMany();
  await db.acaRequest.deleteMany();
  await db.acaExamResult.deleteMany();
  await db.acaExam.deleteMany();
  await db.acaHomeworkRecord.deleteMany();
  await db.acaInteraction.deleteMany();
  await db.acaAttendance.deleteMany();
  await db.acaSession.deleteMany();
  await db.acaEnrollment.deleteMany();
  await db.acaGroupSchedule.deleteMany();
  await db.acaGroup.deleteMany();
  await db.acaLesson.deleteMany();
  await db.acaTopic.deleteMany();
  await db.acaUnit.deleteMany();
  await db.acaSubject.deleteMany();
  await db.academicTerm.deleteMany();
  await db.acaStudentProfile.deleteMany();
  await db.user.deleteMany({ where: { scope: "academia" } });

  // ---------------- TERM ----------------
  const term = await db.academicTerm.create({
    data: { name: "2026/2027 — الترم الأول", type: "TERM", startDate: dateStr(-30), endDate: dateStr(90), isActive: true },
  });

  // ---------------- SUBJECTS + CURRICULUM ----------------
  const math = await db.acaSubject.create({ data: { name: "الرياضيات", code: "MATH", color: "#2563EB" } });
  const physics = await db.acaSubject.create({ data: { name: "الفيزياء", code: "PHY", color: "#B45309" } });
  const chemistry = await db.acaSubject.create({ data: { name: "الكيمياء", code: "CHEM", color: "#6D28D9" } });
  const arabic = await db.acaSubject.create({ data: { name: "اللغة العربية", code: "AR", color: "#B91C1C" } });
  const english = await db.acaSubject.create({ data: { name: "اللغة الإنجليزية", code: "EN", color: "#1D4ED8" } });

  const mathUnits: { id: string; topics: { id: string }[] }[] = [];
  for (const [i, title] of ["الجبر", "الهندسة الفراغية", "التفاضل والتكامل"].entries()) {
    const u = await db.acaUnit.create({ data: { subjectId: math.id, title, order: i } });
    const topics: { id: string }[] = [];
    for (const [j, t] of [`المفاهيم الأساسية ${i + 1}`, `تطبيقات ${i + 1}`, `مسائل امتحانات ${i + 1}`].entries()) {
      const tp = await db.acaTopic.create({ data: { unitId: u.id, title: t, order: j } });
      for (const [k, l] of ["شرح نظري", "ورقة تدريب"].entries()) {
        await db.acaLesson.create({ data: { topicId: tp.id, title: `${t} — ${l}`, order: k } });
      }
      topics.push({ id: tp.id });
    }
    mathUnits.push({ id: u.id, topics });
  }
  const physicsTopics: { id: string }[] = [];
  for (const [i, title] of ["الحركة", "القوى وقوانين نيوتن", "الطاقة والشغل"].entries()) {
    const u = await db.acaUnit.create({ data: { subjectId: physics.id, title, order: i } });
    const tp = await db.acaTopic.create({ data: { unitId: u.id, title: `درس ${i + 1}: ${title}`, order: 0 } });
    await db.acaLesson.create({ data: { topicId: tp.id, title: `${title} — شرح`, order: 0 } });
    physicsTopics.push({ id: tp.id });
  }
  await db.acaUnit.create({ data: { subjectId: chemistry.id, title: "التركيب الذري", order: 0 } });
  await db.acaUnit.create({ data: { subjectId: arabic.id, title: "النحو والصرف", order: 0 } });
  await db.acaUnit.create({ data: { subjectId: english.id, title: "Grammar Units", order: 0 } });

  // ---------------- USERS: staff ----------------
  const tPass = hashPassword("academia123");
  const admin = await db.user.create({ data: { username: "aca-admin", passwordHash: tPass, name: "إدارة أكاديميا النخبة", role: "ADMIN", scope: "academia" } });
  const manager = await db.user.create({ data: { username: "aca-manager", passwordHash: tPass, name: "أ. هدى إبراهيم", role: "MANAGER", scope: "academia" } });
  const teacher1 = await db.user.create({ data: { username: "aca-teacher1", passwordHash: tPass, name: "أ. محمد سمير", role: "TEACHER", scope: "academia" } });
  const teacher2 = await db.user.create({ data: { username: "aca-teacher2", passwordHash: tPass, name: "أ. سلمى فؤاد", role: "TEACHER", scope: "academia" } });
  const teacher3 = await db.user.create({ data: { username: "aca-teacher3", passwordHash: tPass, name: "أ. كريم عادل", role: "TEACHER", scope: "academia" } });

  // ---------------- GROUPS with recurring occurrences ----------------
  // One group may hold MULTIPLE weekly occurrences (spec §11)
  const gMathA = await db.acaGroup.create({ data: { name: "الرياضيات — أولى ثانوي — A", subjectId: math.id, teacherId: teacher1.id, gradeName: "الأول الثانوي", room: "قاعة 1", capacity: 20, pricePerSession: 6500 } });
  const gMathB = await db.acaGroup.create({ data: { name: "الرياضيات — تانية ثانوي — B", subjectId: math.id, teacherId: teacher1.id, gradeName: "التانية الثانوي", room: "قاعة 2", capacity: 16, pricePerSession: 7000 } });
  const gPhys = await db.acaGroup.create({ data: { name: "الفيزياء — أولى ثانوي — A", subjectId: physics.id, teacherId: teacher2.id, gradeName: "الأول الثانوي", room: "قاعة 1", capacity: 18, pricePerSession: 6000 } });
  const gChem = await db.acaGroup.create({ data: { name: "الكيمياء — تالتة ثانوي", subjectId: chemistry.id, teacherId: teacher3.id, gradeName: "التالتة الثانوي", room: "قاعة 3", capacity: 12, pricePerSession: 7500 } });

  const sched: { groupId: string; dayOfWeek: number; startTime: string; endTime: string; room: string }[] = [
    { groupId: gMathA.id, dayOfWeek: (todayDow() + 7) % 7, startTime: "16:00", endTime: "17:30", room: "قاعة 1" }, // TODAY
    { groupId: gMathA.id, dayOfWeek: (todayDow() + 10) % 7, startTime: "16:00", endTime: "17:30", room: "قاعة 1" },
    { groupId: gMathB.id, dayOfWeek: (todayDow() + 7) % 7, startTime: "18:00", endTime: "19:30", room: "قاعة 2" },
    { groupId: gPhys.id, dayOfWeek: (todayDow() + 8) % 7, startTime: "17:00", endTime: "18:30", room: "قاعة 1" },
    { groupId: gChem.id, dayOfWeek: (todayDow() + 9) % 7, startTime: "15:30", endTime: "17:00", room: "قاعة 3" },
  ];
  for (const s of sched) await db.acaGroupSchedule.create({ data: s });

  // ---------------- STUDENTS ----------------
  const sNames = [
    "أحمد محمود الشريف", "سارة عبد الرحمن", "عمر خالد فؤاد", "منة الله حسن", "يوسف طارق",
    "كريم أشرف زكي", "زياد مجدي سلامة", "هنا أيمن رشاد", "مصطفى نبيل عوض", "ليلى سمير جورجي",
    "مازن حاتم عبد الله", "ريتاج وليد فهمي", "عبد الرحمن زيادة", "نور الدين صلاح", "حبيبة رمضان",
  ];
  const profiles: { id: string; userId: string }[] = [];
  for (const [i, name] of sNames.entries()) {
    const u = await db.user.create({
      data: { username: `aca-student${i + 1}`, passwordHash: tPass, name, role: "STUDENT", scope: "academia" },
    });
    const p = await db.acaStudentProfile.create({
      data: {
        userId: u.id, code: String(20001 + i), gradeName: i % 3 === 0 ? "الأول الثانوي" : i % 3 === 1 ? "التانية الثانوي" : "التالتة الثانوي",
        parentName: `ولي أمر ${name.split(" ")[0]}`, parentPhone: `01${Math.floor(100000000 + rnd() * 899999999)}`,
      },
    });
    profiles.push({ id: p.id, userId: u.id });
  }

  // enrollments: mathA (first 7), mathB (next 5), phys (mix 6), chem (last 4)
  const enroll = async (groupId: string, students: { id: string }[]) => {
    for (const s of students) await db.acaEnrollment.create({ data: { groupId, studentId: s.id } });
  };
  await enroll(gMathA.id, profiles.slice(0, 7));
  await enroll(gMathB.id, profiles.slice(7, 12));
  await enroll(gPhys.id, profiles.slice(0, 6));
  await enroll(gChem.id, profiles.slice(11, 15));

  // ---------------- HISTORY: past 21 days sessions ----------------
  const rosterOf: Record<string, string[]> = {
    [gMathA.id]: profiles.slice(0, 7).map((p) => p.id),
    [gMathB.id]: profiles.slice(7, 12).map((p) => p.id),
    [gPhys.id]: profiles.slice(0, 6).map((p) => p.id),
    [gChem.id]: profiles.slice(11, 15).map((p) => p.id),
  };
  const teacherOf: Record<string, string> = { [gMathA.id]: teacher1.id, [gMathB.id]: teacher1.id, [gPhys.id]: teacher2.id, [gChem.id]: teacher3.id };
  const mathTopicIds = mathUnits.flatMap((u) => u.topics.map((t) => t.id));
  let topicCursor = 0;

  for (let d = -21; d <= -1; d++) {
    const date = dateStr(d);
    const dow = new Date(date + "T00:00:00Z").getUTCDay();
    for (const s of sched) {
      if (s.dayOfWeek !== dow) continue;
      const roster = rosterOf[s.groupId];
      // keep ~half the historical dates empty of marks for one group to create attendance materiality
      const sess = await db.acaSession.create({
        data: {
          groupId: s.groupId, date, startTime: s.startTime, endTime: s.endTime, room: s.room,
          teacherId: teacherOf[s.groupId], topicId: s.groupId === gMathA.id ? mathTopicIds[topicCursor++ % mathTopicIds.length] : (s.groupId === gPhys.id ? pick(physicsTopics).id : null),
          status: "COMPLETED", startedAt: new Date(), completedAt: new Date(), workspace: wsDone(),
        },
      });
      const absentee = d % 5 === 0 ? roster[0] : d % 7 === 0 ? roster[1] : null;
      for (const sid of roster) {
        const status = sid === absentee ? "ABSENT" : rnd() > 0.93 ? "LATE" : "PRESENT";
        await db.acaAttendance.create({ data: { sessionId: sess.id, studentId: sid, status, markedById: teacherOf[s.groupId] } });
        if (status !== "ABSENT") {
          await db.acaHomeworkRecord.create({
            data: { sessionId: sess.id, studentId: sid, completed: rnd() > 0.25, score: rnd() > 0.25 ? 10 : rnd() > 0.5 ? 5 : -5 },
          });
        }
      }
    }
  }

  // ---------------- TODAY'S SESSIONS ----------------
  // (generated lazily & idempotently by ensureSessionsForDate when the
  //  teacher/manager opens the app — the weekly occurrences above already
  //  include today's day, so no manual insert is needed here)

  // ---------------- EXAMS + RESULTS (with a declining student) ----------------
  const exam1 = await db.acaExam.create({ data: { groupId: gMathA.id, subjectId: math.id, title: "كويز الجبر — أكتوبر", type: "QUIZ", date: dateStr(-18), maxScore: 20, createdBy: teacher1.id, termId: term.id } });
  const exam2 = await db.acaExam.create({ data: { groupId: gMathA.id, subjectId: math.id, title: "امتحان نوفمبر", type: "MIDTERM", date: dateStr(-10), maxScore: 50, createdBy: teacher1.id, termId: term.id } });
  const exam3 = await db.acaExam.create({ data: { groupId: gMathA.id, subjectId: math.id, title: "كويز الهندسة", type: "QUIZ", date: dateStr(-3), maxScore: 20, createdBy: teacher1.id, termId: term.id, topicId: mathUnits[1].topics[0].id } });
  const mathARoster = profiles.slice(0, 7);
  // student index 2 (عمر خالد فؤاد) declines: 90% → 60% → 40%
  const decline = [0.9, 0.6, 0.4];
  const examsArr = [exam1, exam2, exam3];
  for (const [ei, exam] of examsArr.entries()) {
    for (const [si, p] of mathARoster.entries()) {
      const ratio = si === 2 ? decline[ei] : 0.65 + rnd() * 0.3;
      const score = Math.round((exam.maxScore === 20 ? 20 : 50) * ratio);
      await db.acaExamResult.create({ data: { examId: exam.id, studentId: p.id, score, enteredById: teacher1.id } });
    }
  }
  const physExam = await db.acaExam.create({ data: { groupId: gPhys.id, subjectId: physics.id, title: "كويز الحركة", type: "QUIZ", date: dateStr(-6), maxScore: 20, createdBy: teacher2.id, termId: term.id } });
  for (const p of profiles.slice(0, 6)) {
    await db.acaExamResult.create({ data: { examId: physExam.id, studentId: p.id, score: Math.round(20 * (0.6 + rnd() * 0.35)), enteredById: teacher2.id } });
  }

  // ---------------- PENDING REQUEST + NOTIFICATIONS ----------------
  await db.acaRequest.create({
    data: {
      type: "MAKEUP", groupId: gChem.id,
      payload: JSON.stringify({ date: dateStr(3), startTime: "15:30", endTime: "17:00", reason: "الحصة اتلغت بسبب عجز مفاجئ" }),
      requestedById: teacher3.id, status: "PENDING",
    },
  });
  await db.acaNotification.createMany({
    data: [
      { userId: manager.id, type: "REQUEST", title: "طلب جديد من مدرس", body: "أ. كريم عادل بعت طلب حصة تعويضية.", data: JSON.stringify({}) },
      { userId: admin.id, type: "SYSTEM", title: "أكاديميا النخبة جاهزة", body: "البيانات التجريبية اتحملت — 15 طالب و4 مجموعات وجدول الأسبوع ده.", data: JSON.stringify({}) },
    ],
  });

  console.log("✅ Academia seed done");
  console.log("   Logins → aca-admin / aca-manager / aca-teacher1 / aca-teacher2 / aca-teacher3 / aca-student1.. — password: academia123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
