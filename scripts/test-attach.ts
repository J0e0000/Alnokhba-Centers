/** Test: can we ATTACH a backup .db and read its tables via Prisma raw queries? */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

(async () => {
  // 1) create a test backup directly (same as lib/backup.ts does)
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const file = `nokhba-backup-attest-${stamp}.db`;
  await db.$executeRawUnsafe(`VACUUM INTO 'backups/${file}'`);
  console.log("backup created:", file);

  // 2) ATTACH it
  try {
    await db.$executeRawUnsafe(`ATTACH DATABASE 'backups/${file}' AS bak`);
    console.log("ATTACH: ok");

    // 3) read row counts from the backup
    const tables = ["Student", "User", "SessionInstance", "StudentTransaction", "Attendance"];
    for (const t of tables) {
      const rows = await db.$queryRawUnsafe(`SELECT COUNT(*) as c FROM bak.${t}`);
      console.log(`  bak.${t} =`, rows[0].c, "rows");
    }

    // 4) sample read
    const sample = await db.$queryRawUnsafe(`SELECT code, name FROM bak.Student LIMIT 3`);
    console.log("  sample:", JSON.stringify(sample));

    // 5) DETACH
    await db.$executeRawUnsafe(`DETACH DATABASE bak`);
    console.log("DETACH: ok");

    // 6) verify main DB unaffected
    const mainCount = await db.student.count();
    console.log("main students still:", mainCount);
  } catch (e) {
    console.error("ATTACH FAILED:", e instanceof Error ? e.message : e);
  }
  await db.$disconnect();

  // cleanup test file
  const { unlink } = await import("fs/promises");
  try { await unlink(`backups/${file}`); console.log("test file cleaned"); } catch {}
  process.exit(0);
})().catch((e) => { console.error("CRASH:", e.message); process.exit(1); });
