import "server-only";

/* ============================================================
   FALLBACK PLANNER — المخ الحتمي لزكي (بيشتغل من غير أي LLM)
   مش "ردود جاهزة" — ده وكيل مصغر بحالة: بيبص على نتايج الأدوات
   اللي فاتت + هدف المهمة الأصلي، وبيرتب الخطوة الجاية منها
   (بحث → اختيار → قائمة → تأكيد → تسجيل…). بيفهم المصري،
   الفصحى، والإنجليزي الأساسي. نفس العقد (AgentTurn) ونفس سياسات التأكيد.
============================================================ */

export type AgentTurn = {
  say: string;
  plan?: string[];
  tool?: { name: string; args: Record<string, unknown> };
  need_info?: { question: string; options?: string[] };
  done?: boolean;
};

/** ملاحظة أداة من الترانسكريبت — بتحدد الخطوة الجاية */
export type Observation = { tool: string; summary?: string; error?: string; data?: Record<string, unknown> };

export type FallbackCtx = {
  selectedStudent?: { id: string; name: string };
  /** هدف المهمة الأصلي — عشان اختيارات المستخدم («رياضيات — Group B») تكمل المهمة */
  goal?: string;
};

/* ---------------- تطبيع عربي — بيوحّد الهمزات والتاء المربوطة ---------------- */
function norm(t: string): string {
  return t
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // التشكيل والتطويل
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type StudentRow = { id: string; name: string; code: string };
type GroupRow = { id: string; name: string; subject: string };

const obsOf = (obs: Observation[], tool: string): Observation | undefined =>
  [...obs].reverse().find((o) => o.tool === tool);
const studentsOf = (o?: Observation): StudentRow[] => ((o?.data?.students ?? o?.data?.absentees ?? o?.data?.flagged) as StudentRow[] | undefined) ?? [];
const groupsOf = (o?: Observation): GroupRow[] => ((o?.data?.groups) as GroupRow[] | undefined) ?? [];

/** اختيار طالب من رسالة («أحمد محمد (99002)» أو تطابق اسم) */
function pickStudent(list: StudentRow[], t: string): StudentRow | null {
  const codeM = t.match(/\((\d{3,12})\)|\b(\d{3,12})\b/);
  if (codeM) {
    const code = codeM[1] ?? codeM[2];
    const byCode = list.find((s) => s.code === code);
    if (byCode) return byCode;
  }
  const nt = norm(t);
  const byName = list.find((s) => nt.includes(norm(s.name)));
  return byName ?? null;
}

/** اختيار مجموعة من رسالة («رياضيات — Group B») */
function pickGroup(list: GroupRow[], t: string): GroupRow | null {
  const nt = norm(t);
  if (!nt) return null;
  const scored = list
    .map((g) => ({ g, hit: (nt.includes(norm(g.name)) ? 2 : 0) + (nt.includes(norm(g.subject)) ? 1 : 0) }))
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
  return scored[0]?.g ?? null;
}

function extractName(text: string): string | null {
  const m = text.match(
    /(?:هاتلي|هاتلى|دور(?:لي)?(?:\s+على)?|ابحث(?:\s+عن)?|اعمللي\s+تقرير\s+(?:عن|لـ|ل)|تقرير\s+(?:عن|لـ|ل)|سجل|سجّل|افتح|معلومات\s+(?:عن|على))\s+([\u0600-\u06FFa-zA-Z]{2,}(?:\s+[\u0600-\u06FFa-zA-Z]{2,}){0,3})/,
  );
  if (!m) return null;
  const stop = ["في", "فى", "على", "عن", "من", "المجموعة", "مجموعة", "تقرير", "الحصة", "حصة", "النهارده", "اليوم", "معانا", "السنتر"];
  const words = m[1].split(/\s+/).filter((w) => !stop.includes(w));
  return words.length ? words.join(" ") : null;
}

function extractGroupKey(text: string): string | null {
  const m = text.match(/(?:مجموعة|group)\s+([\u0600-\u06FFa-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

function extractNumber(text: string): number | null {
  const m = norm(text).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const hasAr = (t: string) => /[\u0600-\u06FF]/.test(t);

/** إغلاق آمن بلخص ملاحظة موجودة (أو خطأها) — الحماية من إعادة تنفيذ نفس النية */
const doneWith = (o?: Observation, fallback?: string): AgentTurn =>
  ({ say: o?.summary || o?.error || fallback || "تم — خلصت.", done: true });

/* ---------------- كاشفات النوايا (على النص المطبّع) ---------------- */
const RE = {
  enroll: /سجل|ضيف.*(مجموعه)|enroll|register|add .* to (group|جراب)/,
  report: /تقرير|report|ملف الطالب|معلومات عن|نبذه عن|how is .* doing/,
  absentToday: /(من|مين|انهي|ايه|فين).*(غايب|غايبين|هنحضرش|مش حاضر|مجاش|ماجاش|ناقص)|غايبين.*(النهارده|اليوم)|الغايبين|who('s| is| didn'?t| has)?\s*(absent|missing|not coming|skipping)|didn'?t come/,
  frequentAbsent: /(غايب|غاب|غياب|متكرر).*(كتير|مرات|متكرر|الاسبوع|الشهر)|(اكثر من).*(مره|مرات|غياب)|غيابهم|الغياب المتكرر|frequent(ly)? (absent|missing)|absences|kept missing/,
  groupAttendance: /نسبه حضور|حضور (مجموعه|group)|attendance (rate|of|for)/,
  todaySessions: /كام (حصه|حصة)|ايه (الحصص|حصص)|حصص النهارده|جدول النهارده|how many (sessions|classes)|sessions today|schedule today/,
  todaySummary: /(النهارده|اليوم|today).*(ايه|ملخص|حصل|مهم|وريني|بصلي|وضع|اخبار|مشهور)|ايه اللي حصل|ملخص (اليوم|النهارده)|حضور (النهارده|اليوم)|today'?s? (summary|overview)|what happened today|وريني الملخص|(show|give) me today|today.*(summary|overview|attendance)/,
  debtors: /(عليه|عليهم|عليها) (فلوس|مبلغ|مديونيه)|مديونيه|مديونيات|المتاخرات|متاخرات|مستحقات|لسه (مدفعش|ماقفلش)|who owes|owe(s)? (us|money)|unpaid|outstanding (balance|payments)/,
  tomorrow: /(عندنا|فيه|ايه|جدول|حصص|وريني).*(بكره|بكرا|غدا|بكرة)|(بكره|بكرا|غدا|بكرة).*(حصص|جدول|عندنا)|tomorrow( s)? (sessions|classes|schedule)|what( s| is) (on )?tomorrow/,
  groupsList: /المجموعات|مجموعاتي|مجموعات السنتر|كام مجموعه|غروبات|my groups|show( me)? groups|list groups/,
  weakStudents: /مستواه نازل|مستوي نازل|الضعفاء|ضعيف|محتاج(ين)? متابعه|متعثر(ين)?|متلخبط(ين)?|struggling|falling behind|weak students|needs? follow ?-?up|مين محتاج/,
  collection: /كام (اتنصل|جمع|تحصيل)|التحصيل|ايراد النهارده|collections? today|how much (collected|did we collect)|ايراد/,
  openSession: /افتح (حصه|حضور|session)|اعمل حصه|ابدأ حضور|open (a )?session|start (a )?session/,
  greeting: /^(سلام|السلام عليكم|هاي|هلا|ازيك|عامل ايه|صباح|مساء|مرحبا|اهلا)(\s|$)|^(hi|hello|hey|good (morning|evening|afternoon))\b/,
  thanks: /(شكرا|متشكر|تسلم|ربنا يخليك|thanks|thank you|thx)/,
  help: /تقدر تعمل ايه|ايه اللي تعرفه|امكانياتك|مساعده|إزاي|how (do|can) (i|you)|what can you (do|help)|help( me)?$|اسئله/,
};

/**
 * يفهم الطلب حتميًا ويرتب الخطوة الجاية بناءً على اللي حصل.
 * observations = نتايج الأدوات السابقة في نفس المهمة (الأحدث آخرًا).
 * null = الطلب مش من الأنماط المعروفة.
 */
export function fallbackPlan(
  text: string,
  ctx: FallbackCtx,
  observations: Observation[] = [],
): AgentTurn | null {
  const t = norm(text);
  if (!t) return null;
  // هدف المهمة الأصلي — لو الرسالة دي اختيار/متابعة قصيرة نرجع للهدف عشان نكمل المهمة
  const looksLikePick = t.length <= 60 && !extractName(text) &&
    (/^(كمل|اكمل|خلاص|تمام|ايوه|اها|اختر|دا|ده|يلا|اوك|ok|go|continue|yes|yeah)(\s|$)/.test(t) || /[-—(]|\d{3,}/.test(t));
  const gi = looksLikePick && ctx.goal ? norm(ctx.goal) : "";
  const isEnroll = RE.enroll.test(t) || (!!gi && RE.enroll.test(gi) && !RE.report.test(t));
  const isReport = !isEnroll && (RE.report.test(t) || (!!gi && RE.report.test(gi)));

  const last = observations[observations.length - 1];
  const searchObs = obsOf(observations, "student.search");
  const listObs = obsOf(observations, "group.list");

  /* ================= تحيات ومجاملات ومساعدة ================= */
  if (RE.greeting.test(t)) {
    return { say: hasAr(text) ? "أهلًا بيك! أنا زكي — قولّي عايز إيه؟ أقدر أطلعلك غايبين النهاردة، ملخص اليوم، أدوّر على طالب، أعمل تقرير، أو أسجّل طالب في مجموعة." : "Hey! I'm Zaki — what do you need? I can pull today's absentees, today's summary, find a student, build a report, or enroll a student.", done: true };
  }
  if (RE.thanks.test(t) && t.length < 30) {
    return { say: hasAr(text) ? "ده واجبي! لو محتاج أي حاجة تانية أنا هنا." : "Anytime! I'm here if you need anything else.", done: true };
  }
  if (RE.help.test(t) && t.length < 40) {
    return {
      say: hasAr(text)
        ? "تقدر تطلب مني: «مين غايب النهارده؟» · «اللي غابوا 3 مرات» · «ملخص النهاردة» · «كام حصة النهاردة؟» · «هاتلي أحمد» · «تقرير أحمد» · «حضور مجموعة المعلومات؟» · «سجل أحمد في مجموعة B» — بالعربي أو English."
        : "You can ask: «who is absent today?» · «frequent absentees» · «today's summary» · «find Ahmed» · «report of Ahmed» · «attendance of Group B» · «enroll Ahmed in Group B».",
      done: true,
    };
  }

  /* ================= طلبات بيانات دخول — رفض أمني صريح (spec §34) =================
     ممنوع في كل الأحوال إعطاء حسابات أو كلمات سر — الطلب بيرد عليه رفض واضح
     قبل أي تفكير آخر، سواء بالمخ الحتمي أو أي موديل. */
  const asksPassword = /(باسورد|باسوورد|كلمه السر|باصورد|password)/.test(t);
  const asksAdminAccount = /(حساب|account)/.test(t) && /(ادمن|المدير|مدير|اداري|admin)/.test(t) && !/كشف حساب/.test(t);
  if (asksPassword || asksAdminAccount) {
    return {
      say: hasAr(text)
        ? "لأ — ده مش هقدر أعمله. الحسابات وكلمات السر بيانات حساسة ومش بتتشارك في أي شات، ولا حتى أنا مسموحلي أشوفها. حسابك انت واخد صلاحياته من الإدارة، ولو عايز صلاحيات أكتر أو حساب لموظف جديد، ده بيتعمل من شاشة الموظفين أو من إدارة المنصة مباشرة."
        : "I can't share accounts or passwords — credentials are sensitive and never shared through chat, and I don't have access to them anyway. Your account has the permissions it needs; for more access or a new staff account, use the staff screen or contact the platform admins.",
      done: true,
    };
  }

  /* ================= تسجيل طالب في مجموعة — pipeline بحالة ================= */
  if (isEnroll) {
    const intentText = RE.enroll.test(t) ? text : (ctx.goal ?? text);
    const name = extractName(intentText) ?? ctx.selectedStudent?.name ?? null;
    if (!name && !searchObs) return { say: "تمام — مين الطالب اللي هسجله؟", need_info: { question: "مين الطالب؟" } };

    const enrollObs = obsOf(observations, "group.enroll_student");
    if (enrollObs) {
      return { say: enrollObs.summary ?? enrollObs.error ?? "خلصت التسجيل.", done: true };
    }

    // ١) تحديد الطالب — من الاسم في الطلب أو من اختيار المستخدم على نتايج البحث
    // لو البحث اتحجب (صلاحية/خطأ) — نقفل برسالة الخطأ الحقيقية مش «مفيش مطابقة»
    if (searchObs && searchObs.data?.students === undefined) return doneWith(searchObs, "البحث فشل.");
    const students = studentsOf(searchObs);
    const picked = students.length ? pickStudent(students, text) : null;
    const student = picked ?? (students.length === 1 ? students[0] : null);

    if (!student && searchObs && students.length > 1) {
      return {
        say: "لقيت أكتر من طالب بنفس الاسم — مين فيهم؟",
        need_info: { question: "مين الطالب المقصود؟", options: students.slice(0, 5).map((s) => `${s.name} (${s.code})`) },
      };
    }
    if (!student && !name) {
      return { say: "محتاج أتأكد من الطالب الأول.", need_info: { question: "مين الطالب؟" } };
    }

    // ٢) البحث عن الطالب لو لسه
    if (!searchObs && name) {
      return {
        say: `هبحث عن «${name}» الأول.`,
        plan: ["أدور على الطالب", "أتأكد من المجموعة", "أسجل الطالب (بتأكيدك)"],
        tool: { name: "student.search", args: { q: name, limit: 5 } },
      };
    }

    // ٣) المجموعة — من طلب المستخدم («مجموعة B») أو من اختياره على قايمة المجموعات
    const groupKey = extractGroupKey(intentText);
    if (listObs && listObs.data?.groups === undefined) return doneWith(listObs, "قراية المجموعات فشلت.");
    const groups = groupsOf(listObs);
    const pickedGroup = groups.length ? pickGroup(groups, text) : null;
    if (!pickedGroup && groups.length > 1) {
      return {
        say: "في أكتر من مجموعة مطابقة — أنهي واحدة؟",
        need_info: { question: "أنهي مجموعة؟", options: groups.slice(0, 5).map((g) => `${g.subject} — ${g.name}`) },
      };
    }
    if (!listObs) {
      return {
        say: `تمام. هشوف المجموعات${groupKey ? ` اللي اسمها أو مادتها فيها «${groupKey}»` : ""}.`,
        tool: { name: "group.list", args: { ...(groupKey ? { q: groupKey } : {}) } },
      };
    }
    if (groups.length === 0) {
      return { say: "مفيش مجموعة مطابقة — تأكد من الاسم أو اعمل المجموعة الأول من شاشة المجموعات.", done: true };
    }
    if (!student) {
      return { say: "محتاج أتأكد من الطالب الأول.", need_info: { question: "مين الطالب؟" } };
    }
    const g = pickedGroup ?? groups[0];
    return {
      tool: { name: "group.enroll_student", args: { studentId: student.id, groupId: g.id } },
      say: `جاهز أسجل ${student.name} في ${g.subject} — ${g.name}.`,
    };
  }

  /* ================= تقرير طالب ================= */
  if (isReport) {
    const intentText = RE.report.test(t) ? text : (ctx.goal ?? text);
    // التقرير نفسه اتنفذ؟ اقفل بالملخص (حماية من اللوب)
    const reportObs = obsOf(observations, "reports.get_student_report");
    if (reportObs) return doneWith(reportObs, "خلصت — التقرير جاهز فوق.");
    // ضمير → الطالب المفتوح على الشاشة («تقريره/ملفه/الطالب ده») — من غير \b (مش بيشتغل مع العربي)
    if (ctx.selectedStudent && /((تقرير|ملف|حالة)ها?|هو|بتاعها?|الطالب ده|ده|دا|his|him|her)(\s|$)/i.test(t) && !extractName(intentText) && !searchObs) {
      return {
        say: `هعمل تقرير سريع لـ ${ctx.selectedStudent.name}.`,
        tool: { name: "reports.get_student_report", args: { studentId: ctx.selectedStudent.id } },
      };
    }
    const students = studentsOf(searchObs);
    const picked = students.length ? pickStudent(students, text) : null;
    if (picked) {
      return { tool: { name: "reports.get_student_report", args: { studentId: picked.id } }, say: `تمام — تقرير ${picked.name}.` };
    }
    if (searchObs && searchObs.data?.students === undefined) return doneWith(searchObs, "البحث فشل.");
    if (searchObs && students.length === 1) {
      return { tool: { name: "reports.get_student_report", args: { studentId: students[0].id } }, say: "" };
    }
    if (searchObs && students.length > 1) {
      return {
        say: "لقيت أكتر من طالب — مين فيهم؟",
        need_info: { question: "مين الطالب؟", options: students.slice(0, 5).map((s) => `${s.name} (${s.code})`) },
      };
    }
    const name = extractName(intentText);
    if (name) {
      return { say: `هجيب تقرير ${name}.`, tool: { name: "student.search", args: { q: name, limit: 5 } } };
    }
    return { say: "قولي اسم الطالب أو كوده وأنا أطلع تقريره.", need_info: { question: "مين الطالب؟" } };
  }

  /* ================= الغياب المتكرر (قبل الغايبين النهاردة — عشان «أكتر من N مرات» متلخبطش) ================= */
  if (RE.frequentAbsent.test(t)) {
    const prev = obsOf(observations, "attendance.get");
    if (prev && prev.data?.flagged !== undefined) return doneWith(prev, "خلصت — قايمة الغياب المتكرر فوق.");
    const n = extractNumber(t);
    return { say: `هجيبلك الطلبة اللي غابوا ${n ?? 3} مرات أو أكتر في آخر 30 يوم.`, tool: { name: "attendance.get", args: { mode: "frequent_absentees", ...(n ? { minAbsences: n } : {}) } } };
  }

  /* ================= الغايبين النهاردة ================= */
  if (RE.absentToday.test(t)) {
    const prev = obsOf(observations, "attendance.get");
    if (prev && prev.data?.absentees !== undefined) return doneWith(prev, "خلصت — قايمة الغايبين فوق.");
    return { say: "هشوف حصص النهاردة وأطلع لك اللي مسجل ومحضرش.", tool: { name: "attendance.get", args: { mode: "absent_today" } } };
  }

  /* ================= حضور مجموعة بالاسم ================= */
  if (RE.groupAttendance.test(t)) {
    const prev = obsOf(observations, "attendance.get");
    if (prev && prev.data?.rate !== undefined) return doneWith(prev, "خلصت — نسبة الحضور فوق.");
    const groups = groupsOf(listObs);
    const pickedGroup = groups.length ? pickGroup(groups, text) : null;
    if (pickedGroup) {
      return { say: `هجيب نسبة حضور ${pickedGroup.subject} — ${pickedGroup.name}.`, tool: { name: "attendance.get", args: { mode: "by_group", groupId: pickedGroup.id } } };
    }
    const key = extractGroupKey(text) ?? extractName(text);
    if (!listObs) {
      return {
        say: `هشوف المجموعات${key ? ` المطابقة لـ «${key}»` : ""} الأول.`,
        tool: { name: "group.list", args: { ...(key ? { q: key } : {}) } },
      };
    }
    if (groups.length > 1) {
      return { say: "في أكتر من مجموعة — أنهي واحدة؟", need_info: { question: "أنهي مجموعة؟", options: groups.slice(0, 5).map((g) => `${g.subject} — ${g.name}`) } };
    }
    if (groups.length === 1) {
      const g = groups[0];
      return { say: `هجيب نسبة حضور ${g.subject} — ${g.name}.`, tool: { name: "attendance.get", args: { mode: "by_group", groupId: g.id } } };
    }
    return { say: "قولي اسم المجموعة أو المادة وأنا أجيب نسبة حضورها.", need_info: { question: "أنهي مجموعة؟" } };
  }

  /* ================= حصص النهاردة ================= */
  if (RE.todaySessions.test(t)) {
    const prev = obsOf(observations, "dashboard.get_today");
    if (prev) return doneWith(prev, "خلصت — حصص النهاردة فوق.");
    return { say: "هجيب حصص النهاردة وحالتها.", tool: { name: "dashboard.get_today", args: { withInsights: false } } };
  }

  /* ================= ملخص النهاردة / التحصيل ================= */
  if (RE.todaySummary.test(t) || RE.collection.test(t)) {
    const prev = obsOf(observations, "dashboard.get_today");
    if (prev) return doneWith(prev, "خلصت — الملخص فوق.");
    return { say: "هجيبلك ملخص النهاردة: الحصص والحضور والتحصيل وأهم الملاحظات.", tool: { name: "dashboard.get_today", args: {} } };
  }

  /* ================= الطلبة المحتاجين متابعة ================= */
  if (RE.weakStudents.test(t)) {
    // لو الملخص اللي فات جاب ملاحظات بالفعل → اقفل بيه؛ غير كده هطلبه بالملاحظات
    const prev = obsOf(observations, "dashboard.get_today");
    const prevInsights = (prev?.data?.insights as unknown[] | undefined)?.length ?? 0;
    if (prev && prevInsights > 0) return doneWith(prev, "خلصت — ملاحظات المتابعة فوق.");
    return { say: "هجيب أهم ملاحظات المتابعة: الغياب المتكرر والرصيد والمتأخرين — من قواعد المتابعة الثابتة.", tool: { name: "dashboard.get_today", args: { withInsights: true } } };
  }

  /* ================= المديونيات (finance.debtors) ================= */
  if (RE.debtors.test(t)) {
    const prev = obsOf(observations, "finance.debtors");
    if (prev) return doneWith(prev, "خلصت — قايمة المديونيات فوق.");
    return { say: "هجيبلك الطلاب اللي عليهم فلوس مرتبين من الأكبر.", tool: { name: "finance.debtors", args: {} } };
  }

  /* ================= حصص بكره (schedule.get_day) ================= */
  if (RE.tomorrow.test(t)) {
    const prev = obsOf(observations, "schedule.get_day");
    if (prev) return doneWith(prev, "خلصت — حصص بكره فوق.");
    // تاريخ بكره بتوقيت القاهرة (en-CA بيدّي YYYY-MM-DD)
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() + 86_400_000));
    return { say: "هجيبلك حصص بكره.", tool: { name: "schedule.get_day", args: { date } } };
  }

  /* ================= المجموعات ================= */
  if (RE.groupsList.test(t)) {
    const prev = obsOf(observations, "group.list");
    if (prev) return doneWith(prev, "خلصت — قايمة المجموعات فوق.");
    return { say: "هجيبلك مجموعاتك النشطة.", tool: { name: "group.list", args: {} } };
  }

  /* ================= فتح حصة — توجيه صادق (مفيش أداة جدول لسه) ================= */
  if (RE.openSession.test(t)) {
    return {
      say: "فتح الحصص من زكي لسه مش متاح — بس من شاشة «حصص اليوم» بتضغط على الحصة وتفتح في ثانية، وأنا بعد كده أقدر أقولك مين غايب فيها. تحب أجيبلك حصص النهاردة؟",
      done: true,
    };
  }

  /* ================= بحث مباشر / كود / متابعة بحث ================= */
  const codeOnly = t.match(/\b(\d{3,12})\b/);
  if (codeOnly && t.split(" ").length <= 3) {
    const prevGet = obsOf(observations, "student.get");
    const prevCode = ((prevGet?.data?.student as { code?: string } | undefined)?.code) ?? "";
    if (prevGet && prevCode === codeOnly[1]) return doneWith(prevGet, "خلصت — ملف الطالب فوق.");
    return { say: `هجيب الطالب اللي كوده ${codeOnly[1]}.`, tool: { name: "student.get", args: { code: codeOnly[1] } } };
  }
  const name = extractName(text);
  if (name) {
    // نفس البحث اتعمل؟ اقفل بالملخص بدل التكرار
    const prev = obsOf(observations, "student.search");
    if (prev && norm(String(prev.data?.q ?? "")) === norm(name)) return doneWith(prev, "خلصت — النتايج فوق.");
    return { say: `هبحث عن «${name}».`, tool: { name: "student.search", args: { q: name, limit: 8 } } };
  }
  // متابعة بحث: المستخدم كتب اسم تاني بعد نتايج بحث («واحمد سامي؟»)
  const prevSearch = obsOf(observations, "student.search");
  if (prevSearch && text.split(/\s+/).length <= 4) {
    if (norm(String(prevSearch.data?.q ?? "")) === norm(text)) return doneWith(prevSearch, "خلصت — النتايج فوق.");
    return { say: `هبحث عن «${text.trim()}».`, tool: { name: "student.search", args: { q: text.trim(), limit: 8 } } };
  }

  return null;
}

/** رد الوكيل لما الفول باك ميعرفش الطلب — بيقول الحقيقة ويقترح (spec §40) */
export function fallbackUnknown(text: string): AgentTurn {
  const ar = hasAr(text);
  return {
    say: ar
      ? "الطلب ده مش من الحاجات اللي أقدر أعملها دلوقتي. أقدر أساعدك في:\n• «مين غايب النهارده؟» و«اللي غابوا 3 مرات»\n• «ملخص النهاردة» و«كام حصة النهاردة؟»\n• «هاتلي أحمد» و«تقرير أحمد»\n• «حضور مجموعة كذا إزاي؟»\n• «سجل أحمد في مجموعة B»\nولو عايزني أفهم أي صيغة، المدير يقدر يوصلني بموديل ذكي من الإعدادات ← «زكي — العقل الذكي»."
      : "I can't map this request yet. I can help with: today's absentees, frequent absences, today's summary, student search, student reports, group attendance, and enrolling a student. A manager can also connect a smart model from Settings → Zaki Brain.",
    done: true,
  };
}
