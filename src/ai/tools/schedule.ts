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
  description: "حصص يوم محدد (مواعيد، مجموعة، مادة، مدرس، حالة الحصة) — لأي تاريخ مش النهاردة بس",
  usageHint: "«عندنا إيه بكرة؟» / «حصص يوم 2026-10-12» / «جدول الخميس» — حوّل اليوم لتاريخ YYYY-MM-DD من تاريخ النهاردة في السياق",
  input: z.object({
    date: z.string().regex(ymd, "التاريخ لازم YYYY-MM-DD").optional().describe("التاريخ YYYY-MM-DD (افتراضي النهاردة)"),
  }),
  risk: "LOW",
  async handler(args, ctx): Promise<ToolOutput> {
    const date = args.date ?? todayStr();
    const sessions = await db.sessionInstance.findMany({
      where: { centerId: ctx.centerId, date },
      select: {
        id: true, status: true, startTime: true, endTime: true,
        group: { select: { name: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } },
      },
      orderBy: { startTime: "asc" },
      take: 60,
    });
    const rows = sessions.map((s) => ({
      label: `${s.startTime ?? ""}${s.endTime ? `–${s.endTime}` : ""}`.trim() || "—",
      value: `${s.group?.subject.name ?? ""} — ${s.group?.name ?? ""}${s.group?.teacher?.name ? ` (${s.group.teacher.name})` : ""} · ${s.status}`,
    }));
    return {
      summary: sessions.length ? `يوم ${date}: ${sessions.length} حصة.` : `مفيش حصص مسجلة يوم ${date}.`,
      data: {
        date,
        sessions: sessions.map((s) => ({
          id: s.id, status: s.status, startTime: s.startTime, endTime: s.endTime,
          group: s.group?.name, subject: s.group?.subject.name, teacher: s.group?.teacher?.name,
        })),
      },
      cards: sessions.length ? [{ type: "report", title: `حصص ${date}`, rows }] : [],
    };
  },
});
