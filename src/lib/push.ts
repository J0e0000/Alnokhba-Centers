import "server-only";
import webpush from "web-push";
import { db } from "@/lib/db";

/** هات أو ولّد مفاتيح VAPID للسنتر (مرة واحدة، محفوظة في الداتابيز) */
export async function getVapidKeys(centerId: string): Promise<{ publicKey: string; privateKey: string }> {
  const existing = await db.vapidKey.findUnique({ where: { centerId } });
  if (existing) return { publicKey: existing.publicKey, privateKey: existing.privateKey };
  const keys = webpush.generateVAPIDKeys();
  try {
    await db.vapidKey.create({ data: { centerId, ...keys } });
    return keys;
  } catch {
    // سباق نادر — اقرأ اللي اتعمل
    const again = await db.vapidKey.findUnique({ where: { centerId } });
    if (again) return { publicKey: again.publicKey, privateKey: again.privateKey };
    return keys;
  }
}

/** ابعت إشعار Push لطلاب محددين — best-effort (الفشل مش بيكسر حاجة، والاشتراك الميت بيتشال) */
export async function sendPushToStudents(
  centerId: string,
  studentIds: string[],
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; failed: number }> {
  if (studentIds.length === 0) return { sent: 0, failed: 0 };
  const subs = await db.pushSubscription.findMany({
    where: { centerId, studentId: { in: studentIds } },
  });
  if (subs.length === 0) return { sent: 0, failed: 0 };
  const keys = await getVapidKeys(centerId);
  webpush.setVapidDetails("mailto:admin@nokhba.app", keys.publicKey, keys.privateKey);

  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...payload, url: payload.url ?? "/portal" }),
          { TTL: 24 * 3600, urgency: "normal" },
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = الاشتراك مات — نشيله من غير وجع دماغ
        if (status === 404 || status === 410) {
          await db.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => {});
        }
      }
    }),
  );
  return { sent, failed };
}

// ============================= جمهور الإعلان =============================
// تحديد المستلمين من العلاقات الفعلية — مفيش اختيار يدوي لمئات الطلاب.

export async function resolveAnnouncementAudience(
  centerId: string,
  audienceType: "ALL" | "GRADE" | "GROUP" | "SUBJECT",
  audienceId: string | null,
): Promise<{ studentIds: string[]; audienceName: string; error?: string }> {
  if (audienceType === "ALL" || !audienceId) {
    const students = await db.student.findMany({
      where: { centerId, status: "ACTIVE" },
      select: { id: true },
    });
    return { studentIds: students.map((s) => s.id), audienceName: "كل الطلاب" };
  }

  if (audienceType === "GRADE") {
    const grade = await db.grade.findFirst({ where: { id: audienceId, centerId } });
    if (!grade) return { studentIds: [], audienceName: "", error: "المرحلة دي مش موجودة." };
    const students = await db.student.findMany({
      where: { centerId, status: "ACTIVE", gradeId: grade.id },
      select: { id: true },
    });
    return { studentIds: students.map((s) => s.id), audienceName: grade.name };
  }

  if (audienceType === "GROUP") {
    const group = await db.group.findFirst({
      where: { id: audienceId, centerId },
      include: { grade: { select: { name: true } }, subject: { select: { name: true } } },
    });
    if (!group) return { studentIds: [], audienceName: "", error: "المجموعة دي مش موجودة." };
    const regs = await db.studentGroup.findMany({
      where: { groupId: group.id, status: "ACTIVE", student: { status: "ACTIVE" } },
      select: { studentId: true },
    });
    return { studentIds: regs.map((r) => r.studentId), audienceName: `${group.grade.name} — ${group.subject.name} (مجموعة ${group.name})` };
  }

  // SUBJECT: كل الطلاب المسجلين في أي مجموعة من المادة دي
  const subject = await db.subject.findFirst({ where: { id: audienceId, centerId } });
  if (!subject) return { studentIds: [], audienceName: "", error: "المادة دي مش موجودة." };
  const regs = await db.studentGroup.findMany({
    where: { group: { subjectId: subject.id, centerId }, status: "ACTIVE", student: { status: "ACTIVE" } },
    select: { studentId: true },
  });
  const unique = [...new Set(regs.map((r) => r.studentId))];
  return { studentIds: unique, audienceName: `طلاب ${subject.name}` };
}
