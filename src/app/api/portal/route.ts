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

  const [unread, nextLesson, lastAnnouncement, qrDataUrl, balance] = await Promise.all([
    db.studentNotification.count({ where: { studentId: student.id, readAt: null } }),
    computeNextLesson(student.id),
    latestAnnouncementsFor(student.id, student.centerId, student.gradeId ?? null, 1),
    QRCode.toDataURL(student.qrToken, {
      margin: 1, width: 512, errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#FFFFFF" },
    }),
    studentBalance(student.id),
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
  });
});

// ============================= POST — دخول / خروج =============================

type LoginBody = { action?: string; code?: string; phone?: string };

export const POST = handler(async (req: Request) => {
  const body = await readJson<LoginBody>(req);

  if (body.action === "logout") {
    await destroyPortalSession();
    return ok({ ok: true });
  }

  if (body.action !== "login") throw new ApiError("طلب غير معروف.", 400);

  // rate-limit: 12 محاولة في 10 دقايق لكل IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  rateLimit(`portal-login:${ip}`, 12, 600_000);

  const result = await verifyStudentLogin(String(body.code ?? ""), String(body.phone ?? ""));
  if (!result.ok) throw new ApiError(result.error, 401);

  await createPortalSession(result.studentId);
  return ok({ ok: true });
});
