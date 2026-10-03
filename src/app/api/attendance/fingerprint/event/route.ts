import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager, ApiError, rateLimit } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { createHash } from "crypto";
import { getCenterCapabilities } from "@/lib/center-capabilities";
import { verifyFingerprint } from "@/lib/fingerprint";
import { recordAttendanceEvent } from "@/lib/attendance-core";
import { effectivePrice } from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/fingerprint/event — جهاز البصمة (أو اختبار المدير) بيبعت حدث بصمة.
 *
 * المصادقة: X-Device-Key (جهاز بصمة مسجل) — أو جلسة مدير (اختبار/محاكاة).
 * - قدرة fingerprint لازم تكون مفعّلة
 * - المطابقة: DEVICE_MATCHED (الجهاز بيبعت templateHash) أو SERVER_MATCH (template خام → hash)
 * - النجاح = حدث موحّد في سجل الحضور (method FINGERPRINT)
 * - لو شخص = طالب وفيه حصة مفتوحة النهاردة لمجموعة مسجل فيها → حضور الحصة يتسجل ويُشحن
 * - الفشل بيرجع رد واضح (404) من غير كشف أي بيانات — وبيتسجل في الـ audit
 */

type EventBody = {
  template?: string; // SERVER_MATCH — قالب خام (اختبار/محاكاة)
  templateHash?: string; // DEVICE_MATCHED — الجهاز عمل المطابقة بنفسه
  sessionId?: string; // اختياري: حصة محددة — بدونها بنحاول نلحق حصة مفتوحة
};

function deviceKeyHash(req: Request): string | null {
  const key = (req.headers.get("x-device-key") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{32,96}$/.test(key)) return null;
  return createHash("sha256").update(key).digest("hex");
}

export const POST = handler(async (req: Request) => {
  const body = await readJson<EventBody>(req);

  // ===== المصادقة: جهاز بصمة مسجل أو مدير =====
  const dkHash = deviceKeyHash(req);
  let centerId: string | null = null;
  let deviceId: string | null = null;
  let actorLabel = "";

  if (dkHash) {
    const device = await db.attendanceDevice.findFirst({ where: { keyHash: dkHash } });
    if (!device || !device.active || device.kind !== "FINGERPRINT_SCANNER") {
      throw new ApiError("جهاز البصمة ده مش مسجل أو متوقف.", 401);
    }
    void db.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    centerId = device.centerId;
    deviceId = device.id;
    actorLabel = `جهاز: ${device.name}`;
  } else {
    const user = await requireManager();
    centerId = user.centerId;
    actorLabel = user.name;
  }
  if (!centerId) throw new ApiError("مش قادرين نحدد المركز.", 403);

  rateLimit(`fp-event:${centerId}:${deviceId ?? "mgr"}`, 120, 60_000);

  const caps = await getCenterCapabilities(centerId);
  if (!caps.fingerprint.enabled) {
    throw new ApiError("حضور البصمة مقفول في المركز.", 403);
  }

  // ===== المطابقة ضد البصمات المسجلة =====
  const enrollments = await db.fingerprintEnrollment.findMany({
    where: { centerId, active: true },
    select: {
      id: true, templateHash: true, displayName: true, personType: true,
      studentId: true, userId: true, teacherId: true,
    },
  });
  const result = await verifyFingerprint(centerId, body, enrollments);

  if (!result.matched) {
    await logAudit({
      user: { id: deviceId ? `device:${deviceId}` : "fingerprint", name: actorLabel, centerId },
      action: AUDIT.FINGERPRINT_EVENT,
      entity: "FINGERPRINT",
      reason: "بصمة غير مطابقة لأي مسجل",
      after: { mode: result.mode },
    }).catch(() => {});
    return ok({ ok: false, reason: "NO_MATCH", message: "البصمة دي مش مسجلة في المركز — راجع المدير." }, { status: 200 });
  }

  // ===== حدث الحضور الموحد =====
  const isStudent = result.personType === "STUDENT";
  let sessionId: string | null = null;
  let charged: number | null = null;
  let attendanceLinked: string | null = null;

  if (isStudent && result.studentId) {
    // لحق أقرب حصة مفتوحة النهاردة (أو اللي بعتها الجهاز) للطالب
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const student = await db.student.findFirst({
      where: { id: result.studentId },
      include: { registrations: { where: { status: "ACTIVE" } } },
    });
    if (student && student.status !== "ARCHIVED") {
      const session = body.sessionId
        ? await db.sessionInstance.findFirst({ where: { id: body.sessionId, centerId, status: "OPEN" }, include: { group: { include: { subject: true } } } })
        : await db.sessionInstance.findFirst({
            where: {
              centerId, status: "OPEN", date: today,
              groupId: { in: student.registrations.map((r) => r.groupId) },
            },
            include: { group: { include: { subject: true } } },
            orderBy: { startTime: "asc" },
          });
      if (session) {
        const reg = student.registrations.find((r) => r.groupId === session.groupId);
        if (reg) {
          const existing = await db.attendance.findUnique({
            where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
          });
          if (!existing) {
            const price = effectivePrice(reg.priceOverride, null, session.price);
            const att = await db.attendance.create({
              data: {
                centerId, sessionId: session.id, studentId: student.id,
                status: "PRESENT", charged: price, method: "FINGERPRINT",
                note: "حضور ببصمة — جهاز المركز",
              },
            }).catch(() => null);
            if (att) {
              attendanceLinked = att.id;
              sessionId = session.id;
              charged = price;
              if (price > 0) {
                await db.studentTransaction.create({
                  data: {
                    centerId, studentId: student.id, sessionId: session.id, type: "CHARGE",
                    amount: -price, reason: `حصة ${session.group.subject.name} (بصمة)`,
                    createdBy: "FINGERPRINT",
                  },
                }).catch(() => {});
              }
            }
          } else {
            sessionId = session.id; // حاضر خلاص — الحدث للتدقيق بس
          }
        }
      }
    }
  }

  const eventId = await recordAttendanceEvent({
    centerId,
    personType: isStudent ? "STUDENT" : "STAFF",
    method: "FINGERPRINT",
    status: "CHECK_IN",
    studentId: isStudent ? result.studentId : null,
    userId: !isStudent ? result.userId : null,
    teacherId: !isStudent ? result.teacherId : null,
    displayName: result.displayName ?? "مستخدم بصمة",
    role: isStudent ? "STUDENT" : "STAFF",
    sessionId,
    deviceId,
    metadata: { mode: result.mode, enrollmentId: result.enrollmentId, charged, attendanceLinked },
  }, { critical: true });

  await db.fingerprintEnrollment.update({
    where: { id: result.enrollmentId! },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  await logAudit({
    user: { id: deviceId ? `device:${deviceId}` : "fingerprint", name: actorLabel, centerId },
    action: AUDIT.FINGERPRINT_EVENT,
    entity: "ATTENDANCE_EVENT",
    entityId: eventId ?? undefined,
    after: { person: result.displayName, personType: result.personType, mode: result.mode, linkedAttendance: attendanceLinked },
    reason: "حضور ببصمة — مطابقة ناجحة",
  });

  return ok({
    ok: true,
    displayName: result.displayName,
    personType: result.personType,
    sessionLinked: !!attendanceLinked,
    eventId,
  });
});
