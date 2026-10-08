import { handler, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { runAgentConfirm } from "@/ai/orchestrator/runner";
import type { AgentEvent } from "@/ai/orchestrator/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* ============================================================
   POST /api/agent/confirm — قرار التأكيد (spec §5)
   body: { taskId, decision: "confirm" | "cancel" }
   confirm → بينفذ صف التأكيد المخزن (مش كلام الموديل) ويكمل الحلقة
   cancel  → بيلغي ويقفل بأمان
============================================================ */

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  rateLimit(`agent-confirm:${user.id}`, 30, 60_000);
  const body = await readJson<{ taskId?: string; decision?: string }>(req);
  const taskId = String(body.taskId ?? "");
  const decision = body.decision === "confirm" ? "confirm" : body.decision === "cancel" ? "cancel" : null;
  if (!taskId || !decision) {
    return Response.json({ ok: false, error: "طلب مش مكتمل." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch { /* closed */ }
      };
      try {
        await runAgentConfirm({ user, taskId, decision, emit });
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : "خطأ غير متوقع." });
        emit({ type: "done", status: "FAILED" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
