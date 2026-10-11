/* ============================================================
   سجل أقسام المنتج (Module Registry) — Master Prompt §4
   ------------------------------------------------------------
   - القسم = وحدة منتج كاملة (مالية/امتحانات/كتب/زكي...) — أعلى مستوى
     من قدرات الحضور (capabilities.ts) اللي بتتحكم في طرق الحضور بس.
   - الثلاث طبقات فوق بعض بالظبط (Master Prompt §2):
       أ) اشتراك المنصة (Plan)      — إيه اللي السنتر اشتراه
       ب) إعدادات السنتر (Modules)  — المدير يقفل قسم مش محتاجه
       ج) صلاحيات الحساب (permissions.ts) — مين يعمل إيه جوه القسم
   - المفتاح ثابت (identifier) — العرض بالعربي من الليبل بس.
   - ميزات مش موجودة فعلًا = مش في السجل أصلاً (ممنوع نعرض حاجة وهمية).
   - الملف ده مشترك (client + server) — ممنوع server-only هنا.
============================================================ */

export type ModuleKey =
  | "attendance"      // الحضور (طرقه الثمانية تحت تحكم capabilities)
  | "students"        // الطلاب والمجموعات
  | "sessions"        // الحصص والجدول
  | "finance"         // المالية: دفعات/مصروفات/يومية/تسويات
  | "exams"           // الامتحانات والكويزات
  | "assignments"     // الواجبات
  | "books"           // مبيعات الكتب والمخزون
  | "reports"         // التقارير والتصدير
  | "ai_agent"        // زكي — المساعد الذكي (محادثة/صوت/تحليل)
  | "communications"  // إشعارات أولياء الأمور (واتساب/بنر)
  | "settings";       // إعدادات المركز

export type ModuleGroup = "core" | "academic" | "commercial" | "platform";

export type ModuleMeta = {
  label: string;
  desc: string;
  group: ModuleGroup;
  defaultEnabled: boolean;
};

export const MODULE_CATALOG: Record<ModuleKey, ModuleMeta> = {
  attendance: {
    label: "الحضور والغياب",
    desc: "تحضير الطلاب بكل الطرق: بالاسم، QR ثابت، QR متغير، مسح ذاتي، حضور موظفين، بصمة.",
    group: "core",
    defaultEnabled: true,
  },
  students: {
    label: "الطلاب والمجموعات",
    desc: "تسجيل الطلاب، المجموعات، التسجيلات، كروت الطلاب، وأرشفة/إيقاف الطالب.",
    group: "core",
    defaultEnabled: true,
  },
  sessions: {
    label: "الحصص والجدول",
    desc: "فتح وقفل الحصص، الجدول الأسبوعي، القاعات، وتضارب المواعيد.",
    group: "core",
    defaultEnabled: true,
  },
  finance: {
    label: "المالية",
    desc: "الدفعات والإيصالات، المصروفات، اليومية، تسويات المدرسين، وقيود الصندوق.",
    group: "commercial",
    defaultEnabled: true,
  },
  exams: {
    label: "الامتحانات والكويزات",
    desc: "بنك الامتحانات، الكويزات الإلكترونية، الدرجات، ونتائج الطلاب.",
    group: "academic",
    defaultEnabled: true,
  },
  assignments: {
    label: "الواجبات",
    desc: "إسناد الواجبات لمجموعات ومتابعة التسليم والتقييم.",
    group: "academic",
    defaultEnabled: true,
  },
  books: {
    label: "مبيعات الكتب",
    desc: "مخزون الكتب، البيع للطلاب على الحساب، وتسويات المخزون.",
    group: "commercial",
    defaultEnabled: true,
  },
  reports: {
    label: "التقارير والتصدير",
    desc: "تقارير الحضور والتحصيل والأداء + تصدير CSV/Excel.",
    group: "platform",
    defaultEnabled: true,
  },
  ai_agent: {
    label: "زكي — المساعد الذكي",
    desc: "محادثة صوت ونص، تسجيل حضور بالكلام، تقارير فورية، وتحليل أداء — بصلاحيات حسابك وبأدوات مُتحقق منها على السيرفر.",
    group: "platform",
    defaultEnabled: true,
  },
  communications: {
    label: "إشعارات الأولياء",
    desc: "رسائل واتساب لأولياء الأمور: إشعار غياب، انخفاض رصيد، وإشعارات الدفعات.",
    group: "commercial",
    defaultEnabled: true,
  },
  settings: {
    label: "إعدادات المركز",
    desc: "بيانات السنتر، الهوية البصرية، إعدادات الحضور، وإدارة الموظفين.",
    group: "platform",
    defaultEnabled: true,
  },
};

export const MODULE_KEYS = Object.keys(MODULE_CATALOG) as ModuleKey[];

export function isModuleKey(k: string): k is ModuleKey {
  return k in MODULE_CATALOG;
}

/** مفتاح صف overriding القسم في جدول CenterCapability (بدون تغيير سكيمة) */
export function moduleOverrideKey(key: ModuleKey): string {
  return `module:${key}`;
}

export function parseModuleOverrideKey(raw: string): ModuleKey | null {
  if (!raw.startsWith("module:")) return null;
  const k = raw.slice("module:".length);
  return isModuleKey(k) ? k : null;
}

/** شكل القسم زي ما الـ API بيرجّعه للعميل */
export type ModuleState = { enabled: boolean; /** مين اللي حاجب: platform | plan | center | subscription */
  lockedBy?: "platform" | "plan" | "center" | "subscription" };
export type ModuleMap = Record<ModuleKey, ModuleState>;
