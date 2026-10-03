import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { hasCapability } from "@/lib/center-capabilities";
import { verifySightingPv } from "@/lib/checkin-pv";
import { assessCheckInRisk, STAFF_NOTIFY_SCORE, riskSummary, type RiskFlag } from "@/lib/attendance-risk";
import { recordAttendanceEvent } from "@/lib/attendance-core";
import { logAudit, AUDIT } from "@/lib/audit";
import { effectivePrice } from "@/lib/finance";
import { notifyStudentsAttendance } from "@/lib/notify";
import { notifyStaff } from "@/lib/staff-notify";

export const dynamic = "force-dynamic";

/* ============================================================
   POST /api/attendance/public/check-in — الحضور العام بقفل الجهاز
   (Session-Scoped Device-Locked Attendance — "جهاز واحد = حضور واحد ناجح لكل حصة")
   ------------------------------------------------------------
   طالب يمسح كود QR شاشة الحصة بكاميرا موبايله → الصفحة العامة /a/<token>
   بتفتح من غير أي تسجيل دخول → يكتب كود الطالب → حضور في ثواني.

   هوية الطالب = كود الطالب (زي كارت الحضور) + الجهاز بيتقفل بعد أول نجاح.
   الطبقات (spec §28): توكن متغير قصير العمر + إثبات sighting موقّع + تحقق
   الحصة/الطالب + قفل جهاز على مستوى الداتابيز unique(sessionId, deviceId)
   + إشارات خطورة + تدقيق كامل. القاعدة النهائية في الداتابيز نفسها —
   أي سباق (طلبان في نفس اللحظة) بيكسر unique وبيترفض.

   ترتيب التحقق (spec §10) — كل خطوة قبل اللي بعدها، وكل محاولة بتتسجل
   في CheckInAttempt (نجاح أو رفض) عشان لوحة "النشاط المشبوه" والتدقيق.
============================================================ */

type Body = { token?: string; code?: string; deviceId?: string; pv?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 40) || "unknown";
}

function todayStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export const POST = handler(async (req: Request) => {
  const body = await readJson<Body>(req);
  const token = String(body.token ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const deviceId = String(body.deviceId ?? "").trim();
  const pv = String(body.pv ?? "").trim();
  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 240);
  const tokenTail = token.slice(-8);

  // ===== 1) صحة الطلب (Structure) =====
  if (!/^[0-9a-f]{16,64}$/.test(token)) throw new ApiError("رابط الحضور مش صالح.", 400);
  if (!/^\d{3,10}$/.test(code)) throw new ApiError("اكتب كود الطالب صح (أرقام بس).", 400);
  if (!UUID_RE.test(deviceId)) throw new ApiError("معرّف الجهاز ناقص — حدّث الصفحة وجرب تاني.", 400);

  // ===== 2) حدود محاولات (نحّاس خارجي — مش بيتسجل في المحاولات) =====
  rateLimit(`pub-checkin:${token.slice(-10)}:${ip}`, 12, 60_000);
  rateLimit(`pub-checkin-ip:${ip}`, 40, 60_000);

  // سجل محاولة في سجل التدقيق (بعد ما نعرف الحصة) — أي رفض/قبول بيتوثق
  async function attempt(input: {
    centerId: string; sessionId: string; outcome: string;
    studentId?: string | null; studentCode?: string | null;
    riskScore?: number; riskFlags?: RiskFlag[];
  }) {
    await db.checkInAttempt.create({
      data: {
        centerId: input.centerId, sessionId: input.sessionId, outcome: input.outcome,
        studentId: input.studentId ?? null, studentCode: input.studentCode?.slice(0, 12) ?? null,
        deviceId, ipAddress: ip, userAgent: ua,
        riskScore: input.riskScore ?? 0,
        riskFlags: input.riskFlags?.length ? JSON.stringify(input.riskFlags) : null,
        tokenTail,
      },
    }).catch(() => {});
  }

  // ===== 3) التوكن (صالح/منتهي/متدوّر + نافذة السماح بإثبات sighting) =====
  const qr = await db.sessionQRToken.findUnique({ where: { token } });
  if (!qr) {
    await logAudit({
      user: { id: "QR_UNKNOWN", name: "محاولة حضور عام بكود غير معروف", centerId: null },
      action: AUDIT.PUBLIC_CHECKIN_REJECTED, entity: "PUBLIC_CHECKIN", entityId: tokenTail,
      reason: "INVALID_TOKEN", after: { ip },
    }).catch(() => {});
    throw new ApiError("كود الحضور ده مش معروف — امسح الكود اللي على شاشة الحصة.", 404);
  }
  if (qr.scope !== "CENTERS" || !qr.centerId) throw new ApiError("الكود ده مش كود حضور سنترز.", 400);

  const live = qr.isActive && qr.expiresAt.getTime() >= Date.now();
  let grace = false;
  if (!live) {
    // الكود مش حي دلوقتي — السماح الوحيدة: إثبات sighting موقّع (شاف الكود وهو حي من نفس الجهاز)
    const verdict = pv ? verifySightingPv(pv, qr.id, deviceId, qr.expiresAt) : { ok: false as const, reason: "NO_PV" as const };
    if (!verdict.ok) {
      const outcome = qr.isActive ? "EXPIRED_TOKEN" : "REPLAYED_TOKEN";
      await attempt({ centerId: qr.centerId, sessionId: qr.sessionId, outcome });
      await logAudit({
        user: { id: "QR_UNKNOWN", name: "محاولة حضور عام مرفوضة", centerId: qr.centerId },
        action: outcome === "EXPIRED_TOKEN" ? AUDIT.QR_SCAN_EXPIRED : AUDIT.QR_SCAN_REPLAY,
        entity: "PUBLIC_CHECKIN", entityId: qr.sessionId,
        reason: `${outcome}${pv ? ` (pv: ${verdict.reason ?? "INVALID"})` : " (بدون pv)"}`,
        after: { ip, studentCode: code.slice(0, 12) },
      }).catch(() => {});
      return ok({
        ok: false, reason: outcome,
        message: qr.isActive
          ? "الكود انتهت صلاحيته — امسح الكود الجديد من شاشة الحصة."
          : "الكود ده قديم — الكود بيتجدد أوتوماتيك على الشاشة، امسح الكود الجديد.",
      });
    }
    grace = true;
  }

  // ===== 4) قدرة المركز (server-side enforcement — مش إخفاء UI) =====
  if (!(await hasCapability(qr.centerId, "dynamic_qr"))) {
    await attempt({ centerId: qr.centerId, sessionId: qr.sessionId, outcome: "CAPABILITY_OFF" });
    throw new ApiError("خدمة الحضور بكود الحصة مش متاحة في السنتر ده حاليًا.", 403);
  }

  // ===== 5) الحصة (موجودة + مفتوحة + بتاريخ النهاردة) =====
  const session = await db.sessionInstance.findFirst({
    where: { id: qr.sessionId, centerId: qr.centerId },
    include: { group: { include: { subject: true } } },
  });
  if (!session) return ok({ ok: false, reason: "NO_SESSION", message: "الحصة دي مش موجودة." });
  if (session.status === "CANCELLED") {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "CANCELLED_SESSION" });
    return ok({ ok: false, reason: "CANCELLED_SESSION", message: "الحصة دي ملغاة — راجع إعلانات السنتر." });
  }
  if (session.status === "CLOSED") {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "CLOSED_SESSION" });
    return ok({ ok: false, reason: "CLOSED_SESSION", message: "الحصة اتقفلت — الحضور بيتسجل قبل القفل بس." });
  }
  if (session.date !== todayStr()) {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "NOT_TODAY" });
    return ok({ ok: false, reason: "NOT_TODAY", message: "الكود ده لحصة تانية مش حصة النهاردة." });
  }

  // ===== 6) الطالب (موجود في السنتر + نشط) =====
  const student = await db.student.findFirst({ where: { centerId: qr.centerId, code } });
  if (!student) {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INVALID_STUDENT", studentCode: code });
    return ok({ ok: false, reason: "INVALID_STUDENT", message: "الكود ده مش معروف — اتأكد من كودك أو كلّم الاستقبال." });
  }
  if (student.status !== "ACTIVE") {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INACTIVE_STUDENT", studentId: student.id, studentCode: code });
    return ok({ ok: false, reason: "INACTIVE_STUDENT", message: "حالة الطالب دي مش نشطة — كلّم الاستقبال." });
  }

  // ===== 7) التسجيل في مجموعة الحصة (زي باقي طرق الحضور بالظبط) =====
  const reg = await db.studentGroup.findFirst({
    where: { groupId: session.groupId, studentId: student.id, status: "ACTIVE" },
  });
  if (!reg) {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "NOT_REGISTERED", studentId: student.id, studentCode: code });
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.UNAUTHORIZED_ATTENDANCE, entity: "PUBLIC_CHECKIN", entityId: session.id,
      reason: `طالب مش مسجل في مجموعة الحصة (${session.group.subject.name})`,
      after: { studentCode: student.code, ip },
    }).catch(() => {});
    void notifyStaff(qr.centerId, {
      type: "ATTENDANCE", title: "محاولة حضور مرفوضة",
      body: `${student.name} (كود ${student.code}) حاول يسجّل حضوره في ${session.group.subject.name} من كود الحصة العام وهو مش مسجل في المجموعة.`,
      link: "today",
    }).catch(() => {});
    return ok({ ok: false, reason: "NOT_REGISTERED", message: "انت مش مسجل في مجموعة الحصة دي — كلّم الاستقبال يسجلّك الأول." });
  }

  // ===== 8) فحوص سريعة ودّية قبل الإدخال (القاعدة النهائية في الداتابيز) =====
  const byStudent = await db.attendance.findUnique({
    where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
  });
  if (byStudent) {
    // نفس الطالب متسجل — إعادة محاولة/ريفرش/نفس الطالب من جهاز تاني = رد آمن idempotent
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "ALREADY_SAME_STUDENT", studentId: student.id, studentCode: code });
    return ok({
      ok: true, alreadyAttended: true,
      studentName: student.name, studentCode: student.code,
      sessionLabel: `${session.group.subject.name} — ${session.date} ${session.startTime}`,
      status: byStudent.status,
    });
  }
  const byDevice = await db.attendance.findUnique({
    where: { sessionId_deviceId: { sessionId: session.id, deviceId } },
  });
  if (byDevice) {
    // ⛔ القاعدة الأساسية: الجهاز ده سجّل حضور لطالب تاني في نفس الحصة
    await attempt({
      centerId: qr.centerId, sessionId: session.id, outcome: "DEVICE_LOCKED",
      studentId: student.id, studentCode: code,
      riskScore: 80, riskFlags: ["DEVICE_REUSED", "MULTIPLE_STUDENTS_SAME_DEVICE"],
    });
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.DEVICE_ALREADY_USED, entity: "PUBLIC_CHECKIN", entityId: session.id,
      reason: "جهاز واحد حاول يسجّل طالبين في نفس الحصة — القاعدة: جهاز = حضور واحد لكل حصة",
      after: { studentCode: student.code, ip, deviceTail: deviceId.slice(-6) },
    }).catch(() => {});
    void notifyStaff(qr.centerId, {
      type: "ATTENDANCE", title: "⚠️ جهاز حاول يسجّل طالبين",
      body: `في ${session.group.subject.name}: جهاز اتسجل بيه حضور قبل كده حاول يسجّل ${student.name} (كود ${student.code}) — اترفض تلقائيًا.`,
      link: "today", refId: session.id,
    }).catch(() => {});
    return ok({
      ok: false, reason: "DEVICE_LOCKED",
      message: "الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل — كل طالب بيسجّل من موبايله بنفسه.",
    });
  }

  // ===== 9) إشارات الخطورة (علم للمراجعة — مش رفض؛ IP مش هوية — spec §14) =====
  const risk = await assessCheckInRisk({ sessionId: session.id, deviceId, ipAddress: ip });
  if (risk.score >= STAFF_NOTIFY_SCORE) {
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.SUSPICIOUS_ACTIVITY, entity: "PUBLIC_CHECKIN", entityId: session.id,
      reason: riskSummary(risk), after: { riskScore: risk.score, ip, deviceTail: deviceId.slice(-6) },
    }).catch(() => {});
  }

  // ===== 10) الإدخال الذري — unique(sessionId, deviceId) هو الحَكم النهائي (spec §8/§11) =====
  const price = effectivePrice(reg.priceOverride, null, session.price);
  const charge = price; // PRESENT
  const sessionLabel = `${session.group.subject.name} — ${session.date} ${session.startTime}`;

  let attendanceId: string;
  let already = false;
  let attendanceStatus = "PRESENT";
  try {
    const attendance = await db.attendance.create({
      data: {
        centerId: qr.centerId, sessionId: session.id, studentId: student.id,
        status: "PRESENT", charged: charge, method: "SESSION_QR",
        note: grace ? "حضور عام — QR الحصة (نافذة سماح)" : "حضور عام — QR الحصة (قفل جهاز)",
        deviceId, ipAddress: ip, userAgent: ua,
        riskScore: risk.score,
        riskFlags: risk.flags.length ? JSON.stringify(risk.flags) : null,
      },
    });
    attendanceId = attendance.id;
    attendanceStatus = attendance.status;
  } catch (e) {
    // سباق؟ الداتابيز حَكمت — حدّد مين الـ unique اللي اتكسر
    const msg = e instanceof Error ? e.message : String(e);
    const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? "");
    if (/unique constraint|P2002/i.test(msg)) {
      if (/deviceId/i.test(`${target} ${msg}`)) {
        const dev = await db.attendance.findUnique({ where: { sessionId_deviceId: { sessionId: session.id, deviceId } } });
        if (dev && dev.studentId === student.id) {
          already = true; attendanceId = dev.id; attendanceStatus = dev.status; // نفس الطالب كسب قبله
        } else {
          await attempt({
            centerId: qr.centerId, sessionId: session.id, outcome: "DEVICE_LOCKED",
            studentId: student.id, studentCode: code,
            riskScore: 80, riskFlags: ["DEVICE_REUSED", "MULTIPLE_STUDENTS_SAME_DEVICE"],
          });
          await logAudit({
            user: { id: student.id, name: student.name, centerId: qr.centerId },
            action: AUDIT.DEVICE_ALREADY_USED, entity: "PUBLIC_CHECKIN", entityId: session.id,
            reason: "سباق متزامن — قاعدة الداتابيز رفضت الجهاز",
            after: { studentCode: student.code, ip },
          }).catch(() => {});
          return ok({ ok: false, reason: "DEVICE_LOCKED", message: "الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل — كل طالب بيسجّل من موبايله بنفسه." });
        }
      } else {
        const st = await db.attendance.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } } });
        if (st) { already = true; attendanceId = st.id; attendanceStatus = st.status; }
        else throw e;
      }
    } else {
      throw e;
    }
  }

  // ===== 11) التوثيق والإشعارات (نفس نمط claim — الحضور اثبت، الخصم لو فشل يتراجع يدويًا) =====
  if (!already) {
    if (charge > 0) {
      await db.studentTransaction.create({
        data: {
          centerId: qr.centerId, studentId: student.id, sessionId: session.id,
          type: "CHARGE", amount: -charge,
          reason: `حصة ${session.group.subject.name} (QR الحصة — حضور عام)`,
          createdBy: "PUBLIC_QR",
        },
      }).catch((err) => { console.error("[public-qr-charge-failed]", err); });
    }
    await db.sessionQRToken.update({
      where: { id: qr.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    }).catch(() => {});
    await recordAttendanceEvent({
      centerId: qr.centerId, personType: "STUDENT", method: "DYNAMIC_QR", status: "PRESENT",
      studentId: student.id, displayName: student.name, role: "STUDENT",
      sessionId: session.id,
      metadata: { public: true, grace, deviceTail: deviceId.slice(-6), risk: risk.flags, sessionLabel },
    });
    await logAudit({
      user: { id: student.id, name: student.name, centerId: qr.centerId },
      action: AUDIT.QR_SCAN_SUCCESS, entity: "ATTENDANCE", entityId: attendanceId,
      after: { student: student.name, session: session.group.subject.name, method: "PUBLIC_QR", charged: charge, risk: risk.flags },
      reason: grace ? "حضور عام (نافذة سماح — شاف الكود وهو حي)" : "حضور عام — قفل جهاز",
    });
    void notifyStudentsAttendance(
      qr.centerId, [student.id],
      "تم تسجيل حضورك ✅",
      `حصة ${session.group.subject.name} — حضورك اتحسب بنجاح. بالتوفيق!`,
    ).catch(() => {});
    void notifyStaff(qr.centerId, {
      type: "ATTENDANCE", title: "حضور ذاتي — QR الحصة",
      body: `${student.name} سجّل حضوره بنفسه في ${session.group.subject.name} (${sessionLabel}).`,
      link: "today", refId: session.id,
    }).catch(() => {});
  }

  // ===== 12) سجل المحاولة (للوحة النشاط المشبوه) =====
  await attempt({
    centerId: qr.centerId, sessionId: session.id,
    outcome: already ? "ALREADY_ATTENDED" : "ACCEPTED",
    studentId: student.id, studentCode: code,
    riskScore: risk.score, riskFlags: risk.flags,
  });

  // الرد العام مفيهوش بيانات مالية ولا أرصدة (خصوصية — صفحة من غير تسجيل دخول)
  return ok({
    ok: true, alreadyAttended: already,
    studentName: student.name, studentCode: student.code,
    sessionLabel, status: attendanceStatus,
  });
});
