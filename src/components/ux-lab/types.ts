"use client";
/* مختبر تجربة المستخدم — الأنواع المشتركة
   كل البيانات هنا اصطناعية بالكامل وصفر اتصال بالسيرفر. */

export type OptionId = "quick" | "guided" | "cockpit";

export const OPTION_META: Record<OptionId, { name: string; pitch: string; icon: string }> = {
  quick:   { name: "السريعة",     pitch: "افتراضات ذكية + استثناءات فقط — أقل نقرات ممكنة",  icon: "zap" },
  guided:  { name: "المُوجَّهة",   pitch: "مراحل واضحة بإرشاد كامل — صفر حاجة بتتساب",        icon: "list" },
  cockpit: { name: "قمرة القيادة", pitch: "شاشة حية واحدة — كل حاجة قدامك في نفس اللحظة",    icon: "gauge" },
};

export type AttStatus = "PRESENT" | "LATE" | "EXCUSED";

export const STATUS_LABEL: Record<AttStatus, string> = {
  PRESENT: "حاضر",
  LATE: "متأخر",
  EXCUSED: "بعذر",
};

export type MarkMethod = "MANUAL" | "QR";

export type Mark = { status: AttStatus; method: MarkMethod; at: number };

export type LabStudent = {
  id: string;
  code: string;
  name: string;
  usualLate?: boolean;      // فرضية سلوكية للسيناريو
  lastWeakness?: string;    // نقطة ضعف مسجلة من حصة سابقة (نص اصطناعي)
};

export type InteractionRating = "GREAT" | "GOOD" | "QUIET" | "DISRUPTIVE";

export const RATING_LABEL: Record<InteractionRating, string> = {
  GREAT: "متفاعل جدًا",
  GOOD: "كويس",
  QUIET: "هادي",
  DISRUPTIVE: "مشاكس",
};

export type SaveState = "idle" | "saving" | "saved" | "queued";

export type FlowPhase = "entry" | "live" | "summary";

export type OptionState = {
  phase: FlowPhase;
  loading: boolean;                       // محاكاة تحميل عند فتح الحصة
  marks: Record<string, Mark>;            // الطالب → حالة الحضور (غياب = مش موجود)
  weaknesses: Record<string, string[]>;   // الطالب → نقاط ضعف
  ratings: Record<string, InteractionRating>;
  notes: string;                          // ملاحظات الجلسة
  save: SaveState;
  stage: number;                          // الموجَّهة فقط: 0..3
  stageDone: { attendance: boolean; notes: boolean; review: boolean };
  selfCheckins: string[];                 // معرّفات الطلاب اللي "سجلوا ذاتيًا" (محاكاة QR)
  closed: boolean;
  closedAt: number | null;
};

export type Metrics = {
  clicks: number;
  transitions: number;
  startedAt: number | null;   // أول تفاعل داخل البديل
  finishedAt: number | null;  // لحظة القفل الناجح
};

export type LabChoice = {
  option: OptionId | null;
  comment: string;
  savedAt: number | null;
};

export const emptyOptionState = (): OptionState => ({
  phase: "entry",
  loading: false,
  marks: {},
  weaknesses: {},
  ratings: {},
  notes: "",
  save: "idle",
  stage: 0,
  stageDone: { attendance: false, notes: false, review: false },
  selfCheckins: [],
  closed: false,
  closedAt: null,
});

export const emptyMetrics = (): Metrics => ({ clicks: 0, transitions: 0, startedAt: null, finishedAt: null });
