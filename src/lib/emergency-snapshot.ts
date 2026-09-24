import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { manyBalances } from "@/lib/finance";
import { canonicalJson } from "@/lib/emergency-license";

// ============================================================
// لقطة نظام الطوارئ — آخر بيانات موثوقة من السيرفر وقت التوليد.
// مبدأ: "اللازم بس" — حقول محدودة، تاريخ محصور (±7 أيام)،
// وأي بيانات حساسة (باسوردات/هاشات) مش بتتشحن أبدًا.
// ============================================================

export type EmergencySnapshot = {
  v: number;
  center: {
    id: string;
    name: string;
    phone: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string | null;
  };
  generatedAt: string;
  grades: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  rooms: { id: string; name: string; order: number }[];
  teachers: { id: string; name: string; phone: string | null; isActive: boolean; groups: string[] }[];
  staff: { id: string; name: string; role: string; canAddStudents: boolean }[];
  groups: {
    id: string;
    name: string;
    gradeId: string;
    subjectId: string;
    teacherId: string | null;
    sessionPrice: number; // piastres
    teacherPercent: number;
    room: string | null;
    isActive: boolean;
  }[];
  students: {
    id: string;
    code: string;
    qrToken: string;
    name: string;
    phone: string | null;
    parentPhone: string | null;
    gradeId: string | null;
    status: string;
    createdAt: string;
    regs: { groupId: string; priceOverride: number | null; since: string }[];
  }[];
  balances: Record<string, number>; // studentId → piastres (لقطة وقت التوليد)
  schedule: { id: string; dayOfWeek: number; startTime: string; endTime: string; groupId: string; room: string | null; isActive: boolean }[];
  sessions: {
    id: string;
    groupId: string;
    date: string;
    startTime: string;
    endTime: string;
    room: string | null;
    price: number;
    teacherPercent: number;
    status: string; // OPEN | CLOSED | CANCELLED
    presentCount: number | null;
    totalRevenue: number | null;
  }[];
  attendance: { sessionId: string; studentId: string; status: string; charged: number | null }[];
  payments: {
    id: string;
    studentId: string;
    sessionId: string | null;
    type: string;
    amount: number; // signed piastres
    method: string | null;
    reason: string | null;
    createdAt: string;
  }[];
  teacherEarnings: { teacherId: string; earned: number; paid: number }[];
};

/** آخر 7 أيام + النهاردة بصيغة YYYY-MM-DD بتوقيت القاهرة */
function dayStr(offsetDays: number): string {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
}

export async function buildEmergencySnapshot(centerId: string): Promise<{
  snapshot: EmergencySnapshot;
  snapshotRaw: string;
  snapshotDigest: string;
  stats: { students: number; groups: number; sessions: number; teachers: number };
}> {
  const since = dayStr(-7); // حضور/دفعات آخر 7 أيام (لمنع التكرار + للمراجعة)
  const sessionsFrom = dayStr(-7);
  const sessionsTo = dayStr(14); // الحصص الفعلية ± أسبوعين

  const center = await db.center.findUnique({
    where: { id: centerId },
    select: { id: true, name: true, phone: true, primaryColor: true, secondaryColor: true, accentColor: true },
  });
  if (!center) throw new Error("السنتر غير موجود.");

  const [grades, subjects, rooms, teachers, staff, groups, students, schedule, sessions, settlementsRaw] =
    await Promise.all([
      db.grade.findMany({ where: { centerId }, select: { id: true, name: true }, orderBy: { order: "asc" } }),
      db.subject.findMany({ where: { centerId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.room.findMany({ where: { centerId, isActive: true }, select: { id: true, name: true, order: true }, orderBy: { order: "asc" } }),
      db.teacher.findMany({
        where: { centerId },
        select: { id: true, name: true, phone: true, isActive: true, groups: { select: { id: true } } },
        orderBy: { name: "asc" },
      }),
      db.user.findMany({
        where: { centerId, isActive: true },
        select: { id: true, name: true, role: true, canAddStudents: true },
        orderBy: { name: "asc" },
      }),
      db.group.findMany({
        where: { centerId },
        select: {
          id: true, name: true, gradeId: true, subjectId: true, teacherId: true,
          sessionPrice: true, teacherPercent: true, room: true, isActive: true,
        },
        orderBy: { name: "asc" },
      }),
      db.student.findMany({
        where: { centerId, status: { not: "ARCHIVED" } },
        select: {
          id: true, code: true, qrToken: true, name: true, phone: true, parentPhone: true,
          gradeId: true, status: true, createdAt: true,
          registrations: {
            where: { status: "ACTIVE" },
            select: { groupId: true, priceOverride: true, createdAt: true },
          },
        },
        orderBy: { name: "asc" },
      }),
      db.scheduleSlot.findMany({
        where: { centerId, isActive: true },
        select: { id: true, dayOfWeek: true, startTime: true, endTime: true, groupId: true, room: true, isActive: true },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      }),
      db.sessionInstance.findMany({
        where: { centerId, date: { gte: sessionsFrom, lte: sessionsTo } },
        select: {
          id: true, groupId: true, date: true, startTime: true, endTime: true, room: true,
          price: true, teacherPercent: true, status: true, presentCount: true, totalRevenue: true,
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      }),
      db.teacherSettlement.findMany({
        where: { centerId },
        select: { teacherId: true, type: true, amount: true },
      }),
    ]);

  // الرصيد اللحظي لكل طالب (لقطة موثوقة وقت التوليد)
  const balancesMap = await manyBalances(students.map((s) => s.id));

  // حضور آخر 7 أيام للحصص اللي جوّه نطاق اللقطة
  const sessionIds = new Set(sessions.map((s) => s.id));
  const attendanceRaw = await db.attendance.findMany({
    where: {
      centerId,
      createdAt: { gte: new Date(since + "T00:00:00Z") },
    },
    select: { sessionId: true, studentId: true, status: true, charged: true },
  });
  const attendance = attendanceRaw.filter((a) => sessionIds.has(a.sessionId));

  // حركات مالية آخر 7 أيام (مرجع + كشف تعارض)
  const payments = await db.studentTransaction.findMany({
    where: { centerId, createdAt: { gte: new Date(since + "T00:00:00Z") } },
    select: { id: true, studentId: true, sessionId: true, type: true, amount: true, method: true, reason: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });

  // مستحقات المدرسين: EARNED بيراكم (موجب) و PAID بيصرف — إجماليات لكل مدرس
  const teacherEarnings: EmergencySnapshot["teacherEarnings"] = [];
  const acc = new Map<string, { earned: number; paid: number }>();
  for (const s of settlementsRaw) {
    const cur = acc.get(s.teacherId) ?? { earned: 0, paid: 0 };
    if (s.type === "EARNED") cur.earned += s.amount;
    else if (s.type === "PAID") cur.paid += Math.abs(s.amount);
    acc.set(s.teacherId, cur);
  }
  for (const [teacherId, v] of acc) teacherEarnings.push({ teacherId, ...v });

  const balances: Record<string, number> = {};
  for (const s of students) balances[s.id] = balancesMap.get(s.id) ?? 0;

  const snapshot: EmergencySnapshot = {
    v: 1,
    center: {
      id: center.id,
      name: center.name,
      phone: center.phone,
      primaryColor: center.primaryColor,
      secondaryColor: center.secondaryColor,
      accentColor: center.accentColor,
    },
    generatedAt: new Date().toISOString(),
    grades,
    subjects,
    rooms,
    teachers: teachers.map((t) => ({
      id: t.id, name: t.name, phone: t.isActive ? t.phone : null, isActive: t.isActive,
      groups: t.groups.map((g) => g.id),
    })),
    staff: staff.filter((u) => u.role !== "ADMIN"),
    groups,
    students: students.map((s) => ({
      id: s.id, code: s.code, qrToken: s.qrToken, name: s.name, phone: s.phone,
      parentPhone: s.parentPhone, gradeId: s.gradeId, status: s.status,
      createdAt: s.createdAt.toISOString(),
      regs: s.registrations.map((r) => ({ groupId: r.groupId, priceOverride: r.priceOverride, since: r.createdAt.toISOString() })),
    })),
    balances,
    schedule,
    sessions: sessions.map((s) => ({
      id: s.id, groupId: s.groupId, date: s.date, startTime: s.startTime, endTime: s.endTime,
      room: s.room, price: s.price, teacherPercent: s.teacherPercent, status: s.status,
      presentCount: s.presentCount, totalRevenue: s.totalRevenue,
    })),
    attendance,
    payments: payments.map((p) => ({
      id: p.id, studentId: p.studentId, sessionId: p.sessionId, type: p.type,
      amount: p.amount, method: p.method, reason: p.reason, createdAt: p.createdAt.toISOString(),
    })),
    teacherEarnings,
  };

  // النص القياسي + البصمة (زي الرخصة بالظبط — أي تعديل في اللقطة يكسر التحقق)
  const snapshotRaw = canonicalJson(snapshot);
  const snapshotDigest = crypto.createHash("sha256").update(snapshotRaw, "utf8").digest("hex");

  return {
    snapshot,
    snapshotRaw,
    snapshotDigest,
    stats: { students: students.length, groups: groups.length, sessions: sessions.length, teachers: teachers.length },
  };
}
