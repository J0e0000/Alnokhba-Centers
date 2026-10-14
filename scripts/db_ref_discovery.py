#!/usr/bin/env python3
# db_ref_discovery.py — اكتشاف ref قاعدة الإنتاج الحقيقي + الباسورد الصحيح.
# 1) فلتر DNS فوري: <ref>.supabase.co — الدومين الحقيقي لازم يكون موجود (المشروع شغال).
# 2) مصادقة على الـ refs المرشحة عبر pooler بأي من الباسوردين.
# لا يطبع أي سر — يطبع الـ refs والحالات فقط. يكتب: .dbref / .dbhost / .dbpass (chmod 600).
import json, os, socket, sys
import psycopg2

BASE = "ttydfyqwzkiwuvcgiegy"
SUBS = ["i", "l", "1"]
HOSTS = ["aws-0-eu-west-2.pooler.supabase.com",
         "aws-1-eu-west-2.pooler.supabase.com",
         "aws-2-eu-west-2.pooler.supabase.com"]
CAND_FILE = "/home/z/my-project/scripts/.dbpass_candidates.json"
OUT_DIR = "/home/z/my-project/scripts"

def ref_variants():
    out = set()
    for a in SUBS:
        for b in SUBS:
            arr = list(BASE); arr[10] = a; arr[16] = b
            out.add("".join(arr))
    out.add(BASE)
    return sorted(out)

def dns_ok(name):
    try:
        socket.getaddrinfo(name, None)
        return True
    except Exception:
        return False

def classify(exc):
    msg = str(exc).strip()
    for marker in ("FATAL:", "ERROR:"):
        if marker in msg:
            msg = msg.split(marker, 1)[1].strip(); break
    low = msg.lower()
    if "not found" in low and ("tenant" in low or "user" in low):
        return "WRONG_TENANT"
    if "password authentication failed" in low or "authentication failed" in low:
        return "RIGHT_TENANT_WRONG_PASS"
    if "role" in low and "does not exist" in low:
        return "RIGHT_TENANT_WRONG_USER?"
    if "timeout" in low or "timed out" in low or "connection refused" in low:
        return "UNREACHABLE"
    return "OTHER: " + msg[:90].replace("\n", " ")

def try_auth(ref, pw, host, port=6543):
    try:
        conn = psycopg2.connect(host=host, port=port, user=f"postgres.{ref}",
                                password=pw, dbname="postgres",
                                sslmode="require", connect_timeout=8)
        cur = conn.cursor(); cur.execute("select 1"); cur.fetchone()
        cur.close(); conn.close()
        return "AUTH_OK"
    except psycopg2.OperationalError as e:
        return classify(e)
    except Exception as e:
        return "OTHER: " + str(e)[:90].replace("\n", " ")

cands = json.load(open(CAND_FILE))
refs = ref_variants()
print(f"refs محتملة: {len(refs)} | باسوردات: {len(cands)} (مش بتتطبع)")

print("\n== مرحلة 1: فلتر DNS على <ref>.supabase.co")
alive = [r for r in refs if dns_ok(f"{r}.supabase.co")]
for r in refs:
    print(f"  {r}: {'DNS موجود ✓' if r in alive else 'NXDOMAIN'}")
if not alive:
    print("لا يوجد ref له دومين حي — ممكن المشروع paused أو الفرضية غلط. جاري متابعة مصادقة على الكل على أي حال.")
    alive = refs

print("\n== مرحلة 2: مصادقة (refs الحية × الباسوردات × pooler hosts)")
winner = None
auth_hits = []  # ref+host صح لكن باسورد غلط
for host in HOSTS:
    for ref in alive:
        for ci, pw in enumerate(cands):
            st = try_auth(ref, pw, host)
            if st == "AUTH_OK":
                print(f"  {host} / {ref} / pass#{ci+1}: AUTH_OK ✓✓✓")
                winner = (ref, pw, host)
                break
            elif st == "RIGHT_TENANT_WRONG_PASS":
                print(f"  {host} / {ref} / pass#{ci+1}: RIGHT_TENANT_WRONG_PASS (الـ ref ده هو الصحيح!)")
                auth_hits.append((ref, host))
            else:
                print(f"  {host} / {ref} / pass#{ci+1}: {st}")
        if winner: break
    if winner: break
    # لو عدّا كل الـ refs على aws-0 كله WRONG_TENANT ومفيش أي auth hit → جرب الـ host التالي
    if auth_hits: break

if winner:
    ref, pw, host = winner
    for name, val in ((".dbref", ref), (".dbhost", host), (".dbpass", pw)):
        p = os.path.join(OUT_DIR, name)
        with open(p, "w") as f: f.write(val)
        os.chmod(p, 0o600)
    print(f"\nWINNER: ref={ref} host={host} pass=candidate — متخزنة في scripts/.dbref|.dbhost|.dbpass (600)")
    sys.exit(0)
elif auth_hits:
    ref, host = auth_hits[0]
    for name, val in ((".dbref", ref), (".dbhost", host)):
        p = os.path.join(OUT_DIR, name)
        with open(p, "w") as f: f.write(val)
        os.chmod(p, 0o600)
    print(f"\nالـ ref الصحيح اتحدد: {ref} على {host} — بس الباسورد غلط في المرشحين. مفيش أي كتابة على Vercel.")
    sys.exit(3)
else:
    print("\nNO_WINNER — ولا تركيبة اشتغلت. مفيش أي كتابة على Vercel.")
    sys.exit(2)
