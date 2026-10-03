import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { riskFlagLabel } from "@/lib/attendance-risk";

export const dynamic = "force-dynamic";

/* ============================================================
   GET /api/attendance/public/attempts?sessionId= — للموظفين فقط
   مصدر قسم "النشاط المشبوه" في لوحة الحصة (spec §16):
   - كل محاولات الحضور العام (نجاح/رفض) مع علامات الخطورة بالعربي
   - IP مُقنّع (أول جزئين بس — إشارة شبكة، مش هوية) + ذيل الجهاز
   - مفيش بيانات حساسة: أسماء الطلاب بتظهر بس لو الكود اتحل لطالب فعلي
============================================================ */

/** إخفاء جزء من الـ IP — إشارة شبكة للمراجعة، مش قيمة تعريفية كاملة */
function maskIp(ip: string | null): string | null {
  if (!ip || ip === "unknown") return null;
  if (ip.includes(".")) {
    const p = ip.split(".");
    return p.length >= 2 ? `${p[0]}.${p[1]}.•.•` : ip;
  }
  return ip.slice(0, 6) + "…";
}

/** إخفاء جزء من الـ UUID (غير معنوي أصلًا — بس للتناسق) */
function deviceTail(d: string | null): string | null {
  return d ? d.slice(-6) : null;
}

export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
  if (!sessionId) throw new ApiError("محتاج رقم الحصة.", 400);

  // ملكية: الحصة لازم تكون من سنتر الموظف
  const session = await db.sessionInstance.findFirst({
    where: { id: sessionId, centerId: user.centerId },
    select: { id: true },
  });
  if (!session) throw new ApiError("الحصة دي مش موجودة.", 404);

  const rows = await db.checkInAttempt.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // أسماء الطلبة اللي اتحلو من كود صحيح
  const studentIds = Array.from(new Set(rows.map((r) => r.studentId).filter(Boolean))) as string[];
  const students = studentIds.length
    ? await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(students.map((s) => [s.id, s.name]));

  // مشبوه = مرفوض/منتهي/جهاز متقفل/درجة خطورة > 0 (القبول العادي مش مشبوه)
  const BENIGN = new Set(["ACCEPTED", "ALREADY_SAME_STUDENT", "ALREADY_ATTENDED"]);
  const attempts = rows.map((r) => {
    let flags: string[] = [];
    try { flags = r.riskFlags ? (JSON.parse(r.riskFlags) as string[]) : []; } catch { /* تجاهل */ }
    return {
      id: r.id,
      outcome: r.outcome,
      studentName: r.studentId ? nameOf.get(r.studentId) ?? null : null,
      studentCode: r.studentCode,
      riskScore: r.riskScore,
      riskFlags: flags.map(riskFlagLabel),
      deviceTail: deviceTail(r.deviceId),
      ip: maskIp(r.ipAddress),
      at: r.createdAt,
    };
  });
  const suspiciousCount = attempts.filter((a) => !BENIGN.has(a.outcome) || a.riskScore > 0).length;

  return ok({ attempts, suspiciousCount });
});
