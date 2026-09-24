import { NextResponse } from "next/server";
import { getAcaUser, requireAca } from "@/lib/academia/guard";
import { todayStr } from "@/lib/academia/dates";
import { db } from "@/lib/db";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/bootstrap — session context for the Academia app */
async function GET_impl() {
  const user = await getAcaUser();
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  await requireAca();
  const [term, unread] = await Promise.all([
    db.academicTerm.findFirst({ where: { isActive: true }, select: { id: true, name: true, startDate: true, endDate: true, type: true } }),
    db.acaNotification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return NextResponse.json({ user, term, today: todayStr(), unread });
}

export const GET = acaHandler(GET_impl);
