import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAca, requireAcaPerm } from "@/lib/academia/guard";
import { logAudit } from "@/lib/audit";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/terms — academic calendar (spec §13) */
async function GET_impl() {
  await requireAca();
  const terms = await db.academicTerm.findMany({ orderBy: { startDate: "desc" } });
  return NextResponse.json({ terms });
}

/** POST /api/academia/terms — create term (subjects.manage) */
async function POST_impl(req: NextRequest) {
  const user = await requireAcaPerm("subjects.manage");
  const body = await req.json().catch(() => null);
  const { name, type, startDate, endDate } = body ?? {};
  if (!name?.trim() || !startDate || !endDate) throw new ApiError("الاسم وتاريخ البداية والنهاية مطلوبين.", 400);
  if (endDate < startDate) throw new ApiError("تاريخ النهاية لازم يكون بعد البداية.", 400);
  const t = await db.academicTerm.create({ data: { name: name.trim(), type: type || "TERM", startDate, endDate } });
  await logAudit({ user, action: "إضافة فترة دراسية", entity: "ACA_TERM", entityId: t.id, after: { name: t.name, startDate, endDate } });
  return NextResponse.json({ term: { id: t.id } }, { status: 201 });
}

/** PATCH /api/academia/terms — activate a term (only one active) */
async function PATCH_impl(req: NextRequest) {
  const user = await requireAcaPerm("subjects.manage");
  const body = await req.json().catch(() => null);
  const { termId } = body ?? {};
  if (!termId) throw new ApiError("بيانات ناقصة.", 400);
  const t = await db.academicTerm.findUnique({ where: { id: termId } });
  if (!t) throw new ApiError("الفترة دي مش موجودة.", 404);
  await db.$transaction([
    db.academicTerm.updateMany({ data: { isActive: false } }),
    db.academicTerm.update({ where: { id: termId }, data: { isActive: true } }),
  ]);
  await logAudit({ user, action: "تنشيط فترة دراسية", entity: "ACA_TERM", entityId: termId, after: { name: t.name } });
  return NextResponse.json({ ok: true });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
export const PATCH = acaHandler(PATCH_impl);
