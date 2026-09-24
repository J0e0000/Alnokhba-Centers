import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { createBackup, getBackupStatus, exportCenterJson, exportCenterCsv, CSV_TABLES, type CsvTableKey } from "@/lib/backup";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/backup — center data export + backup status (manager only).
 *   ?format=json          → versioned logical JSON export (faithful restore)
 *   ?format=csv&table=X   → operational CSV (BOM for Excel Arabic)
 *   ?download=latest      → physical .db snapshot download
 *   (no params)           → backup status + available tables
 */
export const GET = handler(async (req: Request) => {
  const user = await requireManager();
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const table = url.searchParams.get("table");
  const download = url.searchParams.get("download");

  if (format === "json") {
    const payload = await exportCenterJson(user.centerId);
    await logAudit({ user, action: AUDIT.BACKUP_EXPORTED, entity: "CENTER", entityId: user.centerId, after: { format: "json", counts: payload.meta.counts } });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="nokhba-export-${stamp}.json"`,
      },
    });
  }

  if (format === "csv") {
    const key = (CSV_TABLES.find((t) => t.key === table)?.key ?? null) as CsvTableKey | null;
    if (!key) throw new ApiError("اختار جدول التصدير من القائمة.");
    const { filename, csv } = await exportCenterCsv(user.centerId, key);
    await logAudit({ user, action: AUDIT.BACKUP_EXPORTED, entity: "CENTER", entityId: user.centerId, after: { format: "csv", table: key } });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (download === "latest") {
    const { file } = await createBackup("manual");
    const bytes = await readFile(path.join(process.cwd(), "backups", file));
    await logAudit({ user, action: AUDIT.BACKUP_DOWNLOADED, entity: "CENTER", entityId: user.centerId, after: { file } });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file}"`,
      },
    });
  }

  const status = await getBackupStatus();
  return ok({
    status,
    tables: CSV_TABLES,
    autoBackup: {
      enabled: true,
      intervalHours: 24,
      retention: 7,
      storage: "server-local-disk",
      note: "نسخ تلقائية يومية على قرص السيرفر (آخر 7 نسخ). التنزيل اليدوي بينزّل نسخة جديدة فوراً — دي الضمانة الأكيدة لو الجهاز نفسه اتباور.",
    },
  });
});

/** POST /api/backup — trigger a backup snapshot right now (manager) */
export const POST = handler(async () => {
  const user = await requireManager();
  const { file, size } = await createBackup("manual");
  await logAudit({ user, action: AUDIT.BACKUP_CREATED, entity: "CENTER", entityId: user.centerId, after: { file, size } });
  return ok({ file, size, status: await getBackupStatus() }, { status: 201 });
});
