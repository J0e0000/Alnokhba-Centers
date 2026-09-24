import { ok, handler, readJson } from "@/lib/api";
import { requireAdmin, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import {
  getBackupStatus, listExcelBackups, createExcelBackup, runWeeklyBackup,
  previewBackupDb, restoreMissingFromDb, RESTORE_TABLES_AR,
} from "@/lib/backup";
import { readFile, stat } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const BACKUP_DIR = path.join(process.cwd(), "backups");

/* ============================================================
   GET /api/admin/backup
   ?preview=<dbfile>  → معاينة محتوى نسخة .db (أعداد الجداول)
   ?download=<file>   → تنزيل نسخة (.db أو .xlsx)
   (افتراضي)          → حالة النسخ + القوائم + ميعاد الجدولة الجاية
============================================================ */
export const GET = handler(async (req: Request) => {
  const user = await requireAdmin();
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview");
  const download = url.searchParams.get("download");

  if (preview) {
    const data = await previewBackupDb(preview);
    return ok(data);
  }

  if (download) {
    const safe = path.basename(download);
    if (!safe.startsWith("nokhba-backup-") && !safe.startsWith("Alnokhba_Backup_")) {
      throw new ApiError("الملف ده مش نسخة احتياطية.", 400);
    }
    const target = path.join(BACKUP_DIR, safe);
    try {
      const st = await stat(target);
      const buf = await readFile(target);
      await logAudit({
        user,
        action: AUDIT.BACKUP_DOWNLOADED,
        entity: "BACKUP",
        entityId: safe,
        after: { size: st.size },
        reason: "تنزيل من بورتال الأدمن",
      });
      const isXlsx = safe.endsWith(".xlsx");
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": isXlsx
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(safe)}"`,
          "Content-Length": String(st.size),
        },
      });
    } catch {
      throw new ApiError("النسخة دي مش موجودة على السيرفر.", 404);
    }
  }

  const [status, excel] = await Promise.all([getBackupStatus(), listExcelBackups()]);
  return ok({
    status: {
      lastSuccessAt: status.lastSuccessAt,
      lastFailureAt: status.lastFailureAt,
      lastError: status.lastError,
      lastWeeklyAt: status.lastWeeklyAt ?? null,
      lastWeeklyTrigger: status.lastWeeklyTrigger ?? null,
      nextScheduledAt: status.nextScheduledAt ?? null,
      scheduleLabel: "كل يوم جمعة — 10:00 مساءً بتوقيت القاهرة",
    },
    dbBackups: status.backups,
    excelBackups: excel.map((e) => ({
      file: e.file, centerName: e.centerName, size: e.size, createdAt: e.createdAt,
      validated: e.validated, validationError: e.validationError ?? null,
      checksum: e.checksum.slice(0, 16), sheets: e.sheets.length,
    })),
    restoreTables: Object.entries(RESTORE_TABLES_AR).map(([table, label]) => ({ table, label })),
  });
});

/* ============================================================
   POST /api/admin/backup
   { action: "create" }                        → نسخة كاملة دلوقتي (db + Excel لكل السنترز)
   { action: "create-excel", centerId }        → مصنف Excel لسنتر واحد
   { action: "restore", file, tables: [...] }  → استعادة موجّهة (الصفوف الناقصة بس)
============================================================ */
export const POST = handler(async (req: Request) => {
  const user = await requireAdmin();
  const body = await readJson<{
    action?: string;
    centerId?: string;
    file?: string;
    tables?: string[];
  }>(req);

  if (body.action === "create") {
    const { dbFile, excelFiles } = await runWeeklyBackup("manual");
    await logAudit({
      user,
      action: AUDIT.BACKUP_CREATED,
      entity: "BACKUP",
      entityId: dbFile,
      after: { dbFile, excel: excelFiles.map((f) => ({ center: f.centerName, validated: f.validated })) },
      reason: "نسخة كاملة يدوية من بورتال الأدمن (db + Excel لكل السنترز + تحقق)",
    });
    return ok({ ok: true, dbFile, excelFiles });
  }

  if (body.action === "create-excel") {
    const meta = await createExcelBackup(String(body.centerId ?? ""), "manual");
    await logAudit({
      user,
      action: AUDIT.BACKUP_EXPORTED,
      entity: "BACKUP",
      entityId: meta.file,
      after: { center: meta.centerName, sheets: meta.sheets.length, checksum: meta.checksum.slice(0, 16) },
      reason: "تصدير مصنف Excel لسنتر واحد",
    });
    return ok({ ok: true, file: meta.file, sheets: meta.sheets.length, checksum: meta.checksum });
  }

  if (body.action === "restore") {
    const file = path.basename(String(body.file ?? ""));
    if (!file.startsWith("nokhba-backup-")) throw new ApiError("اختار نسخة .db صحيحة.", 400);
    const tables = Array.isArray(body.tables) ? body.tables.map(String) : [];
    if (tables.length === 0) throw new ApiError("اختار جدول واحد على الأقل للاستعادة.", 400);

    const results = await restoreMissingFromDb(file, tables);
    await logAudit({
      user,
      action: AUDIT.BACKUP_RESTORED,
      entity: "BACKUP",
      entityId: file,
      after: { tables: results },
      reason: "استعادة موجّهة — الصفوف الناقصة بس (مفيش أي حاجة اتمسحت أو اتعدلت)",
    });
    return ok({
      ok: true,
      file,
      results,
      note: "تمت إضافة الصفوف الناقصة من النسخة. الصفوف الموجودة خلاص فضلت زي ما هي — مفيش أي حاجة اتمسحت.",
    });
  }

  throw new ApiError("العملية دي مش معروفة.");
});
