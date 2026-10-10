import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const students = await db.student.findMany({ select: { code: true, name: true, status: true }, take: 6, orderBy: { code: "asc" } });
console.log(JSON.stringify(students, null, 1));
await db.$disconnect();
