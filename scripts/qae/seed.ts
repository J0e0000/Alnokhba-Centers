/**
 * QAE1 SEED — deterministic synthetic dataset (spec §2/§3).
 * Profiles: baseline (2 centers / 100 students) → operational (10 centers / ~1000) → stress (5000).
 * Zero production data exists locally; everything is tagged qae-* / QAE1.
 * Run: bun scripts/qae/seed.ts baseline|operational|stress|manifest
 */
import { PrismaClient } from "@prisma/client";
import {
  makeRng, ri, pick, chance, studentName, teacherName, synthPhone, qrToken, hex,
  CENTER_SPECS, STRESS_SPEC, PWD, RUN_ID, MANIFEST_PATH, type Rng, type CenterSpec,
} from "./lib";
import { hashPasswordSync } from "./hash";
import { writeFileSync, readFileSync, existsSync } from "fs";

const db = new PrismaClient();
type Ctx = { rng: Rng };

async function wipeQae() {
  const centers = await db.center.findMany({ where: { slug: { startsWith: "qae-" } }, select: { id: true } });
  const ids = centers.map((c) => c.id);
  if (!ids.length) return 0;
  const users = await db.user.findMany({ where: { OR: [{ username: { startsWith: "qae-" } }, { centerId: { in: ids } }] }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  console.log(`  🧹 wiping ${ids.length} qae centers / ${userIds.length} qae users (idempotent reseed)`);
  // children → parents, scoped strictly to QAE ids
  await db.centerTransaction.deleteMany({ where: { centerId: { in: ids } } });
  await db.teacherSettlement.deleteMany({ where: { centerId: { in: ids } } });
  await db.cashDay.deleteMany({ where: { centerId: { in: ids } } });
  await db.expense.deleteMany({ where: { centerId: { in: ids } } });
  await db.receipt.deleteMany({ where: { centerId: { in: ids } } });
  await db.studentTransaction.deleteMany({ where: { centerId: { in: ids } } });
  await db.attendanceEvent.deleteMany({ where: { centerId: { in: ids } } });
  await db.checkInAttempt.deleteMany({ where: { centerId: { in: ids } } });
  await db.attendance.deleteMany({ where: { centerId: { in: ids } } });
  await db.sessionQRToken.deleteMany({ where: { centerId: { in: ids } } });
  await db.staffQrToken.deleteMany({ where: { centerId: { in: ids } } });
  await db.attendanceDevice.deleteMany({ where: { centerId: { in: ids } } });
  await db.trustedDeviceBinding.deleteMany({ where: { centerId: { in: ids } } });
  await db.fingerprintEnrollment.deleteMany({ where: { centerId: { in: ids } } });
  await db.centerCapability.deleteMany({ where: { centerId: { in: ids } } });
  await db.sessionInstance.deleteMany({ where: { centerId: { in: ids } } });
  await db.scheduleSlot.deleteMany({ where: { centerId: { in: ids } } });
  await db.studentGroup.deleteMany({ where: { student: { centerId: { in: ids } } } });
  await db.studentNotification.deleteMany({ where: { student: { centerId: { in: ids } } } });
  await db.notificationAttempt.deleteMany({ where: { centerId: { in: ids } } });
  await db.messageQueueItem.deleteMany({ where: { centerId: { in: ids } } });
  await db.announcement.deleteMany({ where: { centerId: { in: ids } } });
  // (quiz/exam models removed from schema — financial-only descope)
  await db.bookSale.deleteMany({ where: { centerId: { in: ids } } });
  await db.book.deleteMany({ where: { centerId: { in: ids } } });
  await db.studentPortalSession.deleteMany({ where: { student: { centerId: { in: ids } } } });
  await db.teacherPortalSession.deleteMany({ where: { teacher: { centerId: { in: ids } } } });
  await db.student.deleteMany({ where: { centerId: { in: ids } } });
  await db.group.deleteMany({ where: { centerId: { in: ids } } });
  await db.room.deleteMany({ where: { centerId: { in: ids } } });
  await db.teacher.deleteMany({ where: { centerId: { in: ids } } });
  await db.subject.deleteMany({ where: { centerId: { in: ids } } });
  await db.grade.deleteMany({ where: { centerId: { in: ids } } });
  await db.subscription.deleteMany({ where: { centerId: { in: ids } } });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.undoEntry.deleteMany({ where: { centerId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { centerId: { in: ids } } });
  await db.staffNotification.deleteMany({ where: { centerId: { in: ids } } });
  await db.agentUsage.deleteMany({ where: { centerId: { in: ids } } });
  await db.agentToolExecution.deleteMany({ where: { task: { centerId: { in: ids } } } });
  await db.agentConfirmation.deleteMany({ where: { task: { centerId: { in: ids } } } });
  await db.agentMessage.deleteMany({ where: { task: { centerId: { in: ids } } } });
  await db.agentTask.deleteMany({ where: { centerId: { in: ids } } });
  await db.agentMemory.deleteMany({ where: { user: { centerId: { in: ids } } } });
  // user-level rows that reference User (blocks user.deleteMany with P2003)
  await db.userPreference.deleteMany({ where: { userId: { in: userIds } } });
  await db.agentUsage.deleteMany({ where: { userId: { in: userIds } } });
  await db.agentMemory.deleteMany({ where: { userId: { in: userIds } } });
  await db.userPreference.deleteMany({ where: { userId: { in: userIds } } });
  await db.agentTask.deleteMany({ where: { userId: { in: userIds } } });
  await db.supportSession.deleteMany({ where: { OR: [{ adminId: { in: userIds } }, { targetUserId: { in: userIds } }] } });
  await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
  // any remaining User-FK rows (no cascade): ApprovalRequest.userId, UndoEntry.userId, AuditLog.user, StaffNotification.user, AcaStudentProfile.user, AcaNotification.user, TeamMember.user
  await db.approvalRequest.deleteMany({ where: { requestedBy: { in: userIds } } });
  await db.approvalRequest.deleteMany({ where: { decidedBy: { in: userIds } } });
  await db.undoEntry.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: userIds } } });
  // (aca* models removed from schema — financial-only descope)
  await db.teamMember.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.center.deleteMany({ where: { id: { in: ids } } });
  await db.subscriptionPlan.deleteMany({ where: { name: { startsWith: RUN_ID } } });
  return ids.length;
}

async function seedCenter(spec: CenterSpec, ctx: Ctx, manifest: Manifest) {
  const { rng } = ctx;
  const center = await db.center.create({
    data: {
      name: `QAE1 سنتر الجودة ${spec.n}`,
      slug: spec.slug,
      phone: synthPhone(rng), whatsapp: synthPhone(rng),
      address: `عنوان اختبار ${spec.n} — القاهرة`, slogan: "بيانات اصطناعية للاختبار",
      status: "ACTIVE",
    },
  });

  // grades / subjects / rooms
  const grades = [] as { id: string; name: string }[];
  for (let i = 0; i < 3; i++) {
    const g = await db.grade.create({ data: { centerId: center.id, name: ["الأول الثانوي","الثاني الثانوي","الثالث الثانوي"][i], order: i + 1 } });
    grades.push({ id: g.id, name: g.name });
  }
  const subjects: { id: string; name: string }[] = [];
  for (const name of ["رياضيات","فيزياء","كيمياء","إنجليزي","عربي"]) {
    const s = await db.subject.create({ data: { centerId: center.id, name } });
    subjects.push({ id: s.id, name });
  }
  const rooms: string[] = [];
  for (let i = 1; i <= 3; i++) {
    await db.room.create({ data: { centerId: center.id, name: `قاعة ${i}`, capacity: 20 } });
    rooms.push(`قاعة ${i}`);
  }

  // teachers
  const teachers: { id: string; name: string; loginCode: string; phone: string }[] = [];
  for (let i = 0; i < spec.teachers; i++) {
    const phone = `01${"0".repeat(6)}${spec.n}${i}`; // 0100000001-style, deterministic, 11 digits
    const t = await db.teacher.create({
      data: { centerId: center.id, name: teacherName(rng), phone, loginCode: String(7000 + i + Number(spec.n) * 10), isActive: true },
    });
    teachers.push({ id: t.id, name: t.name, loginCode: t.loginCode!, phone });
  }

  // groups: grade × subject matrix, spec.groups count
  const groups: { id: string; name: string; price: number; pct: number; teacherId: string; subject: string; gradeId: string }[] = [];
  const letters = ["أ","ب","ج","د","هـ","و","ز","ح"];
  for (let i = 0; i < spec.groups; i++) {
    const grade = grades[i % 3];
    const subject = subjects[i % subjects.length];
    const teacher = teachers[i % teachers.length];
    const price = ri(rng, 65, 95) * 100; // 65..95 EGP
    const pct = pick(rng, [40, 45, 50, 55, 60]);
    const g = await db.group.create({
      data: { centerId: center.id, name: `${letters[i % letters.length]}${i >= letters.length ? Math.floor(i / letters.length) + 1 : ""}`, gradeId: grade.id, subjectId: subject.id, teacherId: teacher.id, sessionPrice: price, teacherPercent: pct, room: pick(rng, rooms) },
    });
    groups.push({ id: g.id, name: g.name, price, pct, teacherId: teacher.id, subject: subject.name, gradeId: grade.id });
    // schedule: 2 slots/week per group (Fri=5 mostly off)
    const dows = [0, 1, 2, 3, 4, 6];
    const d1 = dows[(i * 2) % dows.length], d2 = dows[(i * 2 + 3) % dows.length];
    const sh = 14 + (i % 6); // 14..19
    await db.scheduleSlot.create({ data: { centerId: center.id, dayOfWeek: d1, startTime: `${sh}:00`, endTime: `${sh + 1}:30`, groupId: g.id, room: pick(rng, rooms) } });
    await db.scheduleSlot.create({ data: { centerId: center.id, dayOfWeek: d2, startTime: `${sh}:00`, endTime: `${sh + 1}:30`, groupId: g.id, room: pick(rng, rooms) } });
  }

  // users
  const users: Record<string, string> = {};
  const mkUser = async (username: string, role: string, perms?: Record<string, boolean>) => {
    let u;
    try {
      u = await db.user.create({
      data: {
        username, passwordHash: hashPasswordSync(PWD), name: `QAE1 ${username}`,
        role, centerId: center.id, isActive: true,
        permissions: perms ? JSON.stringify({ grants: perms }) : undefined,
      },
    });
    } catch (e: any) {
      console.error(`  ❌ mkUser FAILED: username=${username} role=${role} centerId=${center.id} centerExists=${!!center.id}`, e.message?.slice(0, 200));
      throw e;
    }
    users[username] = u.id;
    return u.id;
  };
  await mkUser(`qae-mgr-${spec.n}`, "MANAGER");
  await mkUser(`qae-rec-${spec.n}`, "RECEPTIONIST");
  // limited receptionist: read + sessions only (no payments/refunds/edits)
  await mkUser(`qae-recl-${spec.n}`, "RECEPTIONIST", {
    VIEW_STUDENTS: true, SEARCH_STUDENTS: true, VIEW_STUDENT_FINANCIAL_STATUS: true,
    START_SESSION: true, END_SESSION: true, EDIT_ATTENDANCE: true,
    RECORD_PAYMENT: false, REFUND_PAYMENT: false, REQUEST_REFUND: false,
    EDIT_STUDENT: false, ADD_STUDENT: false, EDIT_GROUP: false, VIEW_REPORTS: false, EXPORT_REPORTS: false,
  });
  await mkUser(`qae-tch-${spec.n}`, "TEACHER");

  // students — batched with explicit IDs (fast over remote pooler)
  const codeStart = 10000 + Number(spec.n) * 500; // 5-digit codes (portal requires exactly 5)
  const students: { id: string; code: string; name: string; active: boolean; groupIds: string[]; priceOv: (number | null)[] }[] = [];
  const studentRows: any[] = [];
  const regRows: any[] = [];
  for (let i = 0; i < spec.students; i++) {
    const name = studentName(rng);
    const grade = pick(rng, grades);
    const status = chance(rng, 0.03) ? "ARCHIVED" : chance(rng, 0.04) ? "PAUSED" : "ACTIVE";
    const code = String(codeStart + i);
    const id = `qae${spec.n}s${String(i).padStart(5, "0")}`;
    studentRows.push({
      id, centerId: center.id, code, qrToken: qrToken(), name,
      phone: synthPhone(rng), parentName: `ولي أمر ${name.split(" ")[0]}`,
      parentPhone: synthPhone(rng), gradeId: grade.id, school: pick(rng, ["مدرسة النيل الإعدادية","مدرسة الحرية الثانوية","مدرسة المستقبل","مدرسة الأمل"]),
      status, notes: chance(rng, 0.1) ? "بيانات اصطناعية QAE1" : null,
      createdAt: new Date(Date.now() - ri(rng, 40, 120) * 86_400_000),
    });
    // registrations: 75% one group, 25% two (ACTIVE students only)
    const regs: { g: (typeof groups)[number]; ov: number | null }[] = [];
    if (status === "ACTIVE") {
      const n = chance(rng, 0.75) ? 1 : 2;
      const shuffled = [...groups].sort(() => rng() - 0.5).slice(0, n);
      for (const g of shuffled) regs.push({ g, ov: chance(rng, 0.05) ? g.price - 1000 : null });
    }
    for (const r of regs) {
      regRows.push({ id: `qae${spec.n}sg${String(i).padStart(5, "0")}${r.g.id.slice(-6)}`, studentId: id, groupId: r.g.id, priceOverride: r.ov, registeredBy: users[`qae-mgr-${spec.n}`] });
    }
    students.push({ id, code, name, active: status === "ACTIVE", groupIds: regs.map((r) => r.g.id), priceOv: regs.map((r) => r.ov) });
  }
  for (let i = 0; i < studentRows.length; i += 500) {
    await db.student.createMany({ data: studentRows.slice(i, i + 500) as any });
    process.stdout.write(`  students ${Math.min(i + 500, studentRows.length)}/${studentRows.length}\n`);
  }
  for (let i = 0; i < regRows.length; i += 500) {
    await db.studentGroup.createMany({ data: regRows.slice(i, i + 500) as any });
  }

  manifest.centers.push({
    n: spec.n, centerId: center.id, slug: spec.slug,
    users, teacherIds: teachers.map((t) => t.id), teacherCodes: teachers.map((t) => t.loginCode), teacherPhones: teachers.map((t) => t.phone),
    groupIds: groups.map((g) => g.id), groups,
    students: students.map((s) => ({ id: s.id, code: s.code, active: s.active, groupIds: s.groupIds })),
    studentCount: students.length,
  });
  console.log(`  ✅ center ${spec.slug}: ${students.length} students, ${groups.length} groups, ${teachers.length} teachers`);
  return center.id;
}

type Manifest = {
  runId: string; seedNote: string; profile: string; createdAt: string;
  adminId?: string;
  centers: {
    n: string; centerId: string; slug: string; users: Record<string, string>;
    teacherIds: string[]; teacherCodes: string[]; teacherPhones?: string[];
    groupIds: string[]; groups: { id: string; name: string; price: number; pct: number; teacherId: string; subject: string; gradeId: string }[];
    students: { id: string; code: string; active: boolean; groupIds: string[] }[];
    studentCount: number;
  }[];
};

async function main() {
  const profile = process.argv[2] ?? "baseline";
  console.log(`\n== QAE1 SEED — profile: ${profile} ==`);
  const rng = makeRng(20261015);
  const ctx = { rng };
  if (profile !== "manifest") await wipeQae();

  let manifest: Manifest = { runId: RUN_ID, seedNote: "deterministic mulberry32 seed 20261015", profile, createdAt: new Date().toISOString(), centers: [] };
  const mpath = MANIFEST_PATH;
  if (profile === "manifest" && existsSync(mpath)) {
    try { manifest = JSON.parse(readFileSync(mpath, "utf8")); } catch { /* fresh */ }
  }
  manifest.profile = profile;
  manifest.createdAt = new Date().toISOString();

  if (profile === "baseline") {
    // 2 centers × 50 students = 100 (spec baseline)
    for (const spec of CENTER_SPECS.slice(0, 2)) {
      await seedCenter({ ...spec, students: 50 }, ctx, manifest);
    }
  } else if (profile === "operational") {
    for (const spec of CENTER_SPECS) await seedCenter(spec, ctx, manifest);
  } else if (profile === "stress") {
    await seedCenter(STRESS_SPEC, ctx, manifest);
  } else if (profile === "manifest") {
    console.log(JSON.stringify({ centers: manifest.centers.length, students: manifest.centers.reduce((a, c) => a + c.studentCount, 0) }));
    process.exit(0);
  }

  // (لا platform-admin في الإنتاج — حساب أدمن منصة بباسورد معروف = ثغرة على السنترات الحقيقية)

  // plan + subscription for c03 (quota path) — maxStudents 200, spec 100 students
  const c03 = manifest.centers.find((c) => c.slug === "qae-c03");
  if (c03) {
    const plan = await db.subscriptionPlan.create({
      data: { name: `${RUN_ID} Plan 200`, pricePerStudent: 2500, maxStudents: 200, features: null },
    });
    await db.subscription.create({
      data: { centerId: c03.centerId, planId: plan.id, status: "ACTIVE", startDate: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), renewalDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), paymentStatus: "PAID" },
    });
  }

  writeFileSync(mpath, JSON.stringify(manifest, null, 2));
  const total = manifest.centers.reduce((a, c) => a + c.studentCount, 0);
  console.log(`\n== SEED DONE: ${manifest.centers.length} centers, ${total} students, admin=qae-admin ==\n`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
