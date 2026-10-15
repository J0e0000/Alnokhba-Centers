/** زرع حساب مدير فحص (diagmgr) في قاعدة الـ PG المحلية — يتحذف بعد الـ E2E */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const salt = randomBytes(16).toString("hex");
const hash = `scrypt:${salt}:${scryptSync("nokhba123", salt, 64).toString("hex")}`;
const center = await db.center.findFirst({ select: { id: true, name: true } });
const user = await db.user.upsert({
  where: { username: "diagmgr" },
  update: { passwordHash: hash, role: "MANAGER", centerId: center.id, isActive: true },
  create: { username: "diagmgr", passwordHash: hash, name: "مدير فحص آلي", role: "MANAGER", centerId: center.id, isActive: true },
});
console.log(`حساب الفحص جاهز: ${user.username} @ ${center.name}`);
await db.$disconnect();
