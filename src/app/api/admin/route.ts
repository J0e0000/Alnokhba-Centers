import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireAdmin, createSupportSession, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { todayStr, toPiastres } from "@/lib/normalize";
import { pricingBreakdown, monthlyBillPiastres, PRICING } from "@/lib/pricing";
import { recordSubEvent, GRACE_DAYS_DEFAULT, deriveSubStatus, EXPIRY_WARNING_DAYS } from "@/lib/subscription";
import { MODULE_CATALOG, MODULE_KEYS, isModuleKey, moduleOverrideKey, type ModuleKey } from "@/lib/modules";
import { invalidateEntitlements } from "@/lib/entitlements";
import { invalidateCenterCapabilities } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

/** GET /api/admin — platform overview: centers, subscriptions, billing, monitoring */
export const GET = handler(async () => {
  const user = await requireAdmin();
  const today = todayStr();

  const moduleOverrideRows = await db.centerCapability.findMany({ where: { key: { startsWith: "module:" } } });
  const moduleOverridesByCenter: Record<string, Record<string, boolean>> = {};
  for (const r of moduleOverrideRows) {
    const k = r.key.slice("module:".length);
    if (!isModuleKey(k)) continue;
    (moduleOverridesByCenter[r.centerId] ??= {})[k] = r.enabled;
  }

  const [centers, plans, billings, recentLogs, teams, joinRequests, unreadNotifs] = await Promise.all([
    db.center.findMany({
      include: {
        subscription: { include: { plan: true } },
        _count: {
          select: {
            students: { where: { status: "ACTIVE" } },
            sessions: { where: { date: today } },
            users: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { pricePerStudent: "asc" } }),
    db.platformBilling.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { center: { select: { name: true } } } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
    db.team.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          orderBy: { addedAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, role: true, centerId: true } } },
        },
      },
    }),
    // طلبات الانضمام المستنية — عشان الأدمن يعيّنهم لسنتر
    db.user.findMany({
      where: { role: "PENDING" },
      select: { id: true, name: true, username: true, phone: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // إشعارات الأدمن غير المقروءة (طلبات انضمام جديدة وغيرها)
    db.staffNotification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  // موظفي كل سنتر — لزرار «دعم فني» (بدون أي بيانات سرية)
  const users = await db.user.findMany({
    where: { centerId: { not: null } },
    select: { id: true, name: true, username: true, role: true, isActive: true, centerId: true },
    orderBy: { centerId: "asc" },
  });
  const centerNameById = new Map(centers.map((c) => [c.id, c.name]));

  // Per-center activity stats (last 30 days)
  const since = today.slice(0, 8) + "01";
  const stats = await Promise.all(
    centers.map(async (c) => {
      const [activeStudents, totalStudents, monthRevenue, monthPayments, teachers, groups] = await Promise.all([
        db.student.count({ where: { centerId: c.id, status: "ACTIVE" } }),
        db.student.count({ where: { centerId: c.id, status: { not: "ARCHIVED" } } }),
        db.sessionInstance.aggregate({ _sum: { totalRevenue: true }, where: { centerId: c.id, status: "CLOSED", date: { gte: since, lte: today } } }),
        db.studentTransaction.aggregate({ _sum: { amount: true }, where: { centerId: c.id, type: "PAYMENT", createdAt: { gte: new Date(`${since}T00:00:00.000Z`) } } }),
        db.teacher.count({ where: { centerId: c.id, isActive: true } }),
        db.group.count({ where: { centerId: c.id, isActive: true } }),
      ]);
      return { centerId: c.id, activeStudents, totalStudents, monthRevenue: monthRevenue._sum.totalRevenue ?? 0, monthPayments: monthPayments._sum.amount ?? 0, teachers, groups };
    })
  );

  const totals = {
    centers: centers.length,
    activeCenters: centers.filter((c) => c.status === "ACTIVE").length,
    totalActiveStudents: stats.reduce((a, s) => a + s.activeStudents, 0),
    platformRevenue: billings.filter((b) => b.status === "PAID").reduce((a, b) => a + b.amount, 0),
    expiringSoon: centers.filter((c) => {
      const sub = c.subscription;
      if (!sub || sub.status !== "ACTIVE") return false;
      const days = Math.ceil((new Date(sub.renewalDate).getTime() - new Date(today).getTime()) / 86400000);
      return days <= 10;
    }).length,
  };

  return ok({
    totals,
    unreadNotifs,
    joinRequests: joinRequests.map((r) => ({
      id: r.id, name: r.name, username: r.username, phone: r.phone, createdAt: r.createdAt,
    })),
    plans: plans.map((p) => ({ id: p.id, name: p.name, pricePerStudent: p.pricePerStudent, maxStudents: p.maxStudents, features: p.features ? (JSON.parse(p.features) as string[]) : null })),
    moduleCatalog: MODULE_KEYS.map((k) => ({ key: k, ...MODULE_CATALOG[k] })),
    moduleOverrides: moduleOverridesByCenter,
    pricingRules: {
      baseMonthly: PRICING.baseMonthly,
      baseIncludedStudents: PRICING.baseIncludedStudents,
      hardLimitStudents: PRICING.hardLimitStudents,
      tiers: PRICING.tiers.map((t) => ({ from: t.from, to: t.to, unit: t.unit, label: t.label })),
    },
    centers: centers.map((c) => {
      const st = stats.find((s) => s.centerId === c.id)!;
      const sub = c.subscription;
      // الفوترة على كل الطلاب المسجلين غير الأرشيف (متصلين أو أونلاين) — مش «النشطين» بس
      const pricing = pricingBreakdown(st.totalStudents);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        status: c.status,
        primaryColor: c.primaryColor,
        phone: c.phone,
        createdAt: c.createdAt,
        activeStudents: st.activeStudents,
        totalStudents: st.totalStudents,
        staff: c._count.users,
        todaySessions: c._count.sessions,
        monthRevenue: st.monthRevenue,
        teachers: st.teachers,
        groups: st.groups,
        pricing,
        subscription: sub
          ? (() => {
              const derived = deriveSubStatus(sub);
              return {
                id: sub.id, plan: sub.plan.name, planId: sub.planId,
                status: sub.status, pricePerStudent: sub.pricePerStudent,
                renewalDate: sub.renewalDate, paymentStatus: sub.paymentStatus,
                billingPeriod: sub.billingPeriod,
                currentAmount: pricing.total,
                maxStudents: sub.plan.maxStudents,
                overLimit: st.totalStudents >= PRICING.hardLimitStudents,
                // lifecycle (spec §7)
                effectiveStatus: derived.effective,
                daysLeft: derived.daysLeft,
                expiringSoon: derived.expiringSoon,
                renewalDue: derived.renewalDue,
                trialEndsAt: sub.trialEndsAt,
                graceUntil: sub.graceUntil,
                lastRenewedAt: sub.lastRenewedAt,
                cancelledAt: sub.cancelledAt,
                // استحقاقات الخطة (Master Prompt §5) — features null = كل الأقسام
                planFeatures: sub.plan.features ? (JSON.parse(sub.plan.features) as string[]) : null,
                warningDays: EXPIRY_WARNING_DAYS,
              };
            })()
          : null,
      };
    }),
    billings: billings.map((b) => ({
      id: b.id, centerName: b.center?.name ?? "—", students: b.students,
      pricePerStudent: b.pricePerStudent, amount: b.amount,
      periodStart: b.periodStart, periodEnd: b.periodEnd, status: b.status, createdAt: b.createdAt,
    })),
    recentLogs: recentLogs.map((l) => ({
      id: l.id, userName: l.userName, action: l.action, reason: l.reason,
      createdAt: l.createdAt, centerId: l.centerId,
    })),
    users: users.map((u) => ({
      id: u.id, name: u.name, username: u.username, role: u.role,
      isActive: u.isActive, centerId: u.centerId, centerName: centerNameById.get(u.centerId ?? "") ?? "—",
    })),
    teams: teams.map((t) => ({
      id: t.id, name: t.name, description: t.description, isActive: t.isActive, createdAt: t.createdAt,
      members: t.members.map((m) => ({
        id: m.id, userId: m.user.id, name: m.user.name, username: m.user.username,
        role: m.user.role, centerName: m.user.centerId ? centerNameById.get(m.user.centerId) ?? "—" : "—",
      })),
    })),
  });
});

type AdminAction = {
  action?: "renew" | "set-plan" | "set-status" | "support-start"
    | "team-create" | "team-rename" | "team-set-status" | "team-add-member" | "team-remove-member" | "team-set-description"
    | "request-assign" | "request-reject"
    | "sub-lifecycle" | "sub-events"
    | "set-plan-features" | "set-center-modules";
  centerId?: string; planId?: string; months?: number;
  status?: string; markPaid?: boolean;
  // support access
  targetUserId?: string; reason?: string;
  // teams
  teamId?: string; name?: string; description?: string; userId?: string;
  // join requests
  requestRole?: string;
  // subscription lifecycle
  op?: string; days?: number; note?: string;
  // entitlements (Master Prompt §5)
  features?: string[]; // plan features — null/undefined معناها «الخطة الكاملة»
  clearFeatures?: boolean; // رجّع الخطة لكل الأقسام
  modules?: Array<{ key?: string; enabled?: boolean }>;
};

/** POST /api/admin — renew / plan / status / support access / teams */
export const POST = handler(async (req: Request) => {
  const user = await requireAdmin();
  const body = await readJson<AdminAction>(req);
  const today = todayStr();

  // =================== طلبات الانضمام (حسابات بتسجل من الصفحة العامة) ===================
  if (body.action === "request-assign" || body.action === "request-reject") {
    const target = await db.user.findUnique({ where: { id: String(body.targetUserId ?? "") } });
    if (!target) throw new ApiError("الحساب ده مش موجود.", 404);
    if (target.role !== "PENDING") throw new ApiError("الحساب ده مش طلب انضمام مستني.", 400);

    if (body.action === "request-reject") {
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 3) throw new ApiError("اكتب سبب الرفض (3 حروف على الأقل).");
      await db.user.update({ where: { id: target.id }, data: { role: "REJECTED", isActive: false } });
      // اقفل إشعارات طلب الانضمام لكل الأدمن — اتعمل فيها قرار
      await db.staffNotification.updateMany({
        where: { refId: target.id, type: "SIGNUP_REQUEST", readAt: null },
        data: { readAt: new Date() },
      });
      await logAudit({
        user, action: "رفض طلب انضمام", entity: "USER", entityId: target.id,
        before: { role: "PENDING", name: target.name, username: target.username },
        after: { role: "REJECTED" }, reason,
      });
      return ok({ ok: true, rejected: true });
    }

    // request-assign: عيّنه لسنتر + دور
    const role = body.requestRole === "MANAGER" ? "MANAGER" : "RECEPTIONIST";
    const center = await db.center.findUnique({ where: { id: String(body.centerId ?? "") } });
    if (!center) throw new ApiError("السنتر ده مش موجود.", 404);
    if (center.status !== "ACTIVE") throw new ApiError("السنتر ده متوقف — مينفعش تضيف له موظفين.", 400);
    if (role === "MANAGER") {
      const managerCount = await db.user.count({ where: { centerId: center.id, role: "MANAGER", isActive: true } });
      if (managerCount >= 1) throw new ApiError("السنتر ده عنده مدير خلاص — عيّنه موظف استقبال أو شيل المدير القديم.", 409);
    }
    await db.user.update({
      where: { id: target.id },
      data: { role, centerId: center.id, isActive: true, permissions: null },
    });
    await db.staffNotification.updateMany({
      where: { refId: target.id, type: "SIGNUP_REQUEST", readAt: null },
      data: { readAt: new Date() },
    });
    await logAudit({
      user: { ...user, centerId: center.id },
      action: "اعتماد طلب انضمام",
      entity: "USER", entityId: target.id,
      before: { role: "PENDING", name: target.name },
      after: { role, center: center.name, username: target.username },
      reason: `تعيين ${target.name} (${target.username}) لـ ${center.name}`,
    });
    return ok({ ok: true, assigned: true, centerName: center.name, role });
  }

  // =================== دعم فني — دخول باسم مستخدم ===================
  if (body.action === "support-start") {
    const targetUserId = String(body.targetUserId ?? "");
    const reason = String(body.reason ?? "");
    const target = await db.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new ApiError("المستخدم ده مش موجود.", 404);
    const { supportId, expiresAt } = await createSupportSession(user, targetUserId, reason);
    await logAudit({
      user: { ...user, centerId: target.centerId },
      action: AUDIT.SUPPORT_ACCESS_STARTED,
      entity: "SUPPORT_SESSION",
      entityId: supportId,
      after: { targetUser: target.name, targetUsername: target.username, reason: reason.trim(), expiresAt, minutes: 30 },
      reason: `دخول باسم ${target.name} (${target.username})`,
    });
    return ok({ ok: true, supportId, expiresAt });
  }

  // =================== الفرق (تنظيمية — بدون أي صلاحيات) ===================
  if (body.action?.startsWith("team-")) {
    const teamAction = body.action as "team-create" | "team-rename" | "team-set-status" | "team-add-member" | "team-remove-member" | "team-set-description";
    return teamActions(teamAction, body, user);
  }

  const center = await db.center.findUnique({ where: { id: String(body.centerId ?? "") } });
  if (!center) throw new ApiError("السنتر ده مش موجود.", 404);

  if (body.action === "renew") {
    const sub = await db.subscription.findUnique({ where: { centerId: center.id }, include: { plan: true } });
    if (!sub) throw new ApiError("السنتر ده ملوش اشتراك.", 404);

    // الفوترة على كل الطلاب المسجلين غير الأرشيف — بتسعير شرائح النخبة
    const totalStudents = await db.student.count({ where: { centerId: center.id, status: { not: "ARCHIVED" } } });
    if (totalStudents >= PRICING.hardLimitStudents) {
      throw new ApiError(`السنتر ده وصل الحد الأقصى (${PRICING.hardLimitStudents.toLocaleString("en-EG")} طالب) — مينفعش تجدد قبل أرشفة طلاب.`, 409);
    }
    const amount = monthlyBillPiastres(totalStudents) * Math.min(Math.max(Number(body.months ?? 1), 1), 12);
    const avgPerStudent = totalStudents > 0 ? Math.round(amount / totalStudents) : 0;
    const months = Math.min(Math.max(Number(body.months ?? 1), 1), 12);
    const renewal = new Date(sub.renewalDate);
    // renewal counts from the later of (today, current renewal)
    const base = renewal > new Date(today) ? renewal : new Date(today);
    const newRenewal = new Date(base.getTime() + months * 30 * 86400000).toISOString().slice(0, 10);

    await db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { centerId: center.id },
        data: {
          status: "ACTIVE", renewalDate: newRenewal,
          paymentStatus: body.markPaid === false ? "PENDING" : "PAID",
          pricePerStudent: avgPerStudent,
          lastRenewedAt: new Date(), graceUntil: null, cancelledAt: null,
        },
      });
      await tx.platformBilling.create({
        data: {
          centerId: center.id, students: totalStudents, pricePerStudent: avgPerStudent,
          amount, periodStart: today, periodEnd: newRenewal,
          status: body.markPaid === false ? "PENDING" : "PAID", createdBy: user.id,
        },
      });
      // Make sure center is active again
      await tx.center.update({ where: { id: center.id }, data: { status: "ACTIVE" } });
    });

    // سجل حياة الاشتراك (spec §7)
    await recordSubEvent({
      subscriptionId: sub.id, centerId: center.id, type: "RENEWED",
      fromStatus: sub.status, toStatus: "ACTIVE", amount,
      note: `تجديد ${months} شهر لغاية ${newRenewal} (${body.markPaid === false ? "غير مدفوع" : "مدفوع"})`,
      userId: user.id, userName: user.name,
    });

    await logAudit({
      user: { ...user, centerId: center.id },
      action: AUDIT.SUBSCRIPTION_RENEWED,
      entity: "SUBSCRIPTION",
      entityId: sub.id,
      before: { renewalDate: sub.renewalDate, status: sub.status },
      after: { renewalDate: newRenewal, amount, students: totalStudents, months, pricing: "tiered" },
    });
    return ok({ renewed: true, renewalDate: newRenewal, amount, students: totalStudents, months });
  }

  if (body.action === "set-plan") {
    const plan = await db.subscriptionPlan.findUnique({ where: { id: String(body.planId ?? "") } });
    if (!plan) throw new ApiError("الخطة دي مش موجودة.", 404);
    const sub = await db.subscription.findUnique({ where: { centerId: center.id } });
    if (!sub) throw new ApiError("السنتر ده ملوش اشتراك.", 404);
    await db.subscription.update({
      where: { centerId: center.id },
      data: { planId: plan.id, pricePerStudent: plan.pricePerStudent },
    });
    await recordSubEvent({
      subscriptionId: sub.id, centerId: center.id, type: "PLAN_CHANGE",
      note: `تغيير الخطة لـ ${plan.name} (${plan.pricePerStudent} قرش/طالب/شهر)`,
      userId: user.id, userName: user.name,
    });
    await logAudit({
      user: { ...user, centerId: center.id },
      action: AUDIT.SUBSCRIPTION_RENEWED,
      entity: "SUBSCRIPTION",
      entityId: sub.id,
      before: { plan: sub.planId, pricePerStudent: sub.pricePerStudent },
      after: { plan: plan.name, pricePerStudent: plan.pricePerStudent },
      reason: "تغيير خطة",
    });
    return ok({ ok: true });
  }

  if (body.action === "set-status") {
    const status = body.status === "ACTIVE" ? "ACTIVE" : "SUSPENDED";
    await db.center.update({ where: { id: center.id }, data: { status } });
    await logAudit({
      user: { ...user, centerId: center.id },
      action: AUDIT.CENTER_STATUS_CHANGED,
      entity: "CENTER",
      entityId: center.id,
      before: { status: center.status },
      after: { status },
    });
    return ok({ ok: true, status });
  }

  // =================== استحقاقات الأقسام (Master Prompt §3/§5) ===================
  // ملاحظة أمنية: الأكشنز دي للأدمن (منصة) بس — مدير السنتر ميعرفش يفتح قسم
  // مستثنى من خطته (override السنتر بيطفي بس — التقييم في entitlements.ts).
  if (body.action === "set-plan-features") {
    const plan = await db.subscriptionPlan.findUnique({ where: { id: String(body.planId ?? "") } });
    if (!plan) throw new ApiError("الخطة دي مش موجودة.", 404);
    if (body.clearFeatures) {
      // الخطة الكاملة — كل الأقسام
      await db.subscriptionPlan.update({ where: { id: plan.id }, data: { features: null } });
    } else {
      const feats = Array.isArray(body.features) ? body.features : [];
      if (!feats.length) throw new ApiError("اختار قسم واحد على الأقل — أو استخدم «الخطة الكاملة».", 400);
      for (const f of feats) if (!isModuleKey(f)) throw new ApiError(`قسم مش معروف: ${f}.`, 400);
      await db.subscriptionPlan.update({
        where: { id: plan.id },
        data: { features: JSON.stringify(MODULE_KEYS.filter((k) => feats.includes(k))) },
      });
    }
    // إلغاء كاش الاستحقاق لكل السنترات على الخطة دي + تدقيق
    const affected = await db.subscription.findMany({ where: { planId: plan.id }, select: { centerId: true } });
    for (const a of affected) invalidateEntitlements(a.centerId);
    await logAudit({
      user,
      action: "PLAN_FEATURES_CHANGED",
      entity: "SUBSCRIPTION_PLAN",
      entityId: plan.id,
      before: { features: plan.features },
      after: { features: body.clearFeatures ? null : JSON.stringify(body.features ?? []) },
      reason: body.reason ?? "تعديل ميزات الخطة",
    });
    return ok({ ok: true, affectedCenters: affected.length });
  }

  if (body.action === "set-center-modules") {
    const updates = Array.isArray(body.modules) ? body.modules : [];
    if (!updates.length) throw new ApiError("مفيش تغييرات — حدد الأقسام.", 400);
    const before = await db.centerCapability.findMany({ where: { centerId: center.id, key: { startsWith: "module:" } } });
    for (const u of updates) {
      const key = String(u.key ?? "");
      if (!isModuleKey(key)) throw new ApiError(`قسم مش معروف: ${key}.`, 400);
      const okey = moduleOverrideKey(key as ModuleKey);
      if (u.enabled === true) {
        // إزالة override (القسم يرجع لحكم الخطة/الافتراضي)
        await db.centerCapability.deleteMany({ where: { centerId: center.id, key: okey } });
      } else {
        await db.centerCapability.upsert({
          where: { centerId_key: { centerId: center.id, key: okey } },
          create: { centerId: center.id, key: okey, enabled: false },
          update: { enabled: false },
        });
      }
    }
    invalidateEntitlements(center.id);
    invalidateCenterCapabilities(center.id);
    await logAudit({
      user: { ...user, centerId: center.id },
      action: "CENTER_MODULES_CHANGED",
      entity: "CENTER",
      entityId: center.id,
      before: { overrides: before.map((b) => ({ key: b.key, enabled: b.enabled })) },
      after: { updates },
      reason: body.reason ?? "تعديل أقسام السنتر من لوحة المنصة",
    });
    return ok({ ok: true });
  }

  // =================== دورة حياة الاشتراك (spec §7) ===================
  // كل انتقال بيتسجل في SubscriptionEvent — ومفيش أي حذف بيانات سنتر أبدًا.
  if (body.action === "sub-lifecycle") {
    const sub = await db.subscription.findUnique({ where: { centerId: center.id } });
    if (!sub) throw new ApiError("السنتر ده ملوش اشتراك.", 404);
    const op = String(body.op ?? "");
    const note = body.note ? String(body.note).trim() || null : null;
    const today = todayStr();

    if (op === "start-trial") {
      const days = Math.min(Math.max(Number(body.days ?? 14), 1), 60);
      const trialEnds = new Date(Date.now() + days * 86400000);
      const renewal = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      await db.subscription.update({
        where: { centerId: center.id },
        data: { status: "TRIAL", trialEndsAt: trialEnds, renewalDate: renewal, graceUntil: null, cancelledAt: null },
      });
      await recordSubEvent({ subscriptionId: sub.id, centerId: center.id, type: "TRIAL_START", fromStatus: sub.status, toStatus: "TRIAL", note: note ?? `تجربة ${days} يوم لغاية ${renewal}`, userId: user.id, userName: user.name });
      await logAudit({ user: { ...user, centerId: center.id }, action: AUDIT.CENTER_STATUS_CHANGED, entity: "SUBSCRIPTION", entityId: sub.id, before: { status: sub.status }, after: { status: "TRIAL" }, reason: note ?? "بدء تجربة" });
      return ok({ ok: true, status: "TRIAL" });
    }

    if (op === "apply-grace") {
      const days = Math.min(Math.max(Number(body.days ?? GRACE_DAYS_DEFAULT), 1), 30);
      const graceUntil = new Date(Date.now() + days * 86400000);
      await db.subscription.update({
        where: { centerId: center.id },
        data: { status: "GRACE", graceUntil, trialEndsAt: null, cancelledAt: null },
      });
      await recordSubEvent({ subscriptionId: sub.id, centerId: center.id, type: "GRACE_APPLIED", fromStatus: sub.status, toStatus: "GRACE", note: note ?? `فترة سماح ${days} يوم`, userId: user.id, userName: user.name });
      await logAudit({ user: { ...user, centerId: center.id }, action: AUDIT.CENTER_STATUS_CHANGED, entity: "SUBSCRIPTION", entityId: sub.id, before: { status: sub.status }, after: { status: "GRACE" }, reason: note ?? "منح فترة سماح" });
      return ok({ ok: true, status: "GRACE" });
    }

    if (op === "cancel") {
      await db.subscription.update({
        where: { centerId: center.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await recordSubEvent({ subscriptionId: sub.id, centerId: center.id, type: "CANCELLED", fromStatus: sub.status, toStatus: "CANCELLED", note: note ?? "إلغاء الاشتراك — بيانات السنتر محفوظة ومفيش أي حذف تلقائي", userId: user.id, userName: user.name });
      await logAudit({ user: { ...user, centerId: center.id }, action: AUDIT.CENTER_STATUS_CHANGED, entity: "SUBSCRIPTION", entityId: sub.id, before: { status: sub.status }, after: { status: "CANCELLED" }, reason: note ?? "إلغاء اشتراك" });
      return ok({ ok: true, status: "CANCELLED" });
    }

    if (op === "expire") {
      // انتهاء صريح — بدون أي حذف/تعطيل تلقائي (spec §7 CRITICAL)
      await db.subscription.update({
        where: { centerId: center.id },
        data: { status: "EXPIRED", graceUntil: null },
      });
      await recordSubEvent({ subscriptionId: sub.id, centerId: center.id, type: "STATUS_CHANGE", fromStatus: sub.status, toStatus: "EXPIRED", note: note ?? "تحديد الحالة منتهي — مفيش أي حذف بيانات", userId: user.id, userName: user.name });
      await logAudit({ user: { ...user, centerId: center.id }, action: AUDIT.CENTER_STATUS_CHANGED, entity: "SUBSCRIPTION", entityId: sub.id, before: { status: sub.status }, after: { status: "EXPIRED" }, reason: note ?? "تحديد اشتراك منتهي" });
      return ok({ ok: true, status: "EXPIRED" });
    }

    throw new ApiError("عملية الاشتراك دي مش معروفة.", 400);
  }

  // سجل حياة الاشتراك للعرض
  if (body.action === "sub-events") {
    const sub = await db.subscription.findUnique({ where: { centerId: center.id } });
    if (!sub) throw new ApiError("السنتر ده ملوش اشتراك.", 404);
    const events = await db.subscriptionEvent.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok({ events });
  }

  throw new ApiError("العملية دي مش معروفة.");
});

/** عمليات الفرق — كلها أدمن، وتنظيمية بحتة (مش بتغير أي صلاحيات) */
async function teamActions(
  action: "team-create" | "team-rename" | "team-set-status" | "team-add-member" | "team-remove-member" | "team-set-description",
  body: AdminAction,
  user: Awaited<ReturnType<typeof requireAdmin>>,
) {
  if (action === "team-create") {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) throw new ApiError("اكتب اسم الفريق (حرفين على الأقل).");
    const exists = await db.team.findUnique({ where: { name } });
    if (exists) throw new ApiError("فيه فريق بنفس الاسم خلاص.", 409);
    const team = await db.team.create({
      data: { name, description: body.description?.trim() || null },
    });
    await logAudit({ user, action: AUDIT.TEAM_CREATED, entity: "TEAM", entityId: team.id, after: { name } });
    return ok({ team: { id: team.id, name: team.name } }, { status: 201 });
  }

  const team = await db.team.findUnique({
    where: { id: String(body.teamId ?? "") },
    include: { members: { include: { user: { select: { name: true, username: true } } } } },
  });
  if (!team) throw new ApiError("الفريق ده مش موجود.", 404);

  if (action === "team-rename") {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) throw new ApiError("اكتب اسم الفريق (حرفين على الأقل).");
    const exists = await db.team.findFirst({ where: { name, id: { not: team.id } } });
    if (exists) throw new ApiError("فيه فريق تاني بنفس الاسم.", 409);
    await db.team.update({ where: { id: team.id }, data: { name } });
    await logAudit({ user, action: AUDIT.TEAM_RENAMED, entity: "TEAM", entityId: team.id, before: { name: team.name }, after: { name } });
    return ok({ ok: true });
  }

  if (action === "team-set-description") {
    const description = String(body.description ?? "").trim() || null;
    await db.team.update({ where: { id: team.id }, data: { description } });
    await logAudit({ user, action: AUDIT.TEAM_RENAMED, entity: "TEAM", entityId: team.id, before: { description: team.description }, after: { description } });
    return ok({ ok: true });
  }

  if (action === "team-set-status") {
    const isActive = body.status === "ACTIVE";
    await db.team.update({ where: { id: team.id }, data: { isActive } });
    await logAudit({ user, action: AUDIT.TEAM_STATUS_CHANGED, entity: "TEAM", entityId: team.id, before: { isActive: team.isActive }, after: { isActive } });
    return ok({ ok: true, isActive });
  }

  if (action === "team-add-member") {
    const member = await db.user.findUnique({ where: { id: String(body.userId ?? "") } });
    if (!member) throw new ApiError("المستخدم ده مش موجود.", 404);
    const exists = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: team.id, userId: member.id } },
    });
    if (exists) throw new ApiError(`${member.name} عضو في الفريق ده خلاص.`, 409);
    await db.teamMember.create({
      data: { teamId: team.id, userId: member.id, addedById: user.id },
    });
    await logAudit({
      user, action: AUDIT.TEAM_MEMBER_ADDED, entity: "TEAM", entityId: team.id,
      after: { member: member.name, username: member.username },
    });
    return ok({ ok: true }, { status: 201 });
  }

  if (action === "team-remove-member") {
    const membership = await db.teamMember.findFirst({
      where: { teamId: team.id, userId: String(body.userId ?? "") },
      include: { user: { select: { name: true, username: true } } },
    });
    if (!membership) throw new ApiError("العضو ده مش في الفريق ده.", 404);
    await db.teamMember.delete({ where: { id: membership.id } });
    await logAudit({
      user, action: AUDIT.TEAM_MEMBER_REMOVED, entity: "TEAM", entityId: team.id,
      before: { member: membership.user.name, username: membership.user.username },
    });
    return ok({ ok: true });
  }

  throw new ApiError("العملية دي مش معروفة.");
}

/** PUT /api/admin — create a plan (platform config) */
export const PUT = handler(async (req: Request) => {
  const user = await requireAdmin();
  const body = await readJson<{ name?: string; pricePerStudent?: number; maxStudents?: number | null }>(req);
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError("اكتب اسم الخطة.");
  const price = toPiastres(Number(body.pricePerStudent ?? 0));
  if (price <= 0) throw new ApiError("سعر الطالب لازم يكون أكبر من صفر.");
  const plan = await db.subscriptionPlan.create({
    data: { name, pricePerStudent: price, maxStudents: body.maxStudents ?? null },
  });
  return ok({ plan: { id: plan.id } }, { status: 201 });
});
