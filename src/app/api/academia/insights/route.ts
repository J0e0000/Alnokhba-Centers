import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth";
import { requireAcaPerm } from "@/lib/academia/guard";
import { shouldRun, runInsights } from "@/lib/academia/insights";
import { acaHandler } from "@/lib/academia/handler";

/** GET /api/academia/insights — stored insights ONLY (never computed on read) */
async function GET_impl(req: NextRequest) {
  const user = await requireAcaPerm("insights.view");
  const status = req.nextUrl.searchParams.get("status");
  const insights = await db.acaInsight.findMany({
    where: status ? { status } : { status: { not: "DISMISSED" } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 60,
  });
  const lastRun = await db.acaInsightRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true, stats: true } });
  return NextResponse.json({
    insights: insights.map((i) => ({ id: i.id, dimension: i.dimension, severity: i.severity, title: i.title, body: i.body, data: i.data, status: i.status, createdAt: i.createdAt })),
    lastRun, role: user.role,
  });
}

/** POST /api/academia/insights/run — scheduled analysis window (throttled 6h) */
async function POST_impl() {
  await requireAcaPerm("insights.view");
  const gate = await shouldRun();
  if (!gate.ok) {
    return NextResponse.json({ throttled: true, message: "التحليل شغال بنافذة مجدولة كل 6 ساعات — آخر تحليل كان قريب.", nextEligibleAt: gate.nextEligibleAt, lastRunAt: gate.lastRunAt }, { status: 200 });
  }
  const result = await runInsights();
  return NextResponse.json({ throttled: false, ...result });
}

/** PATCH — mark seen/dismissed */
async function PATCH_impl(req: NextRequest) {
  await requireAcaPerm("insights.view");
  const body = await req.json().catch(() => null);
  const { insightId, status } = body ?? {};
  if (!insightId || !["NEW", "SEEN", "DISMISSED"].includes(status)) throw new ApiError("بيانات ناقصة.", 400);
  await db.acaInsight.update({ where: { id: insightId }, data: { status } });
  return NextResponse.json({ ok: true });
}

export const GET = acaHandler(GET_impl);
export const POST = acaHandler(POST_impl);
export const PATCH = acaHandler(PATCH_impl);
