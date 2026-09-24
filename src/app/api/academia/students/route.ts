import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, generateQrToken } from "@/lib/auth";
import { randomBytes } from "crypto";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function normalizeDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const ai = AR_DIGITS.indexOf(d);
    if (ai >= 0) return String(ai);
    const fi = FA_DIGITS.indexOf(d);
    return fi >= 0 ? String(fi) : d;
  });
}

/** GET /api/academia/students?q= — search (teacher: own-group students only) */
async function GET_impl(req: NextRequest) {
  const user = await requireAca();
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const qn = normalizeDigits(q);

  let groupIdFilter: string[] | undefined;
  if (user.role === "TEACHER") groupIdFilter = user.teacherGroupIds ?? [];
  if (user.role === "STUDENT") {
    // students don't list other students
    return NextResponse.json({ students: [] });
  }

  const enrollWhere = {
    status: "ACTIVE",
    ...(groupIdFilter ? { groupId: { in: groupIdFilter } } : {}),
  };

  const profiles = await db.acaStudentProfile.findMany({
    where: q
      ? {
          OR: [
            { user: { name: { contains: q } } },
            { code: qn.replace(/\D/g, "") || "—" },
          ],
        }
      : {},
    include: {
      user: { select: { name: true, username: true, isActive: true } },
      enrollments: { where: enrollWhere, include: { group: { select: { id: true, name: true, subject: { select: { name: true, color: true } }, teacher: { select: { name: true } } } } } },
    },
    orderBy: { code: "asc" },
    take: 200,
  });

  return NextResponse.json({
    students: profiles.map((p) => ({
      profileId: p.id, code: p.code, name: p.user.name, gradeName: p.gradeName,
      isActive: p.user.isActive,
      groups: p.enrollments.map((e) => ({ id: e.group.id, name: e.group.name, subject: e.group.subject.name, color: e.group.subject.color, teacher: e.group.teacher.name })),
    })),
  });
}

/** POST /api/academia/students — register student (students.manage): creates User + profile */
async function POST_impl(req: NextRequest) {
  const user = await requireAcaPerm("students.manage");
  const body = await req.json().catch(() => null);
  if (!body) throw new ApiError("البيانات ناقصة.", 400);
  const { name, username, password, gradeName, parentName, parentPhone, notes } = body;
  if (!name?.trim() || !username?.trim() || !password) throw new ApiError("الاسم واسم المستخدم وكلمة السر مطلوبين.", 400);
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(uname)) throw new ApiError("اسم المستخدم: حروف إنجليزية وأرقام و . و _ بس (3-30).", 400);
  if (password.length < 6) throw new ApiError("كلمة السر: 6 حروف على الأقل.", 400);
  if (parentPhone && !/^0\d{9,10}$/.test(normalizeDigits(String(parentPhone)).replace(/\D/g, ""))) {
    throw new ApiError("رقم ولي الأمر مش صحيح — مثال: 01012345678.", 400);
  }

  const exists = await db.user.findUnique({ where: { username: uname } });
  if (exists) throw new ApiError("اسم المستخدم ده متاخد خلاص.", 400);

  // unique 5-digit code
  let code = "";
  for (let i = 0; i < 50; i++) {
    const c = String(Math.floor(10000 + Math.random() * 90000));
    const dup = await db.acaStudentProfile.findUnique({ where: { code: c } });
    if (!dup) { code = c; break; }
  }
  if (!code) throw new ApiError("مفيش كود متاح — جرب تاني.", 500);

  const { hashPassword } = await import("@/lib/auth");
  const u = await db.user.create({
    data: { username: uname, passwordHash: hashPassword(password), name: name.trim(), role: "STUDENT", scope: "academia", centerId: null },
  });
  const profile = await db.acaStudentProfile.create({
    data: {
      userId: u.id, code, gradeName: gradeName?.trim() || null,
      parentName: parentName?.trim() || null,
      parentPhone: parentPhone ? normalizeDigits(String(parentPhone)).replace(/\D/g, "") : null,
      notes: notes?.trim() || null,
    },
  });
  await logAudit({ user, action: "تسجيل طالب جديد", entity: "ACA_STUDENT", entityId: profile.id, after: { name: name.trim(), code } });
  return NextResponse.json({ student: { profileId: profile.id, code } }, { status: 201 });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
