/** e2e_trusted_devices_local.ts — verify trusted-device binding logic locally (sqlite dev DB).
 * Uses a THROWAWAY test student in the dev DB only — never production. */
import { registerHooks } from "node:module";

// stub "server-only" (RSC guard) قبل تحميل الليب
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "server-only") return { url: "file://" + process.cwd() + "/scripts/stub-server-only.js", shortCircuit: true };
    return next(spec, ctx);
  },
});

let PrismaClient: any, tdmod: any;
let db: any;
async function loadDeps() {
  PrismaClient = (await import("@prisma/client")).PrismaClient;
  tdmod = await import("../src/lib/trusted-devices");
  db = new PrismaClient();
}

const CENTER = "cmufick570003iqo9fnqvrh2c"; // مركز النخبة (local dev copy)
let pass = 0, fail = 0;
function ck(cond: boolean, label: string) {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.log("  ✗", label); }
}

async function main() {
  await loadDeps();
  const { evaluateTrustedDevice, bindTrustedDevice, revokeTrustedDevice, listTrustedDevices, deviceVerifier } = tdmod;
  // throwaway student
  const st = await db.student.create({
    data: {
      centerId: CENTER, code: `TT${Date.now() % 100000}`,
      qrToken: "test".repeat(8), name: "طالب اختبار أجهزة موثوقة", status: "ACTIVE",
      notes: "TEST-ONLY — safe to delete",
    },
  });
  try {
    const devA = "aaaaaaaa-1111-4222-8333-444444444444";
    const devB = "bbbbbbbb-1111-4222-8333-444444444444";

    // 1) no binding → BIND
    let v = await evaluateTrustedDevice(CENTER, st.id, devA);
    ck(v.action === "BIND", "first attempt → BIND");

    // 2) bind after success → ALLOW on same device
    await bindTrustedDevice(CENTER, st.id, devA);
    v = await evaluateTrustedDevice(CENTER, st.id, devA);
    ck(v.action === "ALLOW", "same device after bind → ALLOW");

    // 3) student from device B → REJECT (student bound elsewhere)
    v = await evaluateTrustedDevice(CENTER, st.id, devB);
    ck(v.action === "REJECT" && v.reason === "STUDENT_BOUND_TO_OTHER_DEVICE", "new device for bound student → REJECT");

    // 4) device hash verifier is salted per center
    ck(deviceVerifier(CENTER, devA) !== deviceVerifier("other-center", devA), "verifier salted by centerId");

    // 5) device bound to student A cannot evaluate as BIND for student B (fresh student)
    const st2 = await db.student.create({
      data: {
        centerId: CENTER, code: `TU${Date.now() % 100000}`,
        qrToken: "test2".repeat(8), name: "طالب اختبار تاني", status: "ACTIVE",
        notes: "TEST-ONLY — safe to delete",
      },
    });
    v = await evaluateTrustedDevice(CENTER, st2.id, devA);
    ck(v.action === "REJECT" && v.reason === "DEVICE_BOUND_TO_OTHER_STUDENT", "bound device for another student → REJECT");

    // 6) revoke (admin recovery) → device B can BIND again
    const ok = await revokeTrustedDevice({ centerId: CENTER, studentId: st.id, byUserId: "test", byUserName: "اختبار", reason: "الطالب غير موبايله" });
    ck(ok === true, "revoke works");
    v = await evaluateTrustedDevice(CENTER, st.id, devB);
    ck(v.action === "BIND", "after revoke, new device → BIND");

    // 7) list shows revoked row w/o secrets
    const list = await listTrustedDevices(CENTER);
    const row = list.find((r) => r.studentCode === st.code);
    ck(!!row && row.status === "REVOKED" && row.revokedByName === "اختبار", "list shows revoked + revoker");
    ck((row?.deviceTail?.length ?? 0) === 6, "only 6-char tail exposed (no raw deviceId)");

    // 8) cleanup throwaway students + bindings
    await db.trustedDeviceBinding.deleteMany({ where: { studentId: { in: [st.id, st2.id] } } });
    await db.student.deleteMany({ where: { id: { in: [st.id, st2.id] } } });
    ck(true, "cleanup done");
  } catch (e) {
    console.error("TEST ERROR:", e);
    await db.trustedDeviceBinding.deleteMany({ where: { studentId: st.id } });
    await db.student.delete({ where: { id: st.id } }).catch(() => {});
  } finally {
    console.log(`\nRESULT: ${pass} passed / ${fail} failed`);
    process.exitCode = fail ? 2 : 0;
    await db.$disconnect();
  }
}
main();
