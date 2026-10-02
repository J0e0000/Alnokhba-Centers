import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, rateLimit } from "@/lib/auth";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";
import { findSessionConflicts } from "@/lib/academia/conflicts";

/* أمان: كل طلب بيتحقق منه على السيرفر — مفيش ثقة بمعرّفات العميل.
   - GET: الطالب مالوش وصول لطابور الطلبات خالص (requests.view للطاقم بس)
   - POST: المدرس مينفعش يبعت طلب على جلسة/مجموعة مش بتوعته
   - PATCH (الموافقة): إعادة التحقق من الملكية + كشف التعارض قبل تطبيق أي أثر */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanStr(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

/** GET /api/academia/requests — teacher: own requests; manager/admin: pending queue */
async function GET_impl(req: NextRequest) {
  const user = await requireAca();
  // أمان: الطلبات بيانات تشغيلية للطاقم — الطالب (self.view بس) مش له وصول
  if (!user.permissions.includes("requests.view")) {
    throw new ApiError("مالكش صلاحية عرض الطلبات.", 403);
  }
  const status = req.nextUrl.searchParams.get("status") || (user.role === "TEACHER" ? undefined : "PENDING");
  const requests = await db.acaRequest.findMany({
    where: user.role === "TEACHER" ? { requestedById: user.id, ...(status ? { status } : {}) } : { ...(status ? { status } : {}) },
    include: {
      requester: { select: { name: true } },
      group: { select: { name: true, teacher: { select: { name: true } } } },
      decider: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id, type: r.type, status: r.status, payload: safeJson(r.payload),
      requester: r.requester.name, group: r.group ? { name: r.group.name, teacher: r.group.teacher.name } : null,
      decidedBy: r.decider?.name ?? null, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
      createdAt: r.createdAt,
    })),
  });
}

/** POST /api/academia/requests — teacher requests schedule change (spec §8, §27) */
async function POST_impl(req: NextRequest) {
  const user = await requireAca();
  rateLimit(`aca-req-post:${user.id}`, 15, 60_000);
  if (!user.permissions.includes("schedules.request")) throw new ApiError("مالكش صلاحية إرسال طلبات.", 403);
  const body = await req.json().catch(() => null);
  const { type, groupId, sessionId, payload } = body ?? {};
  if (!type || !["RESCHEDULE", "CANCEL", "MAKEUP", "SUBSTITUTE", "OTHER"].includes(type)) throw new ApiError("نوع الطلب مش معروف.", 400);
  if (user.role === "TEACHER" && groupId) {
    if (!(user.teacherGroupIds ?? []).includes(groupId)) throw new ApiError("دي مش مجموعتك.", 403);
  }

  // أمان (IDOR): الطالب/المدرس مينفعش يستهدف جلسة لمجموعة مش بتوعته —
  // كان ممكن يبعت CANCEL على أي حصة في السنتر من غير أي تحقق
  let sessionOwnerId: string | null = null;
  let sessionGroupId: string | null = null;
  if (sessionId) {
    const sess = await db.acaSession.findUnique({
      where: { id: String(sessionId) },
      select: { id: true, groupId: true, group: { select: { teacherId: true, name: true } } },
    });
    if (!sess) throw new ApiError("الجلسة المطلوبة مش موجودة.", 404);
    if (user.role === "TEACHER" && sess.group.teacherId !== user.id) {
      throw new ApiError("الجلسة دي مش في مجموعاتك.", 403);
    }
    sessionOwnerId = sess.group.teacherId;
    sessionGroupId = sess.groupId;
  }

  // تنظيف الحمولة: مفاتيح معروفة بس + حدود أحجام + صيغ تواريخ/وقت صحيحة
  const p = (payload ?? {}) as Record<string, unknown>;
  const cleanPayload: Record<string, unknown> = {};
  const date = cleanStr(p.date, 10);
  const startTime = cleanStr(p.startTime, 5);
  const endTime = cleanStr(p.endTime, 5);
  const room = cleanStr(p.room, 60);
  const reason = cleanStr(p.reason ?? p.note, 500);
  if (date !== undefined && !DATE_RE.test(date)) throw new ApiError("صيغة التاريخ مش مظبوطة (YYYY-MM-DD).", 400);
  if (startTime !== undefined && !HHMM_RE.test(startTime)) throw new ApiError("صيغة وقت البداية مش مظبوطة (HH:MM).", 400);
  if (endTime !== undefined && !HHMM_RE.test(endTime)) throw new ApiError("صيغة وقت النهاية مش مظبوطة (HH:MM).", 400);
  if (date !== undefined) cleanPayload.date = date;
  if (startTime !== undefined) cleanPayload.startTime = startTime;
  if (endTime !== undefined) cleanPayload.endTime = endTime;
  if (room !== undefined) cleanPayload.room = room;
  if (reason !== undefined) cleanPayload.reason = reason;

  const r = await db.acaRequest.create({
    data: {
      type, payload: JSON.stringify(cleanPayload),
      groupId: groupId || sessionGroupId || null, sessionId: sessionId || null,
      requestedById: user.id,
    },
  });
  const managers = await db.user.findMany({ where: { scope: "academia", role: { in: ["ADMIN", "MANAGER"] }, isActive: true }, select: { id: true } });
  if (managers.length) {
    await db.acaNotification.createMany({
      data: managers.map((m) => ({ userId: m.id, type: "REQUEST", title: "طلب جديد من مدرس", body: `${user.name} بعت طلب (${type}).`, data: JSON.stringify({ requestId: r.id }) })),
    });
  }
  return NextResponse.json({ request: { id: r.id } }, { status: 201 });
}

/** PATCH /api/academia/requests — decide (requests.approve) + apply effect */
async function PATCH_impl(req: NextRequest) {
  const user = await requireAcaPerm("requests.approve");
  rateLimit(`aca-req-patch:${user.id}`, 40, 60_000);
  const body = await req.json().catch(() => null);
  const { requestId, approve, note } = body ?? {};
  if (!requestId || typeof approve !== "boolean") throw new ApiError("بيانات ناقصة.", 400);
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) throw new ApiError("ملاحظة القرار طويلة أوي (500 حرف كحد أقصى).", 400);
  const r = await db.acaRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new ApiError("الطلب ده مش موجود.", 404);
  if (r.status !== "PENDING") throw new ApiError("الطلب ده اتقرر عليه خلاص.", 400);
  const payload = safeJson(r.payload);

  if (approve) {
    // أمان: إعادة التحقق قبل أي أثر — الطلب ممكن يكون اتبنع على بيانات اتغيرت
    if (r.type === "CANCEL" && r.sessionId) {
      const sess = await db.acaSession.findUnique({ where: { id: r.sessionId }, select: { id: true, status: true } });
      if (!sess) throw new ApiError("الجلسة المطلوب إلغاؤها مش موجودة — الطلب هيترفض.", 404);
      if (sess.status === "CANCELLED") throw new ApiError("الجلسة ملغاة خلاص.", 400);
      await db.acaSession.update({ where: { id: r.sessionId }, data: { status: "CANCELLED" } });
    }
    if (r.type === "RESCHEDULE" && r.sessionId && typeof payload.date === "string") {
      const sess = await db.acaSession.findUnique({
        where: { id: r.sessionId },
        select: { id: true, groupId: true, room: true, startTime: true, endTime: true },
      });
      if (!sess) throw new ApiError("الجلسة المطلوب تأجيلها مش موجودة — الطلب هيترفض.", 404);
      const newDate = DATE_RE.test(payload.date) ? payload.date : null;
      if (!newDate) throw new ApiError("تاريخ الجلسة الجديد مش مظبوط — الطلب هيترفض.", 400);
      const newStart = typeof payload.startTime === "string" && HHMM_RE.test(payload.startTime) ? payload.startTime : sess.startTime;
      const newEnd = typeof payload.endTime === "string" && HHMM_RE.test(payload.endTime) ? payload.endTime : sess.endTime;
      // كشف التعارض قبل التنفيذ (نفس معايير إنشاء الجلسات)
      const conflicts = await findSessionConflicts({
        groupId: sess.groupId, date: newDate, startTime: newStart, endTime: newEnd,
        room: typeof payload.room === "string" ? payload.room.slice(0, 60) : sess.room,
        excludeSessionId: sess.id,
      });
      if (conflicts.length > 0) {
        throw new ApiError(`مينفعش ننفذ التأجيل — ${conflicts[0].message} ارفض الطلب واطلب وقت تاني.`, 409);
      }
      await db.acaSession.update({
        where: { id: r.sessionId },
        data: { date: newDate, startTime: newStart, endTime: newEnd },
      });
    }
    if (r.type === "MAKEUP" && r.groupId && typeof payload.date === "string") {
      if (!DATE_RE.test(payload.date)) throw new ApiError("تاريخ حصة التعويض مش مظبوطة — الطلب هيترفض.", 400);
      const start = typeof payload.startTime === "string" && HHMM_RE.test(payload.startTime) ? payload.startTime : null;
      const end = typeof payload.endTime === "string" && HHMM_RE.test(payload.endTime) ? payload.endTime : null;
      if (!start || !end) throw new ApiError("وقت حصة التعويض مش مظبوط — الطلب هيترفض.", 400);
      const g = await db.acaGroup.findUnique({ where: { id: r.groupId }, select: { teacherId: true, room: true } });
      if (g) {
        const room = typeof payload.room === "string" ? payload.room.slice(0, 60) : g.room ?? null;
        const conflicts = await findSessionConflicts({ groupId: r.groupId, date: payload.date, startTime: start, endTime: end, room });
        if (conflicts.length > 0) {
          throw new ApiError(`مينفعش ننفذ التعويض — ${conflicts[0].message} ارفض الطلب واطلب وقت تاني.`, 409);
        }
        await db.acaSession.create({
          data: {
            groupId: r.groupId, date: payload.date, startTime: start, endTime: end,
            room, teacherId: g.teacherId, isMakeup: true, status: "SCHEDULED",
            workspace: JSON.stringify({ stages: { attendance: "pending", interaction: "pending", homework: "pending", exams: "pending", review: "pending" } }),
          },
        });
      }
    }
  }

  await db.acaRequest.update({
    where: { id: requestId },
    data: { status: approve ? "APPROVED" : "REJECTED", decidedById: user.id, decidedAt: new Date(), decisionNote: note || null },
  });
  await logAudit({
    user, action: approve ? "موافقة على طلب" : "رفض طلب",
    entity: "ACA_REQUEST", entityId: requestId, reason: note || undefined,
    after: { type: r.type, status: approve ? "APPROVED" : "REJECTED" },
  });
  // notify requester (contextual communication)
  await db.acaNotification.create({
    data: {
      userId: r.requestedById, type: "REQUEST",
      title: approve ? "تمت الموافقة على طلبك" : "تم رفض طلبك",
      body: `طلب (${r.type}) ${approve ? "اتبقّى واتطبق" : "اترفض"}${note ? ` — ${note}` : ""}.`,
      data: JSON.stringify({ requestId }),
    },
  });
  return NextResponse.json({ ok: true });
}

function safeJson(raw: string | null): Record<string, unknown> {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
export const PATCH = acaHandler(PATCH_impl);
