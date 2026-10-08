import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { todayStr } from "@/lib/normalize";

/* ============================================================
   CONTEXT ENGINE — بناء سياق الطلب (spec §7/§31)
   الوكيل بيفهم «طلّعلي تقريره» لأن السياق بيتجمع تلقائيًا:
   المستخدم + دوره + سنتره + الصفحة الحالية + الطالب المفتوح +
   إمكانيات السنتر + اللغة. السياق كله بيتحقق سيرفري — الـ client
   بيبعت إشارات بس (view/studentId) والتحقق هنا.
============================================================ */

export type AgentClientContext = {
  /** الصفحة الحالية في التطبيق (students/today/schedule/...) */
  view?: string;
  /** طالب مفتوح حاليًا على الشاشة — بيتحقق إنه في سنتر المستخدم */
  studentId?: string;
  sessionId?: string;
  groupId?: string;
};

export type AgentContextSnapshot = {
  userName: string;
  role: string;
  centerName: string;
  centerId: string;
  view?: string;
  /** الطالب المفتوح حاليًا (بعد التحقق) — «هو/تقريره» بيشاروا عليه */
  selectedStudent?: { id: string; name: string; code: string };
  selectedSession?: { id: string; label: string; status: string };
  date: string;
  time: string;
  lang: "ar" | "en";
};

const ROLE_AR: Record<string, string> = {
  MANAGER: "مدير السنتر",
  RECEPTIONIST: "موظف استقبال",
  TEACHER: "مدرس",
  ADMIN: "أدمن المنصة",
};

function detectLang(text: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

export async function buildAgentContext(
  user: SessionUser & { centerId: string },
  client: AgentClientContext,
  userText: string,
): Promise<AgentContextSnapshot> {
  const now = new Date();
  const ctx: AgentContextSnapshot = {
    userName: user.name,
    role: ROLE_AR[user.role] ?? user.role,
    centerName: user.center?.name ?? "—",
    centerId: user.centerId,
    view: client.view,
    date: todayStr(),
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    lang: detectLang(userText),
  };

  // الطالب المفتوح — لازم يكون في نفس السنتر (أمان: الـ client مش مصدق)
  if (client.studentId) {
    const s = await db.student.findFirst({
      where: { id: client.studentId, centerId: user.centerId },
      select: { id: true, name: true, code: true },
    });
    if (s) ctx.selectedStudent = s;
  }
  if (client.sessionId) {
    const sess = await db.sessionInstance.findFirst({
      where: { id: client.sessionId, centerId: user.centerId },
      select: { id: true, status: true, group: { select: { name: true, subject: { select: { name: true } } } } },
    });
    if (sess) {
      ctx.selectedSession = {
        id: sess.id,
        label: `${sess.group?.subject.name ?? ""} — ${sess.group?.name ?? ""}`.trim(),
        status: sess.status,
      };
    }
  }
  return ctx;
}

/** وصف نصي آمن للسياق — ده اللي بيدخل في prompt الموديل (من غير أرقام مالية حساسة) */
export function contextBlock(ctx: AgentContextSnapshot): string {
  const lines = [
    `- المستخدم: ${ctx.userName} (${ctx.role})`,
    `- السنتر: ${ctx.centerName}`,
    `- التاريخ: ${ctx.date} — الساعة ${ctx.time}`,
    ...(ctx.view ? [`- الصفحة المفتوحة حاليًا: ${ctx.view}`] : []),
    ...(ctx.selectedStudent
      ? [`- الطالب المفتوح على الشاشة: ${ctx.selectedStudent.name} (كود ${ctx.selectedStudent.code}, id: ${ctx.selectedStudent.id}) — لو المستخدم قال «هو/تقريره/الطالب ده» فهو يقصد ${ctx.selectedStudent.name}`]
      : []),
    ...(ctx.selectedSession ? [`- الحصة المفتوحة حاليًا: ${ctx.selectedSession.label} (${ctx.selectedSession.status})`] : []),
    `- لغة المستخدم في الرسالة الأخيرة: ${ctx.lang === "ar" ? "العربية" : "الإنجليزية"} — رد بنفس اللغة`,
  ];
  return lines.join("\n");
}
