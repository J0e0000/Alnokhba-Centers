import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAcaPerm } from "@/lib/academia/guard";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/audit — traceable changes (spec §32): grade changes,
 * attendance corrections, permission changes, schedule changes, transfers. */
async function GET_impl(req: NextRequest) {
  await requireAcaPerm("audit.view");
  const entity = req.nextUrl.searchParams.get("entity");
  const rows = await db.auditLog.findMany({
    where: { entity: entity ? { in: entity.split(",").map((e) => e.trim()) } : { in: ["ACA_SESSION", "ACA_EXAM", "ACA_EXAM_RESULT", "ACA_SCHEDULE", "ACA_ENROLLMENT", "ACA_GROUP", "ACA_SUBJECT", "ACA_TEACHER", "ACA_STUDENT", "ACA_TERM", "ACA_REQUEST"] } },
    orderBy: { createdAt: "desc" },
    take: 120,
  });
  return NextResponse.json({
    logs: rows.map((r) => ({
      id: r.id, userName: r.userName, action: r.action, entity: r.entity, entityId: r.entityId,
      before: r.before, after: r.after, reason: r.reason, createdAt: r.createdAt,
    })),
  });
}

export const GET = acaHandler(GET_impl);
