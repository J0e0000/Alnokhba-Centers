import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager, ApiError, rateLimit } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { cleanRaw } from "@/lib/normalize";
import { getCenterCapabilities, capabilityNumber } from "@/lib/center-capabilities";
import { fingerprintTemplateHash } from "@/lib/fingerprint";

export const dynamic = "force-dynamic";

/**
 * تسجيل البصمات (Fingerprint Enrollment) — المدير فقط، وقدرة fingerprint مفعّلة.
 * أقصى عدد مسجّلين لكل مركز من قدرة fingerprint.config.maxUsers (افتراضي 3، حد أقصى 10).
 * البيانات البيومترية الخام **مش بتتخزن** — hash للقالب فقط.
 */

/** GET — قائمة البصمات المسجلة (من غير قوالب) */
export const GET = handler(async () => {
  const user = await requireManager();
  const rows = await db.fingerprintEnrollment.findMany({
    where: { centerId: user.centerId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, personType: true, displayName: true, label: true,
      active: true, lastUsedAt: true, createdAt: true, userId: true, studentId: true,
    },
  });
  return ok({ enrollments: rows });
});

type EnrollBody = {
  personType?: string; // STAFF | STUDENT
  userId?: string; // موظف (User)
  teacherId?: string; // مدرس (Teacher) — لما القدرة تتطلب إثبات حضور مادي
  studentId?: string;
  label?: string;
  template?: string; // قالب خام من جهاز البصمة
};

/** POST — تسجيل بصمة جديدة */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  rateLimit(`fp-enroll:${user.centerId}`, 20, 60_000);
  const body = await readJson<EnrollBody>(req);

  const caps = await getCenterCapabilities(user.centerId);
  if (!caps.fingerprint.enabled) {
    throw new ApiError("حضور البصمة مقفول في المركز — فعّله الأول من إعدادات الحضور.", 403);
  }
  const maxUsers = capabilityNumber(caps.fingerprint.config, "maxUsers", 3, 1, 10);

  const personType = body.personType === "STUDENT" ? "STUDENT" : "STAFF";
  const template = String(body.template ?? "").trim();
  const label = cleanRaw(String(body.label ?? "")).slice(0, 60) || "بصمة";
  if (template.length < 8) {
    throw new ApiError("قالب البصمة مفقود أو قصير — لازم ييجي من جهاز البصمة نفسه.");
  }

  let displayName = "";
  let linkUserId: string | null = null;
  let linkTeacherId: string | null = null;
  if (personType === "STAFF") {
    if (body.teacherId) {
      const teacher = await db.teacher.findFirst({
        where: { id: String(body.teacherId), centerId: user.centerId, isActive: true },
        select: { id: true, name: true },
      });
      if (!teacher) throw new ApiError("اختار المدرس اللي هتتسجل بصمته.", 404);
      displayName = teacher.name;
      linkTeacherId = teacher.id;
    } else {
      const staff = await db.user.findFirst({
        where: { id: String(body.userId ?? ""), centerId: user.centerId, isActive: true },
        select: { id: true, name: true },
      });
      if (!staff) throw new ApiError("اختار الموظف اللي هتتسجل بصمته.", 404);
      displayName = staff.name;
      linkUserId = staff.id;
    }
  } else {
    const student = await db.student.findFirst({
      where: { id: String(body.studentId ?? ""), centerId: user.centerId, status: { not: "ARCHIVED" } },
      select: { id: true, name: true },
    });
    if (!student) throw new ApiError("اختار الطالب اللي هتتسجل بصمته.", 404);
    displayName = student.name;
  }

  // الحد الأقصى لعدد البصمات المسجلة في المركز
  const count = await db.fingerprintEnrollment.count({ where: { centerId: user.centerId, active: true } });
  if (count >= maxUsers) {
    throw new ApiError(`الحد الأقصى للبصمات في المركز ${maxUsers} بس — امسح واحدة قبل ما تضيف غيرها.`, 400);
  }

  const templateHash = fingerprintTemplateHash(template);
  const dup = await db.fingerprintEnrollment.findUnique({ where: { templateHash } });
  if (dup && dup.centerId === user.centerId) {
    throw new ApiError("البصمة دي مسجلة خلاص لنفس الشخص.", 409);
  }
  if (dup) throw new ApiError("البصمة دي مسجلة في مركز تاني.", 409);

  const row = await db.fingerprintEnrollment.create({
    data: {
      centerId: user.centerId,
      personType,
      userId: linkUserId,
      teacherId: linkTeacherId,
      studentId: personType === "STUDENT" ? String(body.studentId) : null,
      displayName,
      label,
      templateHash,
    },
  });

  await logAudit({
    user,
    action: AUDIT.FINGERPRINT_ENROLLED,
    entity: "FINGERPRINT_ENROLLMENT",
    entityId: row.id,
    after: { person: displayName, personType, label, countAfter: count + 1, maxUsers },
    reason: "تسجيل بصمة جديدة",
  });

  return ok({
    enrollment: {
      id: row.id, personType: row.personType, displayName: row.displayName,
      label: row.label, active: row.active, createdAt: row.createdAt,
    },
  }, { status: 201 });
});

/** DELETE — إلغاء تسجيل بصمة */
export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const row = await db.fingerprintEnrollment.findFirst({ where: { id, centerId: user.centerId } });
  if (!row) throw new ApiError("البصمة دي مش موجودة.", 404);
  await db.fingerprintEnrollment.update({ where: { id: row.id }, data: { active: false } });
  await logAudit({
    user,
    action: AUDIT.FINGERPRINT_ENROLLED,
    entity: "FINGERPRINT_ENROLLMENT",
    entityId: row.id,
    before: { active: true, person: row.displayName },
    after: { active: false },
    reason: "إلغاء تسجيل بصمة",
  });
  return ok({ ok: true });
});
