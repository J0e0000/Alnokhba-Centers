const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.center.findMany({ select: { name: true, primaryColor: true, secondaryColor: true, accentColor: true } })
  .then((rows) => { console.log(JSON.stringify(rows, null, 1)); return p.$disconnect(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
