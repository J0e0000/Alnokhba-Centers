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
