import "server-only";
import { db } from "@/lib/db";
import { sendPushToStudents } from "@/lib/push";

/**
 * إشعار لطلاب مجموعة معينة — بيتستخدم عند تغيير الجدول/الميعاد/المكان.
 * أنواع محدودة عمدًا (مفيش سبام): SCHEDULE_CHANGE | TIME_CHANGE | LOCATION_CHANGE
 */
export async function notifyGroupStudents(
  centerId: string,
  groupId: string,
  type: "SCHEDULE_CHANGE" | "TIME_CHANGE" | "LOCATION_CHANGE",
  title: string,
  body: string,
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

  void sendPushToStudents(centerId, studentIds, { title, body, url: "/portal", tag: `sch-${Date.now()}` }).catch(() => {});
  return studentIds.length;
}
