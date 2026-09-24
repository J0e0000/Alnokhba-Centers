import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { todayStr } from "@/lib/normalize";
import { manyBalances } from "@/lib/finance";

export const dynamic = "force-dynamic";

/* ============================================================
   وضع التجربة (Demo Mode):
   المدير عايز يجرب النظام كل يوم من غير ما يلمس بيانات
   الطلاب الحقيقيين. الزرار الواحد بيعمل:

   - مدرس تجريبي (أ. تجريبي) — مش بيتعارض مع مدرسين حقيقيين
   - مجموعتين تجريبيتين (تجريبي A / تجريبي B)
   - 6 طلاب تجريبيين بأكواد 99xxx (بيانات وهمية واضحة)
     بأرصدة متنوعة: فيهم اللي معاه رصيد، واللي رصيده صفر،
     واللي عليه فلوس — عشان كل سيناريوهات المسح تتجرّب
   - حصتين النهاردة: واحدة شغالة دلوقتي + واحدة جاية
     (بتتجنب تعارض القاعات الحقيقية تلقائياً)

   كل حاجة تجريبية عليها علامة، وزرار «مسح البيانات التجريبية»
   بيشيل كل أثرها — حتى الحركات اللي اتعملت أثناء التجربة
   (حضور، دفع، إيصالات، إيرادات، مبيعات كتب) ويرجّع المخزون.

   العلامات (Markers):
   - الطلاب: notes فيها DEMO_MARK + الكود من 99000 لـ 99999
   - المجموعات: الاسم بيبدأ بـ "تجريبي"
   - المدرس: اسمه "أ. تجريبي" بالظبط
============================================================ */

const DEMO_MARK = "«بيانات تجريبية»";
const DEMO_TEACHER_NAME = "أ. تجريبي";
const DEMO_GROUP_PREFIX = "تجريبي ";
const DEMO_PRICE = 5000; // 50 جنيه للحصة — رقم واضح للتجربة
const DEMO_TOPUPS = [20000, 10000, 30000, 5000, 0, -5000]; // بالقرش: رصيد متنوع للتجربة

const DEMO_STUDENTS: { name: string; parentName: string; parentPhone: string }[] = [
  { name: "علي حسن التجريبي", parentName: "ولي أمر علي (تجريبي)", parentPhone: "01000000001" },
  { name: "سارة محمود التجريبية", parentName: "ولي أمر سارة (تجريبي)", parentPhone: "01000000002" },
  { name: "عمر خالد التجريبي", parentName: "ولي أمر عمر (تجريبي)", parentPhone: "01000000003" },
  { name: "مريم عادل التجريبية", parentName: "ولي أمر مريم (تجريبي)", parentPhone: "01000000004" },
  { name: "يوسف سامي التجريبي", parentName: "ولي أمر يوسف (تجريبي)", parentPhone: "01000000005" },
  { name: "نور الهدى التجريبية", parentName: "ولي أمر نور (تجريبي)", parentPhone: "01000000006" },
];

function isDemoStudent(code: string, notes: string | null): boolean {
  return (notes?.includes(DEMO_MARK) ?? false) || /^99\d{3}$/.test(code);
}

/** كل الطلاب التجريبيين في السنتر (بالعلامة أو نطاق الكود) */
async function findDemoStudents(centerId: string) {
  const all = await db.student.findMany({ where: { centerId } });
  return all.filter((s) => isDemoStudent(s.code, s.notes));
}

/* ---------- أدوات الوقت ---------- */

/** الساعة دلوقتي بتوقيت القاهرة (أوقات الحصص لازم تتولد بوقت المستخدم مش بتوقيت السيرفر) */
function cairoNow(): Date {
  try {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = dtf.formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return new Date(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  } catch {
    return new Date();
  }
}

function roundTo30(d: Date): Date {
  const m = new Date(d);
  m.setSeconds(0, 0);
  m.setMinutes(Math.floor(m.getMinutes() / 30) * 30);
  return m;
}
function addMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60000);
}
function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/* ============================================================
   GET — حالة وضع التجربة (للكارت في الداشبورد)
============================================================ */

export const GET = handler(async () => {
  const user = await requireCenterUser();
  const centerId = user.centerId!;

  const students = await findDemoStudents(centerId);
  const balances = await manyBalances(students.map((s) => s.id));

  const groups = await db.group.findMany({
    where: { centerId, name: { startsWith: DEMO_GROUP_PREFIX } },
    include: { subject: true, grade: true },
  });

  const sessions = await db.sessionInstance.findMany({
    where: { centerId, groupId: { in: groups.map((g) => g.id) }, date: todayStr() },
    orderBy: { startTime: "asc" },
    include: { group: { include: { subject: true } }, _count: { select: { attendance: true } } },
  });

  return ok({
    ready: students.length > 0,
    students: students
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((s) => ({ code: s.code, name: s.name, balance: balances.get(s.id) ?? 0 })),
    sessions: sessions.map((s) => ({
      id: s.id,
      subject: s.group.subject.name,
      groupName: s.group.name,
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
      status: s.status,
      attendanceCount: s._count.attendance,
    })),
  });
});

/* ============================================================
   POST — جهّز بيانات تجريبية للنهاردة (idempotent — آمن كل يوم)
============================================================ */

export const POST = handler(async () => {
  const user = await requireManager();
  const centerId = user.centerId!;
  const today = todayStr();
  const created = { students: 0, sessions: 0, groups: 0 };

  /* ---------- 1) المدرس التجريبي ---------- */
  let teacher = await db.teacher.findFirst({ where: { centerId, name: DEMO_TEACHER_NAME } });
  if (!teacher) {
    teacher = await db.teacher.create({
      data: {
        centerId,
        name: DEMO_TEACHER_NAME,
        phone: "01000000000",
        notes: `${DEMO_MARK} مدرس وهمي لتجربة النظام`,
      },
    });
  }

  /* ---------- 2) المرحلة والمواد (نستخدم الموجود — مش بنلوّث) ---------- */
  let grade = await db.grade.findFirst({ where: { centerId }, orderBy: { order: "asc" } });
  if (!grade) {
    grade = await db.grade.create({ data: { centerId, name: "الأول الثانوي", order: 1 } });
  }
  const wantSubjects = ["فيزياء", "رياضيات"];
  const subjects: { id: string; name: string }[] = [];
  for (const name of wantSubjects) {
    let subject = await db.subject.findFirst({ where: { centerId, name } });
    if (!subject) subject = await db.subject.create({ data: { centerId, name } });
    subjects.push(subject);
  }

  /* ---------- 3) المجموعات التجريبية ---------- */
  const rooms = await db.room.findMany({ where: { centerId, isActive: true }, orderBy: { order: "asc" } });
  const groupDefs = [
    { name: `${DEMO_GROUP_PREFIX}A`, subjectId: subjects[0].id, room: rooms[0]?.name ?? null },
    { name: `${DEMO_GROUP_PREFIX}B`, subjectId: subjects[1].id, room: rooms[1]?.name ?? rooms[0]?.name ?? null },
  ];
  const groups: { id: string; name: string; room: string | null }[] = [];
  for (const def of groupDefs) {
    let g = await db.group.findFirst({ where: { centerId, name: def.name } });
    if (!g) {
      g = await db.group.create({
        data: {
          centerId,
          name: def.name,
          gradeId: grade.id,
          subjectId: def.subjectId,
          teacherId: teacher.id,
          sessionPrice: DEMO_PRICE,
          teacherPercent: 50,
          room: def.room,
          isActive: true,
        },
      });
      created.groups++;
    }
    groups.push(g);
  }

  /* ---------- 4) الطلاب التجريبيين + الأرصدة ---------- */
  const existing = await findDemoStudents(centerId);
  const students: { id: string; code: string; name: string }[] = existing.map((s) => ({ id: s.id, code: s.code, name: s.name }));

  for (let i = 0; i < DEMO_STUDENTS.length; i++) {
    if (students.length > i) continue; // موجودين خلاص
    const tpl = DEMO_STUDENTS[i];

    // أول كود شاغر في نطاق 99xxx (النطاق ده محجوز للتجربة)
    let code = "";
    for (let c = 99001; c <= 99999; c++) {
      const candidate = String(c);
      const taken = await db.student.findUnique({ where: { centerId_code: { centerId, code: candidate } }, select: { id: true } });
      if (!taken) { code = candidate; break; }
    }
    if (!code) throw new ApiError("نطاق أكواد التجربة (99xxx) خلص — امسح البيانات التجريبية القديمة الأول.", 409);

    const s = await db.student.create({
      data: {
        centerId,
        code,
        qrToken: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
        name: tpl.name,
        phone: null,
        parentName: tpl.parentName,
        parentPhone: tpl.parentPhone,
        gradeId: grade.id,
        status: "ACTIVE",
        notes: `${DEMO_MARK} طالب وهمي لتجربة النظام — بيتشال بزرار «مسح البيانات التجريبية»`,
      },
    });
    students.push({ id: s.id, code: s.code, name: s.name });
    created.students++;
  }

  // تسجيلهم في المجموعتين التجريبيتين
  for (const st of students) {
    for (const g of groups) {
      await db.studentGroup.upsert({
        where: { studentId_groupId: { studentId: st.id, groupId: g.id } },
        create: { studentId: st.id, groupId: g.id, registeredBy: user.id },
        update: {},
      });
    }
  }

  // أرصدة متنوعة — مرة واحدة بس لكل طالب
  for (let i = 0; i < students.length && i < DEMO_TOPUPS.length; i++) {
    const st = students[i];
    const hasTxns = await db.studentTransaction.findFirst({ where: { studentId: st.id }, select: { id: true } });
    if (hasTxns) continue;
    const amount = DEMO_TOPUPS[i];
    if (amount === 0) continue;
    await db.studentTransaction.create({
      data: {
        centerId,
        studentId: st.id,
        type: "ADJUSTMENT",
        amount,
        reason: `${DEMO_MARK} رصيد تجريبي`,
        createdBy: user.id,
      },
    });
  }

  /* ---------- 5) حصص النهاردة — واحدة شغالة دلوقتي + واحدة جاية ---------- */
  const todaySessions = await db.sessionInstance.findMany({
    where: { centerId, date: today, status: { not: "CANCELLED" } },
    include: { group: { select: { name: true } } },
  });

  const base = roundTo30(cairoNow());
  // الحصة الأولى: عدّت بـ 30 دقيقة وشغالة لحد +60 — يعني «شغالة دلوقتي» وقت التجربة
  const s1Start = addMin(base, -30);
  const s1End = addMin(base, 60);
  // الحصة التانية: بعد ساعتين
  const s2Start = addMin(base, 120);
  const s2End = addMin(base, 210);

  const plans = [
    { group: groups[0], start: s1Start, end: s1End },
    { group: groups[1], start: s2Start, end: s2End },
  ];

  const createdSessions: { id: string; subject: string; groupName: string; startTime: string; endTime: string; room: string | null }[] = [];

  for (const plan of plans) {
    // idempotent: لو للمجموعة دي حصة النهاردة خلاص (حتى مقفولة) — سيبها
    const already = todaySessions.find((s) => s.groupId === plan.group.id);
    if (already) {
      createdSessions.push({
        id: already.id, subject: "", groupName: already.group.name,
        startTime: already.startTime, endTime: already.endTime, room: already.room,
      });
      continue;
    }

    // تجنّب تعارض القاعات: جرّب القاعات بالترتيب، ولو كلها مزدحمة زحّح الوقت
    let placed: { start: string; end: string; room: string | null } | null = null;
    outer: for (let shift = 0; shift <= 240; shift += 30) {
      const st = hm(addMin(plan.start, shift));
      const en = hm(addMin(plan.end, shift));
      const roomNames = [...rooms.map((r) => r.name), ""];
      for (const rn of roomNames) {
        const room = rn || null;
        const clash = todaySessions.some(
          (s) => room && s.room === room && overlaps(st, en, s.startTime, s.endTime),
        );
        if (!clash) { placed = { start: st, end: en, room }; break outer; }
      }
    }
    if (!placed) placed = { start: hm(plan.start), end: hm(plan.end), room: null };

    const g = await db.group.findUnique({ where: { id: plan.group.id } });
    const session = await db.sessionInstance.create({
      data: {
        centerId,
        groupId: plan.group.id,
        date: today,
        startTime: placed.start,
        endTime: placed.end,
        room: placed.room,
        price: g?.sessionPrice ?? DEMO_PRICE,
        teacherPercent: g?.teacherPercent ?? 50,
        status: "OPEN",
        openedBy: user.id,
      },
    });
    const subject = await db.subject.findFirst({ where: { centerId, id: g?.subjectId } });
    createdSessions.push({
      id: session.id,
      subject: subject?.name ?? "",
      groupName: plan.group.name,
      startTime: session.startTime,
      endTime: session.endTime,
      room: session.room,
    });
    created.sessions++;
    (todaySessions as { id: string; groupId: string; startTime: string; endTime: string; room: string | null; group: { name: string } }[]).push({
      id: session.id, groupId: plan.group.id, startTime: session.startTime, endTime: session.endTime,
      room: session.room, group: { name: plan.group.name },
    });
  }

  /* ---------- 6) النتيجة + الرصيد الحالي ---------- */
  const balances = await manyBalances(students.map((s) => s.id));

  await logAudit({
    user,
    action: "تجهيز بيانات تجريبية",
    entity: "demo",
    after: { students: created.students, sessions: created.sessions, date: today },
  });

  return ok({
    message: created.sessions > 0
      ? "البيانات التجريبية جاهزة — حصتين النهاردة و6 طلاب بأكواد 99xxx. ابدأ من صفحة المسح."
      : "البيانات التجريبية جاهزة خلاص — دي حصص النهاردة.",
    created,
    students: students.map((s) => ({ code: s.code, name: s.name, balance: balances.get(s.id) ?? 0 })),
    sessions: createdSessions,
  });
});

/* ============================================================
   DELETE — امسح كل البيانات التجريبية وكل أثرها
   (حتى الحركات اللي اتعملت أثناء التجربة على طلاب حقيقيين
   جوّه الحصص التجريبية بتترجّع)
============================================================ */

export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const centerId = user.centerId!;
  const url = new URL(req.url);
  const confirmWord = url.searchParams.get("confirm") ?? "";

  if (confirmWord !== "demo") {
    throw new ApiError("أمر التأكيد ناقص — الطلب لازم يتأكد من الواجهة.", 400);
  }

  const deleted = {
    students: 0, sessions: 0, groups: 0, teachers: 0,
    attendance: 0, txns: 0, receipts: 0, centerTxns: 0, bookSales: 0, stockRestored: 0,
  };

  /* جمع كل الكيانات التجريبية */
  const demoGroups = await db.group.findMany({ where: { centerId, name: { startsWith: DEMO_GROUP_PREFIX } } });
  const groupIds = demoGroups.map((g) => g.id);

  // كل حصص المجموعات التجريبية (كل التواريخ مش النهاردة بس)
  const demoSessions = groupIds.length
    ? await db.sessionInstance.findMany({ where: { centerId, groupId: { in: groupIds } }, select: { id: true } })
    : [];
  const sessionIds = demoSessions.map((s) => s.id);

  const demoStudents = await findDemoStudents(centerId);
  const studentIds = demoStudents.map((s) => s.id);

  if (groupIds.length === 0 && studentIds.length === 0) {
    return ok({ message: "مفيش بيانات تجريبية موجودة.", deleted });
  }

  /* مبيعات كتب للطلاب التجريبيين — بترجّع المخزون */
  const demoBookSales = studentIds.length
    ? await db.bookSale.findMany({ where: { studentId: { in: studentIds } } })
    : [];
  const bookSaleIds = demoBookSales.map((b) => b.id);

  await db.$transaction(async (tx) => {
    // 1) إيصارات الدفع المرتبطة بالحصص التجريبية (حتى لطلاب حقيقيين جربوا فيها)
    if (sessionIds.length) {
      const r = await tx.receipt.deleteMany({ where: { sessionId: { in: sessionIds } } });
      deleted.receipts += r.count;
    }
    // 2) حركات مالية مرتبطة بالحصص التجريبية (خصومات حضور/دفعات لطلاب حقيقيين أثناء التجربة)
    if (sessionIds.length) {
      const r = await tx.studentTransaction.deleteMany({ where: { sessionId: { in: sessionIds } } });
      deleted.txns += r.count;
    }
    // 3) قيود اليومية من قفل الحصص التجريبية (إيراد + نصيب مدرس)
    if (sessionIds.length) {
      const r = await tx.centerTransaction.deleteMany({
        where: { centerId, refType: "SESSION", refId: { in: sessionIds } },
      });
      deleted.centerTxns += r.count;
    }
    // 4) قيود بيع كتب تجريبية + رجّع المخزون
    if (bookSaleIds.length) {
      for (const sale of demoBookSales) {
        await tx.book.update({ where: { id: sale.bookId }, data: { stock: { increment: sale.qty } } });
        deleted.stockRestored += sale.qty;
      }
      const r1 = await tx.centerTransaction.deleteMany({
        where: { centerId, refType: "BOOK_SALE", refId: { in: bookSaleIds } },
      });
      deleted.centerTxns += r1.count;
      const r2 = await tx.bookSale.deleteMany({ where: { id: { in: bookSaleIds } } });
      deleted.bookSales += r2.count;
    }
    // 5) عدّ حضور الحصص التجريبية (للعرض — بيتمسح مع الحصص cascade)
    if (sessionIds.length) {
      deleted.attendance += await tx.attendance.count({ where: { sessionId: { in: sessionIds } } });
    }
    // 5ب) مستحقات المدرس التجريبي من قفل الحصص (EARNED + عكسها)
    const demoTeacherIds = (await tx.teacher.findMany({
      where: { centerId, name: DEMO_TEACHER_NAME },
      select: { id: true },
    })).map((t) => t.id);
    const settleWhere = {
      OR: [
        ...(sessionIds.length ? [{ sessionId: { in: sessionIds } }] : []),
        ...(demoTeacherIds.length ? [{ teacherId: { in: demoTeacherIds } }] : []),
      ],
    };
    if (settleWhere.OR.length > 0) {
      await tx.teacherSettlement.deleteMany({ where: settleWhere });
    }
    // 6) الحصص التجريبية نفسها
    if (sessionIds.length) {
      const r = await tx.sessionInstance.deleteMany({ where: { id: { in: sessionIds } } });
      deleted.sessions += r.count;
    }
    // 7) الطلاب التجريبيين (attendance/txns/receipts/queue cascades)
    if (studentIds.length) {
      const r = await tx.student.deleteMany({ where: { id: { in: studentIds } } });
      deleted.students += r.count;
    }
    // 8) تسجيلات المجموعات التجريبية (لو طالب حقيقي انسجل فيها بالغلط)
    if (groupIds.length) {
      await tx.studentGroup.deleteMany({ where: { groupId: { in: groupIds } } });
    }
    // 9) المجموعات والمدرس التجريبي
    if (groupIds.length) {
      const r = await tx.group.deleteMany({ where: { id: { in: groupIds } } });
      deleted.groups += r.count;
    }
    const t = await tx.teacher.deleteMany({ where: { centerId, name: DEMO_TEACHER_NAME } });
    deleted.teachers += t.count;
  });

  await logAudit({
    user,
    action: "مسح البيانات التجريبية",
    entity: "demo",
    after: deleted,
  });

  return ok({
    message: `اتمسح كله: ${deleted.students} طالب تجريبي، ${deleted.sessions} حصة، ${deleted.receipts} إيصال، ${deleted.centerTxns} قيد يومية${deleted.stockRestored > 0 ? `، ورجّعنا ${deleted.stockRestored} كتاب للمخزون` : ""}.`,
    deleted,
  });
});
