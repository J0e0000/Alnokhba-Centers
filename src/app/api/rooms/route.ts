import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/rooms — list halls for this center */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const rooms = await db.room.findMany({
    where: { centerId: user.centerId, isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return ok({ rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, order: r.order })) });
});

type RoomBody = { id?: string; name?: string; capacity?: number | string };

/** POST /api/rooms — add a hall (manager) */
export const POST = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<RoomBody>(req);
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError("اكتب اسم القاعة.");
  if (name.length > 40) throw new ApiError("اسم القاعة طويل أوي — اختصره.");

  const exists = await db.room.findFirst({ where: { centerId: user.centerId, name } });
  if (exists) throw new ApiError("في قاعة بنفس الاسم خلاص.");

  const count = await db.room.count({ where: { centerId: user.centerId } });
  const room = await db.room.create({
    data: { centerId: user.centerId, name, capacity: body.capacity ? Number(body.capacity) : null, order: count },
  });
  await logAudit({ user, action: AUDIT.ROOM_CREATED, entity: "ROOM", entityId: room.id, after: { name } });
  return ok({ room: { id: room.id, name: room.name } }, { status: 201 });
});

/** PATCH /api/rooms — rename a hall (cascades to schedule slots & groups) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<RoomBody>(req);
  const id = String(body.id ?? "");
  const name = String(body.name ?? "").trim();
  if (!name) throw new ApiError("اكتب اسم القاعة الجديد.");

  const room = await db.room.findFirst({ where: { id, centerId: user.centerId } });
  if (!room) throw new ApiError("القاعة دي مش موجودة.", 404);

  const dup = await db.room.findFirst({ where: { centerId: user.centerId, name, NOT: { id: room.id } } });
  if (dup) throw new ApiError("في قاعة تانية بنفس الاسم.");

  // transactional: rename room + update every schedule slot / group / open session using old name
  await db.$transaction([
    db.room.update({ where: { id: room.id }, data: { name, capacity: body.capacity ? Number(body.capacity) : room.capacity } }),
    db.scheduleSlot.updateMany({ where: { centerId: user.centerId, room: room.name }, data: { room: name } }),
    db.group.updateMany({ where: { centerId: user.centerId, room: room.name }, data: { room: name } }),
    db.sessionInstance.updateMany({ where: { centerId: user.centerId, room: room.name, status: "OPEN" }, data: { room: name } }),
  ]);
  await logAudit({ user, action: AUDIT.ROOM_UPDATED, entity: "ROOM", entityId: room.id, before: { name: room.name }, after: { name } });
  return ok({ ok: true });
});

/** DELETE /api/rooms?id= — remove a hall; its slots must be empty first */
export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const room = await db.room.findFirst({ where: { id, centerId: user.centerId } });
  if (!room) throw new ApiError("القاعة دي مش موجودة.", 404);

  const slotCount = await db.scheduleSlot.count({
    where: { centerId: user.centerId, room: room.name, isActive: true },
  });
  if (slotCount > 0) {
    throw new ApiError(`في ${slotCount} حصة لسه مجدولة في القاعة دي — انقلهم لقاعة تانية الأول.`);
  }

  await db.$transaction([
    db.scheduleSlot.updateMany({ where: { centerId: user.centerId, room: room.name }, data: { room: null } }),
    db.group.updateMany({ where: { centerId: user.centerId, room: room.name }, data: { room: null } }),
    db.room.delete({ where: { id: room.id } }),
  ]);
  await logAudit({ user, action: AUDIT.ROOM_DELETED, entity: "ROOM", entityId: room.id, after: { name: room.name } });
  return ok({ ok: true });
});
