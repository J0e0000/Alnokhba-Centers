import { PrismaClient } from "@prisma/client";

/**
 * تجهيز سنتر اختبار الصلاحيات والأقسام (idempotent):
 * - Center perm-test: pmgr (مدير) + prec (استقبال) + pteach (مدرس) + مجموعة + طالب
 * الإخراج: JSON بالـ ids على stdout.
 */

const p = new PrismaClient();

const hash = (s: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes, scryptSync } = require("crypto") as typeof import("crypto");
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(s, salt, 64).toString("hex")}`;
};

const randToken = () => require("crypto").randomBytes(20).toString("hex");

async function ensureUser(centerId: string, username: string, name: string, role: string) {
  const existing = await p.user.findUnique({ where: { username } });
  if (existing) {
    await p.user.update({ where: { id: existing.id }, data: { passwordHash: hash("nokhba123"), isActive: true, centerId, role, permissions: null, modules: null } });
    return existing.id;
  }
  const u = await p.user.create({
    data: { centerId, username, passwordHash: hash("nokhba123"), name, role, canAddStudents: true, scope: "centers" },
  });
  return u.id;
}

async function main() {
  let center = await p.center.findUnique({ where: { slug: "perm-test" } });
  if (!center) center = await p.center.create({ data: { name: "سنتر اختبار الصلاحيات", slug: "perm-test" } });

  const mgrId = await ensureUser(center.id, "pmgr", "مدير الصلاحيات", "MANAGER");
  const recId = await ensureUser(center.id, "prec", "استقبال الصلاحيات", "RECEPTIONIST");
  const teachId = await ensureUser(center.id, "pteach", "مدرس الصلاحيات", "TEACHER");

  const grade = await p.grade.upsert({
    where: { centerId_name: { centerId: center.id, name: "الصف الأول" } },
    create: { centerId: center.id, name: "الصف الأول" }, update: {},
  });
  const subject = await p.subject.upsert({
    where: { centerId_name: { centerId: center.id, name: "علوم" } },
    create: { centerId: center.id, name: "علوم" }, update: {},
  });

  const student = await p.student.upsert({
    where: { centerId_code: { centerId: center.id, code: "88101" } },
    create: { centerId: center.id, code: "88101", qrToken: randToken(), name: "طالب الصلاحيات", phone: "01000088101" },
    update: {},
  });

  console.log(JSON.stringify({ centerId: center.id, mgrId, recId, teachId, studentId: student.id }));
}

main().then(() => p.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
