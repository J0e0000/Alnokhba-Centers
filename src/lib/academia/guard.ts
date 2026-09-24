import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/auth";

/* ============================================================
   ALNOKHBA ACADEMIA — RBAC / Guard layer (spec §10, §24)
   ------------------------------------------------------------
   RLS-equivalent for this stack: every /api/academia/* route
   resolves the session here and enforcement happens SERVER-side
   (role + granular permission + ownership). The client never
   decides authorization.

   Roles (scope="academia"): ADMIN | MANAGER | TEACHER | STUDENT
   Granular permissions below; acaPermissions JSON on User may
   only WIDEN a role default when allowed, never bypass ownership.
============================================================ */

export type AcaRole = "ADMIN" | "MANAGER" | "TEACHER" | "STUDENT";

export type AcaPermission =
  // academic
  | "subjects.manage" | "groups.view" | "groups.manage"
  | "schedules.view" | "schedules.manage" | "schedules.request"
  | "sessions.view" | "sessions.start" | "sessions.finish" | "sessions.cancel"
  | "attendance.view" | "attendance.edit"
  | "interaction.edit"
  | "homework.view" | "homework.edit"
  | "exams.view" | "exams.manage" | "grades.view" | "grades.edit"
  | "students.view" | "students.manage"
  | "teachers.view" | "teachers.manage"
  // managerial / operational
  | "requests.view" | "requests.approve"
  | "reports.view" | "audit.view" | "permissions.manage"
  // financial / strategic
  | "financial.view" | "insights.view"
  // student self-service
  | "self.view";

/** Role defaults — widened only via acaPermissions for ADMIN-granted exceptions */
const ROLE_DEFAULTS: Record<AcaRole, AcaPermission[]> = {
  ADMIN: [
    "subjects.manage", "groups.view", "groups.manage", "schedules.view", "schedules.manage",
    "sessions.view", "sessions.start", "sessions.finish", "sessions.cancel",
    "attendance.view", "attendance.edit", "interaction.edit", "homework.view", "homework.edit",
    "exams.view", "exams.manage", "grades.view", "grades.edit",
    "students.view", "students.manage", "teachers.view", "teachers.manage",
    "requests.view", "requests.approve", "reports.view", "audit.view", "permissions.manage",
    "financial.view", "insights.view", "self.view",
  ],
  MANAGER: [
    "subjects.manage", "groups.view", "groups.manage", "schedules.view", "schedules.manage",
    "sessions.view", "sessions.start", "sessions.finish", "sessions.cancel",
    "attendance.view", "attendance.edit", "interaction.edit", "homework.view", "homework.edit",
    "exams.view", "exams.manage", "grades.view", "grades.edit",
    "students.view", "students.manage", "teachers.view", "teachers.manage",
    "requests.view", "requests.approve", "reports.view",
    "financial.view", "insights.view", "self.view",
  ],
  TEACHER: [
    "groups.view", "schedules.view", "schedules.request",
    "sessions.view", "sessions.start", "sessions.finish",
    "attendance.view", "attendance.edit", "interaction.edit",
    "homework.view", "homework.edit", "exams.view", "grades.view", "grades.edit",
    "students.view", "teachers.view", "requests.view",
    "reports.view", "self.view",
  ],
  STUDENT: ["self.view"],
};

export type AcaUser = {
  id: string;
  name: string;
  username: string;
  role: AcaRole;
  scope: "academia";
  permissions: AcaPermission[];
  /** teacher: ids of groups they own — for ownership checks */
  teacherGroupIds?: string[];
  /** student: profile id */
  studentProfileId?: string | null;
};

function parsePerms(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}

/** Resolve current academia user (or null). Widens role defaults with acaPermissions. */
export async function getAcaUser(): Promise<AcaUser | null> {
  const su = await getSessionUser();
  if (!su || su.role === "RECEPTIONIST") return null;
  const dbUser = await db.user.findUnique({
    where: { id: su.id },
    select: { scope: true, role: true, isActive: true, acaPermissions: true },
  });
  if (!dbUser || dbUser.scope !== "academia" || !dbUser.isActive) return null;

  const roleRaw = dbUser.role;
  if (!["ADMIN", "MANAGER", "TEACHER", "STUDENT"].includes(roleRaw)) return null;
  const role = roleRaw as AcaRole;

  const overrides = parsePerms(dbUser.acaPermissions);
  const perms = new Set<AcaPermission>(ROLE_DEFAULTS[role]);
  for (const [k, v] of Object.entries(overrides)) {
    if (v && role === "ADMIN") perms.add(k as AcaPermission);
    if (!v) perms.delete(k as AcaPermission);
  }

  const aca: AcaUser = {
    id: su.id, name: su.name, username: su.username, role, scope: "academia",
    permissions: [...perms],
  };

  if (role === "TEACHER") {
    const groups = await db.acaGroup.findMany({ where: { teacherId: su.id }, select: { id: true } });
    aca.teacherGroupIds = groups.map((g) => g.id);
  }
  if (role === "STUDENT") {
    const prof = await db.acaStudentProfile.findUnique({ where: { userId: su.id }, select: { id: true } });
    aca.studentProfileId = prof?.id ?? null;
  }
  return aca;
}

// ============================= GUARDS (throw ApiError) =============================

export async function requireAca(): Promise<AcaUser> {
  const u = await getAcaUser();
  if (!u) throw new ApiError("لازم تدخل بحساب أكاديميا.", 401);
  return u;
}

export async function requireAcaPerm(perm: AcaPermission): Promise<AcaUser> {
  const u = await requireAca();
  if (!u.permissions.includes(perm)) {
    throw new ApiError("مالكش صلاحية بالعملية دي.", 403);
  }
  return u;
}

export async function requireAcaStaff(): Promise<AcaUser> {
  const u = await requireAca();
  if (u.role === "STUDENT") throw new ApiError("ده قسم للإدارة والمدرسين بس.", 403);
  return u;
}

/** Ownership: teacher may only touch own groups; manager/admin any; student only enrolled (spec §8) */
export async function assertGroupAccess(user: AcaUser, groupId: string): Promise<{ teacherId: string; subjectId: string; name: string }> {
  const g = await db.acaGroup.findUnique({ where: { id: groupId }, select: { id: true, teacherId: true, subjectId: true, name: true } });
  if (!g) throw new ApiError("المجموعة دي مش موجودة.", 404);
  if (user.role === "TEACHER" && g.teacherId !== user.id) {
    throw new ApiError("دي مش مجموعتك — مفيش وصول.", 403);
  }
  if (user.role === "STUDENT") {
    const profileId = user.studentProfileId;
    const enrolled = profileId
      ? await db.acaEnrollment.findFirst({ where: { groupId, studentId: profileId, status: "ACTIVE" } })
      : null;
    if (!enrolled) throw new ApiError("أنت مش مسجل في المجموعة دي.", 403);
  }
  return g;
}

/** Student-profile access: self, teacher-of-student, or students.view staff */
export async function assertStudentAccess(user: AcaUser, studentProfileId: string): Promise<void> {
  if (user.role === "STUDENT") {
    if (user.studentProfileId !== studentProfileId) throw new ApiError("تقدر تشوف سجلك أنت بس.", 403);
    return;
  }
  if (user.role === "TEACHER") {
    const links = await db.acaEnrollment.findMany({
      where: { studentId: studentProfileId, status: "ACTIVE", group: { teacherId: user.id } },
      select: { id: true },
    });
    if (links.length === 0) throw new ApiError("الطالب ده مش في مجموعاتك.", 403);
    return;
  }
  if (!user.permissions.includes("students.view")) throw new ApiError("مالكش صلاحية عرض الطلاب.", 403);
}

export function can(user: AcaUser, perm: AcaPermission): boolean {
  return user.permissions.includes(perm);
}
