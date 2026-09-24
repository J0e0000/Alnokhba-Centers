/* ============================================================
   instrumentation.ts — runs once when the Next.js server boots.
   Server-side backup scheduler (NO browser timers):
   1) Weekly FULL backup: Friday 22:00 Africa/Cairo
      (db snapshot + Excel workbook for every active center + validation)
      If the server was down at that moment, the missed run happens at boot.
   2) Light daily db snapshot (~every 20h) as an extra safety net.
   Honest limitation: storage is the server's own disk — a machine loss
   loses backups with it, so manual download remains the real guarantee.
============================================================ */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // guard against double-start in dev (HMR reloads)
  const g = globalThis as unknown as {
    __nkBackupTimer?: NodeJS.Timeout;
    __nkWeeklyTimer?: NodeJS.Timeout;
    __nkBackupRunning?: boolean;
  };
  if (g.__nkBackupTimer || g.__nkWeeklyTimer) return;

  const runLightSnapshot = async () => {
    if (g.__nkBackupRunning) return;
    g.__nkBackupRunning = true;
    try {
      const { getBackupStatus, createBackup } = await import("@/lib/backup");
      const status = await getBackupStatus();
      const last = status.lastSuccessAt ? new Date(status.lastSuccessAt).getTime() : 0;
      // due if never ran or last success older than 20 hours
      if (Date.now() - last > 20 * 3600 * 1000) {
        await createBackup("scheduled");
      }
    } catch (e) {
      console.error("[auto-backup] failed:", e instanceof Error ? e.message : e);
    } finally {
      g.__nkBackupRunning = false;
    }
  };

  const runWeeklyFull = async (trigger: "scheduled" | "catch-up") => {
    if (g.__nkBackupRunning) return;
    g.__nkBackupRunning = true;
    try {
      const { runWeeklyBackup } = await import("@/lib/backup");
      const { dbFile, excelFiles } = await runWeeklyBackup(trigger);
      console.log(`[weekly-backup] ${trigger} done: ${dbFile} | excel: ${excelFiles.map((f) => `${f.centerName}:${f.validated ? "✓" : "✗"}`).join(", ")}`);
    } catch (e) {
      console.error("[weekly-backup] failed:", e instanceof Error ? e.message : e);
    } finally {
      g.__nkBackupRunning = false;
    }
  };

  const scheduleNextWeekly = async () => {
    const { nextFriday22Cairo, getBackupStatus } = await import("@/lib/backup");
    // catch-up: لو آخر نسخة أسبوعية أقدم من آخر جمعة 22:00 عدّت → شغّلها دلوقتي
    try {
      const status = await getBackupStatus();
      const lastWeekly = status.lastWeeklyAt ? new Date(status.lastWeeklyAt).getTime() : 0;
      const { lastFriday22CairoPassed } = await import("@/lib/backup");
      const missedAt = lastFriday22CairoPassed().getTime();
      if (lastWeekly < missedAt) {
        console.log("[weekly-backup] missed Friday run detected — catching up now");
        await runWeeklyFull("catch-up");
      }
    } catch { /* best effort */ }

    const next = nextFriday22Cairo();
    const ms = Math.max(next.getTime() - Date.now(), 60_000);
    console.log(`[weekly-backup] next full backup: ${next.toISOString()} (in ${Math.round(ms / 60000)} min)`);
    g.__nkWeeklyTimer = setTimeout(async () => {
      await runWeeklyFull("scheduled");
      await scheduleNextWeekly();
    }, ms);
    g.__nkWeeklyTimer.unref?.();
  };

  // first checks shortly after boot, then keep-alive intervals
  setTimeout(runLightSnapshot, 45_000).unref?.();
  g.__nkBackupTimer = setInterval(runLightSnapshot, 6 * 3600 * 1000);
  g.__nkBackupTimer.unref?.();

  void scheduleNextWeekly();
}
