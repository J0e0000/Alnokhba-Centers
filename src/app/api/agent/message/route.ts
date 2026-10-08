import { handler, readJson } from "@/lib/api";
import { requireCenterUser, rateLimit } from "@/lib/auth";
import { runAgentMessage } from "@/ai/orchestrator/runner";
import type { AgentEvent } from "@/ai/orchestrator/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* ============================================================
   POST /api/agent/message — مدخل الوكيل الرئيسي (SSE)
   body: { text, taskId?, context?: { view?, studentId?, sessionId?, groupId? } }
   Response: text/event-stream — أحداث AgentEvent سطر سطر.
   الأمان: جلسة + سنتر إجباري + rate limit + كل الصلاحيات سيرفري.
============================================================ */

export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  rateLimit(`agent-msg:${user.id}`, 20, 60_000);
  const body = await readJson<{
    text?: string;
    taskId?: string;
    context?: { view?: string; studentId?: string; sessionId?: string; groupId?: string };
  }>(req);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch { /* stream closed */ }
      };
      try {
        await runAgentMessage({
          user,
          text: String(body.text ?? ""),
          clientCtx: body.context ?? {},
          taskId: body.taskId ? String(body.taskId) : undefined,
          emit,
        });
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
