import "server-only";
import { todayStr } from "@/lib/normalize";

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

/** استخراج مبلغ الدفعة — «50 جنيه» / «50ج» / رقم مفرد. ممنوع \b مع العربي */
function extractAmount(text: string): number | null {
  const n = norm(text);
  const withUnit = n.match(/(\d+(?:[.,]\d+)?)\s*(?:جنيه|جنيها|ج(?=\s|$)|egp)/);
  if (withUnit) {
    const v = parseFloat(withUnit[1].replace(",", "."));
    return v > 0 && v <= 100_000 ? v : null;
  }
  const plain = n.match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?:\s|$)/);
  if (plain) {
    const v = parseFloat(plain[1].replace(",", "."));
    return v > 0 && v <= 100_000 ? v : null;
  }
  return null;
}

/** طريقة الدفع من الكلام — فودافون/انستاباي/كاش */
function methodOf(text: string): "CASH" | "VODAFONE" | "INSTAPAY" | null {
  const n = norm(text);
  if (/فودافون|فود|vodafone/.test(n)) return "VODAFONE";
  if (/انستا|انستاباي|insta/.test(n)) return "INSTAPAY";
  if (/كاش|cash/.test(n)) return "CASH";
  return null;
}

/** اسم الطالب من طلب دفعة — «لأحمد محمد» / «لـ أحمد» / «من أحمد» / «لحساب أحمد» */
function extractPaymentName(text: string): string | null {
  const m = text.match(/(?:لحساب|لـ|لأ|لا|ل|من)\s*([\u0600-\u06FFa-zA-Z]{2,}(?:\s+[\u0600-\u06FFa-zA-Z]{2,}){0,3})/);
  if (!m) return null;
  const stop = ["جنيه", "ج", "كاش", "فودافون", "انستا", "انستاباي", "النهارده", "اليوم", "دفعه", "حساب"];
  const words = m[1].split(/\s+/)
    .map((w, i) => (i === 0 ? w.replace(/^لل?/, "") : w)) // «لأحمد» ← «أحمد»
    .filter((w) => w.length >= 2 && !stop.includes(w) && !/^\d+([.,]\d+)?$/.test(w));
  return words.length ? words.join(" ") : null;
}

type StudentRow = { id: string; name: string; code: string };
type GroupRow = { id: string; name: string; subject: string };

const obsOf = (obs: Observation[], tool: string): Observation | undefined =>
  [...obs].reverse().find((o) => o.tool === tool);
const studentsOf = (o?: Observation): StudentRow[] => {
  const rows = (o?.data?.students ?? o?.data?.absentees ?? o?.data?.flagged) as StudentRow[] | undefined;
  if (rows) return rows;
  const one = o?.data?.student as (StudentRow & Record<string, unknown>) | undefined;
  return one?.id ? [one as StudentRow] : []; // نتيجة student.get — طالب واحد
};
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
  // التسجيل في مجموعة لازم يكون فيه «في مجموعة» صريح — عشان «سجل دفعة» متلخبطش معه
  enroll: /سجل .{1,50}?(?:في|فى) مجموعه|سجل في مجموعه|ضيف .{1,50}?(?:في مجموعه|لمجموعه)|حط .{1,50}? في مجموعه|enroll|register .{1,40} (?:to|in)|add .{1,50} to (?:a |the )?(group|جراب)/,
  payRecord: /سجل دفعه|دفعه (جديده|من|لـ|ل)|استلمت|قبضت|سجل (مبلغ|فلوس|حساب|كاش)|دفع (لي|ليا|لى)|record (a )?payment|payment (from|for)|got (a )?payment/,
  newStudent: /طالب جديد|ضيف طالب|اضف طالب|سجل طالب جديد|new student|add (a )?student/,
  createGroup: /اعمل (مجموعه|جرروب)|ضيف مجموعه|اضف مجموعه|انشاء مجموعه|انشى مجموعه|مجموعه جديده|create (a )?(new )?group|new group/,
  report: /تقرير|report|ملف الطالب|معلومات عن|نبذه عن|how is .* doing/,
  absentToday: /(من|مين|انهي|ايه|فين).*(غايب|غايبين|هنحضرش|مش حاضر|مجاش|ماجاش|ناقص)|غايبين.*(النهارده|اليوم)|الغايبين|who('s| is| didn'?t| has)?\s*(absent|missing|not coming|skipping)|didn'?t come/,
  frequentAbsent: /(غايب|غاب|غياب|متكرر).*(كتير|مرات|متكرر|الاسبوع|الشهر)|(اكثر من).*(مره|مرات|غياب)|غيابهم|الغياب المتكرر|frequent(ly)? (absent|missing)|absences|kept missing/,
  groupAttendance: /نسبه حضور|حضور (مجموعه|group)|attendance (rate|of|for)/,
  todaySessions: /كام (حصه|حصة)|ايه (الحصص|حصص)|حصص النهارده|جدول النهارده|how many (sessions|classes)|sessions today|schedule today/,
  todaySummary: /(النهارده|اليوم|today).*(ايه|ملخص|حصل|مهم|وريني|بصلي|وضع|اخبار|مشهور)|ايه اللي حصل|ملخص (اليوم|النهارده)|حضور (النهارده|اليوم)|today'?s? (summary|overview)|what happened today|وريني الملخص|(show|give) me today|today.*(summary|overview|attendance)/,
  groupsList: /المجموعات|مجموعاتي|مجموعات السنتر|كام مجموعه|غروبات|my groups|show( me)? groups|list groups/,
  weakStudents: /مستواه نازل|مستوي نازل|الضعفاء|ضعيف|محتاج(ين)? متابعه|متعثر(ين)?|متلخبط(ين)?|struggling|falling behind|weak students|needs? follow ?-?up|مين محتاج/,
  collection: /كام (اتنصل|جمع|تحصيل)|التحصيل|ايراد|حصلنا|جمعنا|اتحصل|collections? (today|this week)|how much (collected|did we collect)/,
  tomorrowSessions: /بكره|بكرا|غدا|tomorrow/,
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
  // الدفعات قبل كل حاجة — «سجل دفعة» شكلها «سجل…» بس نيتها تاني خالص (والأسئلة «كام» بتروح للتحصيل)
  const isPay = (RE.payRecord.test(t) || (!!gi && RE.payRecord.test(gi))) && !/كام|اد ايه|how much/.test(t);
  const isEnroll = !isPay && (RE.enroll.test(t) || (!!gi && RE.enroll.test(gi) && !RE.report.test(t)));
  const isReport = !isEnroll && !isPay && (RE.report.test(t) || (!!gi && RE.report.test(gi)));

  const last = observations[observations.length - 1];
  const searchObs = obsOf(observations, "student.search");
  const listObs = obsOf(observations, "group.list");

  /* ================= تحيات ومجاملات ومساعدة ================= */
  if (RE.greeting.test(t)) {
    return { say: hasAr(text) ? "أهلًا بيك! أنا زكي — قولّي عايز إيه؟ أقدر أفتح حصص، أسجل دفعات، أضيف طلبة ومجموعات، أطلع غايبين النهاردة وملخص اليوم وأقارير الطلبة." : "Hey! I'm Zaki — I can open sessions, record payments, add students and groups, pull today's absentees, summaries and student reports.", done: true };
  }
  if (RE.thanks.test(t) && t.length < 30) {
    return { say: hasAr(text) ? "ده واجبي! لو محتاج أي حاجة تانية أنا هنا." : "Anytime! I'm here if you need anything else.", done: true };
  }
  if (RE.help.test(t) && t.length < 40) {
    return {
      say: hasAr(text)
        ? "تقدر تطلب مني: «مين غايب النهارده؟» · «اللي غابوا 3 مرات» · «ملخص النهاردة» · «كام حصة النهاردة؟» · «عندنا إيه بكرة؟» · «افتح حصة رياضيات» · «حصّلنا كام النهارده؟» · «سجل دفعة 50 جنيه لأحمد» · «اعمل مجموعة رياضيات للصف الأول الثانوي بسعر 60» · «ضيف طالب جديد» · «هاتلي أحمد» · «تقرير أحمد» · «سجل أحمد في مجموعة B» — بالعربي أو English."
        : "You can ask: «who is absent today?» · «today's summary» · «open the math session» · «how much did we collect?» · «record a 50 EGP payment for Ahmed» · «create a math group for grade 1 sec» · «add a new student» · «find Ahmed» · «report of Ahmed» · «enroll Ahmed in Group B».",
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

  /* ================= طالب/مجموعة جديدة — دي بيت handledها الموديل الذكي (كتالوج group.create / student.create)
     لأنها محتاجة جمع مدخلات غني (تليفونات/سعر/مرحلة) — لو مفيش موديل، fallbackUnknown هيقول الصراحة */
  if (RE.newStudent.test(t) || RE.createGroup.test(t)) return null;

  /* ================= تسجيل دفعة — pipeline بحالة (بحث/كود ← مبلغ ← تأكيد) ================= */
  if (isPay) {
    const intentText = RE.payRecord.test(t) ? text : (ctx.goal ?? text);
    const paidObs = obsOf(observations, "finance.record_payment");
    if (paidObs) return doneWith(paidObs, "خلصت — الدفعة اتسجلت.");
    const getObs = obsOf(observations, "student.get"); // طلب بالكود بيجه student.get
    const srcObs = searchObs ?? getObs;
    if (srcObs && srcObs.data?.students === undefined && srcObs.data?.student === undefined) return doneWith(srcObs, "البحث فشل.");
    const students = studentsOf(srcObs);
    const picked = students.length ? pickStudent(students, text) : null;
    const student = picked ?? (students.length === 1 ? students[0] : null);

    if (student) {
      const amount = extractAmount(text) ?? extractAmount(intentText);
      const method = methodOf(text) ?? methodOf(intentText);
      if (amount == null) {
        return { say: `تمام — ${student.name}. كام جنيه الدفعة؟`, need_info: { question: "كام جنيه؟" } };
      }
      return {
        say: `جاهز أسجل دفعة ${amount} جنيه لـ ${student.name} — جايبلك كارت التأكيد.`,
        tool: { name: "finance.record_payment", args: { student: student.name, amount, ...(method ? { method } : {}) } },
      };
    }
    if (srcObs && students.length > 1) {
      return {
        say: "لقيت أكتر من طالب — مين فيهم؟",
        need_info: { question: "مين الطالب اللي دفع؟", options: students.slice(0, 5).map((s) => `${s.name} (${s.code})`) },
      };
    }
    if (srcObs && students.length === 0) return doneWith(srcObs, `مفيش طالب مطابق — جرب الاسم زي ما هو في ملف الطالب.`);
    // كود طالب مباشر في طلب الدفعة — «سجل دفعة 25 جنيه لـ 99002»
    const codeM = t.match(/(\d{5})/);
    if (codeM && !getObs) {
      return {
        say: `هجيب الطالب اللي كوده ${codeM[1]} وبعدها أسجل الدفعة.`,
        plan: ["أجيب الطالب بالكود", "أسجل الدفعة (بتأكيدك)"],
        tool: { name: "student.get", args: { code: codeM[1] } },
      };
    }
    const name = extractPaymentName(intentText) ?? ctx.selectedStudent?.name ?? null;
    if (name && !srcObs) {
      return {
        say: `هبحث عن «${name}» الأول وبعدها أسجل الدفعة.`,
        plan: ["أدور على الطالب", "أسجل الدفعة (بتأكيدك)"],
        tool: { name: "student.search", args: { q: name, limit: 5 } },
      };
    }
    return { say: "قولي اسم الطالب اللي دفع والمبلغ — مثال: «سجل دفعة 50 جنيه لأحمد محمد».", need_info: { question: "مين الطالب اللي دفع؟" } };
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

  /* ================= حصص بكرة (جدول أي يوم مش النهاردة بس) ================= */
  if (RE.tomorrowSessions.test(t)) {
    const tomorrow = todayStr(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const prev = obsOf(observations, "schedule.get_day");
    if (prev) return doneWith(prev, "خلصت — حصص بكرة فوق.");
    return { say: "هجيب حصص بكرة ومواعيدها وحالتها.", tool: { name: "schedule.get_day", args: { date: tomorrow } } };
  }

  /* ================= حصص النهاردة ================= */
  if (RE.todaySessions.test(t)) {
    const prev = obsOf(observations, "dashboard.get_today");
    if (prev) return doneWith(prev, "خلصت — حصص النهاردة فوق.");
    return { say: "هجيب حصص النهاردة وحالتها.", tool: { name: "dashboard.get_today", args: { withInsights: false } } };
  }

  /* ================= التحصيل — أداة مالية حقيقية (رقم من الداتابيز) ================= */
  if (RE.collection.test(t)) {
    const prev = obsOf(observations, "finance.get_collection");
    if (prev) return doneWith(prev, "خلصت — التحصيل فوق.");
    return { say: "هجيبلك إجمالي التحصيل النهاردة.", tool: { name: "finance.get_collection", args: {} } };
  }

  /* ================= ملخص النهاردة ================= */
  if (RE.todaySummary.test(t)) {
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

  /* ================= المجموعات ================= */
  if (RE.groupsList.test(t)) {
    const prev = obsOf(observations, "group.list");
    if (prev) return doneWith(prev, "خلصت — قايمة المجموعات فوق.");
    return { say: "هجيبلك مجموعاتك النشطة.", tool: { name: "group.list", args: {} } };
  }

  /* ================= فتح حصة — pipeline حقيقي: جدول النهاردة ← اختيار ← تأكيد ================= */
  if (RE.openSession.test(t)) {
    const opened = obsOf(observations, "attendance.start_session");
    if (opened) return doneWith(opened, "خلصت — الحصة اتفتحت.");
    const dayObs = obsOf(observations, "schedule.get_day");
    if (dayObs && dayObs.data?.slots === undefined) return doneWith(dayObs, "قراية الجدول فشلت.");
    if (!dayObs) {
      return {
        say: "هشوف جدول النهاردة الأول وأجيبلك الحصص المجدولة.",
        plan: ["أشوف جدول النهاردة", "أحدد الحصة", "أفتح الحصة (بتأكيدك)"],
        tool: { name: "schedule.get_day", args: { date: todayStr() } },
      };
    }
    const slots = (dayObs.data?.slots as { slotId: string; startTime: string; endTime: string; group: string; subject: string }[] | undefined) ?? [];
    if (!slots.length) {
      return { say: "مفيش حصص مجدولة النهاردة في الجدول — لو عايز حصة إضافية، شاشة «حصص اليوم» بتفتح حصة لأي مجموعة في ثانية.", done: true };
    }
    const slotLabel = (sl: { subject: string; group: string; startTime: string; endTime: string }) => `${sl.subject} — ${sl.group} (${sl.startTime}–${sl.endTime})`;
    // مطابقة على الرسالة الحالية + هدف المهمة («افتح حصة رياضيات» أو اختيار «رياضيات — B (17:00–18:30)»)
    const nt = `${norm(text)} ${norm(ctx.goal ?? "")}`;
    const scored = slots
      .map((sl) => {
        const hay = norm(`${sl.subject} ${sl.group}`);
        let score = 0;
        for (const tok of nt.split(" ")) {
          if (tok.length > 1 && hay.includes(tok)) score += 1;
        }
        if (nt.includes(norm(sl.startTime))) score += 3; // «الحصة الـ 5» أو اختيار بخيار فيه الوقت
        return { sl, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score > 0 && best.score > (scored[1]?.score ?? 0)) {
      const sl = best.sl;
      return {
        say: `جاهز أفتح حصة ${slotLabel(sl)} — جايبلك كارت التأكيد.`,
        tool: { name: "attendance.start_session", args: { scheduleId: sl.slotId, date: todayStr() } },
      };
    }
    return {
      say: "في أكتر من حصة مجدولة النهاردة — أنهي واحدة؟",
      need_info: { question: "أنهي حصة؟", options: slots.slice(0, 5).map(slotLabel) },
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
      ? "الطلب ده مش من الحاجات اللي أقدر أعملها بالظبط. أقدر أساعدك في:\n• «افتح حصة رياضيات» · «مين غايب النهارده؟» · «ملخص النهاردة» · «عندنا إيه بكرة؟»\n• «سجل دفعة 50 جنيه لأحمد» · «حصّلنا كام النهارده؟»\n• «اعمل مجموعة رياضيات للصف الأول الثانوي بسعر 60» · «ضيف طالب جديد»\n• «هاتلي أحمد» · «تقرير أحمد» · «سجل أحمد في مجموعة B»\nولو الصيغة مختلفة، المدير يقدر يوصلني بموديل ذكي من الإعدادات ← «زكي — العقل الذكي» وأندهم أي طلب بالكلام العادي."
      : "I can't map this request yet. I can help with: opening sessions, today's absentees and summary, recording payments, creating groups and students, search and reports. A manager can also connect a smart model from Settings → Zaki Brain so I understand any phrasing.",
    done: true,
  };
}
