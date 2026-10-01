import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { todayStr } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import QRCode from "qrcode";
import {
  getPortalStudent, createPortalSession, destroyPortalSession, verifyStudentLogin,
} from "@/lib/portal-auth";
import { latestAnnouncementsFor, computeNextLesson } from "./schedule/route";

export const dynamic = "force-dynamic";

// ============================= GET — بيانات الرئيسية =============================

export const GET = handler(async () => {
  const student = await getPortalStudent();
  if (!student) return ok({ student: null });

  const [unread, nextLesson, lastAnnouncement, qrDataUrl, balance, progress] = await Promise.all([
    db.studentNotification.count({ where: { studentId: student.id, readAt: null } }),
    computeNextLesson(student.id),
    latestAnnouncementsFor(student.id, student.centerId, student.gradeId ?? null, 1),
    QRCode.toDataURL(student.qrToken, {
      margin: 1, width: 512, errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#FFFFFF" },
    }),
    studentBalance(student.id),
    portalProgress(student.id, student.centerId),
  ]);

  return ok({
    student: {
      id: student.id, name: student.name, code: student.code, qrToken: student.qrToken,
      gradeName: student.gradeName, qrDataUrl,
      center: student.center,
    },
    today: todayStr(),
    unread,
    balance,
    nextLesson,
    lastAnnouncement: lastAnnouncement[0] ?? null,
    progress,
  });
});

/**
 * نظرة تقدم الطالب (spec §1) — حتمية من داتا الحضور والكويزات:
 * نسبة الحضور آخر 30 يوم + إجمالي الحصص + متوسط الكويزات المصححة.
 */
async function portalProgress(studentId: string, centerId: string) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [attended, quizData] = await Promise.all([
    db.attendance.findMany({
      where: { studentId, createdAt: { gte: since }, session: { centerId, status: { not: "CANCELLED" } } },
      select: { status: true },
    }),
    db.quizAttempt.findMany({
      where: { studentId, status: "GRADED", quiz: { centerId } },
      select: { score: true, maxScore: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);
  const sessionsAttended = attended.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const graded = quizData.filter((a) => a.maxScore > 0);
  const quizAvg = graded.length
    ? Math.round(graded.reduce((s, a) => s + ((a.score ?? 0) / a.maxScore) * 100, 0) / graded.length)
    : null;
  return {
    sessionsAttended,
    sessionsTotal: attended.length,
    attendanceRate: attended.length ? Math.round((sessionsAttended / attended.length) * 100) : null,
    quizAvg,
    quizzesGraded: graded.length,
  };
}

// ============================= POST — دخول / خروج =============================

type LoginBody = { action?: string; code?: string; phone?: string };

export const POST = handler(async (req: Request) => {
  const body = await readJson<LoginBody>(req);

  if (body.action === "logout") {
    await destroyPortalSession();
    return ok({ ok: true });
  }

  if (body.action !== "login") throw new ApiError("طلب غير معروف.", 400);

  // rate-limit مزدوج: 12 محاولة/10 دقايق لكل IP + 6 محاولات/10 دقايق لكل كود
  // (تانيًا بيحمي حساب مستهدف لو المهاجم بدّل IPs)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  rateLimit(`portal-login:${ip}`, 12, 600_000);
  const codeKey = String(body.code ?? "").replace(/\D/g, "").slice(-5);
  if (codeKey) rateLimit(`portal-login-code:${codeKey}`, 6, 600_000);

  const result = await verifyStudentLogin(String(body.code ?? ""), String(body.phone ?? ""));
  if (!result.ok) throw new ApiError(result.error, 401);

  await createPortalSession(result.studentId);
  return ok({ ok: true });
});
