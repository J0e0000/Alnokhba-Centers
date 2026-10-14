#!/usr/bin/env python3
# dns_ref_bruteforce.py — اكتشاف ref قاعدة الإنتاج عبر DNS (بدون auth، بدون كتابة).
# الأساس: ttydfyqwzkiwuvcgiegy (قراءة شاشة) + أول 4 حروف مؤكدة "ttyd" من dbUrlPrefix الحي.
# الفكرة: <ref>.supabase.co للـ ref الحقيقي لازم يكون موجود (المشروع مش محذوف — المالك ظبط باسورده إمس).
# فضاء البحث = بدائل الحروف المتشابهة بصريًا في المواقع غير المؤكدة.
import json, socket, sys
from concurrent.futures import ThreadPoolExecutor

GUESS = "ttydfyqwzkiwuvcgiegy"
# بدائل محتملة لكل موقع (القراءة من شاشة بتلخبط بين المجموعات دي)
CONF = {
    4: "ft", 5: "yv", 6: "qg9", 8: "z2", 10: "il1", 12: "uv",
    13: "vu", 14: "ce", 15: "gq9", 16: "il1", 17: "gq9", 18: "ec", 19: "yv",
}
FIXED = {0, 1, 2, 3}  # "ttyd" مؤكدة من الإنتاج الحي

def variants():
    opts = []
    for i, ch in enumerate(GUESS):
        if i in FIXED:
            opts.append(ch)
        elif i in CONF:
            opts.append(CONF[i])
        else:
            opts.append(ch)
    total = 1
    for o in opts:
        total *= len(o)
    print(f"فضاء البحث: {total} ref محتمل")
    def rec(prefix, idx, acc):
        if idx == len(opts):
            acc.append(prefix); return
        for c in opts[idx]:
            rec(prefix + c, idx + 1, acc)
    acc = []
    rec("", 0, acc)
    return acc

def resolves(ref):
    for _ in range(2):  # تأكيد مزدوج للنتايج الإيجابية
        try:
            socket.getaddrinfo(f"{ref}.supabase.co", 443)
        except socket.gaierror:
            return False
        except Exception:
            return False
    return True

def check(ref):
    try:
        socket.getaddrinfo(f"{ref}.supabase.co", 443)
        return ref
    except Exception:
        return None

def main():
    refs = variants()
    hits = []
    with ThreadPoolExecutor(max_workers=64) as ex:
        for r in ex.map(check, refs):
            if r:
                hits.append(r)
    # تحقق مزدوج للإيجابيات
    hits = [r for r in hits if resolves(r)]
    print(f"refs ليها DNS حي: {len(hits)}")
    for r in hits:
        print(f"  ALIVE: {r}.supabase.co")
    json.dump(hits, open("/home/z/my-project/scripts/.dbref_candidates.json", "w"))
    if not hits:
        print("مفيش أي ref حي — الفرضية متغطتش. هيتطلب من المالك الـ ref من داشبورد Supabase.")
        sys.exit(2)
    sys.exit(0)

main()
