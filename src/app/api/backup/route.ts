import { db, dbMode } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { requireExportAdmin, centerParam } from "@/lib/export-guard";
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
  const user = await requireUser();
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const table = url.searchParams.get("table");
  const download = url.searchParams.get("download");

  if (download === "latest") {
    // ملف الـ .db الفيزيائي بيضم قاعدة المنصة كاملة (كل السنترات) — للأدمن بس
    // (spec المرحلة 1: أي تصفير بيانات بالجملة = أدمن المنصة فقط)
    if (user.role !== "ADMIN") {
      await logAudit({ user, action: AUDIT.EXPORT_DENIED, entity: "EXPORT", entityId: "backup-db-physical", reason: "محاولة تنزيل قاعدة البيانات الفيزيائية من غير دور الأدمن" }).catch(() => {});
      throw new ApiError("ملف قاعدة البيانات الفيزيائي بيضم كل السنترات — متاح للأدمن بس.", 403);
    }
    // اللقطة الفيزيائية (VACUUM INTO) للـ SQLite المحلي بس — الإنتاج Postgres له مسار منفصل
    // (سكريبت scripts/backup/postgres-backup.mts — توثيق كامل في docs/BACKUP-DR.md)
    if (dbMode() !== "local") {
      throw new ApiError("اللقطة الفيزيائية للمطور المحلي (SQLite) بس. الإنتاج (Postgres) بينسخ بسكريبت النسخ المنطقي — شوف docs/BACKUP-DR.md.", 400);
    }
    const { file } = await createBackup("manual");
    const bytes = await readFile(path.join(process.cwd(), "backups", file));
    await logAudit({ user, action: AUDIT.BACKUP_DOWNLOADED, entity: "CENTER", entityId: user.centerId ?? undefined, after: { file } });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file}"`,
      },
    });
  }

  // كل تصدير/حالة النسخ الاحتياطي = أدمن المنصة بس (spec المرحلة 1 + 2)
  const grant = await requireExportAdmin({ what: "backup-export", centerId: centerParam(url) });
  const user2 = grant.user;

  if (format === "json") {
    if (!grant.centerId) throw new ApiError("حدد السنتر المطلوب تصدير بياناته — أضف ?centerId=<معرف السنتر>.", 400);
    const payload = await exportCenterJson(grant.centerId);
    await logAudit({ user: { ...user2, centerId: grant.centerId }, action: AUDIT.BACKUP_EXPORTED, entity: "CENTER", entityId: grant.centerId, after: { format: "json", counts: payload.meta.counts } });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="nokhba-export-${stamp}.json"`,
      },
    });
  }

  if (format === "csv") {
    if (!grant.centerId) throw new ApiError("حدد السنتر المطلوب تصدير جدوله — أضف ?centerId=<معرف السنتر>.", 400);
    const key = (CSV_TABLES.find((t) => t.key === table)?.key ?? null) as CsvTableKey | null;
    if (!key) throw new ApiError("اختار جدول التصدير من القائمة.");
    const { filename, csv } = await exportCenterCsv(grant.centerId, key);
    await logAudit({ user: { ...user2, centerId: grant.centerId }, action: AUDIT.BACKUP_EXPORTED, entity: "CENTER", entityId: grant.centerId, after: { format: "csv", table: key } });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
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

/** POST /api/backup — trigger a backup snapshot right now (admin only — spec المرحلة 2) */
export const POST = handler(async (req: Request) => {
  const url = new URL(req.url);
  const { user } = await requireExportAdmin({ what: "backup-create", centerId: centerParam(url) });
  const { file, size } = await createBackup("manual");
  await logAudit({ user, action: AUDIT.BACKUP_CREATED, entity: "CENTER", entityId: user.centerId ?? undefined, after: { file, size } });
  return ok({ file, size, status: await getBackupStatus() }, { status: 201 });
});
