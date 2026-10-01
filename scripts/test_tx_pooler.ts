/** Reproduce: interactive transaction عبر transaction pooler (زي runtime تمامًا) */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";

const url = process.env.SB_TX_URL ?? "";
if (!url) { console.error("SB_TX_URL required"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url } } });

async function main() {
  try {
    const r = await db.$transaction(async (tx) => {
      const a = await tx.attendance.count();
      const b = await tx.sessionQRToken.count();
      return { a, b };
    });
    console.log("INTERACTIVE TX OK:", JSON.stringify(r));
  } catch (e) {
    console.error("INTERACTIVE TX FAILED:", e instanceof Error ? e.message.slice(0, 300) : e);
  }
  // نفس العمليات بدون transaction
  try {
    const a = await db.attendance.count();
    console.log("PLAIN QUERIES OK:", a);
  } catch (e) {
    console.error("PLAIN FAILED:", e instanceof Error ? e.message.slice(0, 300) : e);
  }
  await db.$disconnect();
}
main();
