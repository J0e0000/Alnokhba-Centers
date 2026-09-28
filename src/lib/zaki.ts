import "server-only";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   ZAKI — المساعد الذكي للنخبة (spec §4)
   ⚠️ زكي مش شات بوت ومش AI: مفيش LLM ولا API خارجي ولا مفاتيح.
   كل إجابة نتايج قواعد حتمية (deterministic) على داتا السنتر الحقيقية.
   الهدف الأساسي: مش بس "في مشكلة" — فين بالظبط؟ (مجموعة/مادة/مدرس/طالب)
   + إيه اللي حصل + ليه النظام علّم عليها + اقتراح عملي.
============================================================ */

export type ZakiFinding = {
  id: string;
  dimension: "ACADEMIC" | "OPERATIONAL" | "FINANCIAL";
  severity: "INFO" | "WARNING" | "CRITICAL";
  what: string;   // إيه اللي حصل
  where: string;  // فين بالظبط
  why: string;    // ليه النظام علّم عليها
  action: string; // اقتراح عملي
  go?: { view: "students" | "schedule" | "payments" | "reports" | "approvals"; studentId?: string };
  data?: Record<string, unknown>;
};

const today = () => todayStr();
function dstr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number): string {
  return dstr(new Date(Date.now() - n * 86400000));
}

/* ------------------------------------------------------------
   قواعد التحليل — كل قاعدة بترجع 0..n ملاحظات
------------------------------------------------------------ */

// 1) تدنّي حضور مجموعة مقارنة بالفترة اللي قبلها
async function ruleGroupAttendanceDrop(centerId: string, out: ZakiFinding[]) {
  const recent = await db.sessionInstance.findMany({
    where: { centerId, date: { gte: daysAgo(14), lte: today() }, status: { not: "CANCELLED" } },
    select: { id: true, groupId: true, group: { select: { name: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });
  if (!recent.length) return;
  const older = await db.sessionInstance.findMany({
    where: { centerId, date: { gte: daysAgo(28), lt: daysAgo(14) }, status: { not: "CANCELLED" } },
    select: { id: true, groupId: true },
  });
  const byGroup = (rows: typeof recent) => {
    const m = new Map<string, { sessions: string[]; name: string; subject: string; teacher: string }>();
    for (const s of rows) {
      if (!m.has(s.groupId)) m.set(s.groupId, { sessions: [], name: s.group.name, subject: s.group.subject.name, teacher: s.group.teacher?.name ?? "—" });
      m.get(s.groupId)!.sessions.push(s.id);
    }
    return m;
  };
  const recentM = byGroup(recent);
  const olderM = byGroup(older as typeof recent);
  for (const [groupId, g] of recentM) {
    const ids = g.sessions;
    if (ids.length < 2) continue;
    const marks = await db.attendance.findMany({ where: { sessionId: { in: ids } }, select: { status: true } });
    if (marks.length < 6) continue;
    const rateNow = Math.round((marks.filter((m) => m.status !== "EXCUSED").length / marks.length) * 100);
    const old = olderM.get(groupId);
    if (!old || old.sessions.length < 2) continue;
    const oldMarks = await db.attendance.findMany({ where: { sessionId: { in: old.sessions } }, select: { status: true } });
    if (oldMarks.length < 6) continue;
    const rateOld = Math.round((oldMarks.filter((m) => m.status !== "EXCUSED").length / oldMarks.length) * 100);
    if (rateOld - rateNow >= 15 && rateNow < 80) {
      out.push({
        id: "group_att_drop",
        dimension: "OPERATIONAL",
        severity: rateNow < 60 ? "CRITICAL" : "WARNING",
        what: `حضور مجموعة ${g.subject} — ${g.name} نزل`,
        where: `المجموعة ${g.name} (${g.subject}) — المدرس ${g.teacher}`,
        why: `الحضور نزل من ${rateOld}% لـ ${rateNow}% في آخر أسبوعين مقارنة بالفترة اللي قبلها`,
        action: `كلم المدرس ${g.teacher} وشوف المواعيد مناسبة ولا لأ، وابعت تنبيه رصيد/غياب لأولياء أمور المجموعة`,
        go: { view: "schedule" },
        data: { groupId, rateOld, rateNow },
      });
    }
  }
}

// 2) طلاب غيابهم اتكرر كتير آخر 30 يوم
async function ruleRepeatedAbsences(centerId: string, out: ZakiFinding[]) {
  const since = new Date(daysAgo(30) + "T00:00:00");
  const sessions = await db.sessionInstance.findMany({
    where: { centerId, date: { gte: daysAgo(30) }, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  if (!sessions.length) return;
  const att = await db.attendance.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) }, status: "PRESENT", createdAt: { gte: since } },
    select: { studentId: true },
  });
  const allRegs = await db.studentGroup.findMany({
    where: { status: "ACTIVE", group: { centerId, isActive: true } },
    select: { studentId: true },
  });
  const expected = new Set(allRegs.map((r) => r.studentId));
  // اللي مسجلين ومحضروش ولا مرة في آخر 30 يوم = غياب متكرر فعلًا
  const attended = new Set(att.map((a) => a.studentId));
  const missing = [...expected].filter((id) => !attended.has(id));
  if (missing.length < 3) return;
  const studs = await db.student.findMany({
    where: { id: { in: missing.slice(0, 60) }, centerId, status: "ACTIVE" },
    select: { id: true, name: true, code: true },
    take: 12,
  });
  if (studs.length < 3) return;
  out.push({
    id: "repeated_absence",
    dimension: "ACADEMIC",
    severity: studs.length >= 8 ? "CRITICAL" : "WARNING",
    what: `${missing.length} طالب مسجل ومحضروش ولا مرة آخر 30 يوم`,
    where: `في مجموعات السنتر — أمثلة: ${studs.slice(0, 3).map((s) => s.name).join("، ")}`,
    why: "غياب متواصل بدون حضور واحد يعني الطالب عمليًا خارج التدريب — والفلوس بتتحاسب على حصص مش بيحضرها",
    action: "افتح قائمة الطلاب، كلم أولياء أمورهم (زرار واتساب/اتصال جاهز جنب كل طالب)، وقرر: تجميد أو استمرار",
    go: { view: "students" },
    data: { count: missing.length, students: studs.map((s) => ({ id: s.id, name: s.name, code: s.code })) },
  });
}

// 3) تحصيل أقل من المعدل الطبيعي
async function ruleCollectionAnomaly(centerId: string, out: ZakiFinding[]) {
  const week = await db.studentTransaction.aggregate({
    where: { centerId, type: "PAYMENT", createdAt: { gte: new Date(daysAgo(7) + "T00:00:00") } },
    _sum: { amount: true },
  });
  const month = await db.studentTransaction.aggregate({
    where: { centerId, type: "PAYMENT", createdAt: { gte: new Date(daysAgo(35) + "T00:00:00"), lt: new Date(daysAgo(7) + "T00:00:00") } },
    _sum: { amount: true },
  });
  const cur = week._sum.amount ?? 0;
  const base = (month._sum.amount ?? 0) / 4;
  if (base < 100_000) return; // مفيش حجم كافي للمقارنة (أقل من 1000ج/أسبوع)
  if (cur < base * 0.6) {
    out.push({
      id: "collection_anomaly",
      dimension: "FINANCIAL",
      severity: cur < base * 0.4 ? "CRITICAL" : "WARNING",
      what: "التحصيل الأسبوعي أقل بكثير من المعدل",
      where: "خزينة السنتر — مدفوعات الطلاب",
      why: `آخر 7 أيام: ${Math.round(cur / 100)}ج مقابل متوسط ${Math.round(base / 100)}ج للأسبوع في آخر شهر (${Math.round((cur / base) * 100)}% من المعدل)`,
      action: "شغّل حملة تذكير رصيد من الرسائل، وراجع الطلاب المتأخرين من تقرير مستحقات الطلاب",
      go: { view: "payments" },
      data: { cur, base: Math.round(base) },
    });
  }
}

// 4) حصص مفتوحة ومتسابة من يومين (مش مقفولة)
async function ruleUnclosedSessions(centerId: string, out: ZakiFinding[]) {
  const open = await db.sessionInstance.findMany({
    where: { centerId, status: "OPEN", date: { lt: today() } },
    include: { group: { select: { name: true, subject: { select: { name: true } } } } },
    orderBy: { date: "asc" },
    take: 10,
  });
  if (!open.length) return;
  out.push({
    id: "unclosed_sessions",
    dimension: "OPERATIONAL",
    severity: open.length >= 4 ? "WARNING" : "INFO",
    what: `${open.length} حصة مفتوحة من يوم/أيام فاتت ومتقفلتش`,
    where: open.slice(0, 3).map((s) => `${s.group.subject.name} — ${s.group.name} (${s.date})`).join("، ") + (open.length > 3 ? " وغيرها" : ""),
    why: "الحصة المفتوحة بتخلي الحسابات معلّقة: مفيش إيراد مسجّل ولا تسوية مدرس لحد ما تتقفل",
    action: "افتح الجدول، اقفل الحصص القديمة بعد مراجعة الحضور — أو ألغِها لو اتلغت فعلًا",
    go: { view: "schedule" },
    data: { sessions: open.map((s) => ({ id: s.id, label: `${s.group.subject.name} ${s.group.name} ${s.date}` })) },
  });
}

// 5) مجموعة عليها جدول ومفيش أي حصة اتولدت ليها آخر 10 أيام
async function ruleMissingSessions(centerId: string, out: ZakiFinding[]) {
  const slots = await db.scheduleSlot.findMany({
    where: { centerId, isActive: true },
    include: { group: { select: { id: true, name: true, isActive: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });
  const since = daysAgo(10);
  for (const slot of slots) {
    const g = slot.group;
    if (!g.isActive) continue;
    const cnt = await db.sessionInstance.count({ where: { centerId, groupId: g.id, date: { gte: since } } });
    if (cnt === 0) {
      out.push({
        id: "missing_sessions",
        dimension: "OPERATIONAL",
        severity: "WARNING",
        what: "مجموعة عليها جدول ومفيش حصة واحدة اتولدت آخر 10 أيام",
        where: `${g.subject.name} — ${g.name} (المدرس ${g.teacher?.name ?? "—"}) · موعد ${slot.startTime}`,
        why: "الجدول بيقول في حصة، بس الواقع مفيش — الطلاب بيستنوا والمدفوعات واقفة",
        action: "راجع مواعيد المجموعة من الجدول: إما فعّل الحصص أو أوقف السلوت المؤقت",
        go: { view: "schedule" },
        data: { groupId: g.id },
      });
      break; // واحدة كفاية كمؤشر — مش عايزين سبام
    }
  }
}

// 6) مديونية الطلاب
async function ruleDebtors(centerId: string, out: ZakiFinding[]) {
  const agg = await db.studentTransaction.groupBy({
    by: ["studentId"],
    where: { centerId },
    _sum: { amount: true },
    having: { amount: { _sum: { lt: -25000 } } }, // أقل من -250 جنيه
  });
  if (!agg.length) return;
  const ids = agg.map((a) => a.studentId);
  const studs = await db.student.findMany({
    where: { id: { in: ids }, centerId, status: "ACTIVE" },
    select: { id: true, name: true, code: true },
  });
  if (!studs.length) return;
  const totalDebt = agg.reduce((s, a) => s + (a._sum?.amount ?? 0), 0);
  out.push({
    id: "debtors",
    dimension: "FINANCIAL",
    severity: "INFO",
    what: `${studs.length} طالب مديونية فوق 250 جنيه`,
    where: `إجمالي المديونية ≈ ${Math.round(Math.abs(totalDebt) / 100)}ج على السنتر`,
    why: "المديونية المتراكمة بتبقّى شذون صعبة التحصيل كل ما تتأخر",
    action: "ابعت تنبيه رصيد من طابور الرسائل، وحدد سقف استثناء للمدير لو محتاج تقسيط",
    go: { view: "payments" },
    data: { count: studs.length, top: studs.slice(0, 8).map((s) => ({ id: s.id, name: s.name, code: s.code })) },
  });
}

// 7) تراجع درجات الكويزات لطالب
async function ruleQuizDecline(centerId: string, out: ZakiFinding[]) {
  const quizzes = await db.quiz.findMany({
    where: { centerId, status: { in: ["PUBLISHED", "CLOSED"] } },
    select: { id: true },
  });
  if (quizzes.length < 6) return;
  const attempts = await db.quizAttempt.findMany({
    where: { quizId: { in: quizzes.map((q) => q.id) }, status: "GRADED", score: { not: null } },
    include: { quiz: { select: { createdAt: true } }, student: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byStudent = new Map<string, { name: string; pct: number }[]>();
  for (const a of attempts) {
    if (!a.quiz || a.maxScore <= 0) continue;
    const pct = Math.round(((a.score ?? 0) / a.maxScore) * 100);
    const list = byStudent.get(a.studentId) ?? [];
    list.push({ name: a.student.name, pct });
    byStudent.set(a.studentId, list);
  }
  const flagged: { name: string; drop: number }[] = [];
  for (const [, series] of byStudent) {
    if (series.length < 4) continue;
    const prev = series.slice(0, Math.floor(series.length / 2));
    const last = series.slice(Math.floor(series.length / 2));
    const avg = (xs: { pct: number }[]) => Math.round(xs.reduce((s, x) => s + x.pct, 0) / xs.length);
    const drop = avg(prev) - avg(last);
    if (drop >= 15 && avg(last) < 65) flagged.push({ name: series[0].name, drop });
  }
  if (flagged.length) {
    out.push({
      id: "quiz_decline",
      dimension: "ACADEMIC",
      severity: flagged.length >= 5 ? "CRITICAL" : "WARNING",
      what: `${flagged.length} طالب درجاتهم في الكويزات بتنزل باستمرار`,
      where: flagged.slice(0, 3).map((f) => `${f.name} (-${f.drop}%)`).join("، "),
      why: "متوسط النصف الأخير من كويزاته أقل من الأول بفرق واضح — مؤشر مبكر على ضعف فهم",
      action: "راجع نتايج الكويزات، وكلم الطالب/ولي الأمر قبل الامتحان الكبير — الدعم المبكر أرخص من إعادة الفصل",
      go: { view: "reports" },
      data: { flagged: flagged.slice(0, 10) },
    });
  }
}

/** تشغيل كل القواعد — مرتبة بالخطورة */
export async function runZakiRules(centerId: string): Promise<{ findings: ZakiFinding[]; at: string }> {
  const out: ZakiFinding[] = [];
  await Promise.allSettled([
    ruleGroupAttendanceDrop(centerId, out),
    ruleRepeatedAbsences(centerId, out),
    ruleCollectionAnomaly(centerId, out),
    ruleUnclosedSessions(centerId, out),
    ruleMissingSessions(centerId, out),
    ruleDebtors(centerId, out),
    ruleQuizDecline(centerId, out),
  ]);
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  out.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings: out, at: new Date().toISOString() };
}

/* ------------------------------------------------------------
   أسئلة زكي الجاهزة — إجابات حتمية بنفس التقييم (فين/ليه/اعمل إيه)
------------------------------------------------------------ */

export type ZakiAnswer = {
  key: string;
  title: string;
  body: string;
  items: { label: string; sub?: string; studentId?: string }[];
  go?: ZakiFinding["go"];
};

export const ZAKI_QUESTIONS: { key: string; label: string }[] = [
  { key: "top_absent_group", label: "أنهي مجموعة غيابها أعلى؟" },
  { key: "repeat_absentees", label: "مين الطلاب اللي غيابهم متكرر؟" },
  { key: "today_collection", label: "تحصيل النهاردة عامل إيه؟" },
  { key: "debtors", label: "مين أكبر المدينين؟" },
  { key: "open_sessions", label: "في حصص لسه مفتوحة؟" },
];

export async function answerZaki(centerId: string, key: string): Promise<ZakiAnswer> {
  if (key === "top_absent_group") {
    const sessions = await db.sessionInstance.findMany({
      where: { centerId, date: { gte: daysAgo(30) }, status: { not: "CANCELLED" } },
      select: { id: true, groupId: true, group: { select: { name: true, subject: { select: { name: true } } } } },
    });
    const byGroup = new Map<string, { name: string; subject: string; present: number; total: number }>();
    for (const s of sessions) {
      if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, { name: s.group.name, subject: s.group.subject.name, present: 0, total: 0 });
    }
    if (byGroup.size) {
      const att = await db.attendance.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        select: { sessionId: true, status: true },
      });
      const sid2gid = new Map(sessions.map((s) => [s.id, s.groupId]));
      for (const a of att) {
        const gid = sid2gid.get(a.sessionId);
        if (!gid) continue;
        const g = byGroup.get(gid)!;
        g.total += 1;
        if (a.status === "PRESENT" || a.status === "LATE") g.present += 1;
      }
    }
    const ranked = [...byGroup.entries()]
      .filter(([, g]) => g.total >= 5)
      .map(([id, g]) => ({ id, ...g, rate: Math.round((g.present / g.total) * 100) }))
      .sort((a, b) => a.rate - b.rate);
    if (!ranked.length) return { key, title: "مفيش داتا كفاية", body: "لسه مفيش حضور كافي آخر 30 يوم للمقارنة بين المجموعات.", items: [] };
    return {
      key,
      title: `أعلى مجموعة غيابًا: ${ranked[0].subject} — ${ranked[0].name}`,
      body: `نسبة حضورها ${ranked[0].rate}% فقط آخر 30 يوم (${ranked[0].present} من ${ranked[0].total}). أعلى مجموعة بعدها ${ranked[1]?.rate ?? "—"}%.`,
      items: ranked.slice(0, 5).map((g) => ({ label: `${g.subject} — ${g.name}`, sub: `حضور ${g.rate}%` })),
      go: { view: "schedule" },
    };
  }

  if (key === "repeat_absentees") {
    const findings: ZakiFinding[] = [];
    await ruleRepeatedAbsences(centerId, findings);
    const f = findings.find((x) => x.id === "repeated_absence");
    const studs = (f?.data?.students as { id: string; name: string; code: string }[] | undefined) ?? [];
    return {
      key,
      title: f ? f.what : "مفيش غياب متكرر",
      body: f ? `${f.where}. ${f.action}` : "كل الطلاب المسجلين حضروا مرة على الأقل آخر 30 يوم — الوضع تمام.",
      items: studs.map((s) => ({ label: s.name, sub: `كود ${s.code}`, studentId: s.id })),
      go: studs.length ? { view: "students" } : undefined,
    };
  }

  if (key === "today_collection") {
    const agg = async (from: string, to?: string) => (await db.studentTransaction.aggregate({
      where: { centerId, type: "PAYMENT", createdAt: { gte: new Date(from + "T00:00:00"), ...(to ? { lt: new Date(to + "T00:00:00") } : {}) } },
      _sum: { amount: true },
    }))._sum.amount ?? 0;
    const t = await agg(today());
    const y = await agg(daysAgo(1), today());
    const trend = y > 0 ? Math.round(((t - y) / y) * 100) : null;
    return {
      key,
      title: `تحصيل النهاردة: ${Math.round(t / 100)} جنيه`,
      body: trend === null
        ? `امبارح كان ${Math.round(y / 100)}ج.`
        : trend >= 0
          ? `زاد ${trend}% عن امبارح (${Math.round(y / 100)}ج) — استمر كده.`
          : `أقل من امبارح بـ ${Math.abs(trend)}% (كان ${Math.round(y / 100)}ج) — لو الاستمرار كده، زكي هيبلّغك بقاعدة تنبيه التحصيل.`,
      items: [],
      go: { view: "payments" },
    };
  }

  if (key === "debtors") {
    const agg = await db.studentTransaction.groupBy({
      by: ["studentId"],
      where: { centerId },
      _sum: { amount: true },
      having: { amount: { _sum: { lt: 0 } } },
      orderBy: { _sum: { amount: "asc" } },
      take: 10,
    });
    if (!agg.length) return { key, title: "مفيش مديونيات", body: "كل الأرصدة سليمة — مفيش طالب عليه فلوس.", items: [] };
    const studs = await db.student.findMany({ where: { id: { in: agg.map((a) => a.studentId) } }, select: { id: true, name: true, code: true } });
    const name = (id: string) => studs.find((s) => s.id === id);
    return {
      key,
      title: `أكبر 10 مديونيات (إجمالي ${Math.round(Math.abs(agg.reduce((s, a) => s + (a._sum?.amount ?? 0), 0)) / 100)}ج)`,
      body: "رتّبنااهم من الأعلى مديونية. زرار التواصل جاهز في ملف كل طالب.",
      items: agg.map((a) => ({ label: name(a.studentId)?.name ?? "طالب", sub: `${Math.round(Math.abs(a._sum?.amount ?? 0) / 100)}ج · كود ${name(a.studentId)?.code ?? "—"}`, studentId: a.studentId })),
      go: { view: "students" },
    };
  }

  if (key === "open_sessions") {
    const open = await db.sessionInstance.findMany({
      where: { centerId, status: "OPEN", date: { lt: today() } },
      include: { group: { select: { name: true, subject: { select: { name: true } } } } },
      take: 10, orderBy: { date: "asc" },
    });
    return {
      key,
      title: open.length ? `${open.length} حصة مفتوحة من أيام فاتت` : "مفيش حصص معلّقة",
      body: open.length ? "اقفلها بعد مراجعة الحضور — الحسابات بتتثبت بالقفل." : "كل الحصص الفاتتة متقفلة وحساباتها ثابتة.",
      items: open.map((s) => ({ label: `${s.group.subject.name} — ${s.group.name}`, sub: s.date })),
      go: open.length ? { view: "schedule" } : undefined,
    };
  }

  return { key, title: "سؤال مش معروف", body: "اختار واحد من الأسئلة الجاهزة.", items: [] };
}
