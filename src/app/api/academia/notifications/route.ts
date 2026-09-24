import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca } from "@/lib/academia/guard";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/notifications — my notifications */
async function GET_impl() {
  const user = await requireAca();
  const items = await db.acaNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 40 });
  const unread = items.filter((n) => !n.readAt).length;
  return NextResponse.json({ notifications: items, unread });
}

/** POST /api/academia/notifications — mark all (or one) read */
async function POST_impl(req: NextRequest) {
  const user = await requireAca();
  const body = await req.json().catch(() => ({}));
  if (body.notificationId) {
    await db.acaNotification.updateMany({ where: { id: body.notificationId, userId: user.id }, data: { readAt: new Date() } });
  } else {
    await db.acaNotification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
