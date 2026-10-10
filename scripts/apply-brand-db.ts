// Apply AlNokhba official brand (navy #143159 + gold #D5A134 from the logo)
// to centers still carrying the old green default. سنتر الأمل keeps its custom
// tenant colors (isolation demo). Branding metadata only — zero operational data touched.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const OLD_DEFAULT = "#0E9F6E";
const BRAND = { primaryColor: "#143159", secondaryColor: "#1D4477", accentColor: "#D5A134" };

const centers = await db.center.findMany({ select: { id: true, name: true, primaryColor: true, secondaryColor: true, accentColor: true } });
for (const c of centers) {
  if (c.primaryColor === OLD_DEFAULT) {
    await db.center.update({ where: { id: c.id }, data: BRAND });
    console.log(`✓ ${c.name}: green default → AlNokhba navy/gold`);
  } else {
    console.log(`- ${c.name}: custom branding preserved (${c.primaryColor})`);
  }
}
const after = await db.center.findMany({ select: { name: true, primaryColor: true, secondaryColor: true, accentColor: true } });
console.log(JSON.stringify(after, null, 2));
await db.$disconnect();
