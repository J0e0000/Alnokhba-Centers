import { ok, handler } from "@/lib/api";
import { ApiError } from "@/lib/auth";
import { db, dbMode } from "@/lib/db";
import { computeAlerts } from "@/lib/alerts";
import { todayStr } from "@/lib/normalize";

export const dynamic = "force-dynamic";

// ============================================================
// GET /api/alerts/cron — إشعار يومي مجدول (Vercel Cron يوميًا 05:00 UTC).
// بيجيب تنبيهات كل سنتر نشط ويدفع ملخص واحد في اليوم لكل مدير
// (dedupe عبر refId = daily-alerts-YYYY-MM-DD — مفيش سبام).
// الحماية: لو CRON_SECRET متعرّف في البيئة → لازم Authorization Bearer يطابقه
// (Vercel Cron بيبعته أوتوماتيك). لو مش متعرّف → الراوت مفتوح لكن آمن:
// GET فقط، idempotent، مفيش بيانات بترجع غير عدّادات.
// ============================================================

export const GET = handler(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) throw new ApiError("غير مصرح.", 401);
  }

  const centers = await db.center.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
  });

  const backupStale = dbMode() === "postgres";
  const today = todayStr();
  let pushed = 0;

  for (const center of centers) {
    const alerts = await computeAlerts(center.id, { includeBackupStale: backupStale });
    if (alerts.length === 0) continue;

    const refId = `daily-alerts-${today}`;
    const managers = await db.user.findMany({
      where: { centerId: center.id, role: "MANAGER", isActive: true },
      select: { id: true },
    });
    if (managers.length === 0) continue;

    // dedupe: لو فيه إشعار لنفس اليوم لأي مدير في السنتر → متبعتش تاني
    const existing = await db.staffNotification.findFirst({
      where: { centerId: center.id, type: "SYSTEM", refId },
      select: { id: true },
    });
    if (existing) continue;

    const icon: Record<string, string> = { CRITICAL: "🔴", WARN: "🟠", INFO: "🔵" };
    const body = alerts.map((a) => `${icon[a.severity]} ${a.title}: ${a.count}`).join("\n");

    await db.staffNotification.createMany({
      data: managers.map((m) => ({
        centerId: center.id,
        userId: m.id,
        type: "SYSTEM",
        title: `تنبيهات اليوم — ${center.name}`,
        body,
        link: null,
        refId,
      })),
    });
    pushed += managers.length;
  }

  return ok({ ok: true, centers: centers.length, pushed });
});
