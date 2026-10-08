import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";
import { assertNoSessionConflicts, autoTeacherAttendance } from "@/lib/sessions-core";
import { logAudit, AUDIT } from "@/lib/audit";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   TOOLS: الحضور — attendance.start_session / attendance.get
   فتح الحصة بيستخدم نفس قواعد الـ API الرسمي (sessions-core):
   تعارضات القاعة/المدرس + حضور المدرس التلقائي + نفس الـ audit
============================================================ */

function sessionCard(label: string, data: { sessionId: string; date: string; startTime: string; endTime: string; room?: string | null; teacherAuto?: boolean; teacherName?: string }) {
  return {
    type: "result" as const,
    title: `✓ حصة ${label} بقت مفتوحة`,
    rows: [
      { label: "التاريخ", value: data.date },
      { label: "الوقت", value: `${data.startTime} — ${data.endTime}` },
      ...(data.room ? [{ label: "القاعة", value: data.room }] : []),
      ...(data.teacherAuto && data.teacherName ? [{ label: "المدرس", value: `${data.teacherName} — اتسجل حاضر تلقائيًا` }] : []),
    ],
    actions: [{ label: "افتح شاشة الحضور", action: "navigate" as const, view: "today" }],
  };
}

register({
  name: "attendance.start_session",
  group: "attendance",
  description: "افتح حصة حضور (session) من سلوت الجدول أو مجموعة — وبتسجل المدرس حاضر تلقائيًا لو الميزة شغالة",
  usageHint: "«افتح حضور حصة Math» / «افتح Session للمجموعة الحالية» — محتاج scheduleId أو groupId (+ المواعيد لو مجموعة)",
  input: z.object({
    scheduleId: z.string().optional().describe("معرف سلوت الجدول (الأفضل لو موجود)"),
    groupId: z.string().optional().describe("معرف المجموعة لو مفيش سلوت — مع startTime/endTime"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("الافتراضي النهاردة"),
  }),
  risk: "MEDIUM",
  requiredPermission: "START_SESSION",
  permissionLabel: "فتح الحصص",
  async handler(args, ctx): Promise<ToolOutput> {
    const date = args.date || todayStr();
    if (!args.scheduleId && !args.groupId) {
      throw new ToolError("VALIDATION", "اختار حصة من الجدول (scheduleId) أو مجموعة (groupId) — ولو مجموعة، حدد الوقت كمان.");
    }

    // ==== مسار سلوت الجدول (الأشهر — «افتح حضور الحصة» ) ====
    if (args.scheduleId) {
      const slot = await db.scheduleSlot.findFirst({
        where: { id: args.scheduleId, centerId: ctx.centerId },
        include: {
          group: {
            include: {
              teacher: { select: { id: true, name: true } },
              subject: { select: { name: true } },
            },
          },
        },
      });
      if (!slot) throw new ToolError("NOT_FOUND", "السلوت ده مش موجود في جدول سنترك.");
      const label = `${slot.group.subject.name} — ${slot.group.name}`;
      const existing = await db.sessionInstance.findFirst({
        where: { centerId: ctx.centerId, date, scheduleId: slot.id },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== "CANCELLED") {
        throw new ToolError("STATE", `حصة ${label} مفتوحة خلاص النهاردة — تقدر تطلب «مين غايب النهارده؟».`);
      }
      await assertNoSessionConflicts({
        centerId: ctx.centerId, date, startTime: slot.startTime, endTime: slot.endTime,
        room: slot.room, teacherId: slot.group.teacherId, excludeId: existing?.id,
      });

      let sessionId: string;
      let revived = false;
      if (existing) {
        // إعادة فتح حصة ملغاة (بدون حسابات) بدل إنشاء مكرر
        await db.sessionInstance.update({
          where: { id: existing.id },
          data: { status: "OPEN", openedBy: ctx.user.id, createdAt: new Date() },
        });
        sessionId = existing.id;
        revived = true;
      } else {
        const session = await db.sessionInstance.create({
          data: {
            centerId: ctx.centerId, groupId: slot.groupId, date, scheduleId: slot.id,
            startTime: slot.startTime, endTime: slot.endTime, room: slot.room,
            price: slot.group.sessionPrice, teacherPercent: slot.group.teacherPercent,
            studentSource: "ROSTER",
            status: "OPEN", openedBy: ctx.user.id,
          },
        });
        sessionId = session.id;
      }
      await logAudit({
        user: ctx.user, action: AUDIT.SESSION_OPENED, entity: "SESSION", entityId: sessionId,
        after: { group: slot.group.name, date, startTime: slot.startTime, via: "agent", ...(revived ? { revivedFrom: "CANCELLED" } : {}) },
      });
      const teacherAuto = await autoTeacherAttendance({
        centerId: ctx.centerId, sessionId, teacher: slot.group.teacher, openerName: ctx.user.name,
      });
      return {
        summary: `${revived ? "أعدت فتح" : "فتحت"} حصة ${label} (${slot.startTime} — ${slot.endTime})${teacherAuto ? ` — المدرس ${teacherAuto.teacherName} اتسجل حاضر تلقائيًا` : ""}.`,
        confirmSummary: `ه${revived ? "عيد فتح" : "فتح"} حصة ${label} النهاردة (${slot.startTime} — ${slot.endTime}).`,
        data: { sessionId, label, date, startTime: slot.startTime, endTime: slot.endTime, revived, teacherAuto: !!teacherAuto },
        cards: [sessionCard(label, {
          sessionId, date, startTime: slot.startTime, endTime: slot.endTime, room: slot.room,
          teacherAuto: !!teacherAuto, teacherName: teacherAuto?.teacherName,
        })],
      };
    }

    // ==== مسار مجموعة (حصة ad-hoc) ====
    const group = await db.group.findFirst({
      where: { id: args.groupId!, centerId: ctx.centerId, isActive: true },
      include: { subject: { select: { name: true } }, teacher: { select: { id: true, name: true } } },
    });
    if (!group) throw new ToolError("NOT_FOUND", "المجموعة دي مش موجودة أو مش نشطة.");
    if (!args.startTime || !args.endTime) {
      throw new ToolError("VALIDATION", `حدد وقت الحصة — مثال: من 17:00 لـ 18:30.`);
    }
    if (args.endTime <= args.startTime) throw new ToolError("VALIDATION", "وقت النهاية لازم يكون بعد وقت البداية.");
    const label = `${group.subject.name} — ${group.name}`;
    await assertNoSessionConflicts({
      centerId: ctx.centerId, date, startTime: args.startTime, endTime: args.endTime,
      room: null, teacherId: group.teacherId,
    });
    const session = await db.sessionInstance.create({
      data: {
        centerId: ctx.centerId, groupId: group.id, date, scheduleId: null,
        startTime: args.startTime, endTime: args.endTime, room: null,
        price: group.sessionPrice, teacherPercent: group.teacherPercent,
        studentSource: "ROSTER",
        status: "OPEN", openedBy: ctx.user.id,
      },
    });
    await logAudit({
      user: ctx.user, action: AUDIT.SESSION_OPENED, entity: "SESSION", entityId: session.id,
      after: { group: group.name, date, startTime: args.startTime, via: "agent" },
    });
    const teacherAuto = await autoTeacherAttendance({
      centerId: ctx.centerId, sessionId: session.id, teacher: group.teacher, openerName: ctx.user.name,
    });
    return {
      summary: `فتحت حصة ${label} من ${args.startTime} لـ ${args.endTime}${teacherAuto ? ` — المدرس ${teacherAuto.teacherName} اتسجل حاضر تلقائيًا` : ""}.`,
      confirmSummary: `هفتح حصة ${label} النهاردة من ${args.startTime} لـ ${args.endTime}.`,
      data: { sessionId: session.id, label, date, startTime: args.startTime, endTime: args.endTime, teacherAuto: !!teacherAuto },
      cards: [sessionCard(label, {
        sessionId: session.id, date, startTime: args.startTime, endTime: args.endTime,
        teacherAuto: !!teacherAuto, teacherName: teacherAuto?.teacherName,
      })],
    };
  },
  /** معاينة التأكيد — قراءة بس، صفر كتابة (spec §5) */
  async preview(args, ctx) {
    const date = args.date || todayStr();
    if (args.scheduleId) {
      const slot = await db.scheduleSlot.findFirst({
        where: { id: args.scheduleId, centerId: ctx.centerId },
        select: { startTime: true, endTime: true, group: { select: { name: true, subject: { select: { name: true } } } } },
      });
      if (!slot) throw new ToolError("NOT_FOUND", "السلوت ده مش موجود في جدول سنترك.");
      return {
        summary: `هفتح حصة ${slot.group.subject.name} — ${slot.group.name} النهاردة (${slot.startTime} — ${slot.endTime}).`,
        details: { group: slot.group.name, subject: slot.group.subject.name, date, startTime: slot.startTime, endTime: slot.endTime },
      };
    }
    if (args.groupId) {
      const group = await db.group.findFirst({
        where: { id: args.groupId, centerId: ctx.centerId },
        select: { name: true, subject: { select: { name: true } } },
      });
      if (!group) throw new ToolError("NOT_FOUND", "المجموعة دي مش موجودة.");
      return {
        summary: `هفتح حصة ${group.subject.name} — ${group.name} النهاردة${args.startTime ? ` من ${args.startTime}` : ""}${args.endTime ? ` لـ ${args.endTime}` : ""}.`,
        details: { group: group.name, subject: group.subject.name, date },
      };
    }
    throw new ToolError("VALIDATION", "اختار حصة من الجدول أو مجموعة.");
  },
  async verify(_args, output, ctx) {
    const sessionId = (output.data?.sessionId as string) ?? null;
    if (!sessionId) return "مفيش معرف حصة في النتيجة.";
    const s = await db.sessionInstance.findFirst({
      where: { id: sessionId, centerId: ctx.centerId, status: "OPEN" },
      select: { id: true },
    });
    if (!s) return "الحصة مظهرتش مفتوحة في الداتابيز.";
    return null;
  },
});

register({
  name: "attendance.get",
  group: "attendance",
  description: "بيانات حضور: الطلبة الغايبين النهاردة، أو الغياب المتكرر، أو إحصاء حضور مجموعة",
  usageHint: "«مين غاب النهارده؟» / «اللي غابوا أكتر من 3 مرات» / «حضور مجموعة كذا إزاي؟»",
  input: z.object({
    mode: z.enum(["absent_today", "frequent_absentees", "by_group"]).describe("نوع الاستعلام"),
    minAbsences: z.number().int().min(1).max(30).optional().describe("للغياب المتكرر — الحد الأدنى (افتراضي 3)"),
    days: z.number().int().min(1).max(90).optional().describe("نطاق الأيام للخلف (افتراضي 30 للمتكرر)"),
    groupId: z.string().optional().describe("لموضع by_group"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_REPORTS",
  permissionLabel: "عرض التقارير",
  async handler(args, ctx): Promise<ToolOutput> {
    const today = todayStr();

    if (args.mode === "absent_today") {
      const sessions = await db.sessionInstance.findMany({
        where: { centerId: ctx.centerId, date: today, status: { not: "CANCELLED" } },
        select: { id: true, groupId: true },
      });
      if (!sessions.length) {
        return { summary: "مفيش حصص النهاردة أصلاً — يبقى مفيش مين غايب.", data: { absentees: [] } };
      }
      const groupIds = [...new Set(sessions.map((s) => s.groupId).filter((x): x is string => !!x))];
      const regs = await db.studentGroup.findMany({
        where: { status: "ACTIVE", groupId: { in: groupIds } },
        select: { studentId: true },
      });
      const marks = await db.attendance.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        select: { studentId: true, status: true },
      });
      const present = new Set(marks.filter((m) => m.status !== "EXCUSED" && m.status !== "ABSENT").map((m) => m.studentId));
      const missingIds = [...new Set(regs.filter((r) => !present.has(r.studentId)).map((r) => r.studentId))];
      if (!missingIds.length) {
        return { summary: "النهاردة كله تمام — مفيش غايبين.", data: { absentees: [] } };
      }
      const studs = await db.student.findMany({
        where: { id: { in: missingIds }, centerId: ctx.centerId },
        select: { id: true, name: true, code: true },
        take: 30,
      });
      return {
        summary: `النهاردة في ${studs.length} طالب مسجل ومحضرش في حصص اليوم.`,
        data: { absentees: studs.map((s) => ({ id: s.id, name: s.name, code: s.code })) },
        cards: [{
          type: "students",
          title: `غايبين النهاردة (${studs.length})`,
          items: studs.slice(0, 12).map((s) => ({
            id: s.id, title: s.name, sub: `كود ${s.code}`,
            actions: [{ label: "تقرير الطالب", action: "agent" as const, text: `اعمللي تقرير عن ${s.name}` }],
          })),
          actions: [{ label: "افتح شاشة الحضور", action: "navigate" as const, view: "today" }],
        }],
      };
    }

    if (args.mode === "frequent_absentees") {
      const days = args.days ?? 30;
      const min = args.minAbsences ?? 3;
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const sessions = await db.sessionInstance.findMany({
        where: { centerId: ctx.centerId, date: { gte: since }, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (!sessions.length) return { summary: "مفيش حصص في الفترة دي أصلاً.", data: { flagged: [] } };
      const marks = await db.attendance.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        select: { studentId: true, status: true },
      });
      // غياب = تسجيل ABSENT صريح (EXCUSED متتحسبش غياب)
      const tally = new Map<string, { absent: number; total: number }>();
      for (const m of marks) {
        if (!m.studentId) continue; // صفوف حضور الموظفين مالهاش studentId
        const t = tally.get(m.studentId) ?? { absent: 0, total: 0 };
        t.total += 1;
        if (m.status === "ABSENT") t.absent += 1;
        tally.set(m.studentId, t);
      }
      const flagged = [...tally.entries()].filter(([, t]) => t.absent >= min).sort((a, b) => b[1].absent - a[1].absent);
      if (!flagged.length) {
        return { summary: `مفيش طالب غاب ${min} مرات أو أكتر في آخر ${days} يوم — الوضع صحي.`, data: { flagged: [] } };
      }
      const studs = await db.student.findMany({
        where: { id: { in: flagged.slice(0, 20).map(([id]) => id) }, centerId: ctx.centerId, status: "ACTIVE" },
        select: { id: true, name: true, code: true },
      });
      const nameOf = new Map(studs.map((s) => [s.id, s]));
      const rows = flagged.slice(0, 12)
        .map(([id, t]) => ({ s: nameOf.get(id), absent: t.absent, total: t.total }))
        .filter((r) => r.s);
      return {
        summary: `لقيت ${flagged.length} طالب غاب ${min} مرات أو أكتر في آخر ${days} يوم.`,
        data: { flagged: rows.map((r) => ({ id: r.s!.id, name: r.s!.name, absent: r.absent, total: r.total })) },
        cards: [{
          type: "students",
          title: `غياب متكرر (${flagged.length}) — آخر ${days} يوم`,
          items: rows.map((r) => ({
            id: r.s!.id, title: r.s!.name, sub: `غاب ${r.absent} من ${r.total}`,
            actions: [{ label: "تقرير الطالب", action: "agent" as const, text: `اعمللي تقرير عن ${r.s!.name}` }],
          })),
        }],
      };
    }

    // by_group
    if (!args.groupId) throw new ToolError("VALIDATION", "حدد المجموعة اللي عايز حضورها.");
    const group = await db.group.findFirst({
      where: { id: args.groupId, centerId: ctx.centerId },
      select: { id: true, name: true, subject: { select: { name: true } } },
    });
    if (!group) throw new ToolError("NOT_FOUND", "المجموعة دي مش موجودة.");
    const sessions = await db.sessionInstance.findMany({
      where: { centerId: ctx.centerId, groupId: group.id, status: { not: "CANCELLED" } },
      select: { id: true },
      orderBy: { date: "desc" },
      take: 20,
    });
    const marks = await db.attendance.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      select: { status: true },
    });
    const present = marks.filter((m) => m.status === "PRESENT" || m.status === "LATE").length;
    const rate = marks.length ? Math.round((present / marks.length) * 100) : null;
    return {
      summary: `حضور ${group.subject.name} — ${group.name}: ${rate != null ? `${rate}% في آخر ${sessions.length} حصة` : "مفيش حضور مسجل"}.`,
      data: { groupId: group.id, groupName: group.name, rate, marks: marks.length, sessions: sessions.length },
      cards: [{
        type: "report",
        title: `حضور ${group.subject.name} — ${group.name}`,
        rows: [
          { label: "نسبة الحضور", value: rate != null ? `${rate}%` : "—", tone: rate != null && rate < 70 ? "warn" : "good" },
          { label: "آخر حصص", value: `${sessions.length} حصة` },
          { label: "إجمالي التسجيلات", value: `${marks.length}` },
        ],
      }],
    };
  },
});
