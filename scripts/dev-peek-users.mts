import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const centers = await db.center.findMany({ select: { id: true, name: true, slug: true } });
  console.log("centers:", JSON.stringify(centers));
  const users = await db.user.findMany({ select: { id: true, name: true, role: true, phone: true, centerId: true } });
  console.log("users:", JSON.stringify(users));
  process.exit(0);
}
main().catch((e) => { console.error("ERR:", String(e).slice(0, 400)); process.exit(1); });
