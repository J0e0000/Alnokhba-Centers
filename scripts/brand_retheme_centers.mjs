/**
 * توحيد هوية السنترات مع اللوجو (brand-alignment data fix)
 * ---------------------------------------------------------
 * القيم القديمة الافتراضية (#0E9F6E أخضر / #0F766E تيل / #F59E0B عنبري) كانت اتولدت
 * قبل اعتماد هوية اللوجو (كحلي #0B1B4F / أزرق #2563EB / تركواز #10B981) —
 * السكريبت ده بيجدد السنترات اللي لسه شايلة التوليفة القديمة بالظبط (يعني مفيش تخصيص حقيقي)
 * للهوية الرسمية. أي سنتر مخصص ألوانه بنفسه بيتسيب زي ما هو.
 *
 * التشغيل: node scripts/brand_retheme_centers.mjs
 */
import { PrismaClient } from "@prisma/client";

const BRAND = { primary: "#0B1B4F", secondary: "#2563EB", accent: "#10B981" };
const LEGACY = { primary: "#0e9f6e", secondary: "#0f766e", accent: "#f59e0b" };
const eq = (a, b) => !!a && a.replace("#", "").toLowerCase() === b.replace("#", "").toLowerCase();

const db = new PrismaClient();
const centers = await db.center.findMany({
  select: { id: true, name: true, slug: true, primaryColor: true, secondaryColor: true, accentColor: true },
});

let touched = 0;
for (const c of centers) {
  const legacyPair = eq(c.primaryColor, LEGACY.primary) && eq(c.secondaryColor, LEGACY.secondary);
  if (!legacyPair) {
    console.log(`⏭  ${c.name} (${c.slug}) — ألوان مخصصة (${c.primaryColor}) — اتسيبت`);
    continue;
  }
  const data = { primaryColor: BRAND.primary, secondaryColor: BRAND.secondary };
  if (eq(c.accentColor, LEGACY.accent)) data.accentColor = BRAND.accent;
  await db.center.update({ where: { id: c.id }, data });
  touched++;
  console.log(`✅ ${c.name} (${c.slug}) → ${BRAND.primary} / ${BRAND.secondary}${data.accentColor ? " / " + BRAND.accent : ""}`);
}

console.log(`\nتم: ${touched}/${centers.length} سنتر اتوحدوا مع هوية اللوجو.`);
await db.$disconnect();
