import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const s = await db.sessionInstance.findFirst({
    where: { group: { subject: { name: "كيمياء" } } },
    orderBy: { createdAt: "desc" },
    include: { group: { include: { subject: true } } },
  });
  console.log(JSON.stringify({ id: s?.id, status: s?.status, subject: s?.group?.subject?.name, date: s?.date }));
  await db.$disconnect();
}
void main();
