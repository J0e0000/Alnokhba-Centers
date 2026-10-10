import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const teachers = await p.teacher.findMany({
    select: { id: true, name: true, phone: true, centerId: true, isActive: true },
  });
  console.log(JSON.stringify(teachers, null, 1));
  const groups = await p.group.count();
  console.log("groups:", groups);
  const centers = await p.center.findMany({ select: { id: true, name: true, slug: true } });
  console.log("centers:", JSON.stringify(centers));
  await p.$disconnect();
}
main();
