import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { resolveAnnouncementAudience, sendPushToStudents } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/announcements — إعلانات السنتر + خيارات الجمهور (مدير + استقبال) */
export const GET = handler(async () => {
  const user = await requireCenterUser();

  const [announcements, grades, groups, subjects] = await Promise.all([
    db.announcement.findMany({
      where: { centerId: user.centerId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.grade.findMany({ where: { centerId: user.centerId }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.group.findMany({
      where: { centerId: user.centerId, isActive: true },
      include: { grade: { select: { name: true } }, subject: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.subject.findMany({ where: { centerId: user.centerId }, select: { id: true, name: true } }),
  ]);

  return ok({
    announcements: announcements.map((a) => ({
      id: a.id, title: a.title, body: a.body,
      audienceType: a.audienceType, audienceName: a.audienceName,
      recipients: a.recipients, createdByName: a.createdByName, createdAt: a.createdAt,
    })),
    audienceOptions: {
      grades: grades.map((g) => ({ id: g.id, name: g.name })),
      groups: groups.map((g) => ({
        id: g.id,
        name: `${g.grade.name} — ${g.subject.name} (مجموعة ${g.name})`,
        studentCount: 0,
      })),
      subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
    },
  });
});

type CreateBody = {
  title?: string;
  body?: string;
  audienceType?: "ALL" | "GRADE" | "GROUP" | "SUBJECT";
  audienceId?: string | null;
};

/**
 * POST /api/announcements — نشر إعلان بجمهور مستهدف (مدير أو استقبال).
 * بينشئ إشعار لكل طالب في الجمهور + Push لكل المشتركين (best-effort).
 */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const body = await readJson<CreateBody>(req);

  const title = String(body.title ?? "").trim();
  const text = String(body.body ?? "").trim();
  if (title.length < 3) throw new ApiError("اكتب عنوان واضح للإعلان (3 حروف على الأقل).");
  if (text.length < 3) throw new ApiError("اكتب نص الإعلان (3 حروف على الأقل).");
  if (title.length > 120) throw new ApiError("العنوان طويل أوي — اختصره.");
  if (text.length > 600) throw new ApiError("نص الإعلان طويل أوي — اختصره.");

  const rawType = body.audienceType as string | undefined;
  const audienceType: "ALL" | "GRADE" | "GROUP" | "SUBJECT" =
    rawType === "GRADE" || rawType === "GROUP" || rawType === "SUBJECT" ? rawType : "ALL";
  if (audienceType !== "ALL" && !body.audienceId) {
    throw new ApiError("اختار الجمهور (مرحلة / مجموعة / مادة).");
  }

  const audience = await resolveAnnouncementAudience(user.centerId, audienceType, body.audienceId ?? null);
  if (audience.error) throw new ApiError(audience.error, 404);
  if (audience.studentIds.length === 0) {
    throw new ApiError("مفيش طلاب في الجمهور المحدد — راجع الاختيار.");
  }

  const announcement = await db.announcement.create({
    data: {
      centerId: user.centerId, title, body: text,
      audienceType, audienceId: body.audienceId ?? null,
      audienceName: audience.audienceName,
      recipients: audience.studentIds.length,
      createdBy: user.id, createdByName: user.name,
    },
  });

  // إشعار لكل طالب — على دفعات (SQLite حد 999 متغير)
  const CHUNK = 500;
  for (let i = 0; i < audience.studentIds.length; i += CHUNK) {
    const chunk = audience.studentIds.slice(i, i + CHUNK);
    await db.studentNotification.createMany({
      data: chunk.map((studentId) => ({
        centerId: user.centerId, studentId,
        type: "ANNOUNCEMENT", title, body: text,
        announcementId: announcement.id,
      })),
    });
  }

  // Push لكل المشتركين — في الخلفية (مش بيأخر الرد)
  void sendPushToStudents(user.centerId, audience.studentIds, {
    title: `📢 ${title}`,
    body: text.length > 90 ? `${text.slice(0, 90)}…` : text,
    url: "/portal",
    tag: `ann-${announcement.id}`,
  }).catch(() => {});

  await logAudit({
    user,
    action: AUDIT.ANNOUNCEMENT_PUBLISHED,
    entity: "ANNOUNCEMENT",
    entityId: announcement.id,
    after: { title, audience: audience.audienceName, recipients: audience.studentIds.length },
  });

  return ok({
    announcement: { id: announcement.id, title, audienceName: audience.audienceName },
    recipients: audience.studentIds.length,
    message: `تم نشر الإعلان لـ ${audience.studentIds.length} طالب.`,
  }, { status: 201 });
});
