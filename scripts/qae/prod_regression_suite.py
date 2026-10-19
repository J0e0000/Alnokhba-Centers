#!/usr/bin/env python3
# تحقق إنتاج سريع — emergency + auth + APIs
import subprocess, json, sys

BASE = "https://alnokhba-centers-nine.vercel.app"
def curl(args, timeout=60):
    r = subprocess.run(["curl", "-s"] + args, capture_output=True, text=True, timeout=timeout)
    return r

ok = []
def check(name, cond, extra=""):
    ok.append((name, cond))
    print(f"{'✅' if cond else '❌'} {name} {extra}")

# login manager
r = curl(["-c", "/tmp/mck.txt", "-X", "POST", f"{BASE}/api/auth", "-H", "Content-Type: application/json",
          "-d", json.dumps({"action": "login", "username": "qae-mgr-99", "password": "Qae#2026"})])
check("0.login-manager", '"user"' in r.stdout)

# 1. history GET + no-store
r = curl(["-b", "/tmp/mck.txt", "-D", "-", f"{BASE}/api/emergency", "-o", "/dev/null"])
check("1.history+no-store", " 200" in r.stderr or "200" in (r.stderr or "") or "no-store" in r.stdout.lower() and "404" not in r.stdout)
h = subprocess.run(["curl", "-s", "-b", "/tmp/mck.txt", "-D", "-", f"{BASE}/api/emergency", "-o", "/dev/null"], capture_output=True, text=True)
check("1b.cache-control-no-store", "no-store" in h.stdout.lower())

# 2. package=1 → HTML attachment
p = subprocess.run(["curl", "-s", "-b", "/tmp/mck.txt", f"{BASE}/api/emergency?package=1&cb=123", "-o", "/tmp/p1.html", "-D", "-", "-w", "%{http_code}"], capture_output=True, text=True)
code = p.stdout.strip().split("\n")[-1]
check("2.package=1-200", code == "200")
check("3.attachment-header", "attachment" in p.stdout.lower())
import os
check("4.package-size-large", os.path.getsize("/tmp/p1.html") > 1_000_000, f"{os.path.getsize('/tmp/p1.html')} bytes")
body = open("/tmp/p1.html", encoding="utf-8", errors="ignore").read()
check("5.signed-license", '"keyFp"' in body and "signature" in body)

# 6. xlsx export
p = subprocess.run(["curl", "-s", "-b", "/tmp/mck.txt", f"{BASE}/api/emergency?export=1&format=xlsx&cb=123", "-o", "/tmp/p2.xlsx", "-w", "%{http_code}"], capture_output=True, text=True)
check("6.export-xlsx-200", p.stdout.strip() == "200")
magic = open("/tmp/p2.xlsx", "rb").read(2)
check("7.xlsx-PK-magic", magic == b"PK")

# 7. receptionist blocked (requireManager)
curl(["-c", "/tmp/rck.txt", "-X", "POST", f"{BASE}/api/auth", "-H", "Content-Type: application/json",
      "-d", json.dumps({"action": "login", "username": "qae-recl-99", "password": "Qae#2026"})])
p = subprocess.run(["curl", "-s", "-b", "/tmp/rck.txt", "-o", "/dev/null", "-w", "%{http_code}", f"{BASE}/api/emergency?package=1"], capture_output=True, text=True)
check("8.receptionist-403", p.stdout.strip() == "403", p.stdout)

# 8. teachers API + students (core APIs)
p = subprocess.run(["curl", "-s", "-b", "/tmp/mck.txt", "-o", "/dev/null", "-w", "%{http_code}", f"{BASE}/api/teachers"], capture_output=True, text=True)
check("9.teachers-200", p.stdout.strip() == "200")

n_fail = sum(1 for _, c in ok if not c)
print(f"\n=== {len(ok)-n_fail}/{len(ok)} passed ===")
sys.exit(1 if n_fail else 0)
