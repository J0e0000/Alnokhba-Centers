import "server-only";
import { db } from "@/lib/db";
import { addDays, todayStr } from "./dates";

/* ============================================================
   SMART INSIGHTS ENGINE (spec §29-30)
   DATA → FINDING → VALIDATION → TREND → IMPACT → MATERIALITY → INSIGHT
   A finding is NOT automatically an insight — thresholds enforce
   materiality. Runs inside a throttled analysis window (6h) so it
   never slows normal operations; outside the window the app only
   reads stored results.
============================================================ */

const RUN_WINDOW_HOURS = 6;

export type InsightDraft = {
  dimension: "ACADEMIC" | "OPERATIONAL" | "FINANCIAL" | "STRATEGIC";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Can we run analysis now? (scheduled window) */
export async function shouldRun(): Promise<{ ok: boolean; lastRunAt: string | null; nextEligibleAt: string | null }> {
  const last = await db.acaInsightRun.findFirst({ where: { status: "DONE" }, orderBy: { startedAt: "desc" } });
  if (!last) return { ok: true, lastRunAt: null, nextEligibleAt: null };
  const next = new Date(last.startedAt.getTime() + RUN_WINDOW_HOURS * 3600 * 1000);
  return { ok: next <= new Date(), lastRunAt: last.startedAt.toISOString(), nextEligibleAt: next.toISOString() };
}

export async function runInsights(): Promise<{ runId: string; generated: number; stats: Record<string, number> }> {
  const run = await db.acaInsightRun.create({ data: { status: "RUNNING" } });
  const drafts: InsightDraft[] = [];
  const stats = { studentDeclines: 0, attendanceDrops: 0, groupsAtRisk: 0, workloadImbalance: 0, capacityUnderuse: 0, financialOutstanding: 0 };

  try {
    const today = todayStr();
    const since28 = addDays(today, -28);
    const since14 = addDays(today, -14);

    // ---- 1) ACADEMIC: declining exam trend across ≥3 assessments (spec §29 example) ----
    const profiles = await db.acaStudentProfile.findMany({ select: { id: true, code: true, user: { select: { name: true } } } });
    for (const p of profiles) {
      const results = await db.acaExamResult.findMany({
        where: { studentId: p.id, score: { not: null }, exam: { date: { gte: addDays(today, -90) } } },
        include: { exam: { select: { date: true, maxScore: true, subject: { select: { name: true } } } } },
        orderBy: { updatedAt: "asc" },
      });
      // per-subject chronological percentages
      const bySubject = new Map<string, { date: string; pct: number }[]>();
      for (const r of results) {
        if (r.score == null || !r.exam.maxScore) continue;
        const key = r.exam.subject.name;
        const list = bySubject.get(key) ?? [];
        list.push({ date: r.exam.date, pct: Math.round((r.score / r.exam.maxScore) * 100) });
        bySubject.set(key, list);
      }
      for (const [subject, series] of bySubject) {
        if (series.length < 3) continue;
        const last3 = series.slice(-3);
        const drop = last3[0].pct - last3[2].pct;
        const avg = Math.round(last3.reduce((s, x) => s + x.pct, 0) / 3);
        if (drop >= 15 && avg < 70) {
          stats.studentDeclines += 1;
          drafts.push({
            dimension: "ACADEMIC", severity: drop >= 30 ? "CRITICAL" : "WARNING",
            title: `${p.user.name} — تراجع في ${subject}`,
            body: `درجات ${p.user.name} في ${subject} نزلت ${drop} نقطة على مدار آخر 3 امتحانات (المتوسط الحالي ${avg}%). محتاج متابعة قريبة قبل ما المشكلة تكبر.`,
            data: { studentId: p.id, subject, series: last3, drop, avg },
          });
        }
      }
    }

    // ---- 2) ACADEMIC/OPERATIONAL: attendance drop vs previous fortnight ----
    const attRecent = await db.acaAttendance.findMany({
      where: { markedAt: { gte: new Date(since14 + "T00:00:00Z") } },
      select: { studentId: true, status: true },
    });
    const attOld = await db.acaAttendance.findMany({
      where: { markedAt: { gte: new Date(since28 + "T00:00:00Z"), lt: new Date(since14 + "T00:00:00Z") } },
      select: { studentId: true, status: true },
    });
    const rate = (rows: typeof attRecent, id: string) => {
      const mine = rows.filter((r) => r.studentId === id);
      if (mine.length < 3) return null;
      const present = mine.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
      return Math.round((present / mine.length) * 100);
    };
    const allStudentIds = new Set([...attRecent.map((r) => r.studentId), ...attOld.map((r) => r.studentId)]);
    for (const sid of allStudentIds) {
      const oldRate = rate(attOld, sid);
      const newRate = rate(attRecent, sid);
      if (oldRate == null || newRate == null) continue;
      if (oldRate - newRate >= 25 && newRate < 70) {
        const p = profiles.find((x) => x.id === sid);
        stats.attendanceDrops += 1;
        drafts.push({
          dimension: "ACADEMIC", severity: "WARNING",
          title: `${p?.user.name ?? "طالب"} — الغياب زاد فجأة`,
          body: `نسبة حضوره نزلت من ${oldRate}% لـ ${newRate}% في آخر أسبوعين. الغياب المتكرر بيأثر على التحصيل مباشرة.`,
          data: { studentId: sid, oldRate, newRate },
        });
      }
    }

    // ---- 3) OPERATIONAL: groups at risk (avg attendance < 60% over 2 weeks) ----
    const groups = await db.acaGroup.findMany({ where: { isActive: true }, select: { id: true, name: true } });
    for (const g of groups) {
      const sess = await db.acaSession.findMany({ where: { groupId: g.id, date: { gte: since14 }, status: "COMPLETED" }, select: { id: true } });
      if (sess.length < 2) continue;
      const marks = await db.acaAttendance.findMany({ where: { sessionId: { in: sess.map((s) => s.id) } }, select: { status: true } });
      if (marks.length < 6) continue;
      const present = marks.filter((m) => m.status === "PRESENT" || m.status === "LATE").length;
      const pct = Math.round((present / marks.length) * 100);
      if (pct < 60) {
        stats.groupsAtRisk += 1;
        drafts.push({
          dimension: "OPERATIONAL", severity: "WARNING",
          title: `مجموعة ${g.name} — حضور منخفض`,
          body: `متوسط الحضور في آخر أسبوعين ${pct}% بس. راجع مواعيد المجموعة وطريقة المتابعة مع الطلاب.`,
          data: { groupId: g.id, pct },
        });
      }
      // ---- 5) STRATEGIC: capacity underuse ----
      const enrolled = await db.acaEnrollment.count({ where: { groupId: g.id, status: "ACTIVE" } });
      const grp = await db.acaGroup.findUnique({ where: { id: g.id }, select: { capacity: true } });
      if (grp && grp.capacity >= 10 && enrolled < grp.capacity * 0.4) {
        stats.capacityUnderuse += 1;
        drafts.push({
          dimension: "STRATEGIC", severity: "INFO",
          title: `مجموعة ${g.name} — طاقة مش مستغلة`,
          body: `فيها ${enrolled} طالب من ${grp.capacity}. في مساحة تتطور بإضافة طلاب أو دمج.`,
          data: { groupId: g.id, enrolled, capacity: grp.capacity },
        });
      }
    }

    // ---- 4) OPERATIONAL: teacher workload imbalance ----
    const teachers = await db.user.findMany({
      where: { role: "TEACHER", scope: "academia", isActive: true },
      select: { id: true, name: true, acaTeacherGroups: { where: { isActive: true }, select: { _count: { select: { schedules: true } } } } },
    });
    const loads = teachers.map((t) => ({ name: t.name, weekly: t.acaTeacherGroups.reduce((s, g) => s + g._count.schedules, 0) }));
    if (loads.length >= 2) {
      const max = loads.reduce((a, b) => (b.weekly > a.weekly ? b : a));
      const min = loads.reduce((a, b) => (b.weekly < a.weekly ? b : a));
      if (max.weekly >= 6 && max.weekly - min.weekly >= 4) {
        stats.workloadImbalance += 1;
        drafts.push({
          dimension: "OPERATIONAL", severity: "INFO",
          title: "توزيع الحصص مش متوازن",
          body: `${max.name} عنده ${max.weekly} حصة أسبوعيًا بينما ${min.name} عنده ${min.weekly} بس. إعادة التوزيع هتخفف الضغط.`,
          data: { loads },
        });
      }
    }

    // ---- 6) FINANCIAL: unpaid enrollment prices (perm-gated at display; generated only if any group has pricing) ----
    const priced = await db.acaGroup.count({ where: { pricePerSession: { not: null } } });
    if (priced > 0) {
      // informational hook: financial dimension exists; deeper ledger is a future extension (spec §25)
      stats.financialOutstanding = priced;
    }

    // ---- persist validated insights only ----
    if (drafts.length) {
      await db.acaInsight.createMany({ data: drafts.map((d) => ({ dimension: d.dimension, severity: d.severity, title: d.title, body: d.body, data: d.data ? JSON.stringify(d.data) : null, runId: run.id })) });
    }
    await db.acaInsightRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: new Date(), stats: JSON.stringify({ ...stats, generated: drafts.length }) } });
    return { runId: run.id, generated: drafts.length, stats };
  } catch (e) {
    await db.acaInsightRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), stats: JSON.stringify({ error: String(e) }) } }).catch(() => {});
    throw e;
  }
}
