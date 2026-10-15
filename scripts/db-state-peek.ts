import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const centers = await db.center.findMany({ select: { id: true, name: true, status: true }, take: 10 });
  console.log("centers:", centers);
  const users = await db.user.findMany({
    select: { id: true, username: true, role: true, centerId: true, status: true },
    take: 20,
  });
  console.log("users:", users);
  const students = await db.student.count();
  console.log("students total:", students);
  const grades = await db.grade.findMany({ select: { id: true, name: true, centerId: true }, take: 20 });
  console.log("grades:", grades);
}
main().finally(() => db.$disconnect());
