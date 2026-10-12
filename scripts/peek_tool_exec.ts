import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const rows = await p.agentToolExecution.findMany({
  orderBy: { createdAt: "desc" },
  take: 50,
  select: { toolName: true, status: true, error: true, input: true, createdAt: true },
});
  for (const r of rows) {
    console.log(
    r.createdAt.toISOString().slice(11, 19),
    r.status.padEnd(8),
    r.toolName.padEnd(26),
    (r.error ?? "").slice(0, 90),
    JSON.stringify(r.input).slice(0, 70),
  );
}
process.exit(0);
}
main().then(() => process.exit(0));
