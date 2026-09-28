/**
 * Nokhba Centers seed — realistic Egyptian demo data with a fully consistent
 * financial ledger (charges/payments/settlements all add up).
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function token(): string { return randomBytes(24).toString("hex"); }

// Deterministic RNG for reproducible demo data
let seedState = 42;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(arr: T[]): T { return arr[Math.floor(rnd() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return out;
}

// Cairo "today"
function cairoNow(): Date { return new Date(Date.now() + 2 * 3600 * 1000); }
function dateStr(offsetDays: number): string {
  const d = new Date(cairoNow().getTime() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function todayDow(): number { return cairoNow().getUTCDay(); }

function shiftTime(base: string, minutes: number): string {
  const [h, m] = base.split(":").map(Number);
  let total = h * 60 + m + minutes;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function nowHM(): string {
  const n = cairoNow();
  return `${String(n.getUTCHours()).padStart(2, "0")}:${String(Math.round(n.getUTCMinutes() / 5) * 5).padStart(2, "0")}`;
}

const EGP = (p: number) => p * 100;

async function main() {
  console.log("🌱 Seeding Nokhba Centers...");
  await db.$transaction(async (tx) => {
    // ordered deletes — children before parents (interactive tx guarantees sequence)
    await tx.auditLog.deleteMany();
    await tx.platformBilling.deleteMany();
    await tx.authSession.deleteMany();
    await tx.cashDay.deleteMany();
    await tx.centerTransaction.deleteMany();
    await tx.teacherSettlement.deleteMany();
    await tx.expense.deleteMany();
    await tx.studentTransaction.deleteMany();
    await tx.attendance.deleteMany();
    await tx.sessionInstance.deleteMany();
    await tx.scheduleSlot.deleteMany();
    await tx.studentGroup.deleteMany();
    await tx.bookSale.deleteMany();
    await tx.book.deleteMany();
    await tx.room.deleteMany();
    await tx.student.deleteMany();
    await tx.group.deleteMany();
    await tx.teacher.deleteMany();
    await tx.subject.deleteMany();
    await tx.grade.deleteMany();
    await tx.whatsAppTemplate.deleteMany();
    await tx.subscription.deleteMany();
    await tx.subscriptionPlan.deleteMany();
    await tx.user.deleteMany();
    await tx.center.deleteMany();
  });

  // ================= PLANS =================
  const plans = await Promise.all([
    db.subscriptionPlan.create({ data: { name: "Starter", pricePerStudent: EGP(15), maxStudents: 150 } }),
    db.subscriptionPlan.create({ data: { name: "Professional", pricePerStudent: EGP(25), maxStudents: 600 } }),
    db.subscriptionPlan.create({ data: { name: "Enterprise", pricePerStudent: EGP(40), maxStudents: null } }),
  ]);

  // ================= CENTERS =================
  const nokhba = await db.center.create({
    data: {
      name: "مركز النخبة التعليمي",
      slug: "alnokhba-elite",
      primaryColor: "#0E9F6E",
      secondaryColor: "#0F766E",
      accentColor: "#F59E0B",
      phone: "01012345678",
      whatsapp: "01012345678",
      address: "15 شارع الجامعة، أمام مدرسة السلام، المعادي، القاهرة",
      slogan: "نخبة التلاميذ… نخبة المستقبل",
      signature: "مع تحيات فريق مركز النخبة التعليمي 🌟",
      social: JSON.stringify({ facebook: "facebook.com/alnokhba.elite" }),
    },
  });
  const amal = await db.center.create({
    data: {
      name: "سنتر الأمل",
      slug: "amal-center",
      primaryColor: "#B45309",
      secondaryColor: "#7C2D12",
      accentColor: "#0D9488",
      phone: "01198765432",
      whatsapp: "01198765432",
      address: "8 شارع البحر، العجوزة، الجيزة",
      slogan: "تعليم بثقة",
      signature: "سنتر الأمل — تعليم بثقة",
    },
  });

  // ================= USERS =================
  const users = {
    admin: await db.user.create({
      data: { username: "admin", passwordHash: hashPassword("nokhba123"), name: "إدارة النخبة", role: "ADMIN", centerId: null },
    }),
    manager: await db.user.create({
      data: { username: "manager", passwordHash: hashPassword("nokhba123"), name: "أ. أحمد محمود", role: "MANAGER", centerId: nokhba.id },
    }),
    reception: await db.user.create({
      data: { username: "reception", passwordHash: hashPassword("nokhba123"), name: "سارة محمد", role: "RECEPTIONIST", centerId: nokhba.id, canAddStudents: true },
    }),
    receptionNoAdd: await db.user.create({
      data: { username: "reception2", passwordHash: hashPassword("nokhba123"), name: "منة الله حسن", role: "RECEPTIONIST", centerId: nokhba.id, canAddStudents: false },
    }),
    manager2: await db.user.create({
      data: { username: "manager2", passwordHash: hashPassword("nokhba123"), name: "أ. هدى إبراهيم", role: "MANAGER", centerId: amal.id },
    }),
  };

  // ================= ACADEMICS (Center 1) =================
  const grades = await Promise.all([
    db.grade.create({ data: { centerId: nokhba.id, name: "الثالث الإعدادي", order: 1 } }),
    db.grade.create({ data: { centerId: nokhba.id, name: "الأول الثانوي", order: 2 } }),
    db.grade.create({ data: { centerId: nokhba.id, name: "الثاني الثانوي", order: 3 } }),
  ]);
  const subjects = await Promise.all([
    db.subject.create({ data: { centerId: nokhba.id, name: "فيزياء" } }),
    db.subject.create({ data: { centerId: nokhba.id, name: "كيمياء" } }),
    db.subject.create({ data: { centerId: nokhba.id, name: "رياضيات" } }),
    db.subject.create({ data: { centerId: nokhba.id, name: "إنجليزي" } }),
  ]);
  const teachers = await Promise.all([
    // loginCode = كود دخول بورتال المدرس (4 أرقام فريد داخل السنتر)
    db.teacher.create({ data: { centerId: nokhba.id, name: "أ. محمد حسن", phone: "01011112222", loginCode: "1234" } }),
    db.teacher.create({ data: { centerId: nokhba.id, name: "أ. سارة علي", phone: "01233334444", loginCode: "2345" } }),
    db.teacher.create({ data: { centerId: nokhba.id, name: "أ. خالد إبراهيم", phone: "01555556666", loginCode: "3456" } }),
  ]);

  // Halls (قاعات) registry — group/schedule room strings reference these names
  await Promise.all([
    db.room.create({ data: { centerId: nokhba.id, name: "قاعة 1", capacity: 30, order: 0 } }),
    db.room.create({ data: { centerId: nokhba.id, name: "قاعة 2", capacity: 25, order: 1 } }),
    db.room.create({ data: { centerId: nokhba.id, name: "قاعة 3", capacity: 20, order: 2 } }),
    db.room.create({ data: { centerId: amal.id, name: "القاعة الرئيسية", capacity: 18, order: 0 } }),
  ]);

  // Groups: physics-G10-A 65/70%, chemistry-G10-A 60/65%, math-G10-B 55/60%, english-prep-A 40/50%, physics-G11-A 70/70%
  const groups = await Promise.all([
    db.group.create({ data: { centerId: nokhba.id, name: "A", gradeId: grades[1].id, subjectId: subjects[0].id, teacherId: teachers[0].id, sessionPrice: EGP(65), teacherPercent: 70, room: "قاعة 2" } }),
    db.group.create({ data: { centerId: nokhba.id, name: "A", gradeId: grades[1].id, subjectId: subjects[1].id, teacherId: teachers[1].id, sessionPrice: EGP(60), teacherPercent: 65, room: "قاعة 1" } }),
    db.group.create({ data: { centerId: nokhba.id, name: "B", gradeId: grades[1].id, subjectId: subjects[2].id, teacherId: teachers[2].id, sessionPrice: EGP(55), teacherPercent: 60, room: "قاعة 3" } }),
    db.group.create({ data: { centerId: nokhba.id, name: "A", gradeId: grades[0].id, subjectId: subjects[3].id, teacherId: teachers[1].id, sessionPrice: EGP(40), teacherPercent: 50, room: "قاعة 1" } }),
    db.group.create({ data: { centerId: nokhba.id, name: "A", gradeId: grades[2].id, subjectId: subjects[0].id, teacherId: teachers[0].id, sessionPrice: EGP(70), teacherPercent: 70, room: "قاعة 2" } }),
  ]);

  // ================= SUBSCRIPTIONS =================
  await db.subscription.create({
    data: { centerId: nokhba.id, planId: plans[1].id, status: "ACTIVE", pricePerStudent: EGP(25), startDate: dateStr(-35), renewalDate: dateStr(25), paymentStatus: "PAID" },
  });
  await db.subscription.create({
    data: { centerId: amal.id, planId: plans[0].id, status: "EXPIRED", pricePerStudent: EGP(15), startDate: dateStr(-70), renewalDate: dateStr(-5), paymentStatus: "PENDING" },
  });
  await db.platformBilling.create({
    data: { centerId: nokhba.id, students: 16, pricePerStudent: EGP(25), amount: EGP(400), periodStart: dateStr(-35), periodEnd: dateStr(25), status: "PAID", createdBy: users.admin.id },
  });

  // ================= STUDENTS (Center 1) =================
  type S = { name: string; parent: string; phone?: string; gradeIdx: number; school?: string; groupIdx: number[]; pay: "full" | "owe" | "credit"; status?: string };
  const roster: S[] = [
    { name: "أحمد محمود الشريف", parent: "محمود الشريف", phone: "01055551111", gradeIdx: 1, school: "مدرسة السلام الثانوية", groupIdx: [0, 1], pay: "full" },
    { name: "محمد عبد الرحمن", parent: "عبد الرحمن سيد", phone: "01055552222", gradeIdx: 1, school: "مدرسة النيل", groupIdx: [0, 1, 2], pay: "owe" },
    { name: "عمر خالد فؤاد", parent: "خالد فؤاد", phone: "01055553333", gradeIdx: 1, groupIdx: [0, 2], pay: "full" },
    { name: "يوسف حسن عبد الله", parent: "حسن عبد الله", phone: "01055554444", gradeIdx: 1, groupIdx: [1, 2], pay: "credit" },
    { name: "كريم أشرف زكي", parent: "أشرف زكي", phone: "01166667777", gradeIdx: 1, groupIdx: [0], pay: "full" },
    { name: "زياد طارق منصور", parent: "طارق منصور", phone: "01277778888", gradeIdx: 1, groupIdx: [0, 1], pay: "owe" },
    { name: "نورهان سامي", parent: "سامي عبد العال", phone: "01088889999", gradeIdx: 1, school: "مدرسة المستقبل", groupIdx: [1, 2], pay: "full" },
    { name: "مريم عادل رشاد", parent: "عادل رشاد", phone: "01099990000", gradeIdx: 1, groupIdx: [0, 1, 2], pay: "credit" },
    { name: "سلمى أيمن حاتم", parent: "أيمن حاتم", phone: "01122223333", gradeIdx: 1, groupIdx: [2], pay: "full" },
    { name: "هبة الله مصطفى", parent: "مصطفى كامل", phone: "01233335555", gradeIdx: 1, groupIdx: [0, 2], pay: "owe" },
    { name: "فاطمة الزهراء عصام", parent: "عصام الدين", phone: "01012349876", gradeIdx: 0, groupIdx: [3], pay: "full" },
    { name: "جنى محسن ثابت", parent: "محسن ثابت", phone: "01156781234", gradeIdx: 0, groupIdx: [3], pay: "credit" },
    { name: "ملك أحمد سيد", parent: "أحمد سيد", phone: "01298765432", gradeIdx: 0, groupIdx: [3], pay: "full" },
    { name: "أدهم شريف لطفي", parent: "شريف لطفي", phone: "01087651234", gradeIdx: 2, groupIdx: [4], pay: "full" },
    { name: "طه وليد صابر", parent: "وليد صابر", phone: "01123456789", gradeIdx: 2, groupIdx: [4], pay: "owe" },
    { name: "ريم عبد الله ناصر", parent: "عبد الله ناصر", phone: "01234567898", gradeIdx: 2, groupIdx: [4], pay: "full" },
    { name: "حسين عادل جمعة", parent: "عادل جمعة", phone: "01011223344", gradeIdx: 1, groupIdx: [], pay: "full", status: "PAUSED" },
    { name: "هنا عمر فتحي", parent: "عمر فتحي", phone: "01122334455", gradeIdx: 1, groupIdx: [0], pay: "full", status: "ARCHIVED" },
  ];

  const students: { id: string; name: string; code: string; pay: string; groupIdx: number[] }[] = [];
  for (let i = 0; i < roster.length; i++) {
    const r = roster[i];
    const st = await db.student.create({
      data: {
        centerId: nokhba.id,
        code: String(10001 + i),
        qrToken: token(),
        name: r.name,
        phone: r.phone,
        parentName: r.parent,
        parentPhone: r.phone ? `010${String(10000000 + i * 137).slice(0, 8)}` : null,
        gradeId: grades[r.gradeIdx].id,
        school: r.school ?? null,
        status: r.status ?? "ACTIVE",
        notes: i === 1 ? "طالب منتظم — يسدد كل أسبوع" : null,
      },
    });
    for (const gi of r.groupIdx) {
      await db.studentGroup.create({
        data: { studentId: st.id, groupId: groups[gi].id, registeredBy: users.manager.id },
      });
    }
    students.push({ ...st, pay: r.pay, groupIdx: r.groupIdx });
  }

  // Center 2 students (isolation + subscription counting demo)
  const amalGrade = await db.grade.create({ data: { centerId: amal.id, name: "الأول الإعدادي", order: 1 } });
  const amalSubject = await db.subject.create({ data: { centerId: amal.id, name: "علوم" } });
  const amalTeacher = await db.teacher.create({ data: { centerId: amal.id, name: "أ. مصطفى سعيد" } });
  const amalGroup = await db.group.create({
    data: { centerId: amal.id, name: "A", gradeId: amalGrade.id, subjectId: amalSubject.id, teacherId: amalTeacher.id, sessionPrice: EGP(35), teacherPercent: 55 },
  });
  const amalNames = ["سيف الدين مراد", "ليان حازم", "عبد الرحمن ماجد", "جودي شريف", "مارس علام", "كنزي ياسر", "روان هشام", "يامن صبري"];
  for (let i = 0; i < amalNames.length; i++) {
    const st = await db.student.create({
      data: {
        centerId: amal.id, code: String(20001 + i), qrToken: token(), name: amalNames[i],
        parentName: "ولي أمر", parentPhone: `010${String(20000000 + i * 313).slice(0, 8)}`,
        gradeId: amalGrade.id, status: "ACTIVE",
      },
    });
    await db.studentGroup.create({ data: { studentId: st.id, groupId: amalGroup.id, registeredBy: users.manager2.id } });
  }

  // ================= SCHEDULE (Center 1) =================
  // dayOfWeek: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const today = todayDow();
  const slotDefs: { day: number; start: string; end: string; groupIdx: number; room: string }[] = [
    { day: 6, start: "14:00", end: "15:30", groupIdx: 3, room: "قاعة 1" }, // Sat
    { day: 6, start: "16:00", end: "17:30", groupIdx: 0, room: "قاعة 2" },
    { day: 6, start: "18:00", end: "19:30", groupIdx: 1, room: "قاعة 1" },
    { day: 0, start: "16:00", end: "17:30", groupIdx: 2, room: "قاعة 3" }, // Sun
    { day: 0, start: "18:00", end: "19:30", groupIdx: 4, room: "قاعة 2" },
    { day: 1, start: "15:00", end: "16:30", groupIdx: 1, room: "قاعة 1" }, // Mon
    { day: 1, start: "17:00", end: "18:30", groupIdx: 0, room: "قاعة 2" },
    { day: 2, start: "14:00", end: "15:30", groupIdx: 3, room: "قاعة 1" }, // Tue (today)
    { day: 2, start: "17:00", end: "18:30", groupIdx: 0, room: "قاعة 2" },
    { day: 2, start: "19:00", end: "20:30", groupIdx: 1, room: "قاعة 1" },
    { day: 3, start: "16:00", end: "17:30", groupIdx: 2, room: "قاعة 3" }, // Wed
    { day: 3, start: "18:00", end: "19:30", groupIdx: 0, room: "قاعة 2" },
    { day: 4, start: "15:00", end: "16:30", groupIdx: 1, room: "قاعة 1" }, // Thu
    { day: 4, start: "17:00", end: "18:30", groupIdx: 4, room: "قاعة 2" },
  ];
  const slots: { id: string }[] = [];
  for (const s of slotDefs) {
    slots.push(await db.scheduleSlot.create({
      data: { centerId: nokhba.id, dayOfWeek: s.day, startTime: s.start, endTime: s.end, groupId: groups[s.groupIdx].id, room: s.room },
    }));
  }

  // ================= PAST SESSIONS (closed, with full economics) =================
  // For each of the past 14 days, materialize sessions matching the weekday schedule.
  const journal: { centerId: string; type: string; amount: number; date: string; note: string; refType: string; refId: string; createdBy: string }[] = [];
  const nowHMStr = nowHM();

  for (let off = -14; off <= -1; off++) {
    const date = dateStr(off);
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    const daySlots = slotDefs.filter((s) => s.day === dow);
    for (const ds of daySlots) {
      const group = groups[ds.groupIdx];
      const registered = await db.studentGroup.findMany({
        where: { groupId: group.id, status: "ACTIVE", student: { status: "ACTIVE" } },
        include: { student: true },
      });
      // ~85% attendance
      const attending = registered.filter(() => rnd() < 0.85);
      const session = await db.sessionInstance.create({
        data: {
          centerId: nokhba.id, groupId: group.id, date, startTime: ds.start, endTime: ds.end,
          room: ds.room, price: group.sessionPrice, teacherPercent: group.teacherPercent,
          status: "CLOSED", openedBy: users.reception.id, closedBy: users.manager.id,
          closedAt: new Date(`${date}T${ds.end}:00.000Z`),
        },
      });
      let revenue = 0;
      for (const reg of attending) {
        const charge = reg.priceOverride ?? group.sessionPrice;
        const late = rnd() < 0.08;
        await db.attendance.create({
          data: { centerId: nokhba.id, sessionId: session.id, studentId: reg.studentId, status: late ? "LATE" : "PRESENT", charged: charge, recordedBy: users.reception.id },
        });
        await db.studentTransaction.create({
          data: { centerId: nokhba.id, studentId: reg.studentId, sessionId: session.id, type: "CHARGE", amount: -charge, reason: `حصة ${group.name !== "A" && group.name !== "B" ? group.name : ""}`.trim(), createdBy: users.reception.id },
        });
        revenue += charge;
        // Pay at the desk: full / short (owe) / extra (credit)
        const payStyle = (reg.student as { pay?: string }).pay; // حقل seed-only (مش في الموديل)
        if (rnd() < 0.8) {
          let pay = charge;
          if (payStyle === "owe" && rnd() < 0.5) pay = Math.max(Math.round(charge * 0.6), 0); // short by 40%
          if (payStyle === "credit" && rnd() < 0.4) pay = charge + EGP(35); // overpay 35 EGP
          await db.studentTransaction.create({
            data: { centerId: nokhba.id, studentId: reg.studentId, sessionId: session.id, type: "PAYMENT", amount: pay, method: rnd() < 0.8 ? "CASH" : "VODAFONE", reason: "دفع عند الحصة", createdBy: users.reception.id },
          });
        }
      }
      const teacherShare = Math.round((revenue * group.teacherPercent) / 100);
      const centerShare = revenue - teacherShare;
      await db.sessionInstance.update({
        where: { id: session.id },
        data: { presentCount: attending.length, totalRevenue: revenue, teacherShare, centerShare },
      });
      await db.teacherSettlement.create({
        data: { centerId: nokhba.id, teacherId: group.teacherId!, sessionId: session.id, type: "EARNED", amount: teacherShare, date, createdBy: users.manager.id },
      });
      journal.push({ centerId: nokhba.id, type: "SESSION_REVENUE", amount: revenue, date, note: `إيراد حصة ${group.name}`, refType: "SESSION", refId: session.id, createdBy: users.manager.id });
      journal.push({ centerId: nokhba.id, type: "TEACHER_SHARE", amount: -teacherShare, date, note: `نصيب المدرس ${group.name}`, refType: "SESSION", refId: session.id, createdBy: users.manager.id });
    }
  }

  // ================= TODAY'S SESSIONS =================
  const todaySlots = slotDefs.filter((s) => s.day === today);
  const todaySessions: { id: string; groupIdx: number; phase: "past" | "now" | "future" }[] = [];
  for (const ds of todaySlots) {
    const group = groups[ds.groupIdx];
    const phase: "past" | "now" | "future" = ds.end < nowHMStr ? "past" : ds.start <= nowHMStr ? "now" : "future";
    const session = await db.sessionInstance.create({
      data: {
        centerId: nokhba.id, groupId: group.id, date: dateStr(0), startTime: ds.start, endTime: ds.end,
        room: ds.room, price: group.sessionPrice, teacherPercent: group.teacherPercent,
        status: "OPEN", openedBy: users.reception.id,
      },
    });
    todaySessions.push({ id: session.id, groupIdx: ds.groupIdx, phase });

    if (phase === "past") {
      // This one already ran: close it with economics (done earlier today)
      const registered = await db.studentGroup.findMany({
        where: { groupId: group.id, status: "ACTIVE", student: { status: "ACTIVE" } },
      });
      const attending = registered.filter(() => rnd() < 0.9);
      let revenue = 0;
      for (const reg of attending) {
        const charge = (await db.studentGroup.findUnique({ where: { id: reg.id } }))!.priceOverride ?? group.sessionPrice;
        await db.attendance.create({
          data: { centerId: nokhba.id, sessionId: session.id, studentId: reg.studentId, status: "PRESENT", charged: charge, recordedBy: users.reception.id },
        });
        await db.studentTransaction.create({
          data: { centerId: nokhba.id, studentId: reg.studentId, sessionId: session.id, type: "CHARGE", amount: -charge, createdBy: users.reception.id },
        });
        revenue += charge;
        if (rnd() < 0.85) {
          await db.studentTransaction.create({
            data: { centerId: nokhba.id, studentId: reg.studentId, sessionId: session.id, type: "PAYMENT", amount: charge, method: "CASH", reason: "دفع عند الحصة", createdBy: users.reception.id },
          });
        }
      }
      const teacherShare = Math.round((revenue * group.teacherPercent) / 100);
      const centerShare = revenue - teacherShare;
      await db.sessionInstance.update({
        where: { id: session.id },
        data: { status: "CLOSED", closedBy: users.manager.id, closedAt: new Date(), presentCount: attending.length, totalRevenue: revenue, teacherShare, centerShare },
      });
      await db.teacherSettlement.create({
        data: { centerId: nokhba.id, teacherId: group.teacherId!, sessionId: session.id, type: "EARNED", amount: teacherShare, date: dateStr(0), createdBy: users.manager.id },
      });
      journal.push({ centerId: nokhba.id, type: "SESSION_REVENUE", amount: revenue, date: dateStr(0), note: `إيراد حصة ${group.name}`, refType: "SESSION", refId: session.id, createdBy: users.manager.id });
      journal.push({ centerId: nokhba.id, type: "TEACHER_SHARE", amount: -teacherShare, date: dateStr(0), note: `نصيب المدرس`, refType: "SESSION", refId: session.id, createdBy: users.manager.id });
    } else if (phase === "now") {
      // Live session: a few students already scanned (charges, some paid) — leave OPEN
      const registered = await db.studentGroup.findMany({
        where: { groupId: group.id, status: "ACTIVE", student: { status: "ACTIVE" } },
      });
      for (const reg of registered.slice(0, Math.max(2, Math.floor(registered.length / 2))) ) {
        await db.attendance.create({
          data: { centerId: nokhba.id, sessionId: session.id, studentId: reg.studentId, status: "PRESENT", charged: group.sessionPrice, recordedBy: users.reception.id },
        });
        await db.studentTransaction.create({
          data: { centerId: nokhba.id, studentId: reg.studentId, sessionId: session.id, type: "CHARGE", amount: -group.sessionPrice, createdBy: users.reception.id },
        });
      }
    }
  }
  // Guarantee at least one OPEN + one future session today (append ad-hoc ones if schedule gap)
  if (!todaySessions.some((s) => s.phase === "now")) {
    const gi = 0;
    const group = groups[gi];
    const s = await db.sessionInstance.create({
      data: { centerId: nokhba.id, groupId: group.id, date: dateStr(0), startTime: shiftTime(nowHMStr, -30), endTime: shiftTime(nowHMStr, 60), room: "قاعة 2", price: group.sessionPrice, teacherPercent: group.teacherPercent, status: "OPEN", openedBy: users.reception.id },
    });
    todaySessions.push({ id: s.id, groupIdx: gi, phase: "now" });
  }

  // ================= EXPENSES =================
  const expenseDefs = [
    { category: "RENT", amount: EGP(6000), date: dateStr(-12), note: "إيجار الشهر" },
    { category: "ELECTRICITY", amount: EGP(850), date: dateStr(-9), note: "فاتورة الكهرباء" },
    { category: "SUPPLIES", amount: EGP(320), date: dateStr(-5), note: "ورق طباعة وأدوات مكتبية" },
    { category: "MAINTENANCE", amount: EGP(400), date: dateStr(-3), note: "إصلاح تكييف القاعة 2" },
    { category: "ELECTRICITY", amount: EGP(290), date: dateStr(-1), note: "رصيد كارت الكهرباء" },
  ];
  for (const e of expenseDefs) {
    await db.expense.create({ data: { ...e, centerId: nokhba.id, createdBy: users.manager.id } });
    journal.push({ centerId: nokhba.id, type: "EXPENSE", amount: -e.amount, date: e.date, note: e.note, refType: "EXPENSE", refId: "", createdBy: users.manager.id });
  }

  // ================= TEACHER PAYOUTS =================
  const payouts = [
    { teacherIdx: 0, amount: EGP(1500), date: dateStr(-7), note: "صرف دفعة على الحساب" },
    { teacherIdx: 1, amount: EGP(900), date: dateStr(-4), note: "صرف جزئي" },
  ];
  for (const p of payouts) {
    await db.teacherSettlement.create({
      data: { centerId: nokhba.id, teacherId: teachers[p.teacherIdx].id, type: "PAID", amount: -p.amount, date: p.date, note: p.note, createdBy: users.manager.id },
    });
    journal.push({ centerId: nokhba.id, type: "TEACHER_PAYOUT", amount: -p.amount, date: p.date, note: p.note, refType: "TEACHER", refId: teachers[p.teacherIdx].id, createdBy: users.manager.id });
  }

  // ================= BOOKS (قسم الكتب) =================
  const bookDefs = [
    { name: "كتاب الفيزياء — الأول الثانوي", gradeIdx: 1, subjectIdx: 0, price: EGP(150), stock: 25, notes: "الطبعة الجديدة ٢٠٢٦" },
    { name: "ملخص الكيمياء — الأول الثانوي", gradeIdx: 1, subjectIdx: 1, price: EGP(90), stock: 12, notes: null },
    { name: "امتحانات الرياضيات — الثاني الثانوي", gradeIdx: 2, subjectIdx: 2, price: EGP(75), stock: 2, notes: "آخر نسخ — راجع المخزون" },
    { name: "قواعد الإنجليزي — الثالث الإعدادي", gradeIdx: 0, subjectIdx: 3, price: EGP(60), stock: 0, notes: "خلص — في توريد جاي" },
  ];
  const books: { id: string; name: string; price: number }[] = [];
  for (const b of bookDefs) {
    books.push(await db.book.create({
      data: { centerId: nokhba.id, name: b.name, gradeId: grades[b.gradeIdx].id, subjectId: subjects[b.subjectIdx].id, price: b.price, stock: b.stock, notes: b.notes },
    }));
  }
  // sales history: a few over the last days + today (buyer names snapshot)
  const saleDefs = [
    { bookIdx: 0, qty: 2, buyer: students[1].id, buyerName: students[1].name, method: "CASH", day: 0 },       // محمد عبد الرحمن — النهاردة
    { bookIdx: 1, qty: 1, buyer: null, buyerName: "أ. مصطفى — زبون من بره", method: "INSTAPAY", day: 0 },       // walk-in — النهاردة
    { bookIdx: 0, qty: 1, buyer: students[3].id, buyerName: students[3].name, method: "VODAFONE", day: -2 },
    { bookIdx: 2, qty: 1, buyer: students[13].id, buyerName: students[13].name, method: "CASH", day: -3 },
    { bookIdx: 1, qty: 2, buyer: students[6].id, buyerName: students[6].name, method: "CASH", day: -5 },
  ];
  for (const s of saleDefs) {
    const book = books[s.bookIdx];
    const sale = await db.bookSale.create({
      data: {
        centerId: nokhba.id, bookId: book.id, studentId: s.buyer, buyerName: s.buyerName,
        qty: s.qty, unitPrice: book.price, total: book.price * s.qty, method: s.method,
        date: dateStr(s.day), createdBy: users.reception.id,
      },
    });
    journal.push({ centerId: nokhba.id, type: "BOOK_SALE", amount: book.price * s.qty, date: dateStr(s.day), note: `بيع ${s.qty}× ${book.name} — ${s.buyerName}`, refType: "BOOK_SALE", refId: sale.id, createdBy: users.reception.id });
  }

  // ================= JOURNAL =================
  for (const j of journal.slice(0, 500)) {
    await db.centerTransaction.create({ data: j });
  }

  // ================= CASH DAY (today) =================
  await db.cashDay.create({
    data: { centerId: nokhba.id, date: dateStr(0), openingCash: EGP(500), status: "OPEN", openedBy: users.manager.id },
  });

  // ================= WHATSAPP TEMPLATES =================
  const templates = [
    { name: "تأكيد حضور", body: "أهلاً بحضرتك 🌟\nتم تسجيل حضور الطالب {student_name} في حصة {subject} اليوم الساعة {session_time}.\nرصيد الطالب الحالي: {balance} جنيه." },
    { name: "تنبيه رصيد", body: "مساء الخير حضرتك 🙏\nالطالب {student_name} عليه مبلغ {amount_due} جنيه.\nبرجاء السداد عند أقرب حصة.\n{center_name}" },
    { name: "ترحيب طالب جديد", body: "أهلاً بيك يا {student_name} في {center_name} 🎉\nتم تسجيلك في مجموعة {group_name} مع {teacher_name}.\nكود الطالب: {student_code}\n{center_phone}" },
    { name: "حصة بكرة", body: "تذكير: بكرة عندنا حصة {subject} مع {teacher_name} الساعة {session_time}.\n{center_name}" },
    { name: "استرداد", body: "تم عمل استرداد بمبلغ {amount} جنيه للطالب {student_name}.\n{center_name}" },
  ];
  for (const t of templates) {
    await db.whatsAppTemplate.create({ data: { ...t, centerId: nokhba.id } });
  }

  // ================= AUDIT SEED =================
  await db.auditLog.createMany({
    data: [
      { centerId: null, userId: users.admin.id, userName: users.admin.name, action: "تجديد اشتراك", entity: "SUBSCRIPTION", after: JSON.stringify({ center: "مركز النخبة التعليمي", renewal: dateStr(25) }) },
      { centerId: nokhba.id, userId: users.manager.id, userName: users.manager.name, action: "تعديل هوية السنتر", entity: "CENTER", entityId: nokhba.id, before: JSON.stringify({ primaryColor: "#0F766E" }), after: JSON.stringify({ primaryColor: "#0E9F6E" }) },
      { centerId: nokhba.id, userId: users.manager.id, userName: users.manager.name, action: "تغيير سعر", entity: "GROUP", entityId: groups[0].id, before: JSON.stringify({ sessionPrice: EGP(60) }), after: JSON.stringify({ sessionPrice: EGP(65) }) },
    ],
  });

  // Summary
  const [studentCount, sessionCount, txnCount] = await Promise.all([
    db.student.count({ where: { centerId: nokhba.id } }),
    db.sessionInstance.count({ where: { centerId: nokhba.id } }),
    db.studentTransaction.count({ where: { centerId: nokhba.id } }),
  ]);
  console.log(`✅ Seed complete: ${studentCount} students, ${sessionCount} sessions, ${txnCount} ledger txns (center 1)`);
  console.log("   Demo logins → admin / manager / reception / reception2 / manager2 — password: nokhba123");
}

// كويز تجريبي منشور عشان بورتال الطالب يبقى فيه محتوى حقيقي من أول تشغيل (spec §1)
async function seedDemoQuiz() {
  const group = await db.group.findFirst({ where: { name: "A", isActive: true }, include: { subject: true } });
  const anyUser = await db.user.findFirst({ where: { role: "MANAGER" } });
  if (!group || !anyUser) return;
  const exists = await db.quiz.findFirst({ where: { title: "كويز تجريبي — الوحدة الأولى" } });
  if (exists) return;
  await db.quiz.create({
    data: {
      centerId: group.centerId,
      groupId: group.id,
      title: "كويز تجريبي — الوحدة الأولى",
      description: "كويز قصير للتجربة — بيصحح تلقائي.",
      status: "PUBLISHED",
      createdById: anyUser.id,
      createdByName: anyUser.name,
      questions: {
        create: [
          { order: 0, text: "السؤال الأول: وحدة القياس في جسم ساقط؟", type: "MCQ", options: JSON.stringify(["م/ث²", "نيوتن", "كجم"]), correctAnswer: "0", points: 5 },
          { order: 1, text: "التسارع الناتج عن الجاذبية الأرضية ثابت على سطح الأرض.", type: "TRUE_FALSE", correctAnswer: "true", points: 5 },
        ],
      },
    },
  });
  console.log("   📝 Demo quiz published (portal → الكويزات)");
}

main()
  .then(() => seedDemoQuiz())
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
