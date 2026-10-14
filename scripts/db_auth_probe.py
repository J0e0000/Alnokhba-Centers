#!/usr/bin/env python3
# db_auth_probe.py — تحديد أي باسورد هو الحالي فعلاً قبل أي كتابة على Vercel.
# يجرّب الاتصال المباشر بـ Supabase pooler (قراءة select 1 فقط — صفر كتابة على بيانات المستخدمين).
# لا يطبع أي سر — يطبع حالة كل مرشح فقط، ويكتب الفائز إلى scripts/.dbpass (chmod 600).
import json, os, sys, socket
import psycopg2

HOST = "aws-0-eu-west-2.pooler.supabase.com"
USR = "postgres.ttydfyqwzkiwuvcgiegy"
DB = "postgres"
CAND_FILE = "/home/z/my-project/scripts/.dbpass_candidates.json"
WIN_FILE = "/home/z/my-project/scripts/.dbpass"

def classify(exc):
    msg = str(exc).strip()
    low = msg.lower()
    # استخراج الجزء المهم بعد FATAL إن وجد (رسائل psycopg2 بتكون طويلة)
    if "fatal" in low or "error" in low:
        for marker in ("FATAL:", "ERROR:"):
            if marker in msg:
                msg = msg.split(marker, 1)[1].strip()
                break
        low = msg.lower()
    if "password authentication failed" in low or ("role" in low and "does not exist" in low):
        return "AUTH_FAILED"
    if "timeout" in low or "timed out" in low or "connection refused" in low or \
       "network is unreachable" in low or "name or service not known" in low or "no address" in low:
        return "UNREACHABLE"
    if "ssl" in low:
        return "SSL_ERR"
    return "OTHER: " + msg[:100].replace("\n", " ")

def try_port(port):
    results = {}
    for i, pw in enumerate(cands):
        try:
            conn = psycopg2.connect(host=HOST, port=port, user=USR, password=pw,
                                    dbname=DB, sslmode="require", connect_timeout=10)
            cur = conn.cursor()
            cur.execute("select 1")
            cur.fetchone()
            cur.close()
            conn.close()
            results[i] = "AUTH_OK"
        except psycopg2.OperationalError as e:
            results[i] = classify(e)
        except Exception as e:
            results[i] = "OTHER: " + str(e)[:100].replace("\n", " ")
    return results

# tcp reachability سريع أولاً لتفريق الحجب عن الباسورد الغلط
def tcp_ok(port):
    try:
        s = socket.create_connection((HOST, port), timeout=8)
        s.close()
        return True
    except Exception:
        return False

cands = json.load(open(CAND_FILE))
print(f"candidates: {len(cands)} (المحتوى مش بيُطبع)")

winner = None
for port in (6543, 5432):
    if not tcp_ok(port):
        print(f"port {port}: TCP غير متاح من الـ sandbox — تخطي")
        continue
    print(f"port {port}: TCP مفتوح — جاري اختبار المصادقة...")
    res = try_port(port)
    for i, st in res.items():
        print(f"  candidate #{i+1}: {st}")
    if any(st == "AUTH_OK" for st in res.values()):
        winner = next(i for i, st in res.items() if st == "AUTH_OK")
        print(f"  -> الفائز على port {port}: candidate #{winner+1}")
        break

if winner is not None:
    with open(WIN_FILE, "w") as f:
        f.write(cands[winner])
    os.chmod(WIN_FILE, 0o600)
    print(f"WINNER=candidate#{winner+1} — متخزنة في scripts/.dbpass (chmod 600، مش بتُطبع)")
    sys.exit(0)
else:
    print("NO_WINNER — ولا مرشح مصادق عليه (أو الشبكة محجوبة). مفيش أي كتابة على Vercel.")
    sys.exit(2)
