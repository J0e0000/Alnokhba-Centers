import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { cleanRaw } from "@/lib/normalize";

export const PORTAL_COOKIE = "nokhba_portal";
// الكوكيز Secure على Vercel (HTTPS) — محليًا http عادي
const COOKIE_SECURE = process.env.VERCEL === "1";
// سنة كاملة — الطالب يفضل مسجل على جهازه من غير ما يخرج من نفسه.
// (الخروج اليدوي من الزرار بيمسح الجلسة فورًا)
const PORTAL_DAYS = 365;
// التجديد المتدحرج: لو فاضل أقل من ١٨٠ يوم → الجلسة بتتمدد تلقائيًا مع الاستخدام
const ROLLING_THRESHOLD_DAYS = 180;

export type PortalStudent = {
  id: string;
  centerId: string;
  code: string;
  qrToken: string;
  name: string;
  phone: string | null;
  parentPhone: string | null;
  gradeId: string | null;
  gradeName: string | null;
  center: {
    id: string; name: string; logo: string | null; slug: string;
    primaryColor: string; secondaryColor: string; accentColor: string | null;
    phone: string | null; whatsapp: string | null; slogan: string | null;
  };
};

/** إنشاء جلسة طالب (بعد التحقق من الكود + الموبايل) */
export async function createPortalSession(studentId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PORTAL_DAYS * 24 * 3600 * 1000);
  await db.studentPortalSession.create({ data: { token, studentId, expiresAt } });
  const jar = await cookies();
  jar.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyPortalSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (token) {
    await db.studentPortalSession.deleteMany({ where: { token } });
  }
  jar.delete(PORTAL_COOKIE);
}

/** الطالب الحالي أو null — بيجيب السنتر كمان للهوية البصرية
 * + تجديد متدحرج: الاستخدام النشط بيمدد الجلسة (الجلسة مش بتوقع من نفسها). */
export async function getPortalStudent(): Promise<PortalStudent | null> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const sess = await db.studentPortalSession.findUnique({
    where: { token },
    include: {
      student: {
        include: {
          grade: { select: { name: true } },
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
  const st = sess.student;
  if (st.status !== "ACTIVE" || st.center.status !== "ACTIVE") return null;

  // تجديد متدحرج — الطالب فتح التطبيق → الامتداد بيحصل بضغطة واحدة
  const msLeft = sess.expiresAt.getTime() - Date.now();
  if (msLeft < ROLLING_THRESHOLD_DAYS * 86400_000) {
    const extended = new Date(Date.now() + PORTAL_DAYS * 24 * 3600 * 1000);
    try {
      await db.studentPortalSession.update({ where: { token }, data: { expiresAt: extended } });
      jar.set(PORTAL_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: COOKIE_SECURE,
        path: "/",
        expires: extended,
      });
    } catch { /* best-effort — الجلسة شغالة زي ما هي */ }
  }

  return {
    id: st.id,
    centerId: st.centerId,
    code: st.code,
    qrToken: st.qrToken,
    name: st.name,
    phone: st.phone,
    parentPhone: st.parentPhone,
    gradeId: st.gradeId ?? null,
    gradeName: st.grade?.name ?? null,
    center: st.center,
  };
}

/**
 * تحقق دخول الطالب: كود 5 أرقام + موبايل (بتاع الطالب أو ولي الأمر).
 * المقارنة بعد التطبيع (٤٨٢٩١ → 48291، مسافات و +20 اتشالوا).
 */
export async function verifyStudentLogin(
  rawCode: string,
  rawPhone: string,
): Promise<{ ok: true; studentId: string; centerId: string } | { ok: false; error: string }> {
  const code = cleanRaw(rawCode);
  const phone = cleanRaw(rawPhone);
  if (!/^\d{5}$/.test(code)) {
    return { ok: false, error: "كود الطالب لازم يكون 5 أرقام — زي اللي على كارته." };
  }
  if (!/^\d{10,13}$/.test(phone)) {
    return { ok: false, error: "اكتب رقم الموبايل الصح (11 رقم)." };
  }
  const students = await db.student.findMany({
    where: { code, status: "ACTIVE" },
    select: { id: true, centerId: true, phone: true, parentPhone: true, center: { select: { status: true } } },
  });
  const match = students.find((s) => {
    const nums = [s.phone, s.parentPhone].map((p) => (p ? cleanRaw(p) : "")).filter(Boolean);
    return nums.some((n) => n === phone || (n.startsWith("0") && phone.endsWith(n)) || (phone.startsWith("0") && n.endsWith(phone)));
  });
  if (!match) {
    return { ok: false, error: "الكود أو رقم الموبايل مش متطابقين — تأكد منهم وجرب تاني." };
  }
  if (match.center.status !== "ACTIVE") {
    return { ok: false, error: "السنتر متوقف حاليًا — راجع الإدارة." };
  }
  return { ok: true, studentId: match.id, centerId: match.centerId };
}
