import "server-only";
import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "crypto";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { permissionsForClient, type PermissionId } from "@/lib/permissions";

export const SESSION_COOKIE = "nokhba_session";
const SESSION_DAYS = 7;

// الكوكيز تتسجل Secure على Vercel (HTTPS دايمًا) — محليًا http فبنسيبها زي ما هي
const COOKIE_SECURE = process.env.VERCEL === "1";

/**
 * خيارات كوكي الجلسة — بتصلّح سببين حقيقيين لـ «بيسجل دخول ويطلع لوحده»:
 * 1) maxAge بدل expires: الـ expires تاريخ مطلق من ساعة السيرفر — لو ساعة جهاز
 *    المستخدم قدّام، المتصفح بيمسح الكوكي فورًا. الـ maxAge بيتحسب من ساعة
 *    المتصفح نفسه فمش بيتأثر بأي انحراف.
 * 2) الإنتاج: SameSite=None + Partitioned (CHIPS) — عشان الجلسة تشتغل جوه
 *    الشاشات المدمجة (معاينة الشات/الويب فيو) بدل ما الكوكي يتمنع ويحصل خروج فوري.
 *    التطوير على http: المتصفح بيرفض None من غير Secure → Lax زي ما هي.
 */
function sessionCookieOptions(expiresAt: Date) {
  const maxAge = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  if (!COOKIE_SECURE) {
    return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge };
  }
  return {
    httpOnly: true,
    sameSite: "none" as const,
    secure: true,
    partitioned: true,
    path: "/",
    maxAge,
  };
}

// ============================= SUPPORT ACCESS (دخول الدعم الفني) =============================
// الأدمن بيدخل باسم مستخدم (مدير/استقبال) لمساعدته — من غير ما يعرف أو يشوف الباسورد.
// ٣ كوكيز: جلسة الموظف المؤقتة + توكن رجوع الأدمن (httpOnly) + معرّف جلسة الدعم للبانر.
export const SUPPORT_COOKIE = "nokhba_support";
export const ADMIN_RETURN_COOKIE = "nokhba_admin_return";
export const SUPPORT_MINUTES = 30;

// ============================= PASSWORDS =============================

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ============================= SESSIONS =============================

export type SessionUser = {
  id: string;
  name: string;
  username: string;
  role: "ADMIN" | "MANAGER" | "RECEPTIONIST" | "TEACHER" | "STUDENT";
  /** product scope: "centers" (legacy) | "academia" (AlNokhba Academia) */
  scope: "centers" | "academia";
  centerId: string | null;
  canAddStudents: boolean;
  // الصلاحيات الدقيقة المحسومة (للواجهات + لفحوص السيرفر في كل مكان)
  permissions: PermissionId[];
  // per-user receipt preferences (auto-print after payment)
  autoPrintReceipt: boolean;
  receiptFormat: "THERMAL" | "A4";
  center: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string | null;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
    slogan: string | null;
    signature: string | null;
    status: string;
    // WhatsApp parent-notification opt-in flags (server-side guards depend on them)
    waPaymentsEnabled?: boolean;
    waLowBalanceEnabled?: boolean;
    waLowBalanceThreshold?: number;
    waConsentNote?: string | null;
  } | null;
  /** موجود بس وقت جلسة الدعم الفني — الأدمن متصرف باسم المستخدم ده */
  support?: {
    supportId: string;
    byAdminId: string;
    byAdminName: string;
    targetName: string;
    reason: string;
    expiresAt: string;
  } | null;
};

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  // تنظيف دوري للجلسات المنتهية (خصوصية: التوكنات القديمة متفضلش متراومة في الداتابيز)
  await db.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  await db.authSession.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.authSession.deleteMany({ where: { token } });
  }
  jar.delete(SESSION_COOKIE);
}

// ============================= SUPPORT ACCESS (دخول الدعم الفني) =============================

const AUDIT_SUPPORT_START = "بدء جلسة دعم فني";
const AUDIT_SUPPORT_END = "إنهاء جلسة دعم فني";
export { AUDIT_SUPPORT_START, AUDIT_SUPPORT_END };

/** تسجيل تدقيق من غير ما يكسر أي فلو (نفس سلوك logAudit) */
async function logAuditSafe(opts: Parameters<typeof logAudit>[0]): Promise<void> {
  await logAudit(opts);
}

/** الأدمن يبدأ جلسة دعم باسم مستخدم (مدير/استقبال):
 * - تتعمل جلسة موظف مؤقتة للمستخدم الهدف (30 دقيقة)
 * - توكن أدمن الأصلي بيتخزن في كوكي رجوع (httpOnly) — الرجوع بيه
 * - مفيش باسورد بيتقرأ أو بيتعرض أبدًا
 */
export async function createSupportSession(
  admin: SessionUser,
  targetUserId: string,
  reason: string,
): Promise<{ supportId: string; expiresAt: string }> {
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new ApiError("المستخدم ده مش موجود.", 404);
  if (target.id === admin.id) throw new ApiError("مينفعش تعمل جلسة دعم لنفسك.", 400);
  if (target.role === "ADMIN") throw new ApiError("الدعم الفني لحسابات السنترز بس (مدير/استقبال) — مش لأدمن تاني.", 400);
  if (!target.isActive) throw new ApiError("الحساب ده متوقف — فعّله الأول من إدارة الموظفين.", 400);
  if (!target.centerId) throw new ApiError("الحساب ده مش مرتبط بسنتر.", 400);
  if (!reason.trim() || reason.trim().length < 3) throw new ApiError("اكتب سبب الدعم (3 حروف على الأقل).", 400);

  // الأدمن عنده جلسة دعم واحدة في نفس الوقت — قفل أي جلسة قديمة لسه مفتوحة
  const stale = await db.supportSession.findMany({
    where: { adminId: admin.id, endedAt: null },
  });
  for (const s of stale) await endSupportSessionRow(s, "جلسة دعم جديدة بدأت");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SUPPORT_MINUTES * 60 * 1000);

  const support = await db.supportSession.create({
    data: {
      adminId: admin.id,
      targetUserId: target.id,
      reason: reason.trim(),
      sessionToken: token,
      expiresAt,
    },
  });
  await db.authSession.create({
    data: { token, userId: target.id, expiresAt },
  });

  const jar = await cookies();
  const adminToken = jar.get(SESSION_COOKIE)?.value;
  if (adminToken) {
    jar.set(ADMIN_RETURN_COOKIE, adminToken, sessionCookieOptions(expiresAt));
  }
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  jar.set(SUPPORT_COOKIE, support.id, sessionCookieOptions(expiresAt));

  return { supportId: support.id, expiresAt: expiresAt.toISOString() };
}

/** قفل صف جلسة الدعم + حذف جلسة الموظف المؤقتة */
async function endSupportSessionRow(row: { id: string; sessionToken: string; endedAt: Date | null }, why?: string): Promise<void> {
  if (row.endedAt) return;
  await db.supportSession.update({ where: { id: row.id }, data: { endedAt: new Date() } });
  await db.authSession.deleteMany({ where: { token: row.sessionToken } });
  if (why) {
    await logAuditSafe({
      user: { id: "system", name: "النظام", centerId: null },
      action: AUDIT_SUPPORT_END,
      entity: "SUPPORT_SESSION",
      entityId: row.id,
      reason: why,
    });
  }
}

/** خروج من جلسة الدعم → رجوع حساب الأدمن الأصلي */
export async function endSupportSession(): Promise<boolean> {
  const jar = await cookies();
  const supportId = jar.get(SUPPORT_COOKIE)?.value;
  if (!supportId) return false;

  const row = await db.supportSession.findUnique({ where: { id: supportId } });
  if (row && !row.endedAt) {
    await db.supportSession.update({ where: { id: row.id }, data: { endedAt: new Date() } });
    await db.authSession.deleteMany({ where: { token: row.sessionToken } });
  }

  const adminToken = jar.get(ADMIN_RETURN_COOKIE)?.value;
  if (adminToken) {
    jar.set(SESSION_COOKIE, adminToken, {
      httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, path: "/",
      expires: new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000),
    });
  } else {
    jar.delete(SESSION_COOKIE);
  }
  jar.delete(SUPPORT_COOKIE);
  jar.delete(ADMIN_RETURN_COOKIE);
  return true;
}

/** لو الجلسة الحالية جلسة دعم → بيانات البانر (أو null) + تنظيف تلقائي لو منتهية */
async function resolveSupportContext(): Promise<SessionUser["support"] | null> {
  const jar = await cookies();
  const supportId = jar.get(SUPPORT_COOKIE)?.value;
  if (!supportId) return null;

  const row = await db.supportSession.findUnique({
    where: { id: supportId },
    include: { admin: { select: { id: true, name: true } }, targetUser: { select: { name: true } } },
  });
  if (!row) {
    jar.delete(SUPPORT_COOKIE);
    jar.delete(ADMIN_RETURN_COOKIE);
    return null;
  }
  if (row.endedAt || row.expiresAt < new Date()) {
    // منتهية → قفلها + تسجيل خروج آمن (الأدمن يسجل دخول تاني)
    await endSupportSessionRow(row, row.endedAt ? undefined : "انتهت مدة جلسة الدعم (30 دقيقة)");
    jar.delete(SESSION_COOKIE);
    jar.delete(SUPPORT_COOKIE);
    jar.delete(ADMIN_RETURN_COOKIE);
    return null;
  }
  return {
    supportId: row.id,
    byAdminId: row.admin.id,
    byAdminName: row.admin.name,
    targetName: row.targetUser.name,
    reason: row.reason,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Resolve the current authenticated user (with center) or null */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sess = await db.authSession.findUnique({
    where: { token },
    include: {
      user: {
        include: {
          center: {
            select: {
              id: true, name: true, slug: true, logo: true, primaryColor: true,
              secondaryColor: true, accentColor: true, phone: true, whatsapp: true,
              address: true, slogan: true, signature: true, status: true,
              waPaymentsEnabled: true, waLowBalanceEnabled: true,
              waLowBalanceThreshold: true, waConsentNote: true,
            },
          },
        },
      },
    },
  });
  if (!sess || sess.expiresAt < new Date() || !sess.user.isActive) return null;
  const u = sess.user;
  // Academia users keep their TEACHER/STUDENT roles; Centers roles resolve as before.
  // أمان: دور TEACHER (موظف امتحانات) بيفضل TEACHER — ميتحولش لاستقبال
  // عشان صلاحيات الفلوس (تسجيل دفعات/تعديل حضور) متبقاش عنده افتراضيًا.
  const isAca = u.scope === "academia";
  const role = isAca
    ? (["ADMIN", "MANAGER", "TEACHER", "STUDENT"].includes(u.role) ? u.role : "STUDENT")
    : (["ADMIN", "MANAGER", "RECEPTIONIST", "TEACHER"].includes(u.role) ? u.role : "RECEPTIONIST");
  const support = await resolveSupportContext();
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: role as SessionUser["role"],
    scope: isAca ? "academia" : "centers",
    centerId: u.centerId,
    canAddStudents: u.canAddStudents,
    permissions: permissionsForClient(u),
    autoPrintReceipt: u.autoPrintReceipt,
    receiptFormat: (u.receiptFormat === "A4" ? "A4" : "THERMAL") as SessionUser["receiptFormat"],
    center: (u as { center: SessionUser["center"] }).center ?? null,
    support,
  };
}

// ============================= GUARDS =============================

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Any authenticated staff member (center or platform) */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("لازم تسجل دخول الأول.", 401);
  return user;
}

/** Center staff (manager or receptionist) — guarantees a centerId scope */
export async function requireCenterUser(): Promise<SessionUser & { centerId: string }> {
  const user = await requireUser();
  if (!user.centerId || !user.center) throw new ApiError("الحساب ده مش مرتبط بسنتر.", 403);
  return user as SessionUser & { centerId: string };
}

export async function requireManager(): Promise<SessionUser & { centerId: string }> {
  const user = await requireCenterUser();
  if (user.role !== "MANAGER") {
    throw new ApiError("العملية دي للمدير بس — الموظف مالهوش صلاحية عليها.", 403);
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ApiError("البورتال ده لأدمن AlNokhba Management بس.", 403);
  return user;
}

/** Receptionist may be allowed to add students depending on permission flag */
export function canRegisterStudents(user: SessionUser): boolean {
  return user.role === "MANAGER" || (user.role === "RECEPTIONIST" && user.canAddStudents);
}

// ============================= RATE LIMITING =============================

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max = 10, windowMs = 60_000): void {
  // مفتاح اختبار الحمل (load-test hook): بيتمكّن من حدود المحاولات محليًا بس
  // عشان نقيس السعة الحقيقية من غير ما نحسب الـ 429s — مش بيشتغل في الإنتاج إلا لو متعمّد
  if (process.env.NK_RATELIMIT_OFF === "1") return;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > max) {
    throw new ApiError("محاولات كتير قوي — استنى شوية وجرب تاني.", 429);
  }
  if (buckets.size > 5000) buckets.clear();
}

// ============================= STUDENT CODES =============================

/** Generate a unique 5-digit code within the center (10000-99999). */
export async function generateStudentCode(centerId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = String(randomInt(10000, 100000));
    const exists = await db.student.findUnique({
      where: { centerId_code: { centerId, code } },
      select: { id: true },
    });
    if (!exists) return code;
  }
  throw new ApiError("مفيش كود متاح حالياً — جرب تاني.", 500);
}

export function generateQrToken(): string {
  return randomBytes(24).toString("hex");
}
