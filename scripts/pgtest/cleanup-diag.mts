import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const d = await db.user.deleteMany({ where: { username: "diagmgr" } });
console.log(`diagmgr deleted: ${d.count}`);
await db.$disconnect();
