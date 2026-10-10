import { handler, ok, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   POST /api/agent/feedback — تقييم رد من ردود زكي (§8 حلقة التحسين)
   body: { messageId, feedback: "UP" | "DOWN" }
   الأمان: الرسالة لازم تكون في مهمة لنفس المستخدم — مفيش تعديل عرضي
   على رسايل غيرنا. التقييم بيتسجل في التدقيق عشان حلقة التحسين.
============================================================ */

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  rateLimit(`agent-fb:${user.id}`, 60, 60_000);
  const body = await readJson<{ messageId?: string; feedback?: string }>(req);
  const messageId = String(body.messageId ?? "");
  const feedback = body.feedback === "UP" ? "UP" : body.feedback === "DOWN" ? "DOWN" : null;
  if (!messageId || !feedback) {
    return Response.json({ ok: false, error: "البيانات ناقصة أو غلط." }, { status: 400 });
  }

  // الرسالة لازم تتبع مهمة لنفس المستخدم — حماية ملكية على مستوى الاستعلام نفسه
  const msg = await db.agentMessage.findFirst({
    where: { id: messageId, role: "assistant", task: { userId: user.id } },
    select: { id: true, feedback: true },
  });
  if (!msg) return Response.json({ ok: false, error: "الرسالة دي مش موجودة." }, { status: 404 });

  if (msg.feedback !== feedback) {
    await db.agentMessage.update({ where: { id: msg.id }, data: { feedback } });
    await logAudit({
      user, action: AUDIT.AGENT_FEEDBACK, entity: "AGENT_MESSAGE", entityId: msg.id,
      after: { feedback },
    });
  }
  return ok({ ok: true, feedback });
});
