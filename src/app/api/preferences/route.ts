import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/preferences — تفضيلات المستخدم الحالي (spec §11)
 * PUT — تحديث (theme / language / prefs JSON) — كل مستخدم بتاعته بس
 */
export const GET = handler(async () => {
  const user = await requireUser();
  const pref = await db.userPreference.findUnique({ where: { userId: user.id } });
  return ok({
    preferences: {
      theme: pref?.theme ?? null,
      language: pref?.language ?? "ar",
      prefs: pref?.prefs ? JSON.parse(pref.prefs) : {},
    },
  });
});

export const PUT = handler(async (req: Request) => {
  const user = await requireUser();
  const body = await readJson<{
    theme?: string; language?: string; prefs?: Record<string, unknown>;
  }>(req);

  const data: { theme?: string | null; language?: string; prefs?: string } = {};
  if (body.theme !== undefined) {
    data.theme = ["light", "dark", "system", null].includes(body.theme as string | null) ? body.theme : null;
  }
  if (body.language !== undefined) {
    data.language = ["ar", "en"].includes(body.language) ? body.language : "ar";
  }
  if (body.prefs !== undefined) {
    data.prefs = JSON.stringify(body.prefs ?? {});
  }

  const pref = await db.userPreference.upsert({
    where: { userId: user.id },
    update: data,
    create: { userId: user.id, theme: data.theme ?? null, language: data.language ?? "ar", prefs: data.prefs ?? "{}" },
  });

  return ok({
    preferences: {
      theme: pref.theme, language: pref.language,
      prefs: pref.prefs ? JSON.parse(pref.prefs) : {},
    },
  });
});
