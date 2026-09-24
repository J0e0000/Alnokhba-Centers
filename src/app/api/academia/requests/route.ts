import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/requests — teacher: own requests; manager/admin: pending queue */
async function GET_impl(req: NextRequest) {
  const user = await requireAca();
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
  if (!user.permissions.includes("schedules.request")) throw new ApiError("مالكش صلاحية إرسال طلبات.", 403);
  const body = await req.json().catch(() => null);
  const { type, groupId, sessionId, payload } = body ?? {};
  if (!type || !["RESCHEDULE", "CANCEL", "MAKEUP", "SUBSTITUTE", "OTHER"].includes(type)) throw new ApiError("نوع الطلب مش معروف.", 400);
  if (user.role === "TEACHER" && groupId) {
    if (!(user.teacherGroupIds ?? []).includes(groupId)) throw new ApiError("دي مش مجموعتك.", 403);
  }
  const r = await db.acaRequest.create({
    data: {
      type, payload: JSON.stringify(payload ?? {}), groupId: groupId || null, sessionId: sessionId || null,
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
  const body = await req.json().catch(() => null);
  const { requestId, approve, note } = body ?? {};
  if (!requestId || typeof approve !== "boolean") throw new ApiError("بيانات ناقصة.", 400);
  const r = await db.acaRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new ApiError("الطلب ده مش موجود.", 404);
  if (r.status !== "PENDING") throw new ApiError("الطلب ده اتقرر عليه خلاص.", 400);
  const payload = safeJson(r.payload);

  if (approve) {
    // apply the operational effect
    if (r.type === "CANCEL" && r.sessionId) {
      await db.acaSession.update({ where: { id: r.sessionId }, data: { status: "CANCELLED" } });
    }
    if (r.type === "RESCHEDULE" && r.sessionId && typeof payload.date === "string") {
      await db.acaSession.update({
        where: { id: r.sessionId },
        data: { date: payload.date, startTime: typeof payload.startTime === "string" ? payload.startTime : undefined, endTime: typeof payload.endTime === "string" ? payload.endTime : undefined },
      });
    }
    if (r.type === "MAKEUP" && r.groupId && typeof payload.date === "string") {
      const g = await db.acaGroup.findUnique({ where: { id: r.groupId }, select: { teacherId: true, room: true } });
      if (g) {
        await db.acaSession.create({
          data: {
            groupId: r.groupId, date: payload.date, startTime: typeof payload.startTime === "string" ? payload.startTime : "00:00", endTime: typeof payload.endTime === "string" ? payload.endTime : "00:00",
            room: typeof payload.room === "string" ? payload.room : g.room ?? null, teacherId: g.teacherId, isMakeup: true, status: "SCHEDULED",
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
