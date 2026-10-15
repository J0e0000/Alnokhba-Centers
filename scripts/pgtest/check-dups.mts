import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const qr = await db.student.count({ where: { qrToken: "x".repeat(48) } });
const fahs = await db.center.count({ where: { slug: { startsWith: "fahs-" } } });
const code = await db.student.count({ where: { code: "10001" } });
console.log(JSON.stringify({ qr, fahs, code }));
await db.$disconnect();
