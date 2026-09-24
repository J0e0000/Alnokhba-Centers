import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager, hashPassword, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { cleanRaw, validateOptionalPhone } from "@/lib/normalize";
import { PERMISSION_CATALOG, resolvePermissions, type PermissionId } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** GET /api/staff — center staff list + صلاحيات كل واحد المحسومة */
export const GET = handler(async () => {
  const user = await requireManager();
  const staff = await db.user.findMany({
    where: { centerId: user.centerId },
    select: { id: true, name: true, username: true, role: true, canAddStudents: true, isActive: true, createdAt: true, permissions: true, phone: true },
    orderBy: { createdAt: "asc" },
  });
  return ok({
    staff: staff.map((s) => ({
      id: s.id, name: s.name, username: s.username, role: s.role,
      canAddStudents: s.canAddStudents, isActive: s.isActive, createdAt: s.createdAt,
      phone: s.phone,
      permissions: [...resolvePermissions(s)].sort(),
    })),
  });
});

type StaffBody = {
  id?: string; name?: string; username?: string; password?: string;
  role?: string; canAddStudents?: boolean; isActive?: boolean; phone?: string;
  permissions?: Record<string, boolean>; // صلاحيات حساسة: تفعيل/تعطيل فوق الافتراضي
};

/** POST /api/staff — add staff (manager) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<StaffBody>(req);

  const name = String(body.name ?? "").trim();
  const username = cleanRaw(String(body.username ?? "")).toLowerCase();
  const password = String(body.password ?? "");
  const role = body.role === "MANAGER" ? "MANAGER" : "RECEPTIONIST";

  if (name.length < 3) throw new ApiError("اكتب اسم الموظف.");
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
    throw new ApiError("اسم المستخدم لازم يكون حروف إنجليزية أو أرقام (3-20 حرف) من غير مسافات.");
  }
  if (password.length < 6) throw new ApiError("كلمة السر لازم 6 حروف على الأقل.");

  const exists = await db.user.findUnique({ where: { username } });
  if (exists) throw new ApiError(`اسم المستخدم "${username}" مستخدم خلاص — اختار واحد تاني.`);

  const managerCount = await db.user.count({ where: { centerId: user.centerId, role: "MANAGER", isActive: true } });
  if (role === "MANAGER" && managerCount >= 1) {
    throw new ApiError("في مدير واحد مسموح به للسنتر — ممكن تضيف موظفين استقبال.");
  }

  const staff = await db.user.create({
    data: {
      centerId: user.centerId, name, username,
      passwordHash: hashPassword(password), role,
      canAddStudents: role === "RECEPTIONIST" ? Boolean(body.canAddStudents ?? true) : true,
    },
  });
  await logAudit({ user, action: AUDIT.STAFF_ADDED, entity: "USER", entityId: staff.id, after: { name, username, role } });
  return ok({ staff: { id: staff.id } }, { status: 201 });
});

/** PATCH /api/staff — update staff (manager) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<StaffBody>(req);
  const target = await db.user.findFirst({ where: { id: String(body.id ?? ""), centerId: user.centerId } });
  if (!target) throw new ApiError("الموظف ده مش موجود.", 404);
  if (target.id === user.id && body.isActive === false) {
    throw new ApiError("مينفعش تقفل حسابك بنفسك.");
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined && body.name.trim()) data.name = body.name.trim();
  if (body.password !== undefined && body.password !== "") {
    if (String(body.password).length < 6) throw new ApiError("كلمة السر الجديدة لازم 6 حروف على الأقل.");
    data.passwordHash = hashPassword(String(body.password));
  }
  if (body.canAddStudents !== undefined) data.canAddStudents = Boolean(body.canAddStudents);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (body.role !== undefined) {
    const managerCount = await db.user.count({ where: { centerId: user.centerId, role: "MANAGER", isActive: true, NOT: { id: target.id } } });
    if (body.role === "MANAGER" && managerCount >= 1) throw new ApiError("في مدير واحد للسنتر.");
    if (target.id === user.id && body.role !== "MANAGER") throw new ApiError("مينفعش تنزل نفسك من مدير.");
    data.role = body.role;
  }

  // ===== الصلاحيات الحساسة الدقيقة (المدير بيتحكم فيها لكل موظف) =====
  if (body.permissions !== undefined && body.permissions !== null && typeof body.permissions === "object") {
    if (target.role === "MANAGER") throw new ApiError("المدير معاه كل الصلاحيات دايمًا — مفيش حاجة تتعدي.");
    // المفتاح لازم يكون من الكتالوج بس — ممنوع مفاتيح غريبة
    const validKeys = (Object.keys(body.permissions) as PermissionId[]).filter((k) => k in PERMISSION_CATALOG);
    if (validKeys.length === 0) throw new ApiError("مفيش صلاحيات معروفة في الطلب.");
    const current = JSON.parse(target.permissions ?? "{}") as { grants?: Record<string, boolean> };
    const grants: Record<string, boolean> = current.grants ?? {};
    for (const k of validKeys) grants[k] = body.permissions[k] === true;
    data.permissions = JSON.stringify({ grants });
    // محاكاة ADD_STUDENT في الحقل القديم (توافق عكسي مع الفحوصات القديمة)
    if ("ADD_STUDENT" in body.permissions) data.canAddStudents = body.permissions.ADD_STUDENT === true;
  }

  await db.user.update({ where: { id: target.id }, data: data as never });
  await logAudit({
    user, action: AUDIT.STAFF_UPDATED, entity: "USER", entityId: target.id,
    before: { role: target.role, canAddStudents: target.canAddStudents, isActive: target.isActive, permissions: target.permissions },
    after: data,
  });
  return ok({ ok: true, permissions: data.permissions ? [...resolvePermissions({ ...target, ...data } as { role: string; permissions?: string | null; canAddStudents?: boolean })].sort() : undefined });
});
