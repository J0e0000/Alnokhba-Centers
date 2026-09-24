import { db } from "@/lib/db";
import { ok, handler } from "@/lib/api";
import { requireCenterUser } from "@/lib/auth";
import { cleanRaw } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/**
 * GET /api/lookup?q= — resolve a student by QR token / 5-digit code / name / phone.
 * QR tokens are long hex strings; codes are exactly 5 digits; names/phones otherwise.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const raw = (url.searchParams.get("q") ?? "").trim();
  const q = cleanRaw(raw);
  if (!raw) return ok({ students: [] });

  const students = await db.student.findMany({
    where: {
      centerId: user.centerId,
      OR: [
        ...(q.length >= 8 && /^[0-9a-f]+$/i.test(q) ? [{ qrToken: q }] : []),
        ...(q.length === 5 && /^\d+$/.test(q) ? [{ code: q }] : []),
        { name: { contains: raw } },
        ...(q.length >= 3 ? [{ phone: { contains: q } }, { parentPhone: { contains: q } }] : []),
      ],
    },
    take: 30,
    include: {
      grade: { select: { name: true } },
      registrations: { where: { status: "ACTIVE" }, include: { group: { include: { subject: { select: { name: true } } } } } },
    },
  });

  // relevance order: exact code match first, then name starts-with, then name contains, then phone
  const exactCode = q.length === 5 && /^\d+$/.test(q) ? q : null;
  const ranked = students.sort((a, b) => {
    const score = (s: typeof a) =>
      exactCode && s.code === exactCode ? 0 : s.name.startsWith(raw) ? 1 : exactCode ? 2 : 3;
    return score(a) - score(b);
  });

  return ok({
    students: ranked.map((s) => ({
      id: s.id, code: s.code, name: s.name, phone: s.phone,
      grade: s.grade?.name ?? null, status: s.status,
      subjects: s.registrations.map((r) => r.group.subject.name),
    })),
  });
});
