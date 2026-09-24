import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { todayStr, cairoDateStr, cairoDayBounds } from "@/lib/normalize";

export const dynamic = "force-dynamic";

type Col = { key: string; label: string; type?: "text" | "money" | "number" | "date" };
type Row = Record<string, string | number | null>;

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** حدود أيام القاهرة بالظبط — تقارير "النهاردة" بتجيب معاملات بعد نص الليل في يومها الصح */
function cairoRange(from: string, to: string) {
  return {
    gte: cairoDayBounds(from).start,
    lte: cairoDayBounds(to).end,
  };
}
function inCairoRange(d: Date, from: string, to: string): boolean {
  const c = cairoDateStr(d);
  return c >= from && c <= to;
}

/** GET /api/reports?type=&from=&to=&groupId=&subjectId=&teacherId=&studentId=&export=csv */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const centerId = user.centerId;
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "daily";
  const today = todayStr();
  const from = url.searchParams.get("from") || today.slice(0, 8) + "01";
  const to = url.searchParams.get("to") || today;
  const groupId = url.searchParams.get("groupId") || "";
  const subjectId = url.searchParams.get("subjectId") || "";
  const teacherId = url.searchParams.get("teacherId") || "";
  const studentId = url.searchParams.get("studentId") || "";
  const isExport = url.searchParams.get("export") === "csv";

  let title = "";
  let columns: Col[] = [];
  let rows: Row[] = [];
  let totals: Record<string, number> = {};
  let statCards: { label: string; value: number; kind: "money" | "number" }[] = [];

  // Common session filter
  const sessionWhere = {
    centerId,
    status: "CLOSED" as const,
    date: { gte: from, lte: to },
    ...(groupId ? { groupId } : {}),
    ...(subjectId ? { group: { subjectId } } : {}),
    ...(teacherId ? { group: { teacherId } } : {}),
  };

  switch (type) {
    case "daily":
    case "weekly":
    case "monthly": {
      title = type === "daily" ? "التقرير اليومي" : type === "weekly" ? "التقرير الأسبوعي" : "التقرير الشهري";
      const [sessions, payments, expenses, payouts] = await Promise.all([
        db.sessionInstance.findMany({ where: sessionWhere, select: { date: true, totalRevenue: true, teacherShare: true, centerShare: true, presentCount: true } }),
        db.studentTransaction.findMany({ where: { centerId, type: "PAYMENT", createdAt: cairoRange(from, to) }, select: { amount: true, createdAt: true } }),
        db.expense.findMany({ where: { centerId, date: { gte: from, lte: to } }, select: { amount: true, date: true } }),
        db.teacherSettlement.findMany({ where: { centerId, type: "PAID", date: { gte: from, lte: to } }, select: { amount: true, date: true } }),
      ]);
      const byDate = new Map<string, { revenue: number; teacher: number; center: number; collected: number; expenses: number; payouts: number; present: number }>();
      for (const s of sessions) {
        const d = byDate.get(s.date) ?? { revenue: 0, teacher: 0, center: 0, collected: 0, expenses: 0, payouts: 0, present: 0 };
        d.revenue += s.totalRevenue ?? 0; d.teacher += s.teacherShare ?? 0; d.center += s.centerShare ?? 0; d.present += s.presentCount ?? 0;
        byDate.set(s.date, d);
      }
      for (const p of payments) {
        if (!inCairoRange(p.createdAt, from, to)) continue;
        const d = cairoDateStr(p.createdAt);
        const e = byDate.get(d) ?? { revenue: 0, teacher: 0, center: 0, collected: 0, expenses: 0, payouts: 0, present: 0 };
        e.collected += p.amount; byDate.set(d, e);
      }
      for (const e of expenses) {
        const d = byDate.get(e.date) ?? { revenue: 0, teacher: 0, center: 0, collected: 0, expenses: 0, payouts: 0, present: 0 };
        d.expenses += e.amount; byDate.set(e.date, d);
      }
      for (const p of payouts) {
        const d = byDate.get(p.date) ?? { revenue: 0, teacher: 0, center: 0, collected: 0, expenses: 0, payouts: 0, present: 0 };
        d.payouts += Math.abs(p.amount); byDate.set(p.date, d);
      }
      columns = [
        { key: "date", label: "اليوم", type: "date" },
        { key: "present", label: "الحضور", type: "number" },
        { key: "revenue", label: "إيراد الحصص", type: "money" },
        { key: "teacher", label: "نصيب المدرسين", type: "money" },
        { key: "center", label: "نصيب السنتر", type: "money" },
        { key: "collected", label: "المحصّل", type: "money" },
        { key: "expenses", label: "المصروفات", type: "money" },
        { key: "payouts", label: "صرف مدرسين", type: "money" },
        { key: "net", label: "صافي السنتر", type: "money" },
      ];
      rows = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, d]) => ({
        date, present: d.present, revenue: d.revenue, teacher: d.teacher, center: d.center,
        collected: d.collected, expenses: d.expenses, payouts: d.payouts, net: d.center - d.expenses,
      }));
      totals = rows.reduce<Record<string, number>>((acc, r) => ({
        present: (acc.present ?? 0) + Number(r.present), revenue: (acc.revenue ?? 0) + Number(r.revenue),
        teacher: (acc.teacher ?? 0) + Number(r.teacher), center: (acc.center ?? 0) + Number(r.center),
        collected: (acc.collected ?? 0) + Number(r.collected), expenses: (acc.expenses ?? 0) + Number(r.expenses),
        payouts: (acc.payouts ?? 0) + Number(r.payouts), net: (acc.net ?? 0) + Number(r.net),
      }), {} as Record<string, number>);
      statCards = [
        { label: "إجمالي الإيراد", value: totals.revenue ?? 0, kind: "money" },
        { label: "نصيب السنتر", value: totals.center ?? 0, kind: "money" },
        { label: "المحصّل", value: totals.collected ?? 0, kind: "money" },
        { label: "المصروفات", value: totals.expenses ?? 0, kind: "money" },
        { label: "صافي السنتر", value: totals.net ?? 0, kind: "money" },
      ];
      break;
    }

    case "revenue-subject":
    case "revenue-group": {
      const bySubject = type === "revenue-subject";
      title = bySubject ? "الإيراد حسب المادة" : "الإيراد حسب المجموعة";
      const sessions = await db.sessionInstance.findMany({
        where: sessionWhere,
        include: { group: { include: { subject: true, grade: true } } },
      });
      const map = new Map<string, { label: string; extra: string; revenue: number; teacher: number; center: number; count: number; present: number }>();
      for (const s of sessions) {
        const key = bySubject ? s.group.subject.id : s.group.id;
        const label = bySubject ? s.group.subject.name : `${s.group.subject.name} — ${s.group.grade.name} ${s.group.name}`;
        const e = map.get(key) ?? { label, extra: bySubject ? "" : s.group.grade.name, revenue: 0, teacher: 0, center: 0, count: 0, present: 0 };
        e.revenue += s.totalRevenue ?? 0; e.teacher += s.teacherShare ?? 0; e.center += s.centerShare ?? 0;
        e.count += 1; e.present += s.presentCount ?? 0;
        map.set(key, e);
      }
      columns = [
        { key: "label", label: bySubject ? "المادة" : "المجموعة" },
        ...(bySubject ? [] : [{ key: "extra", label: "المرحلة" } as Col]),
        { key: "count", label: "عدد الحصص", type: "number" },
        { key: "present", label: "الحضور", type: "number" },
        { key: "revenue", label: "الإيراد", type: "money" },
        { key: "teacher", label: "نصيب المدرسين", type: "money" },
        { key: "center", label: "نصيب السنتر", type: "money" },
      ];
      rows = [...map.values()].sort((a, b) => b.revenue - a.revenue).map((e) => ({ ...e }));
      totals = { revenue: 0, teacher: 0, center: 0 };
      for (const r of rows) { totals.revenue += Number(r.revenue); totals.teacher += Number(r.teacher); totals.center += Number(r.center); }
      statCards = [
        { label: "إجمالي الإيراد", value: totals.revenue ?? 0, kind: "money" },
        { label: "نصيب السنتر", value: totals.center ?? 0, kind: "money" },
      ];
      break;
    }

    case "revenue-teacher": {
      title = "الإيراد حسب المدرس";
      const sessions = await db.sessionInstance.findMany({
        where: { ...sessionWhere, group: { ...(sessionWhere as { group?: object }).group, teacherId: teacherId || undefined } },
        include: { group: { include: { teacher: true, subject: true } } },
      });
      const map = new Map<string, { label: string; revenue: number; teacher: number; center: number; count: number; present: number }>();
      for (const s of sessions) {
        const t = s.group.teacher?.name ?? "بدون مدرس";
        const e = map.get(t) ?? { label: t, revenue: 0, teacher: 0, center: 0, count: 0, present: 0 };
        e.revenue += s.totalRevenue ?? 0; e.teacher += s.teacherShare ?? 0; e.center += s.centerShare ?? 0;
        e.count += 1; e.present += s.presentCount ?? 0;
        map.set(t, e);
      }
      columns = [
        { key: "label", label: "المدرس" },
        { key: "count", label: "عدد الحصص", type: "number" },
        { key: "present", label: "الحضور", type: "number" },
        { key: "revenue", label: "إيراد الحصص", type: "money" },
        { key: "teacher", label: "نصيب المدرس", type: "money" },
        { key: "center", label: "نصيب السنتر", type: "money" },
      ];
      rows = [...map.values()].sort((a, b) => b.revenue - a.revenue);
      totals = rows.reduce<Record<string, number>>((acc, r) => ({ revenue: (acc.revenue ?? 0) + Number(r.revenue), teacher: (acc.teacher ?? 0) + Number(r.teacher), center: (acc.center ?? 0) + Number(r.center) }), {} as Record<string, number>);
      statCards = [{ label: "إجمالي الإيراد", value: totals.revenue ?? 0, kind: "money" }, { label: "مستحقات المدرسين", value: totals.teacher ?? 0, kind: "money" }];
      break;
    }

    case "student-balances":
    case "student-credits": {
      const owing = type === "student-balances";
      title = owing ? "مستحقات الطلاب (اللي عليهم)" : "أرصدة الطلاب (اللي لهم)";
      const students = await db.student.findMany({
        where: { centerId, status: { in: ["ACTIVE", "PAUSED"] }, ...(studentId ? { id: studentId } : {}) },
        include: { grade: true, registrations: { where: { status: "ACTIVE" }, include: { group: { include: { subject: true } } } } },
      });
      const balances = await db.studentTransaction.groupBy({ by: ["studentId"], _sum: { amount: true }, where: { centerId } });
      const bmap = new Map(balances.map((b) => [b.studentId, b._sum.amount ?? 0]));
      rows = students
        .map((s) => ({ id: s.id, name: s.name, code: s.code, phone: s.phone, grade: s.grade?.name ?? "", subjects: s.registrations.map((r) => r.group.subject.name).join("، "), balance: bmap.get(s.id) ?? 0 }))
        .filter((s) => (owing ? s.balance < 0 : s.balance > 0))
        .sort((a, b) => Math.abs(a.balance) - Math.abs(b.balance)) as Row[];
      columns = [
        { key: "code", label: "الكود" },
        { key: "name", label: "الطالب" },
        { key: "grade", label: "المرحلة" },
        { key: "subjects", label: "المواد" },
        { key: "phone", label: "الموبايل" },
        { key: "balance", label: owing ? "اللي عليه" : "اللي له", type: "money" },
      ];
      totals = { balance: rows.reduce((a, r) => a + Math.abs(Number(r.balance)), 0) };
      statCards = [
        { label: owing ? "إجمالي المستحق على الطلاب" : "إجمالي أرصدة الطلاب", value: totals.balance ?? 0, kind: "money" },
        { label: "عدد الطلاب", value: rows.length, kind: "number" },
      ];
      break;
    }

    case "teacher-settlements": {
      title = "مستحقات المدرسين";
      const teachers = await db.teacher.findMany({ where: { centerId, ...(teacherId ? { id: teacherId } : {}) } });
      const all = await db.teacherSettlement.findMany({
        where: { centerId, date: { gte: from, lte: to } },
        orderBy: { date: "desc" },
      });
      rows = teachers.map((t) => {
        const mine = all.filter((x) => x.teacherId === t.id);
        const earned = mine.filter((x) => x.type === "EARNED").reduce((a, x) => a + x.amount, 0);
        const paid = Math.abs(mine.filter((x) => x.type === "PAID").reduce((a, x) => a + x.amount, 0));
        return { name: t.name, earned, paid, payable: earned - paid, sessions: mine.filter((x) => x.type === "EARNED").length };
      }).filter((r) => r.earned > 0 || r.paid > 0) as Row[];
      columns = [
        { key: "name", label: "المدرس" },
        { key: "sessions", label: "عدد الحصص", type: "number" },
        { key: "earned", label: "المستحق", type: "money" },
        { key: "paid", label: "المصروف له", type: "money" },
        { key: "payable", label: "الباقي له", type: "money" },
      ];
      totals = rows.reduce<Record<string, number>>((acc, r) => ({ earned: (acc.earned ?? 0) + Number(r.earned), paid: (acc.paid ?? 0) + Number(r.paid), payable: (acc.payable ?? 0) + Number(r.payable) }), {} as Record<string, number>);
      statCards = [
        { label: "إجمالي المستحق", value: totals.earned ?? 0, kind: "money" },
        { label: "المصروف", value: totals.paid ?? 0, kind: "money" },
        { label: "الباقي", value: totals.payable ?? 0, kind: "money" },
      ];
      break;
    }

    case "session-revenue": {
      title = "إيراد الحصص";
      const sessions = await db.sessionInstance.findMany({
        where: sessionWhere,
        include: { group: { include: { subject: true, grade: true, teacher: true } } },
        orderBy: [{ date: "desc" }, { startTime: "desc" }],
        take: 300,
      });
      const payAgg = await db.studentTransaction.groupBy({ by: ["sessionId"], _sum: { amount: true }, where: { centerId, type: "PAYMENT", sessionId: { not: null } } });
      const pmap = new Map(payAgg.map((p) => [p.sessionId, p._sum.amount ?? 0]));
      rows = sessions.map((s) => ({
        date: s.date, subject: s.group.subject.name, group: `${s.group.grade.name} ${s.group.name}`,
        teacher: s.group.teacher?.name ?? "—", present: s.presentCount ?? 0,
        revenue: s.totalRevenue ?? 0, teacherShare: s.teacherShare ?? 0, centerShare: s.centerShare ?? 0,
        collected: pmap.get(s.id) ?? 0, outstanding: (s.totalRevenue ?? 0) - (pmap.get(s.id) ?? 0),
      }));
      columns = [
        { key: "date", label: "اليوم", type: "date" },
        { key: "subject", label: "المادة" },
        { key: "group", label: "المجموعة" },
        { key: "teacher", label: "المدرس" },
        { key: "present", label: "الحضور", type: "number" },
        { key: "revenue", label: "الإيراد", type: "money" },
        { key: "collected", label: "المحصّل", type: "money" },
        { key: "outstanding", label: "المتأخر", type: "money" },
        { key: "teacherShare", label: "نصيب المدرس", type: "money" },
        { key: "centerShare", label: "نصيب السنتر", type: "money" },
      ];
      totals = rows.reduce<Record<string, number>>((acc, r) => ({
        revenue: (acc.revenue ?? 0) + Number(r.revenue), collected: (acc.collected ?? 0) + Number(r.collected),
        outstanding: (acc.outstanding ?? 0) + Number(r.outstanding), teacherShare: (acc.teacherShare ?? 0) + Number(r.teacherShare),
        centerShare: (acc.centerShare ?? 0) + Number(r.centerShare), present: (acc.present ?? 0) + Number(r.present),
      }), {} as Record<string, number>);
      statCards = [
        { label: "إجمالي الإيراد", value: totals.revenue ?? 0, kind: "money" },
        { label: "المحصّل", value: totals.collected ?? 0, kind: "money" },
        { label: "المتأخر", value: totals.outstanding ?? 0, kind: "money" },
      ];
      break;
    }

    case "expenses": {
      title = "المصروفات";
      const expenses = await db.expense.findMany({
        where: { centerId, date: { gte: from, lte: to } },
        orderBy: { date: "desc" },
      });
      const CAT: Record<string, string> = { RENT: "إيجار", ELECTRICITY: "كهرباء", SALARIES: "مرتبات", MAINTENANCE: "صيانة", SUPPLIES: "مستلزمات", OTHER: "أخرى" };
      rows = expenses.map((e) => ({ date: e.date, category: CAT[e.category] ?? e.category, note: e.note ?? "", amount: e.amount }));
      columns = [
        { key: "date", label: "اليوم", type: "date" },
        { key: "category", label: "البند" },
        { key: "note", label: "ملاحظة" },
        { key: "amount", label: "المبلغ", type: "money" },
      ];
      totals = { amount: rows.reduce((a, r) => a + Number(r.amount), 0) };
      statCards = [{ label: "إجمالي المصروفات", value: totals.amount ?? 0, kind: "money" }, { label: "عدد العمليات", value: rows.length, kind: "number" }];
      break;
    }

    case "cash-movement": {
      title = "حركة الصندوق";
      const [payments, refunds, expenses, payouts] = await Promise.all([
        db.studentTransaction.findMany({ where: { centerId, type: "PAYMENT", createdAt: cairoRange(from, to) } }),
        db.studentTransaction.findMany({ where: { centerId, type: "REFUND", createdAt: cairoRange(from, to) } }),
        db.expense.findMany({ where: { centerId, date: { gte: from, lte: to } } }),
        db.teacherSettlement.findMany({ where: { centerId, type: "PAID", date: { gte: from, lte: to } } }),
      ]);
      const events: { date: string; kind: string; note: string; amount: number }[] = [];
      for (const p of payments) if (inCairoRange(p.createdAt, from, to)) events.push({ date: cairoDateStr(p.createdAt), kind: "تحصيل", note: p.reason ?? "دفع طالب", amount: p.amount });
      for (const r of refunds) if (inCairoRange(r.createdAt, from, to)) events.push({ date: cairoDateStr(r.createdAt), kind: "استرداد", note: r.reason ?? "استرداد", amount: r.amount });
      for (const e of expenses) events.push({ date: e.date, kind: "مصروف", note: e.note ?? "", amount: -e.amount });
      for (const p of payouts) events.push({ date: p.date, kind: "صرف مدرس", note: p.note ?? "", amount: p.amount });
      events.sort((a, b) => (a.date < b.date ? 1 : -1));
      rows = events as Row[];
      columns = [
        { key: "date", label: "اليوم", type: "date" },
        { key: "kind", label: "النوع" },
        { key: "note", label: "تفاصيل" },
        { key: "amount", label: "المبلغ (+ داخل / − خارج)", type: "money" },
      ];
      totals = { amount: events.reduce((a, e) => a + e.amount, 0) };
      statCards = [
        { label: "دخل الصندوق", value: events.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0), kind: "money" },
        { label: "خرج من الصندوق", value: Math.abs(events.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0)), kind: "money" },
        { label: "الصافي", value: totals.amount ?? 0, kind: "money" },
      ];
      break;
    }

    case "payment-history": {
      title = "سجل الدفع";
      const txns = (
        await db.studentTransaction.findMany({
          where: {
            centerId, type: { in: ["PAYMENT", "REFUND"] },
            createdAt: cairoRange(from, to),
            ...(studentId ? { studentId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 500,
          include: { student: { select: { name: true, code: true } } },
        })
      ).filter((t) => inCairoRange(t.createdAt, from, to));
      // sessionId is a plain scalar — resolve session subjects in a second query
      const sessionIds = [...new Set(txns.map((t) => t.sessionId).filter(Boolean))] as string[];
      const sessionMap = new Map<string, string>();
      if (sessionIds.length) {
        const sessions = await db.sessionInstance.findMany({
          where: { id: { in: sessionIds }, centerId },
          include: { group: { include: { subject: { select: { name: true } } } } },
        });
        for (const s of sessions) sessionMap.set(s.id, s.group.subject.name);
      }
      const METHOD: Record<string, string> = { CASH: "كاش", VODAFONE: "فودافون كاش", INSTAPAY: "انستاباي" };
      rows = txns.map((t) => ({
        date: cairoDateStr(t.createdAt),
        student: t.student?.name ?? "", code: t.student?.code ?? "",
        type: t.type === "PAYMENT" ? "دفع" : "استرداد",
        method: METHOD[t.method ?? "CASH"] ?? t.method ?? "",
        subject: (t.sessionId ? sessionMap.get(t.sessionId) : undefined) ?? "—",
        amount: t.amount, note: t.reason ?? "",
      }));
      columns = [
        { key: "date", label: "اليوم", type: "date" },
        { key: "student", label: "الطالب" },
        { key: "code", label: "الكود" },
        { key: "type", label: "النوع" },
        { key: "method", label: "طريقة الدفع" },
        { key: "subject", label: "الحصة" },
        { key: "amount", label: "المبلغ", type: "money" },
        { key: "note", label: "ملاحظة" },
      ];
      totals = {
        amount: rows.filter((r) => r.type === "دفع").reduce((a, r) => a + Number(r.amount), 0),
        refunds: Math.abs(rows.filter((r) => r.type === "استرداد").reduce((a, r) => a + Number(r.amount), 0)),
      };
      statCards = [
        { label: "إجمالي المحصّل", value: totals.amount ?? 0, kind: "money" },
        { label: "استردادات", value: totals.refunds ?? 0, kind: "money" },
        { label: "عدد العمليات", value: rows.length, kind: "number" },
      ];
      break;
    }

    case "net-result": {
      title = "الصافي (أرباح السنتر)";
      const [sessions, expenses] = await Promise.all([
        db.sessionInstance.findMany({ where: sessionWhere, select: { totalRevenue: true, teacherShare: true, centerShare: true } }),
        db.expense.aggregate({ _sum: { amount: true }, where: { centerId, date: { gte: from, lte: to } } }),
      ]);
      const revenue = sessions.reduce((a, s) => a + (s.totalRevenue ?? 0), 0);
      const teacher = sessions.reduce((a, s) => a + (s.teacherShare ?? 0), 0);
      const center = sessions.reduce((a, s) => a + (s.centerShare ?? 0), 0);
      const exp = expenses._sum.amount ?? 0;
      rows = [
        { item: "إجمالي إيراد الحصص", value: revenue },
        { item: "نصيب المدرسين (مصروف)", value: -teacher },
        { item: "نصيب السنتر من الحصص", value: center },
        { item: "المصروفات التشغيلية", value: -exp },
        { item: "صافي السنتر", value: center - exp },
      ];
      columns = [{ key: "item", label: "البند" }, { key: "value", label: "القيمة", type: "money" }];
      statCards = [
        { label: "الإيراد", value: revenue, kind: "money" },
        { label: "نصيب السنتر", value: center, kind: "money" },
        { label: "المصروفات", value: exp, kind: "money" },
        { label: "الصافي", value: center - exp, kind: "money" },
      ];
      break;
    }

    case "center-revenue":
    default: {
      title = "إيراد السنتر";
      const sessions = await db.sessionInstance.findMany({ where: sessionWhere, orderBy: { date: "asc" } });
      const byMonth = new Map<string, { revenue: number; teacher: number; center: number; count: number }>();
      for (const s of sessions) {
        const m = s.date.slice(0, 7);
        const e = byMonth.get(m) ?? { revenue: 0, teacher: 0, center: 0, count: 0 };
        e.revenue += s.totalRevenue ?? 0; e.teacher += s.teacherShare ?? 0; e.center += s.centerShare ?? 0; e.count += 1;
        byMonth.set(m, e);
      }
      columns = [
        { key: "label", label: "الشهر" },
        { key: "count", label: "عدد الحصص", type: "number" },
        { key: "revenue", label: "الإيراد", type: "money" },
        { key: "teacher", label: "نصيب المدرسين", type: "money" },
        { key: "center", label: "نصيب السنتر", type: "money" },
      ];
      const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
      rows = [...byMonth.entries()].map(([m, e]) => ({ label: `${MONTHS[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}`, ...e })).reverse();
      totals = rows.reduce<Record<string, number>>((acc, r) => ({ revenue: (acc.revenue ?? 0) + Number(r.revenue), teacher: (acc.teacher ?? 0) + Number(r.teacher), center: (acc.center ?? 0) + Number(r.center) }), {} as Record<string, number>);
      statCards = [
        { label: "إجمالي الإيراد", value: totals.revenue ?? 0, kind: "money" },
        { label: "نصيب السنتر", value: totals.center ?? 0, kind: "money" },
        { label: "عدد الحصص", value: sessions.length, kind: "number" },
      ];
      break;
    }
  }

  if (isExport) {
    // CSV with BOM so Excel reads Arabic correctly
    const head = columns.map((c) => csvEscape(c.label)).join(",");
    const body = rows.map((r) => columns.map((c) => csvEscape(c.type === "money" ? (Number(r[c.key]) / 100).toFixed(2) : r[c.key])).join(",")).join("\n");
    const totalsLine = columns.filter((c) => totals[c.key] !== undefined).map((c) => csvEscape(c.label === c.label ? `إجمالي ${c.label}` : c.label)).join(",");
    const totalsVals = columns.filter((c) => totals[c.key] !== undefined).map((c) => (totals[c.key] / 100).toFixed(2)).join(",");
    const csv = `\uFEFF${head}\n${body}\n${totalsLine}\n${totalsVals}`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nokhba-${type}-${from}-to-${to}.csv"`,
      },
    });
  }

  return ok({ type, title, from, to, columns, rows, totals, statCards, generatedAt: new Date().toISOString(), centerName: user.center!.name });
});
