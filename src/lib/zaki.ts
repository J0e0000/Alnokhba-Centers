import "server-only";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/normalize";
import { normalizeAr } from "@/lib/arabic";

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
function daysAgo(from: string, n: number): string {
  const [y, m, d] = from.split("-").map(Number);
  return dstr(new Date(y, m - 1, d - n));
}

/** مرساة النشاط: آخر يوم فيه حصة فعلية (مش ملغاة) — بيتقيد بيوم النهاردة.
 *  ليه؟ لو السنتر مثلاً وقّف تسجيل حصص لفترة (عطل/مشكلة) قواعد «آخر 14 يوم»
 *  كانت هتبقى فاضية وقاعدة تدنّي الحضور عمرها ما تشتغل. المرساة بتخلي
 *  المقارنة على آخر 4 أسابيع فيها داتا فعلية — اليوم نفسه لو فيه حصص. */
async function activityAnchor(centerId: string): Promise<string> {
  const last = await db.sessionInstance.findFirst({
    where: { centerId, status: { not: "CANCELLED" } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const t = today();
  if (!last?.date) return t;
  return last.date > t ? t : last.date; // داتا مستقبلية غلط → نقص بيوم النهاردة
}

/* ------------------------------------------------------------
   قواعد التحليل — كل قاعدة بترجع 0..n ملاحظات
------------------------------------------------------------ */

// 1) تدنّي حضور مجموعة مقارنة بالفترة اللي قبلها — على مرساة النشاط
//    الصيغة الرسمية (نفس تقارير النخبة): (PRESENT+LATE) ÷ (عدد الحصص × المسجلين النشطين)
//    صفوف ABSENT الصريحة بتتحسب غياب — مش حضور زي النسخة القديمة.
async function ruleGroupAttendanceDrop(centerId: string, out: ZakiFinding[]) {
  const anchor = await activityAnchor(centerId);
  const recent = await db.sessionInstance.findMany({
    where: { centerId, date: { gte: daysAgo(anchor, 13), lte: anchor }, status: { not: "CANCELLED" } },
    select: { id: true, groupId: true, group: { select: { name: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });
  if (!recent.length) return;
  const older = await db.sessionInstance.findMany({
    where: { centerId, date: { gte: daysAgo(anchor, 27), lt: daysAgo(anchor, 13) }, status: { not: "CANCELLED" } },
    select: { id: true, groupId: true, group: { select: { name: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });
  const byGroup = (rows: typeof recent) => {
    const m = new Map<string, { sessions: string[]; name: string; subject: string; teacher: string }>();
    for (const s of rows) {
      if (s.groupId && s.group && !m.has(s.groupId)) m.set(s.groupId, { sessions: [], name: s.group.name, subject: s.group.subject.name, teacher: s.group.teacher?.name ?? "—" });
      if (s.groupId) m.get(s.groupId)?.sessions.push(s.id);
    }
    return m;
  };
  const recentM = byGroup(recent);
  const olderM = byGroup(older as typeof recent);
  // عدد المسجلين النشطين لكل مجموعة — مرة واحدة لكل المجموعات المرشحة
  const candidateIds = [...recentM.keys()];
  const regRows = await db.studentGroup.groupBy({
    by: ["groupId"],
    where: { status: "ACTIVE", groupId: { in: candidateIds }, student: { status: "ACTIVE" } },
    _count: true,
  });
  const regsOf = new Map(regRows.map((r) => [r.groupId, r._count]));
  const isPresent = (s: string) => s === "PRESENT" || s === "LATE";
  const drops: ZakiFinding[] = [];
  for (const [groupId, g] of recentM) {
    const regs = regsOf.get(groupId) ?? 0;
    if (regs === 0) continue;
    const ids = g.sessions;
    if (ids.length < 2) continue;
    const marks = await db.attendance.findMany({ where: { sessionId: { in: ids } }, select: { status: true } });
    if (!marks.length) continue;
    const expectedNow = ids.length * regs;
    const rateNow = Math.round((marks.filter((m) => isPresent(m.status)).length / expectedNow) * 100);
    const old = olderM.get(groupId);
    if (!old || old.sessions.length < 2) continue;
    const oldMarks = await db.attendance.findMany({ where: { sessionId: { in: old.sessions } }, select: { status: true } });
    if (!oldMarks.length) continue;
    const expectedOld = old.sessions.length * regs;
    const rateOld = Math.round((oldMarks.filter((m) => isPresent(m.status)).length / expectedOld) * 100);
    if (rateOld - rateNow >= 15 && rateNow < 80) {
      drops.push({
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
  // سقف الإزعاج: أضعف 3 مجموعات بس — تقرير قراءته أهم من تعداد كل حالة
  drops.sort((a, b) => ((a.data?.rateNow as number) ?? 100) - ((b.data?.rateNow as number) ?? 100));
  out.push(...drops.slice(0, 3));
}

// 2) طلاب غيابهم اتكرر كتير آخر 30 يوم — على مرساة النشاط (مش وقت التسجيل)
async function ruleRepeatedAbsences(centerId: string, out: ZakiFinding[]) {
  const anchor = await activityAnchor(centerId);
  const sessions = await db.sessionInstance.findMany({
    where: { centerId, date: { gte: daysAgo(anchor, 29), lte: anchor }, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  if (!sessions.length) return;
  const att = await db.attendance.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) }, status: "PRESENT" },
    select: { studentId: true },
  });
  const allRegs = await db.studentGroup.findMany({
    where: { status: "ACTIVE", student: { status: "ACTIVE" }, group: { centerId, isActive: true } },
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
    where: { centerId, type: "PAYMENT", createdAt: { gte: new Date(daysAgo(today(), 7) + "T00:00:00") } },
    _sum: { amount: true },
  });
  const month = await db.studentTransaction.aggregate({
    where: { centerId, type: "PAYMENT", createdAt: { gte: new Date(daysAgo(today(), 35) + "T00:00:00"), lt: new Date(daysAgo(today(), 7) + "T00:00:00") } },
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
    where: open.slice(0, 3).map((s) => `${s.group?.subject.name ?? s.name ?? "حصة"} — ${s.group?.name ?? "—"} (${s.date})`).join("، ") + (open.length > 3 ? " وغيرها" : ""),
    why: "الحصة المفتوحة بتخلي الحسابات معلّقة: مفيش إيراد مسجّل ولا تسوية مدرس لحد ما تتقفل",
    action: "افتح الجدول، اقفل الحصص القديمة بعد مراجعة الحضور — أو ألغِها لو اتلغت فعلًا",
    go: { view: "schedule" },
    data: { sessions: open.map((s) => ({ id: s.id, label: `${s.group?.subject.name ?? s.name ?? "حصة"} ${s.group?.name ?? ""} ${s.date}`.trim() })) },
  });
}

// 5) مجموعة عليها جدول ومفيش أي حصة اتولدت ليها آخر 10 أيام
async function ruleMissingSessions(centerId: string, out: ZakiFinding[]) {
  const slots = await db.scheduleSlot.findMany({
    where: { centerId, isActive: true },
    include: { group: { select: { id: true, name: true, isActive: true, subject: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });
  const since = daysAgo(today(), 10);
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

/** تشغيل كل القواعد — مرتبة بالخطورة. أي قاعدة تقع السبب بيتسجل في اللوج
 *  (ممنوع فشل صامت — القاعدة اللي مش شغالة لازم تبقى مرئية للمطور). */
export async function runZakiRules(centerId: string): Promise<{ findings: ZakiFinding[]; at: string }> {
  const out: ZakiFinding[] = [];
  const rules: [string, (cid: string, o: ZakiFinding[]) => Promise<void>][] = [
    ["group_att_drop", ruleGroupAttendanceDrop],
    ["repeated_absence", ruleRepeatedAbsences],
    ["collection_anomaly", ruleCollectionAnomaly],
    ["unclosed_sessions", ruleUnclosedSessions],
    ["missing_sessions", ruleMissingSessions],
    ["debtors", ruleDebtors],
  ];
  await Promise.all(
    rules.map(async ([name, fn]) => {
      try {
        await fn(centerId, out);
      } catch (e) {
        console.error(`[zaki:rule:${name}] فشل:`, e instanceof Error ? e.message : e);
      }
    }),
  );
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

/* ------------------------------------------------------------
   تخمين الجملة (طلب المالك: «خليه يحاول يخمن الجملة عشان تبقى أريح»)
   أي صيغة قريبة من سؤال جاهز → نفس الإجابة الحتمية بدل «سؤال مش معروف».
   المطابقة على النص المطبَّع (همزات/تاء مربوطة/تشكيل/أرقام) —
   جملة مرادفة قوية أو كلمة مفتاحية واضحة واحدة كفاية.
------------------------------------------------------------ */
const ZAKI_ALIASES: Record<string, string[]> = {
  top_absent_group: [
    "مجموعة غيابها", "اعلي مجموعة", "اكتر مجموعة غياب", "مجموعة بتغيب",
    "ترتيب المجموعات", "نسبه حضور المجموعات", "احسن مجموعه", "اضعف مجموعه",
    "مجموعه غيابها كتير", "انهي مجموعه غياب",
  ],
  repeat_absentees: [
    "غيابهم متكرر", "غياب متكرر", "غيابات متكرره", "متعودين علي الغياب",
    "بيغيابوا كتير", "بيغيبوا كتير", "بيغيب كتير", "غيابهم كتير",
    "غيابات كتير", "اكتر طلاب غياب", "اكتر طالب غياب", "كثيرين الغياب",
    "متكرر", "بيغيب", "بيغياب",
  ],
  today_collection: [
    "تحصيل النهارده", "تحصيل اليوم", "التحصيل النهارده", "التحصيل اليوم",
    "وصل كام", "اتجمع كام", "كام اتجمع", "كام وصل", "فلوس النهارده",
    "مدفوعات اليوم", "كشف اليوم", "الخرين النهارده",
    "تحصيل", "اتجمع",
  ],
  debtors: [
    "مدينين", "مديونيه", "عليهم فلوس", "عليه فلوس", "عليها فلوس",
    "رصيد سالب", "معلقين", "متاخرين في الدفع", "اللي عليهم",
    "اكبر مديونيه", "مديون",
  ],
  open_sessions: [
    "حصص مفتوحه", "حصه مفتوحه", "لسه مفتوحه", "مفتوحه لسه",
    "حصص شغاله", "حصه شغاله", "مفيش اغلاق", "حصص لسه",
    "مفتوحه",
  ],
};

/** كلمات عامة ممنوع تعتبر إشارة مطابقة لوحدها («مين المجموعات الطلاب فلوس») — بكل صيغ «الـ» */
const ZAKI_STOP = new Set([
  "مين", "ايه", "عندنا", "عندك", "اللي", "في", "من", "علي", "عن", "كام",
  "هات", "هاتلي", "قولي", "اذكر", "بالترتيب", "بي", "لل", "ده", "دي",
  "مجموعه", "مجموعات", "طلاب", "طالب", "طالبات", "فلوس", "حصص", "حصه",
  "اليوم", "النهارده", "لحد", "كده", "ازاي", "ليه", "فين", "معايا", "عند",
  "الطلاب", "المدينين", "المجموعات", "الحصص", "الغياب", "الطالبات",
]);

/** أزواج كلمات مع بعض بتأكد النية («اكتر + غايب» = اللي بيغيابوا كتير) — مش لازم يكونوا جنب بعض */
const ZAKI_PAIRS: Record<string, string[][]> = {
  repeat_absentees: [
    ["اكتر", "غياب"], ["اكتر", "غايب"], ["اكتر", "غيابات"],
    ["اعلي", "غياب"], ["اعلي", "غايب"], ["اعلي", "غيابات"],
    ["كتير", "غياب"], ["كتير", "غايب"], ["كتير", "غيابات"],
    ["نسبه", "غياب"],
  ],
  top_absent_group: [
    ["مجموعه", "غايبه"], ["مجموعه", "بتغيب"],
  ],
};

export function resolveZakiKey(q: string, minScore = 3): string | null {
  const raw = String(q ?? "").trim();
  if (!raw) return null;
  // مفتاح مباشر (الواجهة بتبعته)
  if (ZAKI_QUESTIONS.some((p) => p.key === raw)) return raw;
  const n = normalizeAr(raw);
  if (!n) return null;
  // الصيغة الرسمية بالظبط
  for (const p of ZAKI_QUESTIONS) {
    if (normalizeAr(p.label) === n) return p.key;
  }
  const words = new Set(n.split(" "));
  let best: { key: string; score: number } | null = null;
  const scoreOf = (key: string): number => {
    let score = 0;
    for (const a of ZAKI_ALIASES[key] ?? []) {
      const na = normalizeAr(a);
      if (na && n.includes(na)) score += na.split(" ").length * 3;
    }
    // كلمات الليبل القوية (مشتقة من السؤال الرسمي — بغير الكلمات العامة)
    const label = normalizeAr(ZAKI_QUESTIONS.find((p) => p.key === key)?.label ?? "");
    for (const w of label.split(" ")) {
      if (w.length >= 3 && !ZAKI_STOP.has(w) && words.has(w)) score += 3;
    }
    for (const pair of ZAKI_PAIRS[key] ?? []) {
      if (pair.every((w) => words.has(w))) score += pair.length * 3;
    }
    return score;
  };
  for (const key of Object.keys(ZAKI_ALIASES)) {
    const score = scoreOf(key);
    if (score > (best?.score ?? 0)) best = { key, score };
  }
  for (const key of Object.keys(ZAKI_PAIRS)) {
    const score = scoreOf(key);
    if (score > (best?.score ?? 0)) best = { key, score };
  }
  return best && best.score >= minScore ? best.key : null;
}

export async function answerZaki(centerId: string, key: string): Promise<ZakiAnswer> {
  if (key === "top_absent_group") {
    // المجموعات بترتيب إنشائها (زي ترتيب جدول Group في القاعدة) — عشان التعادل بين النِسَب يتحسم
    // بنفس ترتيب التقارير الرسمية، والصيغة «مادة (اسم المجموعة)» زي التقارير بالظبط.
    const groups = await db.group.findMany({
      where: { centerId },
      select: { id: true, name: true, subject: { select: { name: true } } },
    });
    const byGroup = new Map<string, { name: string; subject: string; present: number; total: number }>();
    for (const g of groups) byGroup.set(g.id, { name: g.name, subject: g.subject.name, present: 0, total: 0 });
    if (groups.length) {
      const sessions = await db.sessionInstance.findMany({
        where: { centerId, date: { gte: daysAgo(today(), 30) }, status: { not: "CANCELLED" }, groupId: { in: groups.map((g) => g.id) } },
        select: { id: true, groupId: true },
      });
      if (sessions.length) {
        const att = await db.attendance.findMany({
          where: { sessionId: { in: sessions.map((s) => s.id) } },
          select: { sessionId: true, status: true },
        });
        const sid2gid = new Map(sessions.map((s) => [s.id, s.groupId]));
        for (const a of att) {
          const gid = sid2gid.get(a.sessionId);
          if (!gid) continue;
          const g = byGroup.get(gid);
          if (!g) continue;
          g.total += 1;
          if (a.status === "PRESENT" || a.status === "LATE") g.present += 1;
        }
      }
    }
    const glabel = (g: { subject: string; name: string }) => `${g.subject} (${g.name})`;
    const ranked = [...byGroup.entries()]
      .filter(([, g]) => g.total >= 5)
      .map(([id, g]) => ({ id, ...g, rate: Math.round((g.present / g.total) * 100) }))
      .sort((a, b) => a.rate - b.rate);
    if (!ranked.length) return { key, title: "مفيش داتا كفاية", body: "لسه مفيش حضور كافي آخر 30 يوم للمقارنة بين المجموعات.", items: [] };
    return {
      key,
      title: `أعلى مجموعة غيابًا: ${glabel(ranked[0])}`,
      body: `نسبة حضورها ${ranked[0].rate}% فقط آخر 30 يوم (${ranked[0].present} من ${ranked[0].total}). أعلى مجموعة بعدها ${ranked[1]?.rate ?? "—"}%.`,
      items: ranked.slice(0, 5).map((g) => ({ label: glabel(g), sub: `حضور ${g.rate}%` })),
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
    const y = await agg(daysAgo(today(), 1), today());
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
    // كل المدينين مرة واحدة — العدد الإجمالي وإجمالي المديونية + أكبر 10 للعرض
    const all = await db.studentTransaction.groupBy({
      by: ["studentId"],
      where: { centerId },
      _sum: { amount: true },
      having: { amount: { _sum: { lt: 0 } } },
      orderBy: { _sum: { amount: "asc" } },
    });
    if (!all.length) return { key, title: "مفيش مديونيات", body: "كل الأرصدة سليمة — مفيش طالب عليه فلوس.", items: [] };
    const totalDebt = Math.round(all.reduce((s, a) => s + Math.abs(a._sum?.amount ?? 0), 0) / 100);
    const agg = all.slice(0, 10);
    const studs = await db.student.findMany({ where: { id: { in: agg.map((a) => a.studentId) } }, select: { id: true, name: true, code: true } });
    const name = (id: string) => studs.find((s) => s.id === id);
    return {
      key,
      title: `أكبر 10 مديونيات من إجمالي ${all.length} طالب عليهم رصيد سالب (إجمالي المديونية ${totalDebt}ج)`,
      body: `إجمالي ${all.length} طالب عندهم مديونية — مجموعها ${totalDebt}ج. ده الترتيب من الأعلى مديونية، وزرار التواصل جاهز في ملف كل طالب.`,
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
      items: open.map((s) => ({ label: `${s.group?.subject.name ?? s.name ?? "حصة"} — ${s.group?.name ?? "—"}`, sub: s.date })),
      go: open.length ? { view: "schedule" } : undefined,
    };
  }

  return { key, title: "سؤال مش معروف", body: "اختار واحد من الأسئلة الجاهزة.", items: [] };
}
