import "server-only";
import { db } from "@/lib/db";
import { manyBalances } from "@/lib/finance";
import { todayStr } from "@/lib/normalize";

// ============================================================
// التنبيهات الذكية (المرحلة 6) — محرك استباقي يحسب المخاطر الجارية
// من البيانات نفسها لحظة الطلب (مفيش cron لازم عشان الأرقام تتحدث).
// read-only 100% — مفيش أي كتابة هنا. الإشعار اليومي بيتعمل في /api/alerts/cron.
// ============================================================

export type AlertSeverity = "CRITICAL" | "WARN" | "INFO";

export type SmartAlert = {
  key: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  count: number;
  items: { label: string; sub?: string }[];
};

/** أيام الغياب المتتالي المعتمدة: آخر 3 حصص انعقدت فعلاً لكل مجموعة خلال 21 يوم */
const STREAK_SESSIONS = 3;
const STREAK_WINDOW_DAYS = 21;

export async function computeAlerts(
  centerId: string,
  opts?: { includeBackupStale?: boolean },
): Promise<SmartAlert[]> {
  const today = todayStr();
  const windowStart = new Date(Date.now() - STREAK_WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  const alerts: SmartAlert[] = [];

  /* 1) طلاب برصيد سالب (مدينين) — CRITICAL */
  const activeStudents = await db.student.findMany({
    where: { centerId, status: "ACTIVE" },
    select: { id: true, name: true, code: true },
  });
  const balances = await manyBalances(centerId, activeStudents.map((s) => s.id));
  const debtors = activeStudents
    .map((s) => ({ ...s, bal: balances.get(s.id) ?? 0 }))
    .filter((s) => s.bal < 0)
    .sort((a, b) => a.bal - b.bal);
  if (debtors.length > 0) {
    const totalEGP = Math.abs(debtors.reduce((sum, s) => sum + s.bal, 0)) / 100;
    alerts.push({
      key: "NEGATIVE_BALANCES",
      severity: "CRITICAL",
      title: "طلاب مدينين (رصيد سالب)",
      detail: `${debtors.length} طالب — إجمالي مستحق للسنتر ${totalEGP.toLocaleString("ar-EG")} ج`,
      count: debtors.length,
      items: debtors.slice(0, 5).map((s) => ({
        label: s.name,
        sub: `كود ${s.code} · مدين ${(Math.abs(s.bal) / 100).toLocaleString("ar-EG")} ج`,
      })),
    });
  }

  /* 2) طلبات موافقة معلقة من أكتر من 24 ساعة — WARN */
  const dayAgo = new Date(Date.now() - 86400_000);
  const staleApprovals = await db.approvalRequest.findMany({
    where: { centerId, status: "PENDING", createdAt: { lt: dayAgo } },
    select: { number: true, type: true, reason: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  if (staleApprovals.length > 0) {
    alerts.push({
      key: "STALE_APPROVALS",
      severity: "WARN",
      title: "طلبات موافقة مستنّية من أكتر من يوم",
      detail: `${staleApprovals.length} طلب محتاج قرار — التأخير بيوقف عمليات الموظفين`,
      count: staleApprovals.length,
      items: staleApprovals.map((a) => ({
        label: `${a.number} · ${a.type}`,
        sub: a.reason.slice(0, 60),
      })),
    });
  }

  /* 3) أيام خزنة مفتوحة من أيام فاتت — WARN (المطابقة اليومية بتبوظ) */
  const openCashDays = await db.cashDay.findMany({
    where: { centerId, status: "OPEN", date: { lt: today } },
    select: { date: true },
    orderBy: { date: "asc" },
    take: 5,
  });
  if (openCashDays.length > 0) {
    alerts.push({
      key: "OPEN_CASH_DAYS",
      severity: "WARN",
      title: "أيام خزنة مش مقفولة",
      detail: `${openCashDays.length} يوم/أيام فاتت ولسه مفتوحة — اقفلها عشان أرقام الخزنة تبقى مضبوطة`,
      count: openCashDays.length,
      items: openCashDays.map((d) => ({ label: d.date })),
    });
  }

  /* 4) حصص قديمة لسه OPEN — WARN (الحصة المقفولة بتحمي البيانات من التعديل) */
  const openPastSessions = await db.sessionInstance.count({
    where: { centerId, status: "OPEN", date: { lt: today } },
  });
  if (openPastSessions > 0) {
    alerts.push({
      key: "OPEN_PAST_SESSIONS",
      severity: "WARN",
      title: "حصص قديمة مش مقفولة",
      detail: `${openPastSessions} حصة من أيام فاتت لسه مفتوحة — اقفلها عشان تتمّ أرقام اليوم`,
      count: openPastSessions,
      items: [],
    });
  }

  /* 5) غياب متكرر: طالب فات آخر 3 حصص انعقدت لمجموعته — INFO
     الغياب = مفيش سجل حضور خالص (مفيش حالة ABSENT في النظام) */
  const recentSessions = await db.sessionInstance.findMany({
    where: { centerId, status: { not: "CANCELLED" }, date: { lte: today, gte: windowStart }, groupId: { not: null } },
    select: { id: true, groupId: true, date: true },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  const last3ByGroup = new Map<string, string[]>();
  for (const s of recentSessions) {
    if (!s.groupId) continue;
    const list = last3ByGroup.get(s.groupId);
    if (list) {
      if (list.length < STREAK_SESSIONS) list.push(s.id);
    } else last3ByGroup.set(s.groupId, [s.id]);
  }
  const streakSessionIds = [...last3ByGroup.values()].flat();
  if (streakSessionIds.length >= STREAK_SESSIONS) {
    const [attRows, memberships] = await Promise.all([
      db.attendance.findMany({
        where: { centerId, sessionId: { in: streakSessionIds }, studentId: { not: null } },
        select: { sessionId: true, studentId: true },
      }),
      db.studentGroup.findMany({
        where: { groupId: { in: [...last3ByGroup.keys()] }, status: "ACTIVE" },
        select: { groupId: true, studentId: true },
      }),
    ]);
    const present = new Set(attRows.map((a) => `${a.sessionId}:${a.studentId}`));
    const studentNameById = new Map(activeStudents.map((s) => [s.id, s]));
    // لكل طالب: هل شاف آخر 3 حصص مجموعته كلها بدون أي حضور؟
    const streaks: { name: string; code: string; group: string }[] = [];
    const groupNameById = new Map(
      await db.group.findMany({ where: { centerId, isActive: true }, select: { id: true, name: true, subject: { select: { name: true } } } })
        .then((gs) => gs.map((g) => [g.id, `${g.subject.name} (${g.name})`] as const)),
    );
    for (const m of memberships) {
      const ids = last3ByGroup.get(m.groupId);
      if (!ids || ids.length < STREAK_SESSIONS) continue;
      if (ids.every((sid) => !present.has(`${sid}:${m.studentId}`))) {
        const st = studentNameById.get(m.studentId);
        if (st) streaks.push({ name: st.name, code: st.code, group: groupNameById.get(m.groupId) ?? "" });
      }
    }
    if (streaks.length > 0) {
      alerts.push({
        key: "ABSENCE_STREAKS",
        severity: "INFO",
        title: "غياب متكرر — فاتهم آخر 3 حصص",
        detail: `${streaks.length} طالب غايب عن آخر 3 حصص متتالية لمجموعته — محتاجين متابعة`,
        count: streaks.length,
        items: streaks.slice(0, 5).map((s) => ({ label: s.name, sub: `${s.group} · كود ${s.code}` })),
      });
    }
  }

  /* 6) نسخة الاحتياطي قديمة (وضع Postgres بس — المطور المحلي مالوش) — INFO */
  if (opts?.includeBackupStale) {
    const lastOk = await db.backupRun.findFirst({
      where: { kind: "PLATFORM", target: "DB", status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const stale = !lastOk || Date.now() - lastOk.startedAt.getTime() > 25 * 3600_000;
    if (stale) {
      alerts.push({
        key: "BACKUP_STALE",
        severity: "INFO",
        title: "احتياطي قاعدة البيانات قديم",
        detail: !lastOk
          ? "مفيش أي نسخة احتياطية ناجحة مسجلة — شغّل backup:pg من الـ runbook"
          : `آخر نسخة ناجحة كانت ${lastOk.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC — أكتر من 25 ساعة`,
        count: 1,
        items: [],
      });
    }
  }

  // الترتيب: CRITICAL أولاً ثم WARN ثم INFO
  const order: Record<AlertSeverity, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
