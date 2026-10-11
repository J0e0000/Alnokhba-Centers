import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireManager, ApiError } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { listTrustedDevices, revokeTrustedDevice } from "@/lib/trusted-devices";
import { hasCapability } from "@/lib/center-capabilities";

export const dynamic = "force-dynamic";

/* ============================================================
   الأجهزة الموثوقة — استرجاع إداري (Master Prompt §10 Device recovery)
   GET    /api/attendance/trusted-devices — قائمة الربط للسنتر
   DELETE /api/attendance/trusted-devices — سحب ربط طالب (سبب إلزامي + تدقيق)
   ملاحظات أمنية:
   - مفيش أسرار أجهزة في الردود (آخر 6 حروف hash بس للتعرّف البصري)
   - السحب ميسحب الجهاز القديم بس — الجهاز الجديد يتسجل من أول حضور ناجح بعده
   - كل عملية متدقيقة باسم المدير والسبب
============================================================ */

export const GET = handler(async () => {
  const user = await requireManager();
  const devices = await listTrustedDevices(user.centerId);
  const enabled = await hasCapability(user.centerId, "trusted_devices");
  return ok({ devices, enabled });
});

export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<{ studentId?: string; reason?: string }>(req);
  const studentId = String(body.studentId ?? "");
  const reason = String(body.reason ?? "");
  if (!studentId) throw new ApiError("حدد الطالب.", 400);

  const student = await db.student.findFirst({
    where: { id: studentId, centerId: user.centerId },
    select: { id: true, name: true, code: true },
  });
  if (!student) throw new ApiError("الطالب ده مش موجود في سنترك.", 404);

  const revoked = await revokeTrustedDevice({
    centerId: user.centerId,
    studentId,
    byUserId: user.id,
    byUserName: user.name,
    reason,
  });
  if (!revoked) throw new ApiError("الطالب ده ملهوش جهاز موثوق نشط.", 404);

  await logAudit({
    user,
    action: "TRUSTED_DEVICE_REVOKED",
    entity: "TRUSTED_DEVICE",
    entityId: studentId,
    after: { student: student.name, code: student.code, reason: reason.slice(0, 300) },
    reason: "سحب جهاز موثوق (استرجاع إداري)",
  });

  return ok({
    ok: true,
    message: `اتسحب جهاز ${student.name} — أول حضور ناجح بعد كده هيربط الجهاز الجديد.`,
  });
});
