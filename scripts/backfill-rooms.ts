/**
 * One-off backfill: create Room (قاعة) records for every distinct
 * ScheduleSlot.room / Group.room value already in the DB, per center.
 * Idempotent — safe to run multiple times.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const centers = await db.center.findMany();
  for (const c of centers) {
    const names = new Set<string>();
    const slots = await db.scheduleSlot.findMany({ where: { centerId: c.id }, select: { room: true } });
    const groups = await db.group.findMany({ where: { centerId: c.id }, select: { room: true } });
    for (const s of slots) if (s.room?.trim()) names.add(s.room.trim());
    for (const g of groups) if (g.room?.trim()) names.add(g.room.trim());

    let order = 0;
    for (const name of names) {
      await db.room.upsert({
        where: { centerId_name: { centerId: c.id, name } },
        update: {},
        create: { centerId: c.id, name, order: order++ },
      });
    }
    console.log(`center ${c.slug}: ${names.size} rooms ensured (${[...names].join(", ")})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
