#!/usr/bin/env python3
# verify_real_ref.py — تحقق نهائي من الـ ref الحقيقي (من المالك بالنسخ واللصق) + أي باسورد هو الحالي.
# 1) DNS + REST gateway → المشروع حي ولا paused ولا ميت
# 2) مصادقة على pooler بالباسوردين المرشحين (aws-0/1 × 6543/5432)
# لا يطبع أي سر. عند النجاح يكتب .dbref / .dbhost / .dbpass (chmod 600).
import json, os, socket, sys, urllib.request
import psycopg2

REAL_REF = "ttydfyqwzkwivucgiegy"
HOSTS = ["aws-0-eu-west-2.pooler.supabase.com", "aws-1-eu-west-2.pooler.supabase.com"]
CAND_FILE = "/home/z/my-project/scripts/.dbpass_candidates.json"
OUT = "/home/z/my-project/scripts"

def dns_ok(name):
    try:
        socket.getaddrinfo(name, None); return True
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
    if "timeout" in low or "timed out" in low or "connection refused" in low:
        return "UNREACHABLE"
    return "OTHER: " + msg[:90].replace("\n", " ")

def try_auth(pw, host, port):
    try:
        conn = psycopg2.connect(host=host, port=port, user=f"postgres.{REAL_REF}",
                                password=pw, dbname="postgres",
                                sslmode="require", connect_timeout=8)
        cur = conn.cursor(); cur.execute("select 1"); cur.fetchone()
        cur.close(); conn.close()
        return "AUTH_OK"
    except psycopg2.OperationalError as e:
        return classify(e)
    except Exception as e:
        return "OTHER: " + str(e)[:90].replace("\n", " ")

print(f"ref حقيقي من المالك: {REAL_REF} ({len(REAL_REF)} حرف)")
print("\n== 1) حيوية المشروع:")
for host in (f"{REAL_REF}.supabase.co", f"db.{REAL_REF}.supabase.co"):
    print(f"  {host}: DNS {'موجود ✓' if dns_ok(host) else 'NXDOMAIN ✗'}")
try:
    req = urllib.request.Request(f"https://{REAL_REF}.supabase.co/rest/v1/", method="GET")
    with urllib.request.urlopen(req, timeout=12) as r:
        print(f"  REST gateway: HTTP {r.status} → المشروع حي ✓")
except urllib.error.HTTPError as e:
    print(f"  REST gateway: HTTP {e.code} {'→ حي ✓ (401 متوقعة بدون مفتاح)' if e.code in (401, 200) else '→ Paused/مقيّد ⚠'}")
except Exception as e:
    print(f"  REST gateway: {type(e).__name__} → ميت/Paused ⚠")

print("\n== 2) مصادقة الباسوردات:")
cands = json.load(open(CAND_FILE))
winner = None; right_tenant = False
for host in HOSTS:
    for port in (6543, 5432):
        for ci, pw in enumerate(cands):
            st = try_auth(pw, host, port)
            print(f"  {host}:{port} pass#{ci+1}: {st}")
            if st == "AUTH_OK":
                winner = (pw, host); break
            if st == "RIGHT_TENANT_WRONG_PASS":
                right_tenant = True
        if winner: break
    if winner: break

if winner:
    pw, host = winner
    for name, val in ((".dbref", REAL_REF), (".dbhost", host), (".dbpass", pw)):
        p = os.path.join(OUT, name)
        with open(p, "w") as f: f.write(val)
        os.chmod(p, 0o600)
    print(f"\nWINNER ✓ ref={REAL_REF} host={host} pass=candidate — متخزنة (600) — جاهز للإصلاح")
    sys.exit(0)
elif right_tenant:
    print("\nRIGHT_TENANT — المشروع حي لكن الباسورد الغلط في المرشحين. محتاجين الباسورد الحالي من المالك.")
    sys.exit(3)
else:
    print("\nWRONG_TENANT حتى بالـ ref الصحيح → المشروع Paused/ميت. مطلوب Restore من الداشبورد.")
    sys.exit(2)
