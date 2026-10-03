/* ============================================================
   ميزات المركز القابلة للتشغيل/الإيقاف (Center Capabilities)
   ------------------------------------------------------------
   - القدرة = ميزة بتتفعّل/تتعطل على مستوى المركز (مش على مستوى الحساب).
   - الصلاحيات الحسابية (Account permissions — lib/permissions.ts) منفصلة تمامًا.
   - الفحص النهائي: صلاحية الحساب + قدرة المركز + السياق + الملكية.
   - الملف ده مشترك (client + server) — ممنوع server-only هنا.
   - معمارية قابلة للامتداد: قدرة جديدة = مفتاح جديد في الكتالوج من غير
     تغيير في نواة الحضور (الأحداث الموحدة بتقبل أي method).
============================================================ */

export type CapabilityKey =
  | "name_attendance"        // التحضير بالاسم / التحضير المعكوس (يدوي)
  | "static_qr"              // مسح كارت الطالب (QR الثابت) + كود الطالب
  | "dynamic_qr"             // QR الحصة المتنقل (slot QR قصير العمر)
  | "student_self_scan"      // الطالب يمسح كود الحصة بنفسه من البورتال
  | "staff_qr_checkin"       // حضور الموظفين بمسح QR شاشة المركز
  | "fingerprint"            // حضور ببصمة (عتاد خارجي — اختياري)
  | "late_checkin"           // السماح بتسجيل حضور "متأخر"
  | "teacher_auto_attendance"; // حضور المدرس تلقائي عند بدء الحصة

export type CapabilityGroup = "students" | "staff";

export type CapabilityMeta = {
  label: string;
  desc: string; // شرح قصير جوه علامة "!"
  group: CapabilityGroup;
  defaultEnabled: boolean;
  /** أي طرق حضور موحدة بترتبط بالقدرة دي (للعرض في الإعدادات) */
  methods?: string[];
};

export const CAPABILITY_CATALOG: Record<CapabilityKey, CapabilityMeta> = {
  name_attendance: {
    label: "التحضير بالاسم",
    desc: "تسجيل حضور الطلاب يدويًا من الشاشة (تحديد فردي أو تحضير معكوس للغايبين).",
    group: "students",
    defaultEnabled: true,
    methods: ["NAME"],
  },
  static_qr: {
    label: "QR ثابت (كارت الطالب)",
    desc: "مسح كارت الطالب أو كتابة كوده — الكود ثابت مدى الحياة.",
    group: "students",
    defaultEnabled: true,
    methods: ["STATIC_QR"],
  },
  dynamic_qr: {
    label: "QR متغير (QR الحصة)",
    desc: "كود يتغير تلقائيًا كل 10 ثواني لمنع استخدام صورة QR قديمة — يظهر على شاشة الحصة.",
    group: "students",
    defaultEnabled: true,
    methods: ["DYNAMIC_QR"],
  },
  student_self_scan: {
    label: "المسح الذاتي للطالب",
    desc: "الطالب يسجّل حضوره بنفسه بمسح كود الحصة من بورتال الطالب — بدون استقبال.",
    group: "students",
    defaultEnabled: true,
    methods: ["DYNAMIC_QR"],
  },
  staff_qr_checkin: {
    label: "حضور الموظفين بـ QR",
    desc: "شاشة ثابتة في المركز تعرض كود متغير — الموظف يمسحه من موبايله يسجّل حضوره.",
    group: "staff",
    defaultEnabled: true,
    methods: ["DYNAMIC_QR"],
  },
  fingerprint: {
    label: "حضور بالبصمة",
    desc: "يتطلب جهاز بصمة متوافق مع النظام — تكامل خارجي اختياري (حتى 3 بصمات افتراضيًا).",
    group: "staff",
    defaultEnabled: false,
    methods: ["FINGERPRINT"],
  },
  late_checkin: {
    label: "حضور متأخر",
    desc: "السماح بتسجيل الطالب بحالة «متأخر» — لما تقفلها الحضور بيبقى حاضر أو بعذر بس.",
    group: "students",
    defaultEnabled: true,
    methods: [],
  },
  teacher_auto_attendance: {
    label: "حضور المدرس تلقائي",
    desc: "لما الحصة تفتح، المدرس يتسجل حاضر تلقائيًا بتوقيت البدء — من غير خطوة إضافية.",
    group: "staff",
    defaultEnabled: true,
    methods: ["SESSION_START"],
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_CATALOG) as CapabilityKey[];

export function isCapabilityKey(k: string): k is CapabilityKey {
  return k in CAPABILITY_CATALOG;
}

/** شكل القدرة زي ما الـ API بيرجّعه للعميل */
export type CapabilityState = { enabled: boolean; config: Record<string, unknown> };
export type CapabilityMap = Record<CapabilityKey, CapabilityState>;

/** الخريطة الافتراضية (قبل أي تخصيص) — كل الميزات الموجودة شغالة عشان مفيش حاجة تتكسر */
export function defaultCapabilityMap(): CapabilityMap {
  const map = {} as CapabilityMap;
  for (const key of CAPABILITY_KEYS) {
    map[key] = { enabled: CAPABILITY_CATALOG[key].defaultEnabled, config: {} };
  }
  return map;
}

/** القيم الافتراضية للـ config لكل قدرة */
export function defaultCapabilityConfig(key: CapabilityKey): Record<string, unknown> {
  if (key === "fingerprint") return { maxUsers: 3 };
  if (key === "staff_qr_checkin") return { slotSeconds: 10 };
  if (key === "teacher_auto_attendance") return { requireCenterPresence: false };
  return {};
}
