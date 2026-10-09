import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import type { ToolOutput } from "./types";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   TOOLS: التحليل — reports.analyze (spec Phase 6)
   كل الأرقام هنا بتتحسب حتميًا في كود التطبيق من داتا السنتر
   الفعلية — الموديل بيقرأ النتايج الجاهزة ويفسرها بس.
   ممنوع على الموديل يخترع أرقام أو اتجاهات — اللي مش موجود
   بيتقال عنه صراحة «مفيش داتا كفاية».
============================================================ */

/** YYYY-MM-DD لسنة/شهر/يوم محلي — بدون مكتبات */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDays(s: string, days: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return ymd(dt);
}

function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** التغير النسبي — محمي من القسمة على صفر */
function changePct(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null; // مفيش أساس للمقارنة
  return Math.round(((cur - prev) / prev) * 100);
}

function fmtJ(piastres: number): string {
  return `${Math.round(piastres / 100).toLocaleString("en-US")}ج`;
}

register({
  name: "reports.analyze",
  group: "reports",
  description:
    "تحليل أداء السنتر لأي فترة (يوم/أسبوع/شهر) بالمقارنة مع الفترة اللي قبلها: الحضور والغياب، أكتر المجموعات غيابًا، التحصيل وتغيره، الحصص اللي لسه مفتوحة، والطلبة المحتاجين متابعة",
  usageHint:
    "«حلل أداء السنتر الأسبوع ده» / «قارن الغياب الشهر ده بالشهر اللي فات» / «مين أكتر مجموعة عندها غياب؟» / «إيه المجموعات اللي تحصيلها أقل من المعتاد؟» / «إيه الحصص اللي لسه ما اتقفلتش؟» / «مين من الطلاب محتاج متابعة؟» / «حصّلنا كام من أول الشهر؟»",
  input: z.object({
    period: z.enum(["day", "week", "month"]).optional().describe("الفترة (افتراضي week)"),
  }),
  risk: "LOW",
  requiredPermission: "VIEW_REPORTS",
  permissionLabel: "عرض التقارير",
  async handler(args, ctx): Promise<ToolOutput> {
    const period = args.period ?? "week";
    const today = todayStr();

    // ==== حدود الفترة الحالية والسابقة (نفس الطول دايمًا) ====
    let start: string, prevStart: string, prevEnd: string, label: string, prevLabel: string;
    if (period === "day") {
      start = today;
      prevStart = shiftDays(today, -1);
      prevEnd = prevStart;
      label = `اليوم ${today}`;
      prevLabel = `الأمس ${prevStart}`;
    } else if (period === "week") {
      start = shiftDays(today, -6);
      prevStart = shiftDays(today, -13);
      prevEnd = shiftDays(today, -7);
      label = `آخر 7 أيام (${start} → ${today})`;
      prevLabel = `الـ 7 أيام اللي فاتت (${prevStart} → ${prevEnd})`;
    } else {
      start = `${today.slice(0, 7)}-01`;
      const prevMonthLast = shiftDays(`${today.slice(0, 7)}-01`, -1); // آخر يوم في الشهر اللي فات
      const dayOfMonth = Number(today.slice(8, 10));
      prevStart = `${prevMonthLast.slice(0, 7)}-01`;
      prevEnd = dayOfMonth >= Number(prevMonthLast.slice(8, 10)) ? prevMonthLast : `${prevMonthLast.slice(0, 7)}-${String(dayOfMonth).padStart(2, "0")}`;
      label = `من أول الشهر (${start} → ${today})`;
      prevLabel = `نفس الفترة الشهر اللي فات (${prevStart} → ${prevEnd})`;
    }

    const periodWhere = { centerId: ctx.centerId, date: { gte: start, lte: today } };
    const prevWhere = { centerId: ctx.centerId, date: { gte: prevStart, lte: prevEnd } };

    // ==== الحصص ====
    const [sessions, prevSessions] = await Promise.all([
      db.sessionInstance.findMany({
        where: periodWhere,
        select: {
          id: true, date: true, status: true, price: true,
          group: { select: { name: true, subject: { select: { name: true } } } },
        },
      }),
      db.sessionInstance.findMany({ where: prevWhere, select: { id: true, status: true } }),
    ]);
    const byStatus = (rows: { status: string }[]) => ({
      open: rows.filter((s) => s.status === "OPEN").length,
      closed: rows.filter((s) => s.status === "CLOSED").length,
      cancelled: rows.filter((s) => s.status === "CANCELLED").length,
    });
    const cur = byStatus(sessions);
    const prev = byStatus(prevSessions);

    // ==== الحضور والغياب (من الحصص الفعلية) ====
    const [marks, prevMarks] = await Promise.all([
      db.attendance.findMany({
        where: { centerId: ctx.centerId, session: periodWhere },
        select: { status: true, studentId: true, session: { select: { date: true, groupId: true, group: { select: { name: true, subject: { select: { name: true } } } } } } },
      }),
      db.attendance.findMany({
        where: { centerId: ctx.centerId, session: prevWhere },
        select: { status: true },
      }),
    ]);
    const isPresent = (s: string) => s === "PRESENT" || s === "LATE";
    const attRate = pct(marks.filter((m) => isPresent(m.status)).length, marks.length);
    const prevAttRate = pct(prevMarks.filter((m) => isPresent(m.status)).length, prevMarks.length);

    // ==== أكتر المجموعات غيابًا (حد أدنى 5 تسجيلات عشان الرقم يبقى له معنى) ====
    const byGroup = new Map<string, { name: string; total: number; absent: number }>();
    for (const m of marks) {
      const gid = m.session?.groupId;
      if (!gid) continue;
      const g = byGroup.get(gid) ?? {
        name: `${m.session?.group?.subject?.name ?? "—"} — ${m.session?.group?.name ?? "—"}`,
        total: 0, absent: 0,
      };
      g.total += 1;
      if (m.status === "ABSENT") g.absent += 1;
      byGroup.set(gid, g);
    }
    const worstGroups = [...byGroup.values()]
      .filter((g) => g.total >= 5)
      .map((g) => ({ ...g, rate: pct(g.absent, g.total) ?? 0 }))
      .sort((a, b) => b.rate - a.rate || b.absent - a.absent)
      .slice(0, 3);

    // ==== التحصيل (لمعته الصلاحية المالية بس) ====
    const hasFin = ctx.user.role === "MANAGER" || ctx.user.permissions.includes("VIEW_STUDENT_FINANCIAL_STATUS");
    let collection: { cur: number; prev: number; change: number | null; mtd: number } | null = null;
    if (hasFin) {
      const [curAgg, prevAgg, mtdAgg] = await Promise.all([
        db.studentTransaction.aggregate({ where: { centerId: ctx.centerId, type: "PAYMENT", createdAt: { gte: new Date(`${start}T00:00:00`) } }, _sum: { amount: true } }),
        db.studentTransaction.aggregate({ where: { centerId: ctx.centerId, type: "PAYMENT", createdAt: { gte: new Date(`${prevStart}T00:00:00`), lte: new Date(`${prevEnd}T23:59:59`) } }, _sum: { amount: true } }),
        db.studentTransaction.aggregate({ where: { centerId: ctx.centerId, type: "PAYMENT", createdAt: { gte: new Date(`${today.slice(0, 7)}-01T00:00:00`) } }, _sum: { amount: true } }),
      ]);
      const curP = curAgg._sum.amount ?? 0;
      const prevP = prevAgg._sum.amount ?? 0;
      collection = { cur: curP, prev: prevP, change: changePct(curP, prevP), mtd: mtdAgg._sum.amount ?? 0 };
    }

    // ==== حصص لسه مفتوحة من أيام فاتت (مفروض تتقفل) ====
    const unclosed = await db.sessionInstance.findMany({
      where: { centerId: ctx.centerId, status: "OPEN", date: { lt: today } },
      select: { id: true, date: true, name: true, group: { select: { name: true, subject: { select: { name: true } } } } },
      orderBy: { date: "asc" },
      take: 6,
    });
    const unclosedCount = await db.sessionInstance.count({ where: { centerId: ctx.centerId, status: "OPEN", date: { lt: today } } });

    // ==== طلبة محتاجين متابعة (آخر 30 يوم: حضور أقل من 70% و 5 تسجيلات على الأقل) ====
    const d30 = shiftDays(today, -29);
    const followMarks = await db.attendance.findMany({
      where: { centerId: ctx.centerId, session: { centerId: ctx.centerId, date: { gte: d30, lte: today } } },
      select: { status: true, studentId: true },
    });
    const perStudent = new Map<string, { total: number; present: number }>();
    for (const m of followMarks) {
      if (!m.studentId) continue;
      const s = perStudent.get(m.studentId) ?? { total: 0, present: 0 };
      s.total += 1;
      if (isPresent(m.status)) s.present += 1;
      perStudent.set(m.studentId, s);
    }
    const followIds = [...perStudent.entries()]
      .filter(([, s]) => s.total >= 5 && s.present / s.total < 0.7)
      .sort((a, b) => a[1].present / a[1].total - b[1].present / b[1].total)
      .slice(0, 5);
    const followStudents = followIds.length
      ? await db.student.findMany({ where: { id: { in: followIds.map(([id]) => id) }, centerId: ctx.centerId }, select: { id: true, name: true, code: true } })
      : [];
    const followList = followIds.map(([id, s]) => {
      const st = followStudents.find((f) => f.id === id);
      return { id, name: st?.name ?? "طالب", code: st?.code ?? "—", rate: Math.round((s.present / s.total) * 100), total: s.total };
    });

    // ==== الملخص ====
    const bits: string[] = [
      `${label}: ${sessions.length} حصة (${cur.closed} مقفولة${cur.open ? `، ${cur.open} مفتوحة` : ""})`,
      attRate != null ? `الحضور ${attRate}%` : "مفيش تسجيلات حضور في الفترة دي",
      collection ? `التحصيل ${fmtJ(collection.cur)}${collection.change != null ? ` (${collection.change >= 0 ? "+" : ""}${collection.change}% عن «${prevLabel}»)`: ""}` : "",
    ].filter(Boolean);
    if (worstGroups.length) bits.push(`أكتر مجموعة غيابًا: ${worstGroups[0].name} (${worstGroups[0].rate}%)`);
    if (unclosedCount) bits.push(`${unclosedCount} حصة لسه مفتوحة من أيام فاتت`);
    if (followList.length) bits.push(`${followList.length} طالب محتاج متابعة`);

    const rows: { label: string; value: string; tone?: "good" | "warn" | "bad" | "info" }[] = [
      { label: "الحصص", value: `${sessions.length} (مقفولة ${cur.closed} · مفتوحة ${cur.open} · ملغاة ${cur.cancelled}) — قبل كده ${prevSessions.length}` },
      { label: "نسبة الحضور", value: attRate != null ? `${attRate}% (كانت ${prevAttRate ?? "—"}% في «${prevLabel}»)` : "مفيش داتا", tone: attRate != null && attRate < 70 ? "warn" : "good" },
    ];
    if (collection) {
      rows.push({
        label: "التحصيل",
        value: `${fmtJ(collection.cur)} — «${prevLabel}» كان ${fmtJ(collection.prev)}${collection.change != null ? ` (${collection.change >= 0 ? "+" : ""}${collection.change}%)` : " (مفيش أساس مقارنة)"}`,
        tone: collection.change != null && collection.change < -15 ? "warn" : "good",
      });
      rows.push({ label: "تحصيل من أول الشهر", value: fmtJ(collection.mtd) });
    }
    if (unclosedCount) rows.push({ label: "حصص ما اتقفلتش", value: `${unclosedCount} حصة مفتوحة من أيام فاتت`, tone: "warn" });
    if (followList.length) rows.push({ label: "محتاجين متابعة", value: followList.map((f) => `${f.name} (${f.rate}%)`).join(" · "), tone: "info" });

    return {
      summary: `${bits.join(" · ")}.`,
      data: {
        period, start, end: today, prevStart, prevEnd,
        sessions: { current: { total: sessions.length, ...cur }, previous: { total: prevSessions.length, ...prev } },
        attendance: {
          current: { total: marks.length, present: marks.filter((m) => isPresent(m.status)).length, absent: marks.filter((m) => m.status === "ABSENT").length, excused: marks.filter((m) => m.status === "EXCUSED").length, rate: attRate },
          previousRate: prevAttRate,
        },
        worstGroups,
        ...(collection ? { collection: { currentPiastres: collection.cur, previousPiastres: collection.prev, changePct: collection.change, mtdPiastres: collection.mtd } } : {}),
        unclosedSessions: unclosed.map((s) => ({ id: s.id, date: s.date, name: s.name, group: s.group ? `${s.group.subject.name} — ${s.group.name}` : null })),
        followUpStudents: followList,
      },
      cards: [
        {
          type: "report",
          title: `تحليل أداء السنتر — ${label}`,
          rows,
          actions: [
            { label: "التقارير", action: "navigate", view: "reports" },
            { label: "حصص اليوم", action: "navigate", view: "today" },
          ],
        },
        ...(worstGroups.length
          ? [{
              type: "insight" as const,
              title: `أعلى غياب: ${worstGroups[0].name} — ${worstGroups[0].rate}%`,
              subtitle: "المجموعات التالية فيها أعلى نسب غياب في الفترة (5 تسجيلات على الأقل)",
              severity: (worstGroups[0].rate >= 30 ? "WARNING" : "INFO") as "WARNING" | "INFO",
              rows: worstGroups.map((g) => ({ label: g.name, value: `${g.absent} غياب من ${g.total} — ${g.rate}%`, tone: (g.rate >= 30 ? "bad" : "info") as "bad" | "info" })),
            }]
          : []),
      ],
    };
  },
});
