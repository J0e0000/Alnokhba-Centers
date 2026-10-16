// diag2_login_prod.mjs — run the REAL remaining login steps (session create/audit/getSessionUser query shape)
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const db = new PrismaClient();
const step = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`✓ ${name}`);
    return r;
  } catch (e) {
    console.log(`✗ ${name} FAILED:`);
    console.log("  name:", e?.name, "| code:", e?.code);
    console.log("  message:", String(e?.message ?? "").slice(0, 400));
    if (e?.meta) console.log("  meta:", JSON.stringify(e.meta).slice(0, 200));
    return undefined;
  }
};

try {
  const user = await db.user.findUnique({ where: { username: "qae-mgr-99" } });
  if (!user) throw new Error("user missing");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  await step("cleanup expired sessions", () => db.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }));
  await step("authSession.create", () => db.authSession.create({ data: { token, userId: user.id, expiresAt } }));
  await step("auditLog.create", () => db.auditLog.create({
    data: { centerId: user.centerId, userId: user.id, userName: user.name, action: "تسجيل دخول", entity: null, entityId: null, before: null, after: null, reason: null },
  }));

  // getSessionUser query shape (no cookies — run the same DB query directly)
  await step("authSession.findUnique include user.center", () =>
    db.authSession.findUnique({
      where: { token },
      include: { user: { include: { center: { select: { id: true, name: true, slug: true, logo: true, primaryColor: true, secondaryColor: true, accentColor: true, phone: true, whatsapp: true, address: true, slogan: true, signature: true, status: true, waPaymentsEnabled: true, waLowBalanceEnabled: true, waLowBalanceThreshold: true, waConsentNote: true } } } } },
    }));

  // resolveSupportContext — mimic
  await step("supportSession.findFirst", () => db.supportSession.findFirst({ where: { endedAt: null } }).catch((e) => { throw e; }));

  console.log("\nAll steps done — check ✗ above for the failing one");
} finally {
  await db.$disconnect();
}
