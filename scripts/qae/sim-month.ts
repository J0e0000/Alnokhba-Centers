/**
 * QAE1 SIM-MONTH — replays a full simulated operating month (D-30..D-1) on the
 * operational dataset, using the application's real data model + exact invariants:
 *   CHARGE = -(effectivePrice) for PRESENT/LATE · EXCUSED charged 0
 *   balance = Σ signed txns · receipts sequential per center w/ running balanceBefore/After
 *   close: totalRevenue=Σcharged(PRESENT|LATE) · teacherShare=round(rev*pct/100)
 *          → TeacherSettlement(EARNED) + CenterTransaction(SESSION_REVENUE/TEACHER_SHARE)
 * Realistic variation: per-student attendance propensity, weak/strong performers,
 * cancelled sessions, unclosed sessions (late data), mid-month registrations,
 * attendance corrections, failed notifications, declining quiz scores, peak days.
 * Run: bun scripts/qae/sim-month.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  makeRng, ri, pick, chance, cairoYMD, dayStr, dowOf, cairoTs, studentName, synthPhone, qrToken,
  saveResult, ANNOUNCE_TITLES,
} from "./lib";
import { readFileSync, writeFileSync } from "fs";

const db = new PrismaClient();
const MANIFEST = JSON.parse(readFileSync("/home/z/my-project/qae/manifest.json", "utf8"));
const DAYS = 30; // D-30 .. D-1 (today stays for live API replay)

let cuidCounter = 0;
const cuid = () => `cqae${Date.now().toString(36)}${(cuidCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

type AttRow = { id: string; centerId: string; sessionId: string; studentId: string; status: string; method: string; charged: number | null; recordedBy: string; createdAt: Date; studentName: string; studentCode: string; note?: string };
type Txn = { id: string; centerId: string; studentId: string; sessionId: string | null; type: string; amount: number; method: string | null; reason: string | null; createdBy: string; createdAt: Date };
type Receipt = { id: string; centerId: string; seq: number; number: string; txnId: string; studentId: string; amount: number; method: string | null; balanceBefore: number; balanceAfter: number; sessionId: string | null; issuedBy: string; issuedByName: string; date: string; createdAt: Date };

const log: any = { startedAt: new Date().toISOString(), seed: 20261015, centers: {}, totals: {} };
const groundTruth: any = { generatedAt: new Date().toISOString(), window: { from: dayStr(-DAYS), to: dayStr(-1) }, centers: {} };

function dailyKey(date: string) { return date; }

async function main() {
  const t0 = Date.now();
  console.log(`\n== QAE1 SIM-MONTH: ${DAYS} simulated days (${dayStr(-DAYS)} → ${dayStr(-1)}) ==`);

  for (const cm of MANIFEST.centers) {
    const cT0 = Date.now();
    const rng = makeRng(20261015 + Number(cm.n) * 77);
    const centerId = cm.centerId;
    const mgrId = cm.users[`qae-mgr-${cm.n}`];
    const recId = cm.users[`qae-rec-${cm.n}`];

    // ----- load structures -----
    const groups = await db.group.findMany({
      where: { centerId },
      include: { subject: { select: { name: true } } },
    });
    const slots = await db.scheduleSlot.findMany({ where: { centerId } });
    const regs = await db.studentGroup.findMany({ where: { student: { centerId } }, include: { student: { select: { id: true, name: true, code: true, status: true, createdAt: true } } } });
    const byGroup: Record<string, typeof regs> = {};
    for (const r of regs) (byGroup[r.groupId] ??= []).push(r);
    // per-student attendance propensity (strong/weak variation)
    const propensity = new Map<string, number>();
    regs.forEach((r, i) => {
      if (!propensity.has(r.studentId)) {
        const base = 0.55 + ((i * 2654435761) % 1000) / 1000 * 0.42; // 0.55..0.97
        propensity.set(r.studentId, base);
      }
    });

    const sessions: any[] = [];
    const attRows: AttRow[] = [];
    const txns: Txn[] = [];
    const receipts: Receipt[] = [];
    const attendanceEvents: any[] = [];
    const centerTxns: any[] = [];
    const settlements: any[] = [];
    const expenses: any[] = [];
    const cashDays: any[] = [];
    const announcements: any[] = [];
    const studentNotifs: any[] = [];
    const queueItems: any[] = [];
    const notificationAttempts: any[] = [];
    const auditRows: any[] = [];
    const quizzes: any[] = []; const quizQs: any[] = []; const quizAttempts: any[] = [];
    const exams: any[] = []; const examQs: any[] = []; const examAttempts: any[] = []; const examAnswers: any[] = [];
    const books: any[] = []; const bookSales: any[] = [];
    const newStudents: any[] = [];
    const corrections: any[] = [];

    const daily: Record<string, { sessions: number; closed: number; cancelled: number; attendance: number; charges: number; payments: number; paymentsSum: number }> = {};

    // ===== mid-month new registrations (2-4 students) =====
    const nNew = ri(rng, 2, 4);
    const createdNew: { id: string; groupId: string; from: string }[] = [];
    for (let i = 0; i < nNew; i++) {
      const regDay = dayStr(-ri(rng, 3, 24));
      const g = pick(rng, groups);
      const name = studentName(rng);
      const code = String(88900 + Number(cm.n) * 5 + i); // 5-digit, never collides with seed ranges (10000+)
      const s = { id: cuid(), centerId, code, qrToken: qrToken(), name, phone: synthPhone(rng), parentName: `ولي أمر ${name.split(" ")[0]}`, parentPhone: synthPhone(rng), gradeId: g.gradeId, school: "مدرسة جديدة QAE1", status: "ACTIVE", createdAt: cairoTs(regDay, "11:30") };
      newStudents.push(s);
      createdNew.push({ id: s.id, groupId: g.id, from: regDay });
      propensity.set(s.id, 0.7 + rng() * 0.25);
      auditRows.push({ id: cuid(), centerId, userId: mgrId, userName: "QAE1 مدير", action: "STUDENT_CREATED", entity: "Student", entityId: s.id, after: JSON.stringify({ name, code }), createdAt: s.createdAt });
    }
    const newById = new Map(newStudents.map((s) => [s.id, s]));
    // build combined regs ONCE (DB regs + mid-month registrations)
    const regsAll: any[] = [...regs];
    for (const cn of createdNew) {
      const s: any = newById.get(cn.id);
      regsAll.push({ studentId: cn.id, groupId: cn.groupId, priceOverride: null, student: { id: s.id, name: s.name, code: s.code, status: "ACTIVE", createdAt: s.createdAt } });
    }

    // ===== attendance marking helper =====
    const methodFor = (): string => { const r = rng(); return r < 0.7 ? "MANUAL" : r < 0.88 ? "QR_SCAN" : "SESSION_QR"; };

    // ===== 30-day loop =====
    for (let d = DAYS; d >= 1; d--) {
      const date = dayStr(-d);
      const dow = dowOf(date);
      const dayLog = { sessions: 0, closed: 0, cancelled: 0, attendance: 0, charges: 0, payments: 0, paymentsSum: 0 };
      const peak = chance(rng, 0.1); // exam-prep peak day

      for (const g of groups) {
        const gSlots = slots.filter((s) => s.groupId === g.id && s.dayOfWeek === dow);
        for (const slot of gSlots) {
          const startTs = cairoTs(date, slot.startTime);
          if (startTs.getTime() > Date.now()) continue; // future slot — skip (day 0 handles live)
          dayLog.sessions++;
          const cancelled = chance(rng, 0.03);
          const sessId = cuid();
          if (cancelled) {
            sessions.push({ id: sessId, centerId, scheduleId: slot.id, groupId: g.id, date, startTime: slot.startTime, endTime: slot.endTime, room: slot.room, price: g.sessionPrice, teacherPercent: g.teacherPercent, status: "CANCELLED", openedBy: mgrId, createdAt: startTs });
            dayLog.cancelled++;
            auditRows.push({ id: cuid(), centerId, userId: mgrId, userName: "QAE1 مدير", action: "SESSION_CANCELLED", entity: "SessionInstance", entityId: sessId, reason: "ظروف طارئة", createdAt: startTs });
            continue;
          }
          sessions.push({ id: sessId, centerId, scheduleId: slot.id, groupId: g.id, date, startTime: slot.startTime, endTime: slot.endTime, room: slot.room, price: g.sessionPrice, teacherPercent: g.teacherPercent, status: "OPEN", openedBy: mgrId, createdAt: startTs });

          // attendance for ACTIVE registrations (dedupe by studentId)
          const seenReg = new Set<string>();
          const gRegs = regsAll.filter((r: any) => r.groupId === g.id && !seenReg.has(r.studentId) && seenReg.add(r.studentId));
          let revenue = 0; let present = 0;
          const sessRows: AttRow[] = [];
          for (const r of gRegs) {
            const st: any = r.student;
            if (st.status !== "ACTIVE") continue;
            const regFrom = st.createdAt ? (st.createdAt instanceof Date ? st.createdAt : new Date(st.createdAt)) : null;
            if (regFrom && regFrom.getTime() > startTs.getTime()) continue; // registered after this session
            const p = Math.min(0.98, propensity.get(r.studentId)! + (peak ? 0.08 : 0));
            if (rng() > p) continue; // absent → no row
            const r3 = rng();
            const status = r3 < 0.91 ? "PRESENT" : r3 < 0.96 ? "LATE" : "EXCUSED";
            const price = r.priceOverride ?? g.sessionPrice;
            const charged = status === "EXCUSED" ? 0 : price;
            const method = methodFor();
            const at = new Date(startTs.getTime() + ri(rng, 0, 25) * 60000);
            const row: AttRow = { id: cuid(), centerId, sessionId: sessId, studentId: r.studentId, status, method, charged, recordedBy: chance(rng, 0.7) ? mgrId : recId, createdAt: at, studentName: st.name, studentCode: st.code };
            sessRows.push(row);
            if (status !== "EXCUSED") {
              revenue += charged; present++;
              txns.push({ id: cuid(), centerId, studentId: r.studentId, sessionId: sessId, type: "CHARGE", amount: -charged, method: null, reason: `حصة ${g.subject.name}`, createdBy: row.recordedBy, createdAt: at });
              dayLog.charges++;
            }
            dayLog.attendance++;
            if (method === "QR_SCAN" || method === "SESSION_QR") {
              attendanceEvents.push({ id: cuid(), centerId, personType: "STUDENT", studentId: r.studentId, displayName: st.name, role: "STUDENT", method: method === "QR_SCAN" ? "STATIC_QR" : "DYNAMIC_QR", status, sessionId: sessId, occurredAt: at });
            }
          }
          attRows.push(...sessRows);

          // attendance corrections (PATCH-style) in ~2.5% of sessions
          if (chance(rng, 0.025) && sessRows.length > 2) {
            const exc = sessRows.find((a) => a.status === "EXCUSED");
            if (exc) {
              const g2 = groups.find((x) => x.id === (sessions.find((s) => s.id === exc.sessionId)!.groupId))!;
              const price2 = g2.sessionPrice;
              const fixTs = new Date(startTs.getTime() + ri(rng, 40, 90) * 60000);
              exc.status = "PRESENT"; exc.charged = price2;
              txns.push({ id: cuid(), centerId, studentId: exc.studentId, sessionId: exc.sessionId, type: "CHARGE", amount: -price2, method: null, reason: "تصحيح حضور — تحويل من إذن لحضور", createdBy: mgrId, createdAt: fixTs });
              revenue += price2; present++;
              corrections.push({ sessionId: exc.sessionId, studentId: exc.studentId, from: "EXCUSED", to: "PRESENT", at: fixTs });
              dayLog.charges++;
            }
          }

          // close or leave open
          const unclosed = chance(rng, 0.05); // late/missing data entry
          if (!unclosed) {
            const endTs = cairoTs(date, slot.endTime);
            const closedAt = new Date(endTs.getTime() + ri(rng, 5, 40) * 60000);
            const teacherShare = Math.round((revenue * g.teacherPercent) / 100);
            const centerShare = revenue - teacherShare;
            const sess = sessions.find((s) => s.id === sessId)!;
            sess.status = "CLOSED"; sess.closedBy = mgrId; sess.closedAt = closedAt;
            sess.presentCount = present; sess.totalRevenue = revenue; sess.teacherShare = teacherShare; sess.centerShare = centerShare;
            dayLog.closed++;
            if (g.teacherId && teacherShare > 0) {
              settlements.push({ id: cuid(), centerId, teacherId: g.teacherId, sessionId: sessId, type: "EARNED", amount: teacherShare, date, note: `مستحق حصة ${g.subject.name}`, createdBy: mgrId, createdAt: closedAt });
            }
            centerTxns.push({ id: cuid(), centerId, type: "SESSION_REVENUE", amount: revenue, date, note: `إيراد حصة ${g.subject.name}`, refType: "SESSION", refId: sessId, createdBy: mgrId, createdAt: closedAt });
            centerTxns.push({ id: cuid(), centerId, type: "TEACHER_SHARE", amount: -teacherShare, date, note: `نصيب المدرس`, refType: "SESSION", refId: sessId, createdBy: mgrId, createdAt: closedAt });
            if (chance(rng, 0.3)) auditRows.push({ id: cuid(), centerId, userId: mgrId, userName: "QAE1 مدير", action: "SESSION_CLOSED", entity: "SessionInstance", entityId: sessId, after: JSON.stringify({ present, revenue }), createdAt: closedAt });
          }
        }
      }

      daily[dailyKey(date)] = dayLog;
    }

    // ===== payments + receipts (chronological per student) =====
    const studentTxns = new Map<string, Txn[]>();
    for (const t of txns) { (studentTxns.get(t.studentId) ?? studentTxns.set(t.studentId, []).get(t.studentId)!).push(t); }
    const payTxns: Txn[] = [];
    const priceOf = new Map<string, number>();
    for (const r of regsAll) {
      const g = groups.find((x) => x.id === r.groupId);
      if (g && !priceOf.has(r.studentId)) priceOf.set(r.studentId, r.priceOverride ?? g.sessionPrice);
    }
    const allStudentIds = new Set([...studentTxns.keys()]);
    const addDaysStr = (ds: string, n: number) => new Date(Date.parse(`${ds}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    for (const sid of allStudentIds) {
      const list = studentTxns.get(sid)!;
      if (!list.length) continue;
      const price = priceOf.get(sid) ?? 7500;
      const first = list.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      let payDay = addDaysStr(first.createdAt.toISOString().slice(0, 10), ri(rng, 2, 8));
      const lastDay = list.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt.toISOString().slice(0, 10);
      while (payDay <= lastDay) {
        const at = cairoTs(payDay, `${String(ri(rng, 10, 20)).padStart(2, "0")}:${String(ri(rng, 0, 59)).padStart(2, "0")}`);
        if (at.getTime() > Date.now()) break;
        // pending debt at that moment
        const prior = list.filter((t) => t.createdAt <= at).concat(payTxns.filter((t) => t.studentId === sid && t.createdAt <= at));
        const bal = prior.reduce((a, t) => a + t.amount, 0);
        const debt = Math.max(-bal, 0);
        const r = rng();
        let amount: number;
        if (debt > 0) amount = r < 0.6 ? debt : r < 0.85 ? Math.max(Math.round((debt * 0.6) / 1000) * 1000, 5000) : debt + price;
        else amount = r < 0.9 ? price * 4 : price * 4 + price;
        const method = (() => { const x = rng(); return x < 0.7 ? "CASH" : x < 0.9 ? "VODAFONE" : "INSTAPAY"; })();
        const txn: Txn = { id: cuid(), centerId, studentId: sid, sessionId: null, type: "PAYMENT", amount, method, reason: null, createdBy: chance(rng, 0.8) ? mgrId : recId, createdAt: at };
        payTxns.push(txn);
        payDay = addDaysStr(payDay, ri(rng, 12, 18));
      }
    }

    // receipts: seq per center chronological
    const centerPayments = payTxns.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let seq = 0;
    // running balance per student across ALL txns ordered by time
    const merged = [...txns, ...payTxns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const running = new Map<string, number>();
    const balanceAt = new Map<string, number>(); // txnId -> after
    for (const t of merged) {
      const b = (running.get(t.studentId) ?? 0) + t.amount;
      running.set(t.studentId, b);
      balanceAt.set(t.id, b);
    }
    const balanceBefore = new Map<string, number>();
    {
      const run2 = new Map<string, number>();
      for (const t of merged) {
        balanceBefore.set(t.id, run2.get(t.studentId) ?? 0);
        run2.set(t.studentId, (run2.get(t.studentId) ?? 0) + t.amount);
      }
    }
    for (const t of centerPayments) {
      seq++;
      receipts.push({
        id: cuid(), centerId, seq, number: `RC-${String(seq).padStart(6, "0")}`, txnId: t.id,
        studentId: t.studentId, amount: t.amount, method: t.method,
        balanceBefore: balanceBefore.get(t.id)!, balanceAfter: balanceAt.get(t.id)!,
        sessionId: null, issuedBy: t.createdBy, issuedByName: "QAE1 موظف", date: t.createdAt.toISOString().slice(0, 10), createdAt: t.createdAt,
      });
      const st = newStudents.find((s) => s.id === t.studentId);
      const name = st?.name ?? (regsAll.find((r: any) => r.studentId === t.studentId)?.student?.name ?? "طالب");
      notificationAttempts.push({
        id: cuid(), centerId, studentId: t.studentId, txnId: t.id, template: "تأكيد دفعة", channel: "WA_HANDOFF",
        recipient: synthPhone(rng), status: (() => { const x = rng(); return x < 0.88 ? "SENT" : x < 0.98 ? "OPENED" : "FAILED"; })(),
        bodySnapshot: `تم استلام دفعة ${t.amount / 100} جنيه من ${name}. الرصيد الحالي ${(balanceAt.get(t.id)! / 100).toFixed(1)} جنيه.`,
        createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.createdAt,
        error: undefined,
      });
      auditRows.push({ id: cuid(), centerId, userId: t.createdBy, userName: "QAE1 موظف", action: "PAYMENT_RECORDED", entity: "StudentTransaction", entityId: t.id, after: JSON.stringify({ amount: t.amount, receipt: `RC-${String(seq).padStart(6, "0")}` }), createdAt: t.createdAt });
    }
    // fix FAILED attempts error field
    for (const na of notificationAttempts) if (na.status === "FAILED") na.error = "المستلم لم تُفتح الرسالة";

    // daily payments log
    for (const t of payTxns) {
      const ds = t.createdAt.toISOString().slice(0, 10);
      const dl = daily[ds] ?? (daily[ds] = { sessions: 0, closed: 0, cancelled: 0, attendance: 0, charges: 0, payments: 0, paymentsSum: 0 });
      dl.payments++; dl.paymentsSum += t.amount;
    }

    // ===== expenses (5/center) =====
    const expSpecs: [string, number, string][] = [["RENT", -25, "إيجار السنتر"], ["ELECTRICITY", -20, "فاتورة كهرباء"], ["INTERNET", -15, "إنترنت"], ["SUPPLIES", -10, "قرطاسية ومطبوعات"], ["SALARIES", -5, "مكافأة عاملين"]];
    for (const [category, off, note] of expSpecs) {
      const date = dayStr(off);
      const amount = ri(rng, 60, 300) * 100;
      expenses.push({ id: cuid(), centerId, category, amount, date, note, createdBy: mgrId, createdAt: cairoTs(date, "12:00") });
      centerTxns.push({ id: cuid(), centerId, type: "EXPENSE", amount: -amount, date, note, refType: "EXPENSE", refId: null, createdBy: mgrId, createdAt: cairoTs(date, "12:00") });
    }

    // ===== teacher payouts (PAID) at D-12 and D-2 =====
    const teacherIds = [...new Set(groups.map((g) => g.teacherId).filter(Boolean))] as string[];
    for (const off of [12, 2]) {
      const date = dayStr(-off);
      for (const tid of teacherIds) {
        if (!chance(rng, 0.8)) continue;
        const earnedToDate = settlements.filter((s) => s.teacherId === tid && s.type === "EARNED" && s.date <= date).reduce((a, s) => a + s.amount, 0);
        const paidToDate = settlements.filter((s) => s.teacherId === tid && s.type === "PAID").reduce((a, s) => a + Math.abs(s.amount), 0);
        const payable = earnedToDate - paidToDate;
        if (payable <= 10000) continue;
        const amount = Math.round((payable * (0.7 + rng() * 0.3)) / 5000) * 5000;
        settlements.push({ id: cuid(), centerId, teacherId: tid, sessionId: null, type: "PAID", amount: -amount, date, note: "صرف مستحقات", createdBy: mgrId, createdAt: cairoTs(date, "13:00") });
        centerTxns.push({ id: cuid(), centerId, type: "TEACHER_PAYOUT", amount: -amount, date, note: "صرف مستحقات مدرس", refType: "TEACHER", refId: tid, createdBy: mgrId, createdAt: cairoTs(date, "13:00") });
      }
    }

    // ===== cash days =====
    for (let d = DAYS; d >= 1; d--) {
      const date = dayStr(-d);
      const dl = daily[date];
      if (!dl || (dl.sessions === 0 && dl.payments === 0)) continue;
      const cashIn = payTxns.filter((t) => t.createdAt.toISOString().slice(0, 10) === date && t.method === "CASH").reduce((a, t) => a + t.amount, 0);
      const expOut = expenses.filter((e) => e.date === date).reduce((a, e) => a + e.amount, 0);
      const payoutOut = settlements.filter((s) => s.type === "PAID" && s.date === date).reduce((a, s) => a + Math.abs(s.amount), 0);
      const expected = 20000 + cashIn - expOut - payoutOut;
      const closed = chance(rng, 0.75);
      cashDays.push({
        id: cuid(), centerId, date, openingCash: 20000,
        countedCash: closed ? expected + ri(rng, -300, 300) : null,
        status: closed ? "CLOSED" : "OPEN",
        openedBy: recId, closedBy: closed ? mgrId : null, closedAt: closed ? cairoTs(date, "22:00") : null,
        createdAt: cairoTs(date, "13:30"),
      });
    }

    // ===== announcements + student notifications =====
    const nAnn = ri(rng, 2, 4);
    for (let i = 0; i < nAnn; i++) {
      const date = dayStr(-ri(rng, 2, 28));
      const g = pick(rng, groups);
      const audienceAll = chance(rng, 0.4);
      const targets = audienceAll ? regsAll.filter((r: any) => r.student.status === "ACTIVE") : (byGroup[g.id] ?? []).filter((r: any) => r.student.status === "ACTIVE");
      const title = pick(rng, ANNOUNCE_TITLES);
      const annId = cuid();
      announcements.push({ id: annId, centerId, title, body: `${title} — رسالة تجريبية QAE1 للطلاب.`, audienceType: audienceAll ? "ALL" : "GROUP", audienceId: audienceAll ? null : g.id, audienceName: audienceAll ? "كل الطلاب" : `مجموعة ${g.name}`, recipients: targets.length, createdBy: mgrId, createdByName: "QAE1 مدير", createdAt: cairoTs(date, "10:00") });
      for (const t of targets) {
        studentNotifs.push({ id: cuid(), centerId, studentId: (t as any).studentId, type: "ANNOUNCEMENT", title, body: `${title} — رسالة تجريبية QAE1 للطلاب.`, announcementId: annId, readAt: chance(rng, 0.55) ? new Date(cairoTs(date, "10:00").getTime() + ri(rng, 1, 48) * 3600000) : null, createdAt: cairoTs(date, "10:00") });
      }
    }

    // ===== low-balance queue batches (D-10, D-2) =====
    for (const off of [10, 2]) {
      const date = dayStr(-off);
      const batchId = cuid();
      const debtors = [...running.entries()].filter(([sid, bal]) => bal <= -5000 && (newById.has(sid) || regsAll.some((r: any) => r.studentId === sid)));
      queueItems.push({ id: cuid(), centerId, batchId, batchLabel: `تنبيه رصيد ${date}`, studentId: null, recipientPhone: "-", recipientName: "دفعة تنبيه رصيد", channel: "WA_HANDOFF", templateKey: "campaign", messageText: `دفعة تنبيه رصيد ${date}`, dedupeKey: `qae1-batch-${centerId}-${date}`, status: "SENT", attempts: 1, maxAttempts: 3, handoffCount: 0, createdBy: mgrId, createdAt: cairoTs(date, "12:30"), sentAt: cairoTs(date, "12:30"), updatedAt: cairoTs(date, "12:30") });
      for (const [sid, bal] of debtors) {
        const status = (() => { const x = rng(); return x < 0.7 ? "SENT" : x < 0.85 ? "QUEUED" : "SKIPPED"; })();
        queueItems.push({ id: cuid(), centerId, batchId, batchLabel: `تنبيه رصيد ${date}`, studentId: sid, recipientPhone: synthPhone(rng), recipientName: "ولي أمر", channel: "WA_HANDOFF", templateKey: "low_balance", messageText: `الرصيد المستحق ${(Math.abs(bal) / 100).toFixed(0)} جنيه`, dedupeKey: `qae1-lowbal-${centerId}-${off}-${sid}`, status, attempts: status === "SENT" ? 1 : 0, maxAttempts: 3, handoffCount: status === "SENT" ? 1 : 0, createdBy: mgrId, createdAt: cairoTs(date, "12:30"), sentAt: status === "SENT" ? cairoTs(date, "12:31") : null, updatedAt: cairoTs(date, "12:30") });
      }
    }

    // ===== quizzes: declining scores for first group (Zaki quiz_decline) =====
    {
      const g = groups[0];
      const targets = ((byGroup[g.id] ?? []) as any[]).filter((r) => r.student.status === "ACTIVE").slice(0, 20);
      for (const [qi, off] of [[0, 21], [1, 14], [2, 7]] as const) {
        const date = dayStr(-off);
        const qId = cuid();
        quizzes.push({ id: qId, centerId, groupId: g.id, title: `كويز ${g.subject.name} — رقم ${qi + 1}`, status: "CLOSED", durationMin: 10, opensAt: cairoTs(date, "16:00"), closesAt: new Date(cairoTs(date, "16:00").getTime() + 86400000), createdById: mgrId, createdByName: "QAE1 مدير", createdAt: cairoTs(date, "15:00"), updatedAt: cairoTs(date, "18:00") });
        for (let q = 0; q < 5; q++) {
          quizQs.push({ id: cuid(), quizId: qId, order: q, text: `سؤال ${q + 1} في ${g.subject.name} (QAE1)`, type: "MCQ", options: JSON.stringify(["أ", "ب", "ج", "د"]), correctAnswer: String(q % 4), points: 1 });
        }
        const avg = [75, 63, 50][qi];
        for (const t of targets) {
          const score = Math.max(0, Math.min(5, Math.round((avg / 100) * 5 + (rng() * 3 - 1.5))));
          const subAt = new Date(cairoTs(date, "16:00").getTime() + ri(rng, 5, 55) * 60000);
          quizAttempts.push({ id: cuid(), quizId: qId, studentId: t.studentId, answers: "[]", score, maxScore: 5, status: "GRADED", submittedAt: subAt, gradedAt: subAt, gradedById: mgrId, createdAt: subAt, updatedAt: subAt });
        }
      }
    }

    // ===== exams (1-2 per center) =====
    {
      const nEx = ri(rng, 1, 2);
      for (let i = 0; i < nEx; i++) {
        const g = pick(rng, groups);
        const created = dayStr(-18 - i * 5);
        const eId = cuid();
        const startAt = cairoTs(created, "17:00");
        const endAt = new Date(startAt.getTime() + 48 * 3600000);
        exams.push({ id: eId, centerId, groupId: g.id, sessionId: null, title: `امتحان ${g.subject.name} — ${created}`, instructions: "امتحان تجريبي QAE1", status: "CLOSED", startAt, endAt, durationMin: 30, maxScore: 10, attemptsAllowed: 1, shuffleQuestions: false, shuffleOptions: false, allowAnswerEdit: true, securityMode: "WARNING", createdById: mgrId, createdByName: "QAE1 مدير", createdAt: cairoTs(created, "12:00"), updatedAt: endAt });
        for (let q = 0; q < 10; q++) {
          examQs.push({ id: cuid(), examId: eId, order: q, text: `سؤال امتحان ${q + 1} في ${g.subject.name} (QAE1)`, type: "MCQ", options: JSON.stringify(["أ", "ب", "ج", "د"]), correctAnswer: String((q * 3) % 4), points: 1 });
        }
        const targets = (((byGroup[g.id] ?? []) as any[])).filter((r) => r.student.status === "ACTIVE");
        for (const t of targets) {
          if (!chance(rng, 0.6)) continue;
          const startedAt = new Date(startAt.getTime() + ri(rng, 0, 40) * 3600000);
          const score = ri(rng, 2, 10);
          const attId = cuid();
          examAttempts.push({ id: attId, examId: eId, studentId: t.studentId, centerId, attemptNo: 1, status: "SUBMITTED", startedAt, expiresAt: new Date(startedAt.getTime() + 30 * 60000), submittedAt: new Date(startedAt.getTime() + ri(rng, 12, 30) * 60000), score, questionOrder: "[]", userAgent: "QAE1-bot", createdAt: startedAt, updatedAt: startedAt });
          for (let q = 0; q < 10; q++) {
            examAnswers.push({ id: cuid(), attemptId: attId, questionId: "x", answer: String(ri(rng, 0, 3)), savedAt: startedAt });
          }
        }
      }
    }
    // fix examAnswers questionId after examQs generated (distinct question per answer)
    {
      const qByExam = new Map<string, any[]>();
      for (const q of examQs) (qByExam.get(q.examId) ?? qByExam.set(q.examId, []).get(q.examId)!).push(q);
      const perAttempt = new Map<string, number>();
      for (const a of examAnswers) {
        const att = examAttempts.find((x) => x.id === a.attemptId);
        const qs = att ? qByExam.get(att.examId) : null;
        if (qs && qs.length) {
          const idx = perAttempt.get(att.id) ?? 0;
          a.questionId = qs[idx % qs.length].id;
          perAttempt.set(att.id, idx + 1);
        }
      }
    }

    // ===== books (c01 only) =====
    if (cm.slug === "qae-c01") {
      const b1 = { id: cuid(), centerId, name: "كتاب الفيزياء — الأول الثانوي (QAE1)", gradeId: groups[0].gradeId, subjectId: null as string | null, price: 8500, costPrice: 6000, stock: 40, reorderThreshold: 5, isActive: true, createdAt: cairoTs(dayStr(-30), "12:00") };
      const b2 = { id: cuid(), centerId, name: "كتاب الرياضيات — الثاني الثانوي (QAE1)", gradeId: null as string | null, subjectId: null as string | null, price: 7000, costPrice: 5000, stock: 25, reorderThreshold: 5, isActive: true, createdAt: cairoTs(dayStr(-30), "12:00") };
      books.push(b1, b2);
      for (let i = 0; i < 18; i++) {
        const date = dayStr(-ri(rng, 2, 28));
        const book = pick(rng, [b1, b2]);
        const buyer = pick(rng, regsAll as any[]);
        const qty = ri(rng, 1, 2);
        bookSales.push({ id: cuid(), centerId, bookId: book.id, studentId: buyer?.studentId ?? null, buyerName: buyer?.student?.name ?? "عميل نقدي", qty, unitPrice: book.price, unitCost: book.costPrice, total: qty * book.price, method: "CASH", idemKey: `qae1-sale-${centerId}-${i}`, date, createdBy: recId, createdAt: cairoTs(date, "17:00") });
        book.stock -= qty;
      }
    }

    // ===== insert everything (dependency order) =====
    if (createdNew.length) {
      try {
        await db.student.createMany({ data: newStudents as any });
      } catch (e: any) {
        const codes = newStudents.map((s: any) => s.code);
        const existing = await db.student.findMany({ where: { centerId, code: { in: codes } }, select: { code: true } });
        console.error(`  ❌ student createMany failed for ${cm.slug}: new codes=[${codes.join(",")}] colliding=[${existing.map((x) => x.code).join(",")}]`);
        throw e;
      }
      await db.studentGroup.createMany({ data: createdNew.map((cn) => ({ studentId: cn.id, groupId: cn.groupId, priceOverride: null, registeredBy: mgrId })) });
    }
    if (sessions.length) await db.sessionInstance.createMany({ data: sessions as any });
    if (attRows.length) await db.attendance.createMany({ data: attRows as any });
    if (txns.length) await db.studentTransaction.createMany({ data: txns as any });
    if (payTxns.length) await db.studentTransaction.createMany({ data: payTxns as any });
    if (receipts.length) await db.receipt.createMany({ data: receipts as any });
    if (attendanceEvents.length) await db.attendanceEvent.createMany({ data: attendanceEvents as any });
    if (centerTxns.length) await db.centerTransaction.createMany({ data: centerTxns as any });
    if (settlements.length) await db.teacherSettlement.createMany({ data: settlements as any });
    if (expenses.length) await db.expense.createMany({ data: expenses as any });
    if (cashDays.length) await db.cashDay.createMany({ data: cashDays as any });
    if (announcements.length) await db.announcement.createMany({ data: announcements as any });
    if (studentNotifs.length) await db.studentNotification.createMany({ data: studentNotifs as any });
    if (queueItems.length) await db.messageQueueItem.createMany({ data: queueItems as any });
    if (notificationAttempts.length) await db.notificationAttempt.createMany({ data: notificationAttempts as any });
    if (quizzes.length) await db.quiz.createMany({ data: quizzes as any });
    if (quizQs.length) await db.quizQuestion.createMany({ data: quizQs as any });
    if (quizAttempts.length) await db.quizAttempt.createMany({ data: quizAttempts as any });
    if (exams.length) await db.exam.createMany({ data: exams as any });
    if (examQs.length) await db.examQuestion.createMany({ data: examQs as any });
    if (examAttempts.length) await db.examAttempt.createMany({ data: examAttempts as any });
    if (examAnswers.length) await db.examAnswer.createMany({ data: examAnswers as any });
    if (books.length) await db.book.createMany({ data: books as any });
    if (bookSales.length) await db.bookSale.createMany({ data: bookSales as any });
    if (auditRows.length) await db.auditLog.createMany({ data: auditRows as any });

    // ===== ground truth for this center =====
    const closedSessions = sessions.filter((s) => s.status === "CLOSED");
    const openSessions = sessions.filter((s) => s.status === "OPEN");
    const cancelledSessions = sessions.filter((s) => s.status === "CANCELLED");
    const presentCount = attRows.filter((a) => a.status === "PRESENT").length;
    const lateCount = attRows.filter((a) => a.status === "LATE").length;
    const excusedCount = attRows.filter((a) => a.status === "EXCUSED").length;
    const chargesSum = txns.reduce((a, t) => a + t.amount, 0);
    const paymentsSum = payTxns.reduce((a, t) => a + t.amount, 0);
    const finalBalances = new Map(running);
    const debtors = [...finalBalances.entries()].filter(([sid, bal]) => bal < 0).map(([sid, bal]) => {
      const r = regsAll.find((x: any) => x.studentId === sid) as any;
      const name = newById.get(sid)?.name ?? r?.student?.name ?? "";
      const code = newById.get(sid)?.code ?? r?.student?.code ?? "";
      return { studentId: sid, name, code, balance: bal };
    }).sort((a, b) => a.balance - b.balance);
    // attendance rate per group over the window (registrations from regsAll incl. mid-month)
    const groupStats = groups.map((g) => {
      const gSessions = sessions.filter((s) => s.groupId === g.id && s.status !== "CANCELLED").length;
      const seen = new Set<string>();
      const gRegs = regsAll.filter((r: any) => r.groupId === g.id && r.student.status === "ACTIVE" && !seen.has(r.studentId) && seen.add(r.studentId));
      const gAtt = attRows.filter((a) => sessions.find((s) => s.id === a.sessionId)?.groupId === g.id);
      const expected = gSessions * gRegs.length;
      return { groupId: g.id, name: g.name, subject: g.subject.name, sessions: gSessions, registrations: gRegs.length, attended: gAtt.length, rate: expected ? +(gAtt.length / expected).toFixed(4) : null };
    }).sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1));
    const quizSeries = [0, 1, 2].map((qi) => {
      const q = quizzes[qi];
      const atts = quizAttempts.filter((a) => a.quizId === q.id);
      return { quizId: q.id, title: q.title, attempts: atts.length, avgScore: atts.length ? +(atts.reduce((a, b) => a + (b.score ?? 0), 0) / atts.length).toFixed(2) : 0, maxScore: 5 };
    });
    groundTruth.centers[cm.slug] = {
      centerId, name: `QAE1 سنتر الجودة ${cm.n}`,
      window: groundTruth.window,
      counts: {
        students: cm.studentCount, newStudents: newStudents.length, groups: groups.length, teachers: teacherIds.length,
        sessions: sessions.length, closed: closedSessions.length, open: openSessions.length, cancelled: cancelledSessions.length,
        attendance: attRows.length, present: presentCount, late: lateCount, excused: excusedCount,
        attendanceRate: +((presentCount + lateCount) / Math.max(1, attRows.length)).toFixed(4),
        chargesCount: txns.length, chargesSum, paymentsCount: payTxns.length, paymentsSum,
        receipts: receipts.length, expenses: expenses.length, expensesSum: expenses.reduce((a, e) => a + e.amount, 0),
        settlementsEARNED: settlements.filter((s) => s.type === "EARNED").reduce((a, s) => a + s.amount, 0),
        settlementsPAID: Math.abs(settlements.filter((s) => s.type === "PAID").reduce((a, s) => a + s.amount, 0)),
        announcements: announcements.length, studentNotifications: studentNotifs.length,
        queueItems: queueItems.length, notificationAttempts: notificationAttempts.length,
        corrections: corrections.length, audit: auditRows.length,
        quizzes: quizzes.length, quizAttempts: quizAttempts.length, exams: exams.length, examAttempts: examAttempts.length,
        bookSales: bookSales.length, bookSalesSum: bookSales.reduce((a, s) => a + s.total, 0),
      },
      debtors: { count: debtors.length, top10: debtors.slice(0, 10) },
      lowestAttendanceGroups: groupStats.slice(0, 3),
      highestAttendanceGroups: groupStats.slice(-3).reverse(),
      quizSeries,
      daily: Object.entries(daily).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    };

    log.centers[cm.slug] = {
      ms: Date.now() - cT0,
      sessions: sessions.length, attendance: attRows.length, txns: txns.length + payTxns.length, receipts: receipts.length,
      audit: auditRows.length, events: attendanceEvents.length,
    };
    console.log(`  ✅ ${cm.slug}: ${sessions.length} sessions (${closedSessions.length} closed, ${openSessions.length} open, ${cancelledSessions.length} cancelled), ${attRows.length} attendance, ${payTxns.length} payments, ${Date.now() - cT0}ms`);
  }

  // ===== totals =====
  const t = { sessions: 0, attendance: 0, txns: 0, receipts: 0, audit: 0, events: 0 };
  for (const c of Object.values<any>(log.centers)) {
    t.sessions += c.sessions; t.attendance += c.attendance; t.txns += c.txns; t.receipts += c.receipts; t.audit += c.audit; t.events += c.events;
  }
  log.totals = t;
  log.ms = Date.now() - t0;

  saveResult("sim-log.json", log);
  saveResult("ground-truth.json", groundTruth);
  writeFileSync("/home/z/my-project/qae/sim-state.json", JSON.stringify({ done: true, finishedAt: new Date().toISOString() }));

  // quick DB verification
  const [dbSessions, dbAtt, dbTxns, dbReceipts] = await Promise.all([
    db.sessionInstance.count({ where: { centerId: { startsWith: "" }, id: { not: "" } } }),
    db.attendance.count(),
    db.studentTransaction.count(),
    db.receipt.count(),
  ]);
  console.log(`\n== SIM DONE in ${(log.ms / 1000).toFixed(1)}s == totals: sessions=${t.sessions} attendance=${t.attendance} txns=${t.txns} receipts=${t.receipts}`);
  console.log(`   DB counts: sessions=${dbSessions} attendance=${dbAtt} txns=${dbTxns} receipts=${dbReceipts}`);
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
