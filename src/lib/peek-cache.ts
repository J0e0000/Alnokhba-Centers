/* ============================================================
   مايكرو-كاش قراءات الـ peek (Task R) — معessel إبطال مركزي.
   موجة فصل كامل بيمسح الكود في نفس الثواني = كل طالب بيعمل peek
   لنفس التوكن — والبيانات دي (الحصة/القدرة/الوضع) مش بتتغير أسرع من كده.
   pv بيتولّد لكل طلب في الـ route — الكاش هنا تسريع قراءة بس.
   clearPeekCache() بتتنادى لما قدرات المركز تتغيّر (PATCH) عشان
   التبديل يبان فورًا للطلاب من غير نوافذ 3ث قديمة.
============================================================ */
const PEEK_TTL_MS = 3_000;
const peekCache = new Map<string, { at: number; payload: Record<string, unknown> }>();

export function peekCacheGet(token: string): Record<string, unknown> | null {
  const hit = peekCache.get(token);
  if (hit && Date.now() - hit.at < PEEK_TTL_MS) return hit.payload;
  if (hit) peekCache.delete(token);
  return null;
}

export function peekCachePut(token: string, payload: Record<string, unknown>): void {
  if (peekCache.size > 400) {
    const cutoff = Date.now() - 30_000;
    for (const [k, v] of peekCache) if (v.at < cutoff) peekCache.delete(k);
  }
  peekCache.set(token, { at: Date.now(), payload });
}

/** إبطال فوري — بتتنادى من PATCH /api/center/capabilities وأي تغيير قدرات */
export function clearPeekCache(): void {
  peekCache.clear();
}
