import "server-only";
import { db } from "@/lib/db";
import { sendPushToStudents } from "@/lib/push";

/** إشعار لطلاب مجموعة معينة — بيتستخدم عند تغيير الجدول/الميعاد/المكان، ونشر الامتحانات والواجبات والكويزات.
 *  أنواع محدودة عمدًا (مفيش سبام): SCHEDULE_CHANGE | TIME_CHANGE | LOCATION_CHANGE | EXAM | ASSIGNMENT | QUIZ
 *  url = deep-link جوّه البورتال (مثال: /portal?tab=exams) — بتفتح التاب الصح لما الطالب يدوس على الإشعار */
export async function notifyGroupStudents(
  centerId: string,
  groupId: string,
  type: "SCHEDULE_CHANGE" | "TIME_CHANGE" | "LOCATION_CHANGE" | "EXAM" | "ASSIGNMENT" | "QUIZ",
  title: string,
  body: string,
  url = "/portal",
): Promise<number> {
  const regs = await db.studentGroup.findMany({
    where: { groupId, status: "ACTIVE", student: { status: "ACTIVE" } },
    select: { studentId: true },
  });
  const studentIds = regs.map((r) => r.studentId);
  if (studentIds.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const chunk = studentIds.slice(i, i + CHUNK);
    await db.studentNotification.createMany({
      data: chunk.map((studentId) => ({ centerId, studentId, type, title, body })),
    });
  }

  void sendPushToStudents(centerId, studentIds, { title, body, url, tag: `${type.toLowerCase()}-${Date.now()}` }).catch(() => {});
  return studentIds.length;
}

/**
 * إشعار تسجيل الحضور للطلاب — "تم تسجيل حضورك" فورًا جوّه البورتال + Web Push.
 * Best-effort: فشل الإشعار عمره ما بيكسر عملية الحضور نفسها.
 */
export async function notifyStudentsAttendance(
  centerId: string,
  studentIds: string[],
  title: string,
  body: string,
): Promise<number> {
  if (studentIds.length === 0) return 0;
  try {
    const CHUNK = 500;
    for (let i = 0; i < studentIds.length; i += CHUNK) {
      const chunk = studentIds.slice(i, i + CHUNK);
      await db.studentNotification.createMany({
        data: chunk.map((studentId) => ({ centerId, studentId, type: "ATTENDANCE", title, body })),
      });
    }
    void sendPushToStudents(centerId, studentIds, {
      title, body, url: "/portal", tag: `attendance-${Date.now()}`,
    }).catch(() => {});
    return studentIds.length;
  } catch (e) {
    console.error("attendance-notify-failed", e);
    return 0;
  }
}
