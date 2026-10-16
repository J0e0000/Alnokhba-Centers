import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import type { ToolOutput } from "./types";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   TOOL: الجدول — schedule.get_day
   حصص يوم معين (اليوم/بكرة/أي تاريخ) — قراءة فقط، محصور بالسنتر.
   dashboard.get_today بيغطي النهاردة بس؛ ده بيغطي أي يوم.
============================================================ */

const ymd = /^\d{4}-\d{2}-\d{2}$/;

register({
  name: "schedule.get_day",
  group: "schedule",
  requiredModule: "sessions",
  description: "حصص يوم محدد (مواعيد، مجموعة، مادة، مدرس، حالة الحصة) — لأي تاريخ مش النهاردة بس",
  usageHint: "«عندنا إيه بكرة؟» / «حصص يوم 2026-10-12» / «جدول الخميس» — حوّل اليوم لتاريخ YYYY-MM-DD من تاريخ النهاردة في السياق",
  input: z.object({
    date: z.string().regex(ymd, "التاريخ لازم YYYY-MM-DD").optional().describe("التاريخ YYYY-MM-DD (افتراضي النهاردة)"),
  }),
  risk: "LOW",
  async handler(args, ctx): Promise<ToolOutput> {
    const date = args.date ?? todayStr();
    // الحصص المفتوحة فعلًا في اليوم ده
    const sessions = await db.sessionInstance.findMany({
      where: { centerId: ctx.centerId, date },
      select: {
        id: true, status: true, startTime: true, endTime: true,
        group: { select: { name: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } },
      },
      orderBy: { startTime: "asc" },
      take: 60,
    });
    // الحصص المجدولة في الجدول الأسبوعي ليهوم اليوم ده (لسه متفتحتش) —
    // دي اللي الـ LLM محتاجها عشان يفتح حصة بـ attendance.start_session (scheduleId)
    const slots = await db.scheduleSlot.findMany({
      where: { centerId: ctx.centerId, dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay(), isActive: true },
      select: {
        id: true, startTime: true, endTime: true, room: true,
        group: { select: { id: true, name: true, subject: { select: { name: true } }, teacher: { select: { name: true } }, _count: { select: { students: { where: { status: "ACTIVE" } } } } } },
      },
      orderBy: { startTime: "asc" },
      take: 60,
    });
    const rows = sessions.map((s) => ({
      label: `${s.startTime ?? ""}${s.endTime ? `–${s.endTime}` : ""}`.trim() || "—",
      value: `${s.group?.subject.name ?? ""} — ${s.group?.name ?? ""}${s.group?.teacher?.name ? ` (${s.group.teacher.name})` : ""} · ${s.status}`,
    }));
    for (const sl of slots) {
      rows.push({
        label: `${sl.startTime}${sl.endTime ? `–${sl.endTime}` : ""}`,
        value: `${sl.group.subject.name} — ${sl.group.name}${sl.group.teacher?.name ? ` (${sl.group.teacher.name})` : ""} · مجدولة (مش متفتحة)`,
      });
    }
    const summaryBits: string[] = [];
    summaryBits.push(sessions.length ? `${sessions.length} حصة متفتحة` : "مفيش حصص متفتحة");
    summaryBits.push(slots.length ? `${slots.length} حصة مجدولة في الجدول` : "مفيش حصص مجدولة في الجدول");
    return {
      summary: `يوم ${date}: ${summaryBits.join(" · ")}.`,
      data: {
        date,
        sessions: sessions.map((s) => ({
          id: s.id, status: s.status, startTime: s.startTime, endTime: s.endTime,
          group: s.group?.name, subject: s.group?.subject.name, teacher: s.group?.teacher?.name,
        })),
        slots: slots.map((sl) => ({
          slotId: sl.id, startTime: sl.startTime, endTime: sl.endTime, room: sl.room,
          groupId: sl.group.id, group: sl.group.name, subject: sl.group.subject.name,
          teacher: sl.group.teacher?.name, students: sl.group._count.students,
        })),
      },
      cards: rows.length ? [{ type: "report", title: `حصص ${date}`, rows }] : [],
    };
  },
});

/* ============================================================
   TOOL: إحصاء الحصص — schedule.get_stats
   أعداد الحصص حسب الحالة في فترة (مقفولة/مفتوحة/ملغاة) + الحصص
   المفتوحة من أيام فاتت اللي لازم تتقفل — بدل ما الموديل يجاوب
   بأرقام النهاردة لواحد سأل عن الشهر.
============================================================ */

register({
  name: "schedule.get_stats",
  group: "schedule",
  requiredModule: "sessions",
  description: "أعداد حصص السنتر حسب الحالة في فترة: كام اتقفلت، كام لسه مفتوحة، كام اتلغت + الحصص المفتوحة من أيام فاتت",
  usageHint: "«كام حصة اتقفلت الشهر ده؟» / «كام حصة مفتوحة؟» / «حصص من 2026-10-01 لـ 2026-10-15» — من غير تواريخ = من أول الشهر لليوم",
  input: z.object({
    from: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("بداية الفترة (افتراضي أول الشهر)"),
    to: z.string().regex(ymd, "YYYY-MM-DD").optional().describe("نهاية الفترة شاملة (افتراضي النهاردة)"),
  }),
  risk: "LOW",
  async handler(args, ctx): Promise<ToolOutput> {
    const today = todayStr();
    const from = args.from ?? `${today.slice(0, 7)}-01`;
    const to = args.to ?? today;
    if (to < from) return { summary: "تاريخ النهاية قبل البداية — راجع الفترة.", data: { error: "range" } };
    const sessions = await db.sessionInstance.findMany({
      where: { centerId: ctx.centerId, date: { gte: from, lte: to } },
      select: { status: true, date: true },
    });
    const closed = sessions.filter((s) => s.status === "CLOSED").length;
    const open = sessions.filter((s) => s.status === "OPEN").length;
    const cancelled = sessions.filter((s) => s.status === "CANCELLED").length;
    const openPast = sessions.filter((s) => s.status === "OPEN" && s.date < today).length;
    const openToday = open - openPast;
    return {
      summary: `حصص ${from} → ${to}: ${closed} مقفولة، ${open} مفتوحة (${openPast} منها من أيام فاتت لازم تتقفل)، ${cancelled} ملغاة.`,
      data: { from, to, total: sessions.length, closed, open, openPast, openToday, cancelled },
      cards: [{
        type: "report", title: `حصص ${from} → ${to}`,
        rows: [
          { label: "المقفولة", value: String(closed), tone: "good" },
          { label: "المفتوحة", value: `${open} (${openPast} من أيام فاتت)`, tone: openPast > 0 ? ("warn" as const) : ("info" as const) },
          { label: "الملغاة", value: String(cancelled), tone: "info" },
        ],
        actions: [{ label: "الجدول", action: "navigate" as const, view: "schedule" }],
      }],
    };
  },
});
