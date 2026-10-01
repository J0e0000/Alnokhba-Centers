import "server-only";
import { cookies } from "next/headers";
import { randomBytes, randomInt } from "crypto";
import { db } from "@/lib/db";
import { cleanRaw } from "@/lib/normalize";

export const TEACHER_COOKIE = "nokhba_teacher";
const TEACHER_DAYS = 30;
// الكوكيز Secure على Vercel (HTTPS) — محليًا http عادي
const COOKIE_SECURE = process.env.VERCEL === "1";

export type PortalTeacher = {
  id: string;
  centerId: string;
  name: string;
  phone: string | null;
  center: {
    id: string; name: string; logo: string | null; slug: string;
    primaryColor: string; secondaryColor: string; accentColor: string | null;
    phone: string | null; whatsapp: string | null; slogan: string | null;
  };
};

/** توليد كود 4 أرقام فريد داخل السنتر (للاستخدام عند إنشاء/إعادة توليد الكود) */
export async function generateTeacherCode(centerId: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    // crypto.randomInt — مش Math.random (متوقع شكليًا)
    const code = String(randomInt(1000, 10000));
    const clash = await db.teacher.findFirst({ where: { centerId, loginCode: code } });
    if (!clash) return code;
  }
  // احتياط نادر جدًا: نلف على كل الأكواد الممكنة
  const taken = new Set(
    (await db.teacher.findMany({ where: { centerId }, select: { loginCode: true } }))
      .map((t) => t.loginCode)
      .filter((c): c is string => !!c),
  );
  for (let n = 1000; n <= 9999; n++) {
    if (!taken.has(String(n))) return String(n);
  }
  throw new Error("كل أكواد المدرسين متخدة في السنتر ده — مستحيل عمليًا.");
}

/** إنشاء جلسة مدرس (بعد التحقق من الموبايل + الكود) */
export async function createTeacherSession(teacherId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TEACHER_DAYS * 24 * 3600 * 1000);
  await db.teacherPortalSession.create({ data: { token, teacherId, expiresAt } });
  const jar = await cookies();
  jar.set(TEACHER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyTeacherSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(TEACHER_COOKIE)?.value;
  if (token) {
    await db.teacherPortalSession.deleteMany({ where: { token } });
  }
  jar.delete(TEACHER_COOKIE);
}

/** المدرس الحالي أو null — بيجيب السنتر كمان للهوية البصرية */
export async function getPortalTeacher(): Promise<PortalTeacher | null> {
  const jar = await cookies();
  const token = jar.get(TEACHER_COOKIE)?.value;
  if (!token) return null;
  const sess = await db.teacherPortalSession.findUnique({
    where: { token },
    include: {
      teacher: {
        include: {
          center: {
            select: {
              id: true, name: true, logo: true, slug: true,
              primaryColor: true, secondaryColor: true, accentColor: true,
              phone: true, whatsapp: true, slogan: true, status: true,
            },
          },
        },
      },
    },
  });
  if (!sess || sess.expiresAt < new Date()) return null;
  const t = sess.teacher;
  if (!t.isActive || t.center.status !== "ACTIVE") return null;
  return {
    id: t.id,
    centerId: t.centerId,
    name: t.name,
    phone: t.phone,
    center: t.center,
  };
}

/**
 * تحقق دخول المدرس: موبايل المدرس + كود 4 أرقام.
 * المقارنة بعد التطبيع (٠١٢٣ → 0123، مسافات و +20 اتشالوا).
 */
export async function verifyTeacherLogin(
  rawPhone: string,
  rawCode: string,
): Promise<{ ok: true; teacherId: string } | { ok: false; error: string }> {
  const phone = cleanRaw(rawPhone);
  const code = cleanRaw(rawCode);
  if (!/^\d{4}$/.test(code)) {
    return { ok: false, error: "كود المدرس لازم يكون 4 أرقام — خده من إدارة السنتر." };
  }
  if (!/^\d{10,13}$/.test(phone)) {
    return { ok: false, error: "اكتب رقم الموبايل الصح (11 رقم)." };
  }
  const teachers = await db.teacher.findMany({
    where: { loginCode: code, isActive: true },
    select: { id: true, phone: true, center: { select: { status: true } } },
  });
  const match = teachers.find((t) => {
    if (!t.phone) return false;
    const n = cleanRaw(t.phone);
    return n === phone || (n.startsWith("0") && phone.endsWith(n)) || (phone.startsWith("0") && n.endsWith(phone));
  });
  if (!match) {
    return { ok: false, error: "الموبايل أو الكود مش متطابقين — تأكد منهم وجرب تاني." };
  }
  if (match.center.status !== "ACTIVE") {
    return { ok: false, error: "السنتر متوقف حاليًا — راجع الإدارة." };
  }
  return { ok: true, teacherId: match.id };
}
