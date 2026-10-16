// diag_login_prod.mjs — run each login step against prod DB and find the throwing one
import { PrismaClient } from "@prisma/client";
import { scryptSync, timingSafeEqual } from "crypto";

const db = new PrismaClient();
const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`✓ ${name}`);
    return r;
  } catch (e) {
    console.log(`✗ ${name} FAILED:`);
    console.log("  name:", e?.name);
    console.log("  code:", e?.code);
    console.log("  message:", String(e?.message ?? "").slice(0, 500));
    if (e?.meta) console.log("  meta:", JSON.stringify(e.meta).slice(0, 300));
    throw e;
  }
};

try {
  const user = await step("findUnique user + center", () =>
    db.user.findUnique({ where: { username: "qae-mgr-99" }, include: { center: { select: { status: true, name: true } } } }));
  console.log("  user found:", user?.username, "| center:", user?.center?.name);

  await step("verifyPassword", async () => {
    const [scheme, salt, hash] = String(user.passwordHash).split(":");
    const candidate = scryptSync("Qae#2026", salt, 64);
    const expected = Buffer.from(hash, "hex");
    if (!(candidate.length === expected.length && timingSafeEqual(candidate, expected))) throw new Error("password mismatch");
  });

  await step("createSession", async () => {
    const { randomBytes } = await import("crypto");
    // mimic src/lib/auth.ts createSession — check its shape first
  });

  console.log("\ncreateSession implementation from src/lib/auth.ts:");
} catch (e) {
  console.log("\n>>> THREW");
} finally {
  await db.$disconnect();
}
