import "server-only";
import { db } from "@/lib/db";

/* ============================================================
   MEMORY — ذاكرة منظمة وقابلة للتفتيش (spec §8)
   - قصيرة المدى: رسائل المهمة نفسها (AgentMessage) — بتتنضف مع الأرشفة
   - الجلسة/التفضيلات: AgentMemory بمفاتيح محددة — ممنوع ذاكرة حرة
   - معرفة النظام: كتالوج الأدوات (registry) — ثابت ومُعلن
   مفيش أي ذاكرة طويلة-مدى غير مهيكلة. كل قيمة JSON محددة المفتاح.
============================================================ */

export type AgentPrefValue = { v: string };

/** تفضيل مستخدم — يقرأ */
export async function getPref(userId: string, key: string): Promise<string | null> {
  const row = await db.agentMemory.findUnique({
    where: { userId_scope_key: { userId, scope: "USER_PREF", key } },
    select: { value: true },
  });
  const v = (row?.value as AgentPrefValue | undefined)?.v;
  return typeof v === "string" ? v : null;
}

/** تفضيل مستخدم — يكتب (upsert) */
export async function setPref(userId: string, key: string, value: string): Promise<void> {
  await db.agentMemory.upsert({
    where: { userId_scope_key: { userId, scope: "USER_PREF", key } },
    create: { userId, scope: "USER_PREF", key, value: { v: value } },
    update: { value: { v: value } },
  });
}

/** آخر مهمة فعلية للمستخدم — عشان «كمّل اللي كنت بتقوله» */
export async function lastTaskId(userId: string): Promise<string | null> {
  const row = await db.agentMemory.findUnique({
    where: { userId_scope_key: { userId, scope: "SESSION", key: "last_task" } },
    select: { value: true },
  });
  const v = (row?.value as AgentPrefValue | undefined)?.v;
  return typeof v === "string" ? v : null;
}

/* ------------------------------------------------------------
   ذاكرة المحادثة — إحالة منظمة واحدة بس: آخر طالب اتحسم
   (بحث بنتيجة وحيدة / ملف طالب / تقرير). مش ذاكرة حرة —
   قيمة واحدة بمفاتيح معلنة وقابلة للتفتيش من أي حد يبص في الجدول.
   بتستخدم عشان «سجل حضوره» / «تقريره» بعد محادثة تانية تشاور عليه.
------------------------------------------------------------ */

export type LastStudentRef = {
  id: string;
  name: string;
  code: string;
  centerId: string;
  /** ISO — العمر أقصاه 24 ساعة (TTL) عشان الإحالة القديمة ما تضللش */
  at: string;
};

export const LAST_STUDENT_TTL_MS = 24 * 60 * 60 * 1000;

export async function getLastStudent(userId: string): Promise<LastStudentRef | null> {
  try {
    const row = await db.agentMemory.findUnique({
      where: { userId_scope_key: { userId, scope: "SESSION", key: "last_student" } },
      select: { value: true },
    });
    const v = row?.value as Partial<LastStudentRef> | undefined;
    if (!v || typeof v.id !== "string" || typeof v.name !== "string" || typeof v.at !== "string") return null;
    if (Number.isNaN(Date.parse(v.at))) return null;
    return v as LastStudentRef;
  } catch {
    return null; // جدول الذاكرة مش متزامن — الإحالة اختيارية والوكيل يكمل من غيرها
  }
}

export async function setLastStudent(
  userId: string,
  ref: { id: string; name: string; code: string; centerId: string },
): Promise<void> {
  const value: LastStudentRef = { ...ref, at: new Date().toISOString() };
  await db.agentMemory.upsert({
    where: { userId_scope_key: { userId, scope: "SESSION", key: "last_student" } },
    create: { userId, scope: "SESSION", key: "last_student", value },
    update: { value },
  });
}
