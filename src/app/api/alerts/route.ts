import { ok, handler } from "@/lib/api";
import { requireManager } from "@/lib/auth";
import { computeAlerts } from "@/lib/alerts";
import { dbMode } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/alerts — التنبيهات الذكية للمدير (محسوبة لحظيًا — read-only) */
export const GET = handler(async () => {
  const user = await requireManager();
  const alerts = await computeAlerts(user.centerId, { includeBackupStale: dbMode() === "postgres" });
  return ok({ alerts, generatedAt: new Date().toISOString() });
});
