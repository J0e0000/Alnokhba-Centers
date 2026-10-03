import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { cairoDateStr } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance/staff-events?days=1 — أحداث حضور الموظفين (السجل الموحد).
 * بيرجّع آخر N يوم لكل طرق حضور الموظفين (شاشة QR / بدء حصة مدرس / بصمة).
 * للعرض في إعدادات «الحضور والpresence» — والتفاصيل الكاملة في سجل العمليات.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireManager();
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(7, Math.round(Number(url.searchParams.get("days")) || 1)));

  const rows = await db.attendanceEvent.findMany({
    where: {
      centerId: user.centerId,
      personType: "STAFF",
      occurredAt: { gte: new Date(Date.now() - days * 24 * 3600 * 1000) },
    },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: {
      id: true, displayName: true, role: true, method: true, status: true,
      sessionId: true, occurredAt: true, metadata: true,
    },
  });

  const METHOD_LABEL: Record<string, string> = {
    DYNAMIC_QR: "QR شاشة المركز",
    SESSION_START: "بدء حصة",
    FINGERPRINT: "بصمة",
    NAME: "اسم",
    STATIC_QR: "QR ثابت",
  };

  return ok({
    events: rows.map((e) => {
      let sessionLabel: string | null = null;
      try {
        const m = e.metadata ? (JSON.parse(e.metadata) as Record<string, unknown>) : null;
        sessionLabel = typeof m?.sessionLabel === "string" ? m.sessionLabel : null;
      } catch { /* تجاهل */ }
      return {
        id: e.id,
        name: e.displayName,
        role: e.role,
        method: e.method,
        methodLabel: METHOD_LABEL[e.method] ?? e.method,
        status: e.status,
        occurredAt: e.occurredAt.toISOString(),
        today: cairoDateStr(e.occurredAt) === cairoDateStr(new Date()),
        sessionLabel,
      };
    }),
  });
});
