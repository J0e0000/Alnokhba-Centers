import { db } from "@/lib/db";
import { getSessionUser, ApiError, type SessionUser } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";

/* ============================================================
   حارس تصدير البيانات بالجملة — أدمن المنصة (ADMIN) فقط.
   ------------------------------------------------------------
   القاعدة (spec المرحلة 1): أي تصدير بيانات بالجملة — CSV/Excel/تقارير/
   حضور/حزم طوارئ/نسخ احتياطي/أي تفريغ بيانات — للأدمن العام فقط.
   المدير/الاستقبال/المدرس/الطالب/زائر = رفض 403 + تدقيق EXPORT_DENIED.
   إخفاء الزرار مش حماية — الحارس ده سيرفر-سايد على كل مسار.
   - الدور والهوية بتيجي من الجلسة الموثوقة فقط — أي ادعاء دور/معرف
     من البارامز/البودي/الهيدرز مش بيتقبل أصلًا (بنقرأ role من DB عبر الجلسة).
   - التصدير لسنتر معين بيحدده أدمن المنصة صراحة (?centerId=) وبنتحقق
     إن السنتر موجود — والاستيراد (recovery) ليه صلاحية مستقلة مش من هنا.
   - مفيش حاجة حساسة تتسجل في التدقيق — بس المين/النوع/النتيجة/النطاق.
============================================================ */

export type ExportGrant = { user: SessionUser; centerId: string | null };

/** اتأكد إن اللي بياخد التصدير أدمن عام — وارجعله ومعاه نطاق السنتر (لو محدد) */
export async function requireExportAdmin(opts: {
  what: string;               // نوع التصدير للتدقيق — مثال: "attendance-csv"
  centerId?: string | null;   // نطاق مطلوب صراحة (من بارام موثوق بينتحقق)
}): Promise<ExportGrant> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("محتاج تسجيل دخول.", 401);
  if (user.role !== "ADMIN") {
    await logAudit({
      user,
      action: AUDIT.EXPORT_DENIED,
      entity: "EXPORT",
      entityId: opts.what,
      reason: `محاولة تصدير (${opts.what}) من غير دور الإدارة العامة — رفض سيرفر-سايد`,
    }).catch(() => {});
    throw new ApiError("تصدير البيانات بالجملة متاح لحساب الإدارة العامة (أدمن المنصة) بس.", 403);
  }
  let centerId: string | null = opts.centerId?.trim() || null;
  if (centerId) {
    const center = await db.center.findUnique({
      where: { id: centerId },
      select: { id: true, name: true, status: true },
    });
    if (!center) throw new ApiError("السنتر المطلوب تصديره مش موجود.", 404);
  }
  return { user, centerId };
}

/** جلسة أدمن منسوخة بنطاق سنتر محدد — عشان المسارات اللي بتقرأ user.centerId */
export function scopeAdminToCenter(grant: ExportGrant, centerId: string): SessionUser & { centerId: string } {
  return { ...grant.user, centerId };
}

/** بارام centerId من الـ URL — مدخل موثوق للمدير العام بس (بيتحقق جوه الحارس) */
export function centerParam(url: URL): string | null {
  return url.searchParams.get("centerId");
}
