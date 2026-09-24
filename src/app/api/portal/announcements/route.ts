import { ok, handler } from "@/lib/api";
import { getPortalStudent } from "@/lib/portal-auth";
import { latestAnnouncementsFor } from "../schedule/route";

export const dynamic = "force-dynamic";

/** GET /api/portal/announcements — الإعلانات اللي تخص الطالب بس */
export const GET = handler(async () => {
  const student = await getPortalStudent();
  if (!student) return ok({ student: null, announcements: [] });

  const list = await latestAnnouncementsFor(student.id, student.centerId, student.gradeId ?? null, 30);
  return ok({
    student: { name: student.name },
    announcements: list.map((a) => ({
      id: a.id, title: a.title, body: a.body,
      audienceName: a.audienceName, createdAt: a.createdAt,
    })),
  });
});
