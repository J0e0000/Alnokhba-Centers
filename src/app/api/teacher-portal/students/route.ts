import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { getPortalTeacher } from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";

// ============================= GET — طلابي (طلاب مجموعاتي) =============================
// ملاحظة خصوصية: بيانات التواصل (تليفون الطالب/ولي الأمر) مش بتظهر للمدرس

export const GET = handler(async () => {
  const teacher = await getPortalTeacher();
  if (!teacher) return ok({ teacher: null });

  const groups = await db.group.findMany({
    where: { teacherId: teacher.id, isActive: true },
    include: {
      subject: true,
      grade: true,
      students: {
        where: { status: "ACTIVE" },
        include: { student: { select: { id: true, name: true, code: true, status: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return ok({
    teacher: { name: teacher.name, center: teacher.center },
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      subject: g.subject.name,
      gradeName: g.grade.name,
      room: g.room,
      students: g.students
        .map((r) => r.student)
        .sort((a, b) => a.name.localeCompare(b.name, "ar"))
        .map((st) => ({ id: st.id, name: st.name, code: st.code })),
    })),
  });
});
