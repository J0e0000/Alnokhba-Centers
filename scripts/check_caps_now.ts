import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const rows = await db.centerCapability.findMany({ include: { center: { select: { name: true } } } });
  for (const r of rows) {
    if (["dynamic_qr","static_qr","name_attendance","session_qr_attendance"].includes(r.key) || !r.enabled)
      console.log(r.center.name, '→', r.key, '=', r.enabled);
  }
  await db.$disconnect();
}
main();
