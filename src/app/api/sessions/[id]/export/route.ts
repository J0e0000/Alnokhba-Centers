import { db } from "@/lib/db";
import { handler } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/sessions/[id]/export — تصدير CSV نظيف يفتح في Excel
   (spec §11/§12 — لحصص الحضور المفتوح المقفولة بالأساس، وشغال للكشف كمان)
   ------------------------------------------------------------
   - UTF-8 مع BOM: الأسماء العربية بتظهر صح في Excel من غير تحويل ترميز
   - أسطر CRLF + escaping صحيح (فواصل/اقتباسات/أسطر جوه الخلية)
   - أعمدة واضحة فقط — مفيش أي بيانات أمنية (device/token/risk/IP — spec §11)
   - الناجح بس: كل صف في جدول Attendance = حضور ناجح (التكرار ممنوع
     على مستوى الداتابيز unique(sessionId, deviceId)/(sessionId, studentId))
     فمفيش صفوف مكررة من retry/refresh/clicks (spec §13)
============================================================ */

type Ctx = { params: Promise<{ id: string }> };

const STATUS_LABEL: Record<string, string> = { PRESENT: "حاضر", LATE: "متأخر", EXCUSED: "بعذر" };

/** escaping CSV: خلية فيها فواصل/اقتباسات/سطر جديد تتقفل في اقتباسات والاقتباس الداخلي يتضاعف */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** اسم ملف آمن: منع / \ : * ? " < > | وحروف التحكم — ومفيش نقاط في الآخر (Windows) */
function sanitizeFilename(name: string): string {
  const clean = name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 60);
  return clean || "session";
}

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireCenterUser();
  const { id } = await ctx.params;

  const session = await db.sessionInstance.findFirst({
    where: { id, centerId: user.centerId },
    include: {
      group: { include: { subject: true, grade: true } },
      attendance: {
        include: { student: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: "asc" }, // بترتيب وقت التسجيل — كشف زمني نظيف
      },
    },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);
  if (session.status !== "CLOSED") {
    throw new ApiError("التصدير متاح بعد قفل الحصة بس — اقفل الحصة الأول.", 400);
  }

  const sessionName = session.group?.subject.name ?? session.name ?? "حصة";
  const label = session.group
    ? `${sessionName} — ${session.group.grade.name} ${session.group.name}`
    : sessionName;

  const header = [
    "اسم الطالب",
    "كود الطالب",
    "حالة الحضور",
    "وقت التسجيل",
    "اسم الحصة",
    "تاريخ الحصة",
    "معرف الطالب",
    "نوع التسجيل",
  ];

  const rows = session.attendance.map((a) => {
    const d = a.createdAt;
    const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return [
      a.student?.name ?? a.studentName ?? "",
      a.student?.code ?? a.studentCode ?? "",
      STATUS_LABEL[a.status] ?? a.status,
      time,
      label,
      session.date,
      a.studentId ?? "",
      a.studentId ? "مسجل" : "غير مسجل",
    ].map(csvCell).join(",");
  });

  // BOM + CRLF = صيغة Excel الودّية (العربي بيظهر صح والصفوف مش بتتبوظ)
  const csv = "\uFEFF" + [header.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";

  await logAudit({
    user,
    action: AUDIT.ATTENDANCE_EXPORTED,
    entity: "SESSION",
    entityId: session.id,
    reason: `تصدير CSV لحضور الحصة (${session.attendance.length} سجل)`,
  }).catch(() => {});

  const filename = `attendance-${sanitizeFilename(label)}-${session.date}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
});
