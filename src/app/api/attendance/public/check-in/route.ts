import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { ApiError, rateLimit } from "@/lib/auth";
import { hasCapability } from "@/lib/center-capabilities";
import { verifySightingPv } from "@/lib/checkin-pv";
import { verifyRoomPin } from "@/lib/room-pin";
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
   بتفتح من غير أي تسجيل دخول → يكتب اسمه + كود الطالب → حضور في ثواني.

   وضعا الحصة (spec §1):
   - ROSTER (كشف/مجموعة): الكود بيتطابق مع قاعدة بيانات السنتر + التسجيل في
     مجموعة الحصة. الطالب مش موجود؟ إعداد الحصة allowUnregistered بيحدد:
     يترفض، أو يتقبل كـ"غير مسجل" (بيتسجل باسمه المكتوب من غير خصم).
   - OPEN (حضور مفتوح): مفيش كشف خالص — الاسم + كود بطول محدد من إعدادات
     الحصة (3..12 — قابل للضبط، ممنوع hardcode) ويتسجل زي ما هو.

   هوية الجهاز = القاعدة الأساسية: جهاز واحد = حضور واحد ناجح لكل حصة —
   محفوظة في الداتابيز نفسها unique(sessionId, deviceId) مش في الكود.

   الطبقات (spec §28): توكن متغير قصير العمر + إثبات sighting موقّع + تحقق
   الحصة + قفل جهاز على مستوى الداتابيز + إشارات خطورة + تدقيق كامل.

   ترتيب التحقق (spec §10) — كل خطوة قبل اللي بعدها، وكل محاولة بتتسجل
   في CheckInAttempt (نجاح أو رفض) عشان لوحة "النشاط المشبوه" والتدقيق.
============================================================ */

type Body = { token?: string; code?: string; name?: string; deviceId?: string; pv?: string; fp?: string; pin?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FP_RE = /^[0-9a-f]{32,64}$/;

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 40) || "unknown";
}

function todayStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** تنظيف الاسم المكتوب: مسافات متعددة → مسافة واحدة، وحذف تشكيل/تطويل للفحص الناعم */
function cleanName(raw: string): string {
  return raw.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** اسم صالح؟ (حرفين على الأقل بعد التنظيف — حروف/مسافات/فواصل/نقاط — الفاصلة مسموحة للكشف النصي والـ CSV) */
function validName(name: string): boolean {
  return name.length >= 2 && /^[\p{L}\s.'\-،,]+$/u.test(name);
}

/** مقارنة ناعمة للاسم مع سجل الطالب — مش شرط تطابق تام (أسماء مختصرة/لقب) — فقط للعلم */
function nameLooksSimilar(a: string, b: string): boolean {
  const norm = (s: string) => cleanName(s).replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").toLowerCase();
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  // تطابق جزئي: كل كلمة من الأقصر موجودة في الأطول (اسم ثلاثي مكتوب باسمين مثلًا)
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.split(" ").every((w) => long.includes(w));
}

export const POST = handler(async (req: Request) => {
  const body = await readJson<Body>(req);
  const token = String(body.token ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const rawName = cleanName(String(body.name ?? ""));
  const deviceId = String(body.deviceId ?? "").trim();
  const pv = String(body.pv ?? "").trim();
  // بصمة المتصفح (تطبيقية — ثابتة لكل المتصفح الفيزيائي حتى بعد مسح البيانات/إنكوجنتو)
  // قيمة ناقصة/بايطة → بنعتبرها "مفيش بصمة" (توافق رجعي) وبنعلّم MISSING_FINGERPRINT
  const fpRaw = String(body.fp ?? "").trim().toLowerCase();
  const fp = FP_RE.test(fpRaw) ? fpRaw : "";
  // كود القاعة المتغيّر (مضاد مشاركة الـ QR — بيتحقق من السيرفر بس لما الحصة تطلبه)
  const pin = String(body.pin ?? "").trim();
  const ip = clientIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 240);
  const tokenTail = token.slice(-8);

  // ===== 1) صحة الطلب (Structure) =====
  if (!/^[0-9a-f]{16,64}$/.test(token)) throw new ApiError("رابط الحضور مش صالح.", 400);
  if (!/^\d{3,10}$/.test(code)) throw new ApiError("اكتب كود الطالب صح (أرقام بس).", 400);
  if (!UUID_RE.test(deviceId)) throw new ApiError("معرّف الجهاز ناقص — حدّث الصفحة وجرب تاني.", 400);

  // ===== 2) حدود محاولات (نحّاس خارجي — مش بيتسجل في المحاولات) =====
  // مقاييس قاعة دراسية: كل الطلبة على نفس الواي فاي (نفس الـ IP) ونفس كود الحصة —
  // 600/دقيقة لكل IP = 10 طالب/ثانية من نفس الشبكة (فصل 200 طالب يمسحوا في دقيقتين)
  // ولسه بتخنق البوتات اللي بتعمل مئات المحاولات في الثانية
  rateLimit(`pub-checkin:${token.slice(-10)}:${ip}`, 600, 60_000);
  rateLimit(`pub-checkin-ip:${ip}`, 600, 60_000);

  // سجل محاولة في سجل التدقيق (بعد ما نعرف الحصة) — أي رفض/قبول بيتوثق
  async function attempt(input: {
    centerId: string; sessionId: string; outcome: string;
    studentId?: string | null; studentCode?: string | null; studentName?: string | null;
    riskScore?: number; riskFlags?: RiskFlag[];
  }) {
    await db.checkInAttempt.create({
      data: {
        centerId: input.centerId, sessionId: input.sessionId, outcome: input.outcome,
        studentId: input.studentId ?? null, studentCode: input.studentCode?.slice(0, 12) ?? null,
        studentName: input.studentName ?? null,
        deviceId, deviceFingerprint: fp || null, ipAddress: ip, userAgent: ua,
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
      await attempt({ centerId: qr.centerId, sessionId: qr.sessionId, outcome, studentName: rawName || null });
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

  // ===== 5ب) كود القاعة المتغيّر (Room PIN — مضاد مشاركة الـ QR عن بُعد) =====
  // شاشة الحصة بتعرض 4 أرقام جنب الـ QR بتتبدّل كل دقيقتين — التسجيل من غيره مرفوض.
  // الصاحب اللي بره القاعة محتاج الكود الحالي بنفس اللحظة — يعني موصل حي جوه القاعة.
  if (session.requireRoomPin && !verifyRoomPin(session.id, pin)) {
    await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "WRONG_ROOM_PIN", studentCode: code, studentName: rawName || null, riskScore: 20 });
    return ok({
      ok: false, reason: "WRONG_ROOM_PIN",
      message: "اكتب كود القاعة (4 أرقام) الظاهر على شاشة الحصة جنب كود QR — ولو اتغيّر وانت بيكتب، اكتب الجديد وسجّل تاني.",
    });
  }

  const isOpen = session.studentSource === "OPEN";
  // قيمة ثابتة للحالة النهائية — بيتحدد في وضع الحصة
  let matchedStudentId: string | null = null;
  let matchedStudent: { id: string; name: string; code: string } | null = null;
  let charge: number | null = null; // null = من غير خصم (مفتوح/غير مسجل)
  let sessionLabel = isOpen
    ? `${session.name ?? "حصة"} — ${session.date} ${session.startTime}`
    : `${session.group?.subject.name ?? session.name ?? "حصة"} — ${session.date} ${session.startTime}`;
  let mismatchNote: string | null = null;

  // ===== 6) وضع الحضور المفتوح (spec §1B): اسم + كود بطول الحصة — من غير أي كشف =====
  if (isOpen) {
    if (!validName(rawName)) {
      await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INVALID_NAME", studentCode: code });
      return ok({ ok: false, reason: "INVALID_NAME", message: "اكتب اسمك الكامل (حرفين على الأقل) وسجّل تاني." });
    }
    // طول الكود من إعدادات الحصة (قابل للضبط 3..12 — spec §2 ممنوع hardcode)
    const expectedLen = Math.max(3, Math.min(12, session.studentCodeLength ?? 5));
    if (code.length !== expectedLen) {
      await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INVALID_CODE_LENGTH", studentCode: code, studentName: rawName });
      return ok({ ok: false, reason: "INVALID_CODE_LENGTH", message: `الكود لازم يكون ${expectedLen} أرقام بالظبط — اتأكد واكتبه تاني.` });
    }
    sessionLabel = `${session.name ?? "حصة"} — ${session.date} ${session.startTime}`;
  } else {
    // ===== 7) وضع الكشف (ROSTER): الكود هو المعرف الأساسي — الاسم فحص ناعم (spec §21) =====
    const student = await db.student.findFirst({ where: { centerId: qr.centerId, code } });
    if (!student) {
      // مش معروف في السنتر — إعداد الحصة بيحدد: رفض أو قبول كـ"غير مسجل" (spec §22)
      if (session.allowUnregistered) {
        if (!validName(rawName)) {
          await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INVALID_NAME", studentCode: code });
          return ok({ ok: false, reason: "INVALID_NAME", message: "اكتب اسمك الكامل (حرفين على الأقل) وسجّل تاني." });
        }
        sessionLabel = `${session.group?.subject.name ?? session.name ?? "حصة"} — ${session.date} ${session.startTime}`;
      } else {
        await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INVALID_STUDENT", studentCode: code, studentName: rawName || null });
        return ok({ ok: false, reason: "INVALID_STUDENT", message: "الكود ده مش معروف — اتأكد من كودك أو كلّم الاستقبال." });
      }
    } else if (student.status !== "ACTIVE") {
      await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "INACTIVE_STUDENT", studentId: student.id, studentCode: code, studentName: rawName || null });
      return ok({ ok: false, reason: "INACTIVE_STUDENT", message: "حالة الطالب دي مش نشطة — كلّم الاستقبال." });
    } else {
      matchedStudent = { id: student.id, name: student.name, code: student.code };
      matchedStudentId = student.id;
      sessionLabel = `${session.group?.subject.name ?? session.name ?? "حصة"} — ${session.date} ${session.startTime}`;
      // الاسم المكتوب بيتقارن ناعمًا بسجل الطالب — اختلاف = ملاحظة للمراجعة (مش رفض — الأسماء بتتكتب اختصار)
      if (rawName && !nameLooksSimilar(rawName, student.name)) {
        mismatchNote = `الاسم المكتوب «${rawName}» مختلف عن السجل «${student.name}»`;
      }
    }
  }

  // ===== 7ب) التسجيل في مجموعة الحصة (زي باقي طرق الحضور — للكشف بس) =====
  let reg: { priceOverride: number | null } | null = null;
  if (!isOpen && matchedStudent) {
    const found = await db.studentGroup.findFirst({
      where: { groupId: session.groupId!, studentId: matchedStudent.id, status: "ACTIVE" },
      select: { priceOverride: true },
    });
    if (!found && !session.allowUnregistered) {
      await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "NOT_REGISTERED", studentId: matchedStudent.id, studentCode: code, studentName: rawName || null });
      await logAudit({
        user: { id: matchedStudent.id, name: matchedStudent.name, centerId: qr.centerId },
        action: AUDIT.UNAUTHORIZED_ATTENDANCE, entity: "PUBLIC_CHECKIN", entityId: session.id,
        reason: `طالب مش مسجل في مجموعة الحصة (${session.group?.subject.name ?? ""})`,
        after: { studentCode: matchedStudent.code, ip },
      }).catch(() => {});
      void notifyStaff(qr.centerId, {
        type: "ATTENDANCE", title: "محاولة حضور مرفوضة",
        body: `${matchedStudent.name} (كود ${matchedStudent.code}) حاول يسجّل حضوره في ${session.group?.subject.name} من كود الحصة العام وهو مش مسجل في المجموعة.`,
        link: "today",
      }).catch(() => {});
      return ok({ ok: false, reason: "NOT_REGISTERED", message: "انت مش مسجل في مجموعة الحصة دي — كلّم الاستقبال يسجلّك الأول." });
    }
    if (found) {
      reg = found;
      charge = effectivePrice(found.priceOverride, null, session.price); // PRESENT عادي
    }
    // مش مسجل ومقبول بإعداد allowUnregistered → charge يفضل null (من غير خصم — مش من الكشف)
  }

  // ===== 8) فحوص سريعة ودّية قبل الإدخال (القاعدة النهائية في الداتابيز) =====
  // الاسم/الكود المعروضين: الحقيقي من السجل للطلاب الحقيقيين — وإلا الاسم/الكود المكتوبين
  const displayName = matchedStudent?.name ?? rawName;
  const displayCode = matchedStudent?.code ?? code;
  // هوية الكود للمفتوح/غير المسجل: كود الطالب بيتسجل مرة واحدة لكل حصة مهما كان الجهاز
  const openIdentityCode = isOpen || !matchedStudentId ? code : null;

  if (matchedStudentId) {
    const byStudent = await db.attendance.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId: matchedStudentId } },
    });
    if (byStudent) {
      // نفس الطالب متسجل — إعادة محاولة/ريفرش/نفس الطالب من جهاز تاني = رد آمن idempotent
      await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "ALREADY_SAME_STUDENT", studentId: matchedStudentId, studentCode: code, studentName: rawName || null });
      return ok({
        ok: true, alreadyAttended: true,
        studentName: matchedStudent!.name, studentCode: matchedStudent!.code,
        sessionLabel,
        status: byStudent.status,
      });
    }
  }

  // --- قفل الجهاز (معرّف المتصفح nk_did) ---
  const byDevice = await db.attendance.findUnique({
    where: { sessionId_deviceId: { sessionId: session.id, deviceId } },
  });
  if (byDevice) {
    if (byDevice.studentCode === displayCode) {
      // نفس الجهاز نفس الكود — ريفرش/إعادة إرسال (idempotent ودّي — مش غش)
      await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "ALREADY_ATTENDED", studentId: matchedStudentId, studentCode: code, studentName: rawName || null });
      return ok({
        ok: true, alreadyAttended: true,
        studentName: byDevice.studentName ?? displayName, studentCode: byDevice.studentCode ?? displayCode,
        sessionLabel, status: byDevice.status,
      });
    }
    // ⛔ القاعدة الأساسية: الجهاز ده سجّل حضور لطالب تاني في نفس الحصة
    await attempt({
      centerId: qr.centerId, sessionId: session.id, outcome: "DEVICE_LOCKED",
      studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
      riskScore: 80, riskFlags: ["DEVICE_REUSED", "MULTIPLE_STUDENTS_SAME_DEVICE"],
    });
    await logAudit({
      user: { id: matchedStudentId ?? "UNKNOWN", name: rawName || "طالب من غير حساب", centerId: qr.centerId },
      action: AUDIT.DEVICE_ALREADY_USED, entity: "PUBLIC_CHECKIN", entityId: session.id,
      reason: "جهاز واحد حاول يسجّل طالبين في نفس الحصة — القاعدة: جهاز = حضور واحد لكل حصة",
      after: { studentCode: code.slice(0, 12), ip, deviceTail: deviceId.slice(-6) },
    }).catch(() => {});
    void notifyStaff(qr.centerId, {
      type: "ATTENDANCE", title: "⚠️ جهاز حاول يسجّل طالبين",
      body: `في ${sessionLabel}: جهاز اتسجل بيه حضور قبل كده حاول يسجّل ${rawName || `كود ${code}`} — اترفض تلقائيًا.`,
      link: "today", refId: session.id,
    }).catch(() => {});
    return ok({
      ok: false, reason: "DEVICE_LOCKED",
      message: "الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل — كل طالب بيسجّل من موبايله بنفسه.",
    });
  }

  // --- قفل البصمة (مضاد الإنكوجنتو/مسح بيانات الموقع): نفس المتصفح الفيزيائي = حضور واحد ---
  // الهوية العشوائية (nk_did) بتتولد من جديد بعد مسح بيانات الموقع أو في نافذة خاصة —
  // البصمة (canvas/audio/WebGL/خطوط/هاردوير) ثابتة — فاللي مسح بياناته وجرّب تاني بيتقفل هنا.
  if (fp) {
    const byFp = await db.attendance.findUnique({
      where: { sessionId_deviceFingerprint: { sessionId: session.id, deviceFingerprint: fp } },
    });
    if (byFp) {
      if (byFp.studentCode === displayCode) {
        // نفس الشخص — مسح بيانات المتصفح/ريفرش عميق (الاسم/الكود زي ما اتسجلوا الأول)
        await attempt({ centerId: qr.centerId, sessionId: session.id, outcome: "ALREADY_ATTENDED", studentId: matchedStudentId, studentCode: code, studentName: rawName || null });
        return ok({
          ok: true, alreadyAttended: true,
          studentName: byFp.studentName ?? displayName, studentCode: byFp.studentCode ?? displayCode,
          sessionLabel, status: byFp.status,
        });
      }
      await attempt({
        centerId: qr.centerId, sessionId: session.id, outcome: "DEVICE_LOCKED",
        studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
        riskScore: 90, riskFlags: ["FINGERPRINT_REUSED", "MULTIPLE_STUDENTS_SAME_DEVICE"],
      });
      await logAudit({
        user: { id: matchedStudentId ?? "UNKNOWN", name: rawName || "طالب من غير حساب", centerId: qr.centerId },
        action: AUDIT.DEVICE_ALREADY_USED, entity: "PUBLIC_CHECKIN", entityId: session.id,
        reason: "نفس بصمة المتصفح اتسجل بيه حضور قبل كده في الحصة (إنكوجنتو/مسح بيانات الموقع؟) — اترفض",
        after: { studentCode: code.slice(0, 12), ip, deviceTail: deviceId.slice(-6), fpTail: fp.slice(-8) },
      }).catch(() => {});
      void notifyStaff(qr.centerId, {
        type: "ATTENDANCE", title: "⚠️ محاولة تسجيل من متصفح متسجل قبل كده",
        body: `في ${sessionLabel}: متصفح نفس البصمة اتسجل بيه حضور قبل كده حاول يسجّل ${rawName || `كود ${code}`} — اترفض تلقائيًا.`,
        link: "today", refId: session.id,
      }).catch(() => {});
      return ok({
        ok: false, reason: "DEVICE_LOCKED",
        message: "الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل — كل طالب بيسجّل من موبايله بنفسه.",
      });
    }
  }

  // --- قفل الكود (مضاد النيابة): كود طالب غايب مينفعش يتسجل من موبايل حد تاني ---
  if (openIdentityCode) {
    const byCode = await db.attendance.findUnique({
      where: { sessionId_attendanceCode: { sessionId: session.id, attendanceCode: openIdentityCode } },
    });
    if (byCode) {
      await attempt({
        centerId: qr.centerId, sessionId: session.id, outcome: "CODE_ALREADY_USED",
        studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
        riskScore: 70, riskFlags: ["STUDENT_CODE_REUSED"],
      });
      await logAudit({
        user: { id: matchedStudentId ?? "UNKNOWN", name: rawName || "طالب من غير حساب", centerId: qr.centerId },
        action: AUDIT.DEVICE_ALREADY_USED, entity: "PUBLIC_CHECKIN", entityId: session.id,
        reason: `كود الطالب ${code.slice(0, 12)} اتسجل بيه حضور من جهاز تاني — محاولة تسجيل نيابة ات رفضت`,
        after: { ip, deviceTail: deviceId.slice(-6) },
      }).catch(() => {});
      void notifyStaff(qr.centerId, {
        type: "ATTENDANCE", title: "⚠️ كود طالب اتسجل مرتين من جهازين",
        body: `في ${sessionLabel}: كود ${code.slice(0, 12)} اتسجل بيه حضور قبل كده من جهاز تاني، وحاول ${rawName || "حد تاني"} يسجّل بيه — اترفض. (لو الطالب نفسه، سجّله يدويًا من شاشة الحصة)`,
        link: "today", refId: session.id,
      }).catch(() => {});
      return ok({
        ok: false, reason: "CODE_ALREADY_USED",
        message: "الكود ده اتسجل بيه حضور في الحصة دي من قبل — كل طالب بيسجّل من موبايله بنفسه. لو ده كودك وحصل لبس، كلّم المدرس/الاستقبال وهيسجلّك من شاشة الحصة.",
      });
    }
  }

  // ===== 9) إشارات الخطورة (علم للمراجعة — مش رفض؛ IP مش هوية — spec §14) =====
  // أعلام مضادات الغش: بصمة ناقصة (متصفح قديم) + التسجيل من شبكة مختلفة عن شبكة القاعة المرجعية
  // (المعلم معمول لحظة فتح الحصة — نفس الواي فاي/NAT بيعدّي عادي، الشبكة التانية بتتعلم للمراجعة)
  const extraRiskFlags: RiskFlag[] = [];
  if (!fp) extraRiskFlags.push("MISSING_FINGERPRINT");
  if (session.anchorIp && session.anchorIp !== "unknown" && ip !== "unknown" && ip !== session.anchorIp) {
    extraRiskFlags.push("DIFFERENT_NETWORK");
  }
  const risk = await assessCheckInRisk({ sessionId: session.id, deviceId, ipAddress: ip, extraFlags: extraRiskFlags });
  if (risk.score >= STAFF_NOTIFY_SCORE) {
    await logAudit({
      user: { id: matchedStudentId ?? "UNKNOWN", name: rawName || "طالب", centerId: qr.centerId },
      action: AUDIT.SUSPICIOUS_ACTIVITY, entity: "PUBLIC_CHECKIN", entityId: session.id,
      reason: riskSummary(risk), after: { riskScore: risk.score, ip, deviceTail: deviceId.slice(-6) },
    }).catch(() => {});
  }

  // ===== 10) الإدخال الذري — القواعد النهائية محفوظة في الداتابيز نفسها (spec §8/§11):
  // unique(sessionId, deviceId) + unique(sessionId, deviceFingerprint) + unique(sessionId, attendanceCode)
  // + unique(sessionId, studentId) — أي سباق متزامن الداتابيز هيحكم فيه النهائي =====
  const noteBits: string[] = [];
  if (grace) noteBits.push("حضور عام — QR الحصة (نافذة سماح)");
  else noteBits.push(isOpen ? "حضور مفتوح — QR الحصة" : "حضور عام — QR الحصة (قفل جهاز)");
  if (isOpen) noteBits.push("حضور مفتوح (من غير كشف)");
  if (fp) noteBits.push("قفل بصمة");
  if (!isOpen && matchedStudent && !reg) noteBits.push("غير مسجل في المجموعة — اتقبل بإعدادات الحصة");
  if (mismatchNote) noteBits.push(mismatchNote);

  let attendanceId: string;
  let already = false;
  let attendanceStatus = "PRESENT";
  try {
    const attendance = await db.attendance.create({
      data: {
        centerId: qr.centerId, sessionId: session.id, studentId: matchedStudentId,
        studentName: displayName, studentCode: displayCode.slice(0, 12),
        status: "PRESENT", charged: charge, method: "SESSION_QR",
        note: noteBits.join(" · "),
        deviceId, deviceFingerprint: fp || null, attendanceCode: openIdentityCode,
        ipAddress: ip, userAgent: ua,
        riskScore: risk.score,
        riskFlags: risk.flags.length ? JSON.stringify(risk.flags) : null,
      },
    });
    attendanceId = attendance.id;
    attendanceStatus = attendance.status;
  } catch (e) {
    // سباق؟ الداتابيز حَكمت — حدّد مين الـ unique اللي اتكسر (الترتيب: بصمة → جهاز → كود → طالب)
    const msg = e instanceof Error ? e.message : String(e);
    const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? "");
    const violated = `${target} ${msg}`;
    if (/unique constraint|P2002/i.test(msg)) {
      if (/deviceFingerprint/i.test(violated)) {
        // سباق على نفس البصمة — نفس الشخص كسب قبله ولا حد تاني بأخذ هوية المتصفح؟
        const row = fp
          ? await db.attendance.findUnique({ where: { sessionId_deviceFingerprint: { sessionId: session.id, deviceFingerprint: fp } } })
          : null;
        if (row && row.studentCode === displayCode) {
          already = true; attendanceId = row.id; attendanceStatus = row.status; // نفس الشخص كسب قبله
        } else {
          await attempt({
            centerId: qr.centerId, sessionId: session.id, outcome: "DEVICE_LOCKED",
            studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
            riskScore: 90, riskFlags: ["FINGERPRINT_REUSED", "MULTIPLE_STUDENTS_SAME_DEVICE"],
          });
          return ok({ ok: false, reason: "DEVICE_LOCKED", message: "الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل — كل طالب بيسجّل من موبايله بنفسه." });
        }
      } else if (/deviceId/i.test(violated)) {
        const dev = await db.attendance.findUnique({ where: { sessionId_deviceId: { sessionId: session.id, deviceId } } });
        if (dev && dev.studentId && dev.studentId === matchedStudentId) {
          already = true; attendanceId = dev.id; attendanceStatus = dev.status; // نفس الطالب كسب قبله
        } else {
          await attempt({
            centerId: qr.centerId, sessionId: session.id, outcome: "DEVICE_LOCKED",
            studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
            riskScore: 80, riskFlags: ["DEVICE_REUSED", "MULTIPLE_STUDENTS_SAME_DEVICE"],
          });
          await logAudit({
            user: { id: matchedStudentId ?? "UNKNOWN", name: rawName || "طالب", centerId: qr.centerId },
            action: AUDIT.DEVICE_ALREADY_USED, entity: "PUBLIC_CHECKIN", entityId: session.id,
            reason: "سباق متزامن — قاعدة الداتابيز رفضت الجهاز",
            after: { studentCode: code.slice(0, 12), ip },
          }).catch(() => {});
          return ok({ ok: false, reason: "DEVICE_LOCKED", message: "الجهاز ده اتسجل بيه حضور في الحصة دي بالفعل — كل طالب بيسجّل من موبايله بنفسه." });
        }
      } else if (/attendanceCode/i.test(violated)) {
        // سباق: نفس الكود من جهازين — الأول كسب، والتاني رفض (مضاد النيابة)
        await attempt({
          centerId: qr.centerId, sessionId: session.id, outcome: "CODE_ALREADY_USED",
          studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
          riskScore: 70, riskFlags: ["STUDENT_CODE_REUSED"],
        });
        return ok({ ok: false, reason: "CODE_ALREADY_USED", message: "الكود ده اتسجل بيه حضور في الحصة دي من قبل — كل طالب بيسجّل من موبايله بنفسه. لو ده كودك وحصل لبس، كلّم المدرس/الاستقبال." });
      } else {
        const st = matchedStudentId
          ? await db.attendance.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId: matchedStudentId } } })
          : null;
        if (st) { already = true; attendanceId = st.id; attendanceStatus = st.status; }
        else throw e;
      }
    } else {
      throw e;
    }
  }

  // ===== 11) التوثيق والإشعارات (الخصم لو فشل يتراجع يدويًا — زي claim بالظبط) =====
  if (!already) {
    if (charge && charge > 0 && matchedStudentId) {
      await db.studentTransaction.create({
        data: {
          centerId: qr.centerId, studentId: matchedStudentId, sessionId: session.id,
          type: "CHARGE", amount: -charge,
          reason: `حصة ${session.group?.subject.name ?? ""} (QR الحصة — حضور عام)`,
          createdBy: "PUBLIC_QR",
        },
      }).catch((err) => { console.error("[public-qr-charge-failed]", err); });
    }
    await db.sessionQRToken.update({
      where: { id: qr.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    }).catch(() => {});
    await recordAttendanceEvent({
      centerId: qr.centerId, personType: "STUDENT", method: "DYNAMIC_QR", status: "PRESENT",
      studentId: matchedStudentId ?? undefined, displayName, role: "STUDENT",
      sessionId: session.id,
      metadata: { public: true, grace, deviceTail: deviceId.slice(-6), risk: risk.flags, sessionLabel, mode: isOpen ? "OPEN" : matchedStudent ? "ROSTER" : "UNREGISTERED" },
    });
    await logAudit({
      user: { id: matchedStudentId ?? "PUBLIC_QR", name: displayName, centerId: qr.centerId },
      action: AUDIT.QR_SCAN_SUCCESS, entity: "ATTENDANCE", entityId: attendanceId,
      after: { student: displayName, session: sessionLabel, method: "PUBLIC_QR", charged: charge, risk: risk.flags },
      reason: grace ? "حضور عام (نافذة سماح — شاف الكود وهو حي)" : isOpen ? "حضور مفتوح — قفل جهاز" : "حضور عام — قفل جهاز",
    });
    if (matchedStudentId) {
      // إشعار الطالب بس للطلاب الحقيقيين (الحضور المفتوح مفيش حساب يتبعت له)
      void notifyStudentsAttendance(
        qr.centerId, [matchedStudentId],
        "تم تسجيل حضورك ✅",
        `حصة ${sessionLabel} — حضورك اتحسب بنجاح. بالتوفيق!`,
      ).catch(() => {});
      void notifyStaff(qr.centerId, {
        type: "ATTENDANCE", title: "حضور ذاتي — QR الحصة",
        body: `${displayName} سجّل حضوره بنفسه في ${sessionLabel}.`,
        link: "today", refId: session.id,
      }).catch(() => {});
    }
    // الحضور المفتوح: مفيش إشعارات لكل طالب (فصل كامل = سبام) — العداد الحي على شاشة الحصة كفاية
  }

  // ===== 12) سجل المحاولة (للوحة النشاط المشبوه) =====
  await attempt({
    centerId: qr.centerId, sessionId: session.id,
    outcome: already ? "ALREADY_ATTENDED" : "ACCEPTED",
    studentId: matchedStudentId, studentCode: code, studentName: rawName || null,
    riskScore: risk.score, riskFlags: risk.flags,
  });

  // الرد العام مفيهوش بيانات مالية ولا أرصدة (خصوصية — صفحة من غير تسجيل دخول)
  return ok({
    ok: true, alreadyAttended: already,
    studentName: displayName, studentCode: displayCode,
    sessionLabel, status: attendanceStatus,
  });
});
