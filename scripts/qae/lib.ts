/**
 * QAE shared library — AlNokhba full-system validation (run QAE1)
 * Deterministic PRNG + Cairo time helpers + center specs + result writers.
 * Everything is tagged with RUN_ID "QAE1" so teardown can remove exactly our data.
 */
import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";

export const RUN_ID = "QAE1";
export const PWD = "Qae#2026";
export const RESULTS_DIR = "/home/z/my-project/qae/results";
export const MANIFEST_PATH = "/home/z/my-project/qae/manifest.json";

/* ---------------- deterministic PRNG (mulberry32) ---------------- */
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function rnd(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof makeRng>;
export function ri(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
export function pick<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
export function hex(rng: Rng, len: number): string {
  let out = "";
  while (out.length < len) out += Math.floor(rng() * 16).toString(16);
  return out.slice(0, len);
}

/* ---------------- Cairo time helpers ---------------- */
const CAIRO = "Africa/Cairo";
function tzOffsetMin(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CAIRO, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour % 24, +map.minute, +map.second);
  return (asUTC - d.getTime()) / 60000;
}
export function cairoYMD(ref = new Date()): { y: number; m: number; d: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO, dateStyle: "short" });
  const parts = fmt.formatToParts(ref);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get("year"), m = get("month"), dd = get("day");
  const dow = new Date(Date.UTC(y, m - 1, dd, 12)).getUTCDay();
  return { y, m, d: dd, dow };
}
export function dayStr(offsetDays: number): string {
  const { y, m, d } = cairoYMD();
  const t = new Date(Date.UTC(y, m - 1, d, 12) + offsetDays * 86_400_000);
  return t.toISOString().slice(0, 10);
}
export function cairoTs(dateStr: string, hm: string): Date {
  const guess = new Date(`${dateStr}T${hm}:00Z`);
  const off = tzOffsetMin(guess);
  return new Date(guess.getTime() - off * 60000);
}
export function dowOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/* ---------------- synthetic Egyptian pools ---------------- */
export const FIRST = ["أحمد","محمد","محمود","مصطفى","كريم","عمر","يوسف","علي","حسن","حسين","خالد","طارق","زياد","عبدالله","إبراهيم","شريف","هاني","سيف","أنس","باسم"];
export const MID = ["سيد","عبد الرحمن","السيد","فتحي","رمضان","عادل","جمال","كامل","سعيد","مجدي","شعبان","رجب","الأمير","عصام","هشام"];
export const LAST = ["إبراهيم","زكي","عبد الله","الشريف","حسنين","الشناوي","بدوي","سمير","فؤاد","الجندي","رشاد","الحديدي","عوض","سليم","منصور","الغريب","قنديل","الدسوقي","طنطاوي","خير الله"];
export const SCHOOLS = ["مدرسة النيل الإعدادية","مدرسة الحرية الثانوية","مدرسة المستقبل","مدرسة الأمل","مدرسة الفتح","مدرسة السلام"];
export const SUBJECTS = ["رياضيات","فيزياء","كيمياء","إنجليزي","عربي"];
export const GRADES = ["الأول الثانوي","الثاني الثانوي","الثالث الثانوي"];
export const ANNOUNCE_TITLES = ["بدء امتحانات الشهر","تغيير موعد حصة الفيزياء","سداد المصروفات","حصص تعويضية يوم الجمعة","افتتاح قاعة جديدة"];

export function studentName(rng: Rng): string {
  return `${pick(rng, FIRST)} ${pick(rng, MID)} ${pick(rng, LAST)}`;
}
export function teacherName(rng: Rng): string {
  return `أ/ ${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}
export function synthPhone(rng: Rng): string {
  return `01${pick(rng, [0, 1, 2, 5])}${String(ri(rng, 10000000, 99999999))}`;
}
export function qrToken(): string {
  return randomBytes(24).toString("hex");
}

/* ---------------- center specs ---------------- */
export type CenterSpec = {
  n: string;
  slug: string;
  students: number;
  teachers: number;
  groups: number;
  attnBase: number;
};
export const CENTER_SPECS: CenterSpec[] = [
  { n: "01", slug: "qae-c01", students: 120, teachers: 6, groups: 8, attnBase: 0.90 },
  { n: "02", slug: "qae-c02", students: 110, teachers: 5, groups: 7, attnBase: 0.84 },
  { n: "03", slug: "qae-c03", students: 100, teachers: 5, groups: 6, attnBase: 0.88 },
  { n: "04", slug: "qae-c04", students: 100, teachers: 5, groups: 6, attnBase: 0.78 },
  { n: "05", slug: "qae-c05", students: 95, teachers: 4, groups: 6, attnBase: 0.92 },
  { n: "06", slug: "qae-c06", students: 105, teachers: 5, groups: 7, attnBase: 0.81 },
  { n: "07", slug: "qae-c07", students: 90, teachers: 4, groups: 5, attnBase: 0.86 },
  { n: "08", slug: "qae-c08", students: 100, teachers: 5, groups: 6, attnBase: 0.75 },
  { n: "09", slug: "qae-c09", students: 85, teachers: 4, groups: 5, attnBase: 0.89 },
  { n: "10", slug: "qae-c10", students: 90, teachers: 4, groups: 5, attnBase: 0.83 },
];
export const STRESS_SPEC: CenterSpec = { n: "99", slug: "qae-c99-stress", students: 5000, teachers: 30, groups: 30, attnBase: 0.85 };

/* ---------------- result helpers ---------------- */
export function saveResult(name: string, data: unknown): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const p = `${RESULTS_DIR}/${name}`;
  writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`  📄 saved ${p}`);
  return p;
}
export function ok(b: boolean): string { return b ? "✅" : "❌"; }
export function pctl(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[i]);
}
export function fmtMs(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}
