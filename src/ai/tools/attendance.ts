import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";
import { assertNoSessionConflicts, autoTeacherAttendance } from "@/lib/sessions-core";
import { assertAttendanceMethodAllowed, assertAttendanceStatusAllowed, recordAttendanceEvent, unifiedMethodFromTableMethod } from "@/lib/attendance-core";
import { logAudit, AUDIT } from "@/lib/audit";
import { todayStr } from "@/lib/normalize";
import { effectivePrice, sessionEconomics } from "@/lib/finance";
import { notifyStudentsAttendance } from "@/lib/notify";

/* ============================================================
   TOOLS: الحضور — attendance.start_session / attendance.get /
   attendance.mark_names / attendance.close_session
   كل الكتابة بنفس قواعد الـ API الرسمي بالظبط (attendance/mark +
   sessions/[id] close): بوابات القدرات + التحميل داخل transaction
   + أحداث الحضور الموحدة + الإشعارات + نفس الـ audit
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

/* ============================================================
   مطابقة عربية مرنة — نفس روح groups.ts (همزات/تاء مربوطة/تشكيل)
============================================================ */
function normAr(t: string): string {
  return t
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** عرض قروش بالجنيه — صحيح بدون كسور، وكسور بمنزلتين (ممنوع ضياع قروش) */
function egp(piastres: number): string {
  return piastres % 100 === 0 ? String(piastres / 100) : (piastres / 100).toFixed(2);
}

/* ------------------------------------------------------------
   حلّ الحصة المفتوحة من كلام حر — «حصة رياضيات» / «فيزياء A» /
   أو الحصة المفتوحة الوحيدة النهاردة تلقائيًا (فهم نية المدرّس)
------------------------------------------------------------ */
async function resolveOpenSession(
  args: { sessionId?: string; session?: string; date?: string },
  ctx: { centerId: string },
) {
  const date = args.date || todayStr();
  const base = {
    where: { centerId: ctx.centerId, date, status: "OPEN" as const },
    include: {
      group: {
        include: {
          subject: { select: { name: true } },
          teacher: { select: { id: true, name: true } },
          grade: { select: { name: true } },
        },
      },
    },
  };

  if (args.sessionId) {
    const s = await db.sessionInstance.findFirst({ ...base, where: { ...base.where, id: args.sessionId } });
    if (!s) throw new ToolError("NOT_FOUND", "الحصة دي مش موجودة أو مش مفتوحة النهاردة.");
    return s;
  }

  const open = await db.sessionInstance.findMany(base);
  if (!open.length) {
    throw new ToolError(
      "STATE",
      date === todayStr()
        ? "مفيش حصص مفتوحة النهاردة — افتح الحصة الأول (قول مثلاً: «افتح حصة رياضيات») وبعدها سجّل الحضور."
        : `مفيش حصص مفتوحة بتاريخ ${date}.`,
    );
  }
  if (open.length === 1 && !args.session) return open[0];

  const q = args.session ? normAr(args.session) : "";
  if (!q) {
    const opts = open.slice(0, 5).map(sessionLabel);
    throw new ToolError("VALIDATION", `في أكتر من حصة مفتوحة — سجّل في أنهي واحدة؟ ${opts.join(" / ")}`);
  }

  // «الكيمياء» و«كيمياء» نفس الحصة — الأداة التعريف بتتشال من الفحص
  const qBare = q.startsWith("ال") && q.length > 3 ? q.slice(2) : q;
  const qTokens = q.split(" ").filter((w) => w.length > 1 && !["حصه", "مجموعه", "المجموعه", "الحصه"].includes(w));
  const scored = open
    .map((s) => {
      const hay = normAr(`${s.group?.subject.name ?? s.name ?? ""} ${s.group?.name ?? ""} ${s.group?.grade?.name ?? ""}`);
      let score = 0;
      if (hay === q || hay.includes(q) || q.includes(hay)) score += 6;
      else if (qBare !== q && (hay === qBare || hay.includes(qBare))) score += 6;
      for (const tok of qTokens) {
        const bare = tok.startsWith("ال") && tok.length > 3 ? tok.slice(2) : tok;
        if (hay.includes(tok) || (bare !== tok && hay.includes(bare))) score += 2;
        if (normAr(s.startTime) === tok) score += 4; // «الحصة الـ 5» / اختيار بميعاد
      }
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) {
    const opts = open.slice(0, 5).map(sessionLabel);
    throw new ToolError("NOT_FOUND", `مفيش حصة مفتوحة النهاردة مطابقة لـ «${args.session}» — الحصص المفتوحة: ${opts.join(" / ")}`);
  }
  if (best.score === scored[1]?.score) {
    const tied = scored.filter((x) => x.score === best.score).slice(0, 4).map((x) => sessionLabel(x.s));
    throw new ToolError("VALIDATION", `في أكتر من حصة مطابقة — حدد بالظبط: ${tied.join(" / ")}`);
  }
  return best.s;
}

function sessionLabel(s: { startTime: string; endTime: string; group?: { subject: { name: string }; name: string } | null; name?: string | null }): string {
  return s.group ? `${s.group.subject.name} — ${s.group.name} (${s.startTime})` : `${s.name ?? "حضور مفتوح"} (${s.startTime})`;
}

type RosterRow = { student: { id: string; name: string; code: string; status: string }; priceOverride: number | null };

/* ------------------------------------------------------------
   حلّ الأسماء ضد كشف الحصة — مطابقة مرنة + تجزيء ذكي لنص حر
   («أحمد محمد ومحمود علي وسعيد») بنوافذ متتالية ضد أسماء الكشف،
   والتعادل بيرجع خطأ بالخيارات — ممنوع تخمين (spec §13)
------------------------------------------------------------ */
function resolveNamesAgainstRoster(
  names: string[],
  roster: RosterRow[],
): {
  matched: { student: RosterRow["student"]; priceOverride: number | null; given: string }[];
  ambiguous: { name: string; candidates: string[] }[];
  unknown: string[];
} {
  const matched: { student: RosterRow["student"]; priceOverride: number | null; given: string }[] = [];
  const ambiguous: { name: string; candidates: string[] }[] = [];
  const unknown: string[] = [];
  const claimed = new Set<string>();

  for (const raw of names) {
    const nq = normAr(raw);
    if (!nq) continue;
    const scored = roster
      .filter((r) => !claimed.has(r.student.id))
      .map((r) => {
        const hay = normAr(r.student.name);
        let score = 0;
        if (hay === nq) score += 10;
        else if (hay.includes(nq) || nq.includes(hay)) score += 6;
        else {
          const toks = nq.split(" ").filter((w) => w.length > 1);
          const hayToks = hay.split(" ");
          for (const tok of toks) if (hayToks.some((h) => h === tok)) score += 3;
        }
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) {
      unknown.push(raw);
      continue;
    }
    const top = scored[0].score;
    const tied = scored.filter((x) => x.score === top);
    if (tied.length > 1) {
      ambiguous.push({ name: raw, candidates: tied.slice(0, 4).map((x) => `${x.r.student.name} (${x.r.student.code})`) });
      continue;
    }
    claimed.add(scored[0].r.student.id);
    matched.push({ student: scored[0].r.student, priceOverride: scored[0].r.priceOverride, given: raw });
  }
  return { matched, ambiguous, unknown };
}

/**
 * كلمات مش أسماء — شبكة أمان لرخصة الموديلات (بيسكبوا جملة الطلب كلها في namesText ساعات)
 * مخزنة م normalized عشان المقارنة مباشرة.
 */
const NAME_STOP = new Set([
  "في", "فى", "حصه", "الحصه", "مجموعه", "المجموعه", "النهارده", "اليوم", "بكره", "امبارح",
  "سجل", "سجللي", "احضر", "الحضور", "حضور", "حاضر", "حاضرين", "متاخر", "متأخر", "بعذر", "بعتذر",
  "غايب", "غايبين", "الغايبين", "الباقي", "باقيهم", "كلهم", "الكله", "الكل", "بس", "كمان", "كام",
  "كذا", "قولي", "هيتحمل", "منه", "منهم", "له", "لها", "لهم", "هو", "هي", "هما", "من", "على",
  "عن", "الى", "مع", "ياريت", "لو", "مش", "دلوقتي", "تاني", "و", "ال", "ده", "دي", "دا",
  "and", "the", "for", "with", "from", "today", "tomorrow", "please", "mark", "present", "absent",
]);

/**
 * تجزيء نص حر لأسماء («سجل حضور أحمد ومحمد ومحمود علي») —
 * بيتعامل مع «و» الملتصقة («ومحمد») والفواصل والفراغات وكلمات الطلب الزخرفية،
 * والنتيجة بتتطابق بنوافذ متتالية ضد أسماء الكشف (2 كلمات قبل 1) —
 * فالأسماء المركبة («أحمد محمد») بتتطابق كوحدة واحدة.
 */
function splitNamesFree(text: string): string[] {
  return text
    .replace(/[،,;؛:\/]/g, " ")
    .split(/\s+/)
    .map((w) => (w.length >= 4 && w.startsWith("و") ? w.slice(1) : w)) // «ومحمد» ← «محمد» (وحيد/عوض متتقطعش)
    .filter((w) => w.length >= 2 && !NAME_STOP.has(normAr(w)));
}

/**
 * مطابقة متتالية لنص حر ضد كشف الحصة: نوافذ (4→1 كلمات) بمطابقة تامة
 * على أسماء الكشف، والكلمات اللي فاتت بتتحل فردي بمطابقة مرنة —
 * بيرجع المطابقين + الكلمات اللي مالهاش صاحب.
 */
function matchNamesSequence(text: string, roster: RosterRow[]): {
  matched: { student: RosterRow["student"]; priceOverride: number | null }[];
  ambiguous: { name: string; candidates: string[] }[];
  unknown: string[];
} {
  const tokens = splitNamesFree(text);
  const claimed = new Set<string>();
  const matched: { student: RosterRow["student"]; priceOverride: number | null }[] = [];
  const ambiguous: { name: string; candidates: string[] }[] = [];
  const unknown: string[] = [];

  // المرحلة ١: نوافذ متتالية (الأطول الأول) — تطابق تام، ولو مفيش تطابق تام:
  // احتواء فريد («مريم عادل» ⊆ «مريم عادل رشاد») — فالأسماء الناقصة بتتكمل من الكشف
  let i = 0;
  while (i < tokens.length) {
    let consumed = 0;
    for (let w = Math.min(4, tokens.length - i); w >= 1 && !consumed; w--) {
      const frag = normAr(tokens.slice(i, i + w).join(" "));
      if (!frag) continue;
      const avail = roster.filter((r) => !claimed.has(r.student.id));
      const exact = avail.filter((r) => normAr(r.student.name) === frag);
      // احتواء باتجاه واحد بس: الجزء المكتوب ⊆ اسم كامل في الكشف («مريم عادل» ⊆ «مريم عادل رشاد»).
      // الاتجاه العكسي (frag أطول من اسم) بيبلع أسماء جنب بعض — ممنوع.
      const contained = exact.length ? [] : avail.filter((r) => normAr(r.student.name).includes(frag));
      const hits = exact.length ? exact : contained;
      if (hits.length === 1) {
        claimed.add(hits[0].student.id);
        matched.push({ student: hits[0].student, priceOverride: hits[0].priceOverride });
        consumed = w;
      } else if (hits.length > 1) {
        ambiguous.push({ name: tokens.slice(i, i + w).join(" "), candidates: hits.slice(0, 4).map((r) => `${r.student.name} (${r.student.code})`) });
        consumed = w;
      }
    }
    if (consumed) {
      i += consumed;
    } else {
      unknown.push(tokens[i]);
      i += 1;
    }
  }

  // المرحلة ٢: الكلمات المتبقية — مطابقة مرنة فردية (اسم أول، جزء من اسم…)
  if (unknown.length) {
    const rest = resolveNamesAgainstRoster(unknown, roster.filter((r) => !claimed.has(r.student.id)));
    for (const m of rest.matched) {
      claimed.add(m.student.id);
      matched.push({ student: m.student, priceOverride: m.priceOverride });
    }
    ambiguous.push(...rest.ambiguous);
    const finallyUnknown = rest.unknown;
    unknown.length = 0;
    unknown.push(...finallyUnknown);
  }
  return { matched, ambiguous, unknown };
}

const MARK_STATUS_LABEL: Record<string, string> = { PRESENT: "حاضر", LATE: "متأخر", EXCUSED: "بعذر" };

register({
  name: "attendance.mark_names",
  group: "attendance",
  description: "سجّل حضور بالأسماء في حصة مفتوحة: حاضر/متأخر/بعذر، أو علّم كل المسجلين وحدد الغايبين — بنفس قواعد التحميل الرسمية (الاعتذار ببلاش، الباقي بيتحمّل سعر الحصة)",
  usageHint: "«سجل حضور أحمد ومحمد في حصة رياضيات» / «الحضور: أحمد، محمد — الغايبين عمر وسالم، سجّل الباقي» / «سجل الكل ما عدا عمر» — الأسماء بالكلام العادي والأداة بتحلها ضد كشف الحصة",
  input: z.object({
    session: z.string().max(80).optional().describe("الحصة — مادة أو اسم مجموعة زي «رياضيات» أو «فيزياء A» (لو فيه حصة مفتوحة واحدة بس اسبها)"),
    sessionId: z.string().optional().describe("معرف الحصة لو معروف من خطوة سابقة"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("الافتراضي النهاردة"),
    marks: z.array(z.union([
      z.string().min(1).max(80),
      z.object({
        name: z.string().min(1).max(80).describe("اسم الطالب زي ما قاله المستخدم"),
        status: z.enum(["PRESENT", "LATE", "EXCUSED"]).default("PRESENT").describe("حاضر/متأخر/بعذر"),
      }),
    ])).max(60).default([]).describe("أسماء هتتسجل — نص بسيط (هيتحسب حاضر) أو كائن {name, status}"),
    namesText: z.string().max(400).optional().describe("أسماء الطلبة بس — «أحمد محمد ومحمود علي» — من غير كلام الجملة — بيتجزّع ضد كشف الحصة كلهم PRESENT"),
    markRest: z.boolean().optional().describe("علّم باقي المسجلين اللي لسه محضروش (تحضير معكوس) — «سجل الباقي»"),
    except: z.array(z.string().min(1).max(80)).max(60).optional().describe("أسماء مستثناة من markRest — الغايبين، اسم لكل عنصر"),
    exceptText: z.string().max(400).optional().describe("نص حر للمستثنين — «عمر وسالم» — بيتجزّع ضد كشف الحصة"),
    note: z.string().max(200).optional(),
  }),
  risk: "MEDIUM",
  requiredPermission: undefined, // زي الـ API الرسمي — أي موظف سنتر يقدر يسجّل حضور (التحصيل سيرفري بقواعد ثابتة)
  permissionLabel: "تسجيل الحضور",
  async handler(args, ctx): Promise<ToolOutput> {
    const plan = await buildMarkPlan(args, ctx);

    // لا تغيير — الحصة مطابقة للطلب بالفعل (idempotent زي الـ API الرسمي)
    if (!plan.toMark.length) {
      return {
        summary: plan.noopText ?? "مفيش تسجيلات جديدة — الحالة مطابقة للطلب.",
        confirmSummary: plan.previewText,
        data: { sessionId: plan.session.id, marked: 0, noChange: true, absent: plan.absentNames, skipped: plan.skipped },
        cards: [{
          type: "report",
          title: `حضور ${sessionLabel(plan.session)}`,
          rows: [
            { label: "تسجيلات جديدة", value: "مفيش — الحالة مطابقة", tone: "info" as const },
            ...(plan.absentNames.length ? [{ label: "غايب", value: plan.absentNames.slice(0, 10).join("، "), tone: "warn" as const }] : []),
          ],
          actions: [{ label: "افتح شاشة الحضور", action: "navigate" as const, view: "today" }],
        }],
      };
    }

    // بوابات القدرات — نفس الـ API الرسمي: التسجيل بالاسم محتاج قدرة name_attendance، والتأخير late_checkin
    await assertAttendanceMethodAllowed(ctx.centerId, "MANUAL");
    for (const st of plan.statusesUsed) await assertAttendanceStatusAllowed(ctx.centerId, st);

    // ==== التنفيذ داخل transaction — نفس قواعد attendance/mark (التحميل محسوب في الخطة) ====
    let totalCharge = 0;
    const markedRows: { studentId: string; name: string; status: string; charged: number }[] = [];
    await db.$transaction(async (tx) => {
      for (const m of plan.toMark) {
        const charge = m.charge;
        await tx.attendance.create({
          data: {
            centerId: ctx.centerId, sessionId: plan.session.id, studentId: m.student.id,
            status: m.status, charged: charge, recordedBy: ctx.user.id, method: "MANUAL",
            studentName: m.student.name, studentCode: m.student.code,
            ...(args.note ? { note: args.note } : {}),
          },
        });
        if (charge > 0) {
          await tx.studentTransaction.create({
            data: {
              centerId: ctx.centerId, studentId: m.student.id, sessionId: plan.session.id,
              type: "CHARGE", amount: -charge,
              reason: `حصة ${plan.session.group?.subject.name ?? ""} (عن طريق زكي)`,
              createdBy: ctx.user.id,
            },
          });
        }
        totalCharge += charge;
        markedRows.push({ studentId: m.student.id, name: m.student.name, status: m.status, charged: charge });
      }
    });

    // أحداث الحضور الموحدة + إشعار لكل حالة بحالتها (best-effort زي الرسمي)
    await Promise.all(markedRows.map((m) => recordAttendanceEvent({
      centerId: ctx.centerId,
      personType: "STUDENT",
      method: unifiedMethodFromTableMethod("MANUAL"),
      status: m.status,
      studentId: m.studentId,
      displayName: m.name,
      role: "STUDENT",
      sessionId: plan.session.id,
      metadata: { via: "agent", charged: m.charged },
    }).catch(() => {})));
    for (const status of ["PRESENT", "LATE", "EXCUSED"] as const) {
      const ids = markedRows.filter((m) => m.status === status).map((m) => m.studentId);
      if (!ids.length) continue;
      void notifyStudentsAttendance(
        ctx.centerId,
        ids,
        "تم تسجيل حضورك ✅",
        `حصة ${plan.session.group?.subject.name ?? ""} — حالة حضورك: ${MARK_STATUS_LABEL[status]}.`,
      ).catch(() => {});
    }

    await logAudit({
      user: ctx.user, action: AUDIT.ATTENDANCE_RECORDED, entity: "SESSION", entityId: plan.session.id,
      after: {
        via: "agent",
        marked: markedRows.length,
        totalCharge,
        statuses: Object.fromEntries(["PRESENT", "LATE", "EXCUSED"].map((s) => [s, markedRows.filter((m) => m.status === s).length])),
        students: markedRows.map((m) => `${m.name}:${m.status}`),
        ...(plan.absentNames.length ? { absent: plan.absentNames } : {}),
        ...(plan.skipped.length ? { skipped: plan.skipped } : {}),
      },
      reason: `تسجيل حضور بالأسماء — ${sessionLabel(plan.session)}`,
    });

    const byStatus = (s: string) => markedRows.filter((m) => m.status === s).length;
    const absentLine = plan.absentNames.length ? ` — غايب من الكشف: ${plan.absentNames.slice(0, 8).join("، ")}${plan.absentNames.length > 8 ? "…" : ""}` : "";
    const skippedLine = plan.skipped.length ? ` (كانوا مسجّلين قبل كده: ${plan.skipped.slice(0, 5).join("، ")})` : "";
    return {
      summary: `سجلت حضور ${markedRows.length} في ${sessionLabel(plan.session)} — حاضر ${byStatus("PRESENT")} · متأخر ${byStatus("LATE")} · بعذر ${byStatus("EXCUSED")}${totalCharge > 0 ? ` — تحميل ${egp(totalCharge)} ج` : ""}${absentLine}${skippedLine}.`,
      confirmSummary: plan.previewText,
      data: {
        sessionId: plan.session.id,
        marked: markedRows.length,
        statuses: { PRESENT: byStatus("PRESENT"), LATE: byStatus("LATE"), EXCUSED: byStatus("EXCUSED") },
        totalChargePiastres: totalCharge,
        absent: plan.absentNames,
        skipped: plan.skipped,
      },
      cards: [{
        type: "report",
        title: `حضور ${sessionLabel(plan.session)}`,
        rows: [
          { label: "اتسجل", value: `${markedRows.length} طالب`, tone: "good" },
          { label: "الحالات", value: `حاضر ${byStatus("PRESENT")} · متأخر ${byStatus("LATE")} · بعذر ${byStatus("EXCUSED")}` },
          ...(plan.absentNames.length ? [{ label: "غايب", value: plan.absentNames.slice(0, 10).join("، "), tone: "warn" as const }] : []),
          ...(plan.skipped.length ? [{ label: "مسجّلين من قبل", value: plan.skipped.slice(0, 8).join("، ") }] : []),
          { label: "التحميل", value: totalCharge > 0 ? `${egp(totalCharge)} ج` : "مفيش", tone: "info" as const },
        ],
        actions: [{ label: "افتح شاشة الحضور", action: "navigate" as const, view: "today" }],
      }],
    };
  },
  /** معاينة التأكيد — قراءة بس، صفر كتابة (spec §5): بتعرض الأسماء محلولة والحالات والتحميل */
  async preview(args, ctx) {
    const plan = await buildMarkPlan(args, ctx);
    return {
      summary: plan.previewText,
      details: {
        الحصة: sessionLabel(plan.session),
        هيتسجل: plan.toMark.slice(0, 12).map((m) => `${m.student.name} (${MARK_STATUS_LABEL[m.status]}${m.charge > 0 ? `، ${egp(m.charge)}ج` : ""})`).join(" · ") || "—",
        ...(plan.absentNames.length ? { هيفضل_غايب: plan.absentNames.slice(0, 12).join("، ") } : {}),
        ...(plan.skipped.length ? { مسجّلين_من_قبل: plan.skipped.join("، ") } : {}),
        ...(plan.warnings.length ? { تنبيهات: plan.warnings.join(" · ") } : {}),
        إجمالي_التحميل: `${egp(plan.totalCharge)} ج`,
      },
    };
  },
  /** تحقق ما بعد التنفيذ من الداتابيز (spec §34) */
  async verify(_args, output, ctx) {
    const sessionId = output.data?.sessionId as string | undefined;
    const marked = (output.data?.marked as number | undefined) ?? 0;
    if (!sessionId) return "مفيش معرف حصة في النتيجة.";
    const count = await db.attendance.count({ where: { sessionId, centerId: ctx.centerId, studentId: { not: null } } });
    if (count < marked) return `المفروض ${marked} تسجيل والحصة فيها ${count} بس — راجع شاشة الحضور.`;
    return null;
  },
});

/* ------------------------------------------------------------
   خطة تسجيل الحضور — مستخدمة في preview والتنفيذ (قراءة بس)
   بتحل الحصة + الكشف + الأسماء وبتطلع كل المشاكل مرة واحدة
------------------------------------------------------------ */
type MarkArgs = {
  session?: string; sessionId?: string; date?: string;
  marks?: (string | { name: string; status: "PRESENT" | "LATE" | "EXCUSED" })[];
  namesText?: string; markRest?: boolean; except?: string[]; exceptText?: string; note?: string;
};

async function buildMarkPlan(args: MarkArgs, ctx: { centerId: string; user: { id: string } }) {
  const session = await resolveOpenSession(args, ctx);
  // الحضور المفتوح (بدون كشف) — التسجيل من الـ QR بس، زي الـ API الرسمي بالظبط
  if (session.studentSource === "OPEN" || !session.groupId) {
    throw new ToolError("STATE", "الحصة دي حضور مفتوح (من غير كشف) — الحضور بيتسجل من الـ QR بس بالاسم والكود، والتحضير بالأسماء مش منطبق عليها.");
  }

  const regs = await db.studentGroup.findMany({
    where: { groupId: session.groupId, status: "ACTIVE" },
    select: {
      priceOverride: true,
      student: { select: { id: true, name: true, code: true, status: true } },
    },
  });
  const roster: RosterRow[] = regs.filter((r) => r.student.status !== "ARCHIVED");

  // الموجودين مسبقًا — التكرار بيتشال زي الرسمي (idempotent)
  const existing = await db.attendance.findMany({
    where: { sessionId: session.id, studentId: { in: roster.map((r) => r.student.id) } },
    select: { studentId: true, status: true },
  });
  const attendedIds = new Set(existing.map((e) => e.studentId));

  // ١) الأسماء المطلوب تسجيلها — من مصدرين:
  //    marks (أسماء فردية بحالتها — نص بسيط = حاضر) + namesText (نص حر بيتجزّع ضد الكشف)
  const markEntries = (args.marks ?? []).map((m) => (typeof m === "string" ? { name: m, status: "PRESENT" as const } : m));
  type WantedMark = { student: RosterRow["student"]; status: "PRESENT" | "LATE" | "EXCUSED"; priceOverride: number | null };
  const wanted: WantedMark[] = [];
  const ambiguous: { name: string; candidates: string[] }[] = [];
  const unknown: string[] = [];
  const claimed = new Set<string>();

  const indNames = markEntries.map((m) => m.name);
  const ind = resolveNamesAgainstRoster(indNames, roster);
  for (const m of ind.matched) {
    claimed.add(m.student.id);
    wanted.push({ student: m.student, status: markEntries.find((x) => x.name === m.given)?.status ?? "PRESENT", priceOverride: m.priceOverride });
  }
  ambiguous.push(...ind.ambiguous);
  unknown.push(...ind.unknown);

  if (args.namesText) {
    const seq = matchNamesSequence(args.namesText, roster.filter((r) => !claimed.has(r.student.id)));
    for (const m of seq.matched) {
      claimed.add(m.student.id);
      wanted.push({ student: m.student, status: "PRESENT", priceOverride: m.priceOverride });
    }
    ambiguous.push(...seq.ambiguous);
    unknown.push(...seq.unknown);
  }

  if (ambiguous.length) {
    throw new ToolError(
      "VALIDATION",
      `الأسماء دي مطابقة لأكتر من طالب في الكشف — حدد بالظبط: ${ambiguous.map((a) => `«${a.name}» (${a.candidates.join(" / ")})`).join(" · ")}`,
    );
  }
  if (unknown.length) {
    const rosterNames = roster.slice(0, 10).map((r) => r.student.name).join("، ");
    throw new ToolError(
      "NOT_FOUND",
      `مفيش طالب بالأسماء دي في كشف ${sessionLabel(session)}: ${unknown.map((u) => `«${u}»`).join("، ")}${rosterNames ? ` — الكشف فيه: ${rosterNames}${roster.length > 10 ? "…" : ""}` : ""}`,
    );
  }
  if (!wanted.length && !args.markRest) {
    throw new ToolError("VALIDATION", "حدد أسماء تتسجل أو اطلب «سجّل الباقي» — مفيش حاجة هتتسجل.");
  }

  // ٢) المستثنين (الغايبين) — من except + exceptText — كلهم بمطابقة متتالية ضد الكشف
  let exceptMatched = new Set<string>();
  const exceptWarnings: string[] = [];
  if (args.markRest && (args.except?.length || args.exceptText)) {
    const exceptStr = [...(args.except ?? []), args.exceptText ?? ""].join(" ").trim();
    const ex = matchNamesSequence(exceptStr, roster);
    for (const m of ex.matched) exceptMatched.add(m.student.id);
    for (const u of ex.unknown) exceptWarnings.push(`«${u}» مش في كشف الحصة دي أصلاً`);
    for (const a of ex.ambiguous) exceptWarnings.push(`«${a.name}» متعادل بين: ${a.candidates.join(" / ")}`);
  }

  const statusesUsed = [...new Set(wanted.map((m) => m.status))];
  if (statusesUsed.includes("LATE")) await assertAttendanceStatusAllowed(ctx.centerId, "LATE");

  const chargeOf = (r: RosterRow, status: string) => (status === "EXCUSED" ? 0 : effectivePrice(r.priceOverride, null, session.price));

  // ٣) الأفراد المطلوب تسجيلهم + (markRest) باقي الكشف غير المحضر ما عدا المستثنين
  const toMark = wanted.map((m) => ({
    student: m.student,
    status: m.status,
    charge: chargeOf({ student: m.student, priceOverride: m.priceOverride }, m.status),
  }));
  if (args.markRest) {
    for (const r of roster) {
      if (attendedIds.has(r.student.id) || exceptMatched.has(r.student.id)) continue;
      if (toMark.some((m) => m.student.id === r.student.id)) continue;
      toMark.push({ student: r.student, status: "PRESENT", charge: chargeOf(r, "PRESENT") });
    }
  }

  const absentNames = roster
    .filter((r) => !attendedIds.has(r.student.id) && !toMark.some((m) => m.student.id === r.student.id))
    .map((r) => r.student.name);
  const skipped = wanted.filter((m) => attendedIds.has(m.student.id)).map((m) => m.student.name);
  const finalToMark = toMark.filter((m) => !attendedIds.has(m.student.id));
  const totalCharge = finalToMark.reduce((s, m) => s + m.charge, 0);

  // مفيش تسجيلات جديدة؟ لو الطلب «سجل الباقي» والحالة مطابقة أصلًا (الباقي = الغايبين بس)
  // → نجاح بدون تغيير (idempotent زي الـ API الرسمي) — مش خطأ
  if (!finalToMark.length && args.markRest) {
    const absentLine = absentNames.length ? absentNames.slice(0, 8).join("، ") : "محدش";
    return {
      session,
      toMark: [],
      absentNames,
      skipped,
      warnings: exceptWarnings,
      statusesUsed: [],
      totalCharge: 0,
      previewText: `الحالة مطابقة لطلبك بالفعل — مفيش تسجيلات جديدة. الغايب في كشف ${sessionLabel(session)}: ${absentLine}.`,
      noopText: `الحالة مطابقة لطلبك بالفعل — الغايب في كشف ${sessionLabel(session)}: ${absentLine}. مفيش حاجة اتغيرت.`,
    };
  }
  if (!finalToMark.length) {
    throw new ToolError("STATE", "كل الأسماء دي مسجّل حضورهم قبل كده في الحصة دي — مفيش حاجة جديدة تتسجل.");
  }

  const previewText = `هسجل حضور ${finalToMark.length} في ${sessionLabel(session)}: ${finalToMark.slice(0, 10).map((m) => `${m.student.name} (${MARK_STATUS_LABEL[m.status]}${m.charge > 0 ? `، ${egp(m.charge)}ج` : ""})`).join(" · ")}${finalToMark.length > 10 ? ` و${finalToMark.length - 10} كمان` : ""}${absentNames.length ? ` — هيفضل غايب: ${absentNames.slice(0, 8).join("، ")}${absentNames.length > 8 ? "…" : ""}` : ""}${totalCharge > 0 ? ` — إجمالي التحميل ${egp(totalCharge)} ج` : ""}.`;

  return {
    session,
    toMark: finalToMark,
    absentNames,
    skipped,
    warnings: exceptWarnings,
    statusesUsed: statusesUsed.length ? statusesUsed : ["PRESENT"],
    totalCharge,
    previewText,
    noopText: undefined as string | undefined,
  };
}

/* ------------------------------------------------------------
   قفل الحصة — attendance.close_session
   نفس الـ API الرسمي (POST /api/sessions/[id] action=close):
   تجميعات القفل + مستحقات المدرس + حركات مركز السنتر
------------------------------------------------------------ */
register({
  name: "attendance.close_session",
  group: "attendance",
  description: "اقفل حصة مفتوحة — بيجمع الحضور والإيراد ونصيب المدرس ويسجل المستحقات، وبعدها مينفعش تعديل حضور غير من المدير",
  usageHint: "«اقفل حصة رياضيات» / «اقفل الحصة» — لو فيه حصة مفتوحة واحدة بس هتتقفل هي",
  input: z.object({
    session: z.string().max(80).optional().describe("الحصة — مادة أو اسم مجموعة (لو فيه حصة مفتوحة واحدة بس اسبها)"),
    sessionId: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("الافتراضي النهاردة"),
  }),
  risk: "MEDIUM",
  async handler(args, ctx): Promise<ToolOutput> {
    const session = await resolveOpenSession(args, ctx);
    if (session.status !== "OPEN") throw new ToolError("STATE", "الحصة دي مش مفتوحة أصلاً.");

    const open = session.studentSource === "OPEN";
    const econ = await sessionEconomics(session.id);

    await db.$transaction(async (tx) => {
      await tx.sessionInstance.update({
        where: { id: session.id },
        data: {
          status: "CLOSED", closedBy: ctx.user.id, closedAt: new Date(),
          presentCount: open ? await tx.attendance.count({ where: { sessionId: session.id } }) : econ.presentCount,
          totalRevenue: econ.totalRevenue,
          teacherShare: econ.teacherShare,
          centerShare: econ.centerShare,
        },
      });
      if (!open) {
        if (session.group?.teacherId && econ.teacherShare > 0) {
          await tx.teacherSettlement.create({
            data: {
              centerId: ctx.centerId, teacherId: session.group.teacherId, sessionId: session.id,
              type: "EARNED", amount: econ.teacherShare, date: session.date,
              note: `حصة ${session.group.subject.name} ${session.date} (عن طريق زكي)`, createdBy: ctx.user.id,
            },
          });
        }
        await tx.centerTransaction.createMany({
          data: [
            { centerId: ctx.centerId, type: "SESSION_REVENUE", amount: econ.totalRevenue, date: session.date, note: `إيراد حصة ${session.group?.subject.name ?? ""}`, refType: "SESSION", refId: session.id, createdBy: ctx.user.id },
            { centerId: ctx.centerId, type: "TEACHER_SHARE", amount: -econ.teacherShare, date: session.date, note: `نصيب المدرس ${session.group?.teacher?.name ?? ""}`, refType: "SESSION", refId: session.id, createdBy: ctx.user.id },
          ],
        });
      }
    });

    await logAudit({
      user: ctx.user, action: AUDIT.SESSION_CLOSED, entity: "SESSION", entityId: session.id,
      after: { via: "agent", ...(open ? { mode: "OPEN", recorded: econ.presentCount } : { ...econ }) },
    });

    const label = sessionLabel(session);
    return {
      summary: open
        ? `قفلت ${label} — حضور مفتوح، اتسجل ${econ.presentCount} حضور ومفيش حسابات.`
        : `قفلت ${label} — ${econ.presentCount} حاضر · إيراد ${egp(econ.totalRevenue)} ج · نصيب المدرس ${egp(econ.teacherShare)} ج${session.group?.teacher ? ` (${session.group.teacher.name})` : ""}.`,
      confirmSummary: `هقفل ${label} — ${econ.presentCount} حاضر${open ? "" : ` · إيراد ${egp(econ.totalRevenue)} ج · نصيب المدرس ${egp(econ.teacherShare)} ج`}. بعد القفل الحضور بيتجمد لغير المدير.`,
      data: { sessionId: session.id, mode: open ? "OPEN" : "ROSTER", ...econ },
      cards: [{
        type: "report",
        title: `اتقفلت — ${label}`,
        rows: [
          { label: "الحضور", value: `${econ.presentCount}` },
          ...(open ? [] : [
            { label: "الإيراد", value: `${egp(econ.totalRevenue)} ج` },
            { label: "نصيب المدرس", value: `${egp(econ.teacherShare)} ج` },
            { label: "نصيب السنتر", value: `${egp(econ.centerShare)} ج` },
          ]),
        ],
        actions: [{ label: "حصص اليوم", action: "navigate" as const, view: "today" }],
      }],
    };
  },
  async preview(args, ctx) {
    const session = await resolveOpenSession(args, ctx);
    const open = session.studentSource === "OPEN";
    const econ = await sessionEconomics(session.id);
    return {
      summary: `هقفل ${sessionLabel(session)} — ${econ.presentCount} حاضر${open ? " (حضور مفتوح — مفيش حسابات)" : ` · إيراد ${egp(econ.totalRevenue)} ج · نصيب المدرس ${egp(econ.teacherShare)} ج`}.`,
      details: {
        الحصة: sessionLabel(session),
        الحضور: `${econ.presentCount}`,
        ...(open ? {} : {
          الإيراد: `${egp(econ.totalRevenue)} ج`,
          "نصيب المدرس": `${egp(econ.teacherShare)} ج`,
          "نصيب السنتر": `${egp(econ.centerShare)} ج`,
        }),
        ملاحظة: "بعد القفل الحضور بيتجمد لغير المدير",
      },
    };
  },
  async verify(_args, output, ctx) {
    const sessionId = output.data?.sessionId as string | undefined;
    if (!sessionId) return "مفيش معرف حصة في النتيجة.";
    const s = await db.sessionInstance.findFirst({ where: { id: sessionId, centerId: ctx.centerId, status: "CLOSED" }, select: { id: true } });
    if (!s) return "الحصة مظهرتش مقفولة في الداتابيز.";
    return null;
  },
});
