import "server-only";
import { db } from "@/lib/db";

/* ============================================================
   إشعارات الموظفين (Manager / Admin) — موثوقة وسريعة
   ------------------------------------------------------------
   - بتتكتب في الداتابيز فورًا (مفيش طابور بطيء).
   - الواجهة بتقراها بالبولينج (/api/notifications/staff) كل 15 ثانية
     + فورًا مع أي حدث nk-staff-notifs — يعني الإشعار بيوصلم بسرعة.
   - Best-effort: فشل الإشعار عمره ما بيكسر العملية الأساسية.
============================================================ */

export type StaffNotifInput = {
  type: "APPROVAL_REQUEST" | "APPROVAL_DECIDED" | "SIGNUP_REQUEST" | "ATTENDANCE" | "PUBLISH" | "SYSTEM";
  title: string;
  body: string;
  link?: string;
  refId?: string;
};

export type StaffRole = "MANAGER" | "RECEPTIONIST" | "TEACHER";

/**
 * إشعار لكل موظفين السنتر الشغالين (مدير + استقبال + مدرس) — "الإشعار يوصل لأي حد بيشتغل".
 * opts.roles: تحديد أدوار معينة (افتراضي: الكل). opts.exceptUserId: استثناء الموظف اللي عمل الحدث بنفسه.
 */
export async function notifyStaff(
  centerId: string,
  n: StaffNotifInput,
  opts?: { roles?: StaffRole[]; exceptUserId?: string },
): Promise<number> {
  try {
    const staff = await db.user.findMany({
      where: {
        centerId,
        isActive: true,
        role: { in: opts?.roles?.length ? opts.roles : ["MANAGER", "RECEPTIONIST", "TEACHER"] },
      },
      select: { id: true },
    });
    const targets = staff.filter((s) => s.id !== opts?.exceptUserId);
    if (targets.length === 0) return 0;
    await db.staffNotification.createMany({
      data: targets.map((m) => ({
        centerId, userId: m.id, type: n.type, title: n.title, body: n.body,
        link: n.link ?? null, refId: n.refId ?? null,
      })),
    });
    return targets.length;
  } catch (e) {
    console.error("staff-notify-failed", e);
    return 0;
  }
}

/** إشعار لكل مدراء سنتر معين (طلبات الموافقة مثلاً) */
export async function notifyManagers(centerId: string, n: StaffNotifInput): Promise<number> {
  try {
    const managers = await db.user.findMany({
      where: { centerId, role: "MANAGER", isActive: true },
      select: { id: true },
    });
    if (managers.length === 0) return 0;
    await db.staffNotification.createMany({
      data: managers.map((m) => ({
        centerId, userId: m.id, type: n.type, title: n.title, body: n.body,
        link: n.link ?? null, refId: n.refId ?? null,
      })),
    });
    return managers.length;
  } catch (e) {
    console.error("staff-notify-failed", e);
    return 0;
  }
}

/** إشعار لكل أدمن المنصة (طلبات الانضمام مثلاً) */
export async function notifyAdmins(n: StaffNotifInput): Promise<number> {
  try {
    const admins = await db.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return 0;
    await db.staffNotification.createMany({
      data: admins.map((a) => ({
        centerId: null, userId: a.id, type: n.type, title: n.title, body: n.body,
        link: n.link ?? null, refId: n.refId ?? null,
      })),
    });
    return admins.length;
  } catch (e) {
    console.error("staff-notify-failed", e);
    return 0;
  }
}

/** إشعار لمستخدم محدد (صاحب الطلب لما المدير يقرر مثلاً) */
export async function notifyUser(userId: string, centerId: string | null, n: StaffNotifInput): Promise<void> {
  try {
    await db.staffNotification.create({
      data: {
        centerId, userId, type: n.type, title: n.title, body: n.body,
        link: n.link ?? null, refId: n.refId ?? null,
      },
    });
  } catch (e) {
    console.error("staff-notify-failed", e);
  }
}
