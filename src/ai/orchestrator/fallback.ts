import "server-only";

/* ============================================================
   FALLBACK PLANNER — مخطط حتمي لو مفيش LLM متاح أو باظ بروتوكوله
   مش "ردود جاهزة" — ده وكيل مصغر بحالة: بيبص على نتايج الأدوات
   اللي فاتت وبيرتب الخطوة الجاية منها (بحث → قائمة → تسجيل…).
   نفس العقد (AgentTurn) ونفس سياسات التأكيد.
============================================================ */

export type AgentTurn = {
  say: string;
  plan?: string[];
  tool?: { name: string; args: Record<string, unknown> };
  need_info?: { question: string; options?: string[] };
  done?: boolean;
};

/** ملاحظة أداة من الترانسكريبت — بتحدد الخطوة الجاية */
export type Observation = { tool: string; summary?: string; data?: Record<string, unknown> };

function extractName(text: string): string | null {
  const m = text.match(
    /(?:هاتلي|هاتلى|دور(?:لي)?|ابحث عن|اعمللي تقرير عن|تقرير عن|سجل|سجّل|افتح)\s+(?:عن\s+|ال\s+|على\s+)?([\u0600-\u06FFa-zA-Z]{2,}(?:\s+[\u0600-\u06FFa-zA-Z]{2,}){0,3})/,
  );
  if (!m) return null;
  const stop = ["في", "فى", "على", "من", "المجموعة", "مجموعة", "تقرير", "الحصة", "حصة", "النهارده", "اليوم", "معانا"];
  const words = m[1].split(/\s+/).filter((w) => !stop.includes(w));
  return words.length ? words.join(" ") : null;
}

function extractGroupKey(text: string): string | null {
  const m = text.match(/(?:مجموعة|group)\s+([\u0600-\u06FFa-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

function extractNumber(text: string): number | null {
  const ar = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m = ar.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const isAr = (t: string) => /[\u0600-\u06FF]/.test(t);

/**
 * يفهم الطلب حتميًا ويرتب الخطوة الجاية بناءً على اللي حصل.
 * observations = نتايج الأدوات السابقة في نفس المهمة (الأحدث آخرًا).
 * null = الطلب مش من الأنماط المعروفة.
 */
export function fallbackPlan(
  text: string,
  ctx: { selectedStudent?: { id: string; name: string } },
  observations: Observation[] = [],
): AgentTurn | null {
  const t = text.replace(/[؟?!.]/g, " ").trim();
  const last = observations[observations.length - 1];

  // ================= تسجيل طالب في مجموعة — pipeline بحالة =================
  if (/سجل|سجّل|enroll|register/i.test(t) && /مجموعة|group|في|فى/i.test(t)) {
    const name = extractName(t) ?? ctx.selectedStudent?.name ?? null;
    if (!name) return { say: "تمام — مين الطالب اللي هسجله؟", need_info: { question: "مين الطالب؟" } };

    const searchObs = [...observations].reverse().find((o) => o.tool === "student.search");
    const listObs = [...observations].reverse().find((o) => o.tool === "group.list");
    const enrollObs = [...observations].reverse().find((o) => o.tool === "group.enroll_student");
    if (enrollObs) {
      return { say: enrollObs.summary ?? "خلصت التسجيل.", done: true };
    }

    // ١) البحث عن الطالب
    if (!searchObs) {
      return {
        say: `هبحث عن «${name}» الأول.`,
        plan: ["أدور على الطالب", "أتأكد من المجموعة", "أسجل الطالب (بتأكيدك)"],
        tool: { name: "student.search", args: { q: name, limit: 5 } },
      };
    }

    const students = (searchObs.data?.students as { id: string; name: string; code: string }[] | undefined) ?? [];
    // ٢) ambiguity في الطالب → سؤال بالاختيارات
    if (students.length > 1 && !listObs) {
      return {
        say: "لقيت أكتر من طالب بنفس الاسم — مين فيهم؟",
        need_info: { question: "مين الطالب المقصود؟", options: students.slice(0, 5).map((s) => `${s.name} (${s.code})`) },
      };
    }
    const student = students.length === 1 ? students[0] : null;

    // ٣) قائمة المجموعات
    if (!listObs) {
      const key = extractGroupKey(t);
      return {
        say: `تمام. هشوف المجموعات${key ? ` اللي اسمها أو مادتها فيها «${key}»` : ""}.`,
        tool: { name: "group.list", args: { ...(key ? { q: key } : {}) } },
      };
    }

    const groups = (listObs.data?.groups as { id: string; name: string; subject: string }[] | undefined) ?? [];
    if (groups.length === 0) {
      return { say: "مفيش مجموعة مطابقة — تأكد من الاسم أو اعمل المجموعة الأول من شاشة المجموعات.", done: true };
    }
    if (groups.length > 1) {
      return {
        say: "في أكتر من مجموعة مطابقة — أنهي واحدة؟",
        need_info: { question: "أنهي مجموعة؟", options: groups.slice(0, 5).map((g) => `${g.subject} — ${g.name}`) },
      };
    }
    if (!student) {
      // الطالب مش متحدد لسه — من الاختيار اللي المستخدم داس عليه في الترانسكريبت؟
      return { say: "محتاج أتأكد من الطالب الأول.", need_info: { question: "مين الطالب؟" } };
    }
    const g = groups[0];
    return {
      tool: { name: "group.enroll_student", args: { studentId: student.id, groupId: g.id } },
      say: `جاهز أسجل ${student.name} في ${g.subject} — ${g.name}.`,
    };
  }

  // ================= تقرير طالب =================
  if (/تقرير|report/i.test(t)) {
    if (ctx.selectedStudent && /ه|ده|دا|his|him/i.test(t) && !extractName(t)) {
      return {
        say: `هعمل تقرير سريع لـ ${ctx.selectedStudent.name}.`,
        tool: { name: "reports.get_student_report", args: { studentId: ctx.selectedStudent.id } },
      };
    }
    const name = extractName(t);
    if (name) {
      const searchObs = [...observations].reverse().find((o) => o.tool === "student.search");
      if (!searchObs) {
        return { say: `هجيب تقرير ${name}.`, tool: { name: "student.search", args: { q: name, limit: 5 } } };
      }
      const students = (searchObs.data?.students as { id: string; name: string }[] | undefined) ?? [];
      if (students.length === 1) {
        return { tool: { name: "reports.get_student_report", args: { studentId: students[0].id } }, say: "" };
      }
      if (students.length > 1) {
        return {
          say: "لقيت أكتر من طالب — مين فيهم؟",
          need_info: { question: "مين الطالب؟", options: students.slice(0, 5).map((s) => s.name) },
        };
      }
    }
    return { say: "قولي اسم الطالب أو كوده وأنا أطلع تقريره.", need_info: { question: "مين الطالب؟" } };
  }

  // ================= حضور =================
  if (/مين\s*(ال)?\s*(غايب|غايبين)|غايبين\s*(ال)?\s*نهارده|who.*(absent|missing)/i.test(t)) {
    return { say: "هشوف حصص النهاردة وأطلع لك اللي مسجل ومحضرش.", tool: { name: "attendance.get", args: { mode: "absent_today" } } };
  }
  if (/غابوا|غيابهم|غايب.*كتير|متكرر|frequent|absences/i.test(t) || (/اكتر من/.test(t) && /غ|غياب/.test(t))) {
    const n = extractNumber(t);
    return { say: `هجيبلك الطلبة اللي غابوا ${n ?? 3} مرات أو أكتر في آخر 30 يوم.`, tool: { name: "attendance.get", args: { mode: "frequent_absentees", ...(n ? { minAbsences: n } : {}) } } };
  }

  // ================= ملخص النهاردة =================
  if (/النهارده|اليوم|today/i.test(t) && /ايه|إيه|ملخص|حصل|مهم|وريني|بصلي|today/i.test(t)) {
    return { say: "هجيبلك ملخص النهاردة: الحصص والحضور والتحصيل وأهم الملاحظات.", tool: { name: "dashboard.get_today", args: {} } };
  }

  // ================= المجموعات =================
  if (/المجموعات|مجموعاتي|groups|كام مجموعة/i.test(t)) {
    return { say: "هجيبلك مجموعاتك النشطة.", tool: { name: "group.list", args: {} } };
  }

  // ================= بحث مباشر =================
  const name = extractName(t);
  if (name) {
    return { say: `هبحث عن «${name}».`, tool: { name: "student.search", args: { q: name, limit: 8 } } };
  }

  return null;
}

/** رد الوكيل لما الفول باك ميعرفش الطلب — بيقول الحقيقة ويقترح (spec §40) */
export function fallbackUnknown(text: string): AgentTurn {
  const ar = isAr(text);
  return {
    say: ar
      ? "الطلب ده مش من الحاجات اللي أقدر أعملها دلوقتي من غير موديل لغوي متصل. أقدر أساعدك في: ملخص النهاردة، الغايبين النهاردة، الغياب المتكرر، البحث عن طالب، تقارير الطلبة، تسجيل طالب في مجموعة، وفتح حصص. أو وصّل موديل LLM (AGENT_LLM_BASE_URL) عشان أفهم أي صيغة."
      : "I can't map this request without a connected LLM. I can help with: today's summary, absentees, frequent absences, student search, student reports, enrolling a student, and opening sessions.",
    done: true,
  };
}
