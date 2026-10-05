// Align demo tenant branding with the official AlNokhba Management brand system.
// النخبة = الهوية الرسمية · الأمل = هوية تركواز · اختبارات القدرات = هوية زرقاء
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const MAP = {
  "مركز النخبة التعليمي": { primaryColor: "#0B1B4F", secondaryColor: "#2563EB", accentColor: "#10B981" },
  "سنتر الأمل": { primaryColor: "#0F766E", secondaryColor: "#134E4A", accentColor: "#2563EB" },
  "اختبار القدرات A": { primaryColor: "#1D4ED8", secondaryColor: "#0B1B4F", accentColor: "#10B981" },
  "اختبار القدرات B": { primaryColor: "#1D4ED8", secondaryColor: "#0B1B4F", accentColor: "#10B981" },
};

(async () => {
  for (const [name, colors] of Object.entries(MAP)) {
    const r = await p.center.updateMany({ where: { name }, data: colors });
    console.log(name, "→", colors, "| updated:", r.count);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
