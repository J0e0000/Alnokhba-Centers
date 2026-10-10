/** prod_subscription_check.ts — READ-ONLY: subscription/licensing status of centers. */
import { PrismaClient as PgClient } from "../generated/prisma-pg/client.js";
import { readFileSync } from "fs";

const envFile = readFileSync("/home/z/my-project/scripts/.env.prod-url", "utf8");
const m = envFile.match(/DATABASE_URL_POOLED="(postgres:\/\/[^"]+)"/);
if (!m) { console.error("no DATABASE_URL_POOLED"); process.exit(1); }
const db = new PgClient({ datasources: { db: { url: m[1] } } });

async function main() {
  const subs = await (db as any).subscription.findMany({ include: { center: { select: { name: true } } } });
  console.log("=== SUBSCRIPTIONS ===", subs.length);
  for (const s of subs) {
    console.log(`${s.center?.name} | plan=${s.plan ?? "?"} | status=${s.status ?? "?"} | trialEnds=${s.trialEndsAt ?? "-"} | expires=${s.expiresAt ?? "-"} | raw=${JSON.stringify(s).slice(0, 400)}`);
  }
  const events = await (db as any).subscriptionEvent.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  console.log("\n=== SUBSCRIPTION EVENTS (last 10) ===");
  for (const e of events) console.log(JSON.stringify(e).slice(0, 300));
}
main().finally(() => db.$disconnect());
