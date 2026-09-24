import "server-only";

/* Cairo-local academic date helpers (UTC+2, consistent with the replica) */

export function cairoNow(): Date {
  return new Date(Date.now() + 2 * 3600 * 1000);
}

/** YYYY-MM-DD for Cairo today (or offset days) */
export function todayStr(offsetDays = 0): string {
  const d = new Date(cairoNow().getTime() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/** dayOfWeek for a YYYY-MM-DD date string (0=Sunday..6=Saturday, Cairo) */
export function dowOf(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.getUTCDay();
}

/** Add days to a YYYY-MM-DD string */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes since midnight for "HH:MM" */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Time overlap on the same day: [s1,e1) vs [s2,e2) */
export function overlaps(start1: string, end1: string, start2: string, end2: string): boolean {
  return toMinutes(start1) < toMinutes(end2) && toMinutes(start2) < toMinutes(end1);
}

export const DOW_NAMES_AR = ["الأحد", "الإتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

export function fmtTime12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
