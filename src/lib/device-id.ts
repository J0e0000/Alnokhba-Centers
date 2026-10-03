/* ============================================================
   معرّف الجهاز للحضور العام (Session-Scoped Device Identity — spec §5/§27)
   ------------------------------------------------------------
   - UUID عشوائي بلا أي معنى: مش مشتق من الطالب ولا من الهاردوير.
   - التخزين: كوكي first-party + LocalStorage كاحتياط (أي واحد فيهم يكفي).
   - الهدف: قفل إساءة الاستخدام العادي (جهاز واحد = حضور واحد لكل حصة).
   - مش إثبات هوية قوي: المتصفح مش بيقدر يثبت إن كروم وإنкогنتو نفس الموبايل —
     ده قصور معروف في الويب وبنعالجه بإشارات الخطورة (attendance-risk) مش بادعاءات.
   - البيانات الصغرى: مفيش اسم/موبايل/بصمة/معرّف هاردوير — UUID بس.
============================================================ */

const COOKIE_NAME = "nk_did";
const LS_KEY = "nk_attend_did";
const ONE_YEAR_S = 60 * 60 * 24 * 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValid(v: string | null | undefined): v is string {
  return !!v && UUID_RE.test(v);
}

function generateUuid(): string {
  // crypto.randomUUID موجود في كل المتصفحات الحديثة — الاحتياط لبيئات قديمة
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // آخر احتياط (نظريًا مش هيحصل في المتصفح)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(v: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(v)}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax${secure}`;
}

/**
 * getOrCreateAttendanceDeviceId() — الواجهة الموحدة للحضور العام (spec §27).
 * موجود وصالح → رجّعه | مش موجود → ولّد UUID → خزّنه (كوكي + LocalStorage) → رجّعه.
 * بيرجّع لو القيمة المخزنة بايظة (مش UUID) عشان القاعدة تفضل نظيفة.
 */
export function getOrCreateAttendanceDeviceId(): string {
  if (typeof window === "undefined") return "";
  let ls: string | null = null;
  try {
    ls = window.localStorage?.getItem(LS_KEY) ?? null;
  } catch {
    /* LocalStorage مكتوم (خصوصية صارمة) — الكوكي يكفي */
  }
  const ck = readCookie();

  const existing = isValid(ls) ? (ls as string) : isValid(ck) ? (ck as string) : null;
  const id = existing ?? generateUuid();

  // زامن المكانين (اللي ناقص اكتبه — اللي بايظ صلّحه)
  if (ls !== id) {
    try {
      window.localStorage?.setItem(LS_KEY, id);
    } catch {
      /* تجاهل — الكوكي موجود */
    }
  }
  if (ck !== id) writeCookie(id);

  return id;
}
