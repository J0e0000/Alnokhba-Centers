#!/usr/bin/env python3
# save_and_probe_prod_db.py — حفظ باسورد قاعدة الإنتاج + اختبار الاتصال (قراءة فقط)
# ⚠️ الأمان: الباسورد مش متخزن هنا — بيُقرأ من scripts/.dbpass (gitignored، chmod 600)
# مفيش أي بيانات سرية مسموح تتحفظ في ملفات المشروع المتتبعة في git
import os, stat, json

_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".dbpass")
if not os.path.exists(_path):
    raise SystemExit("❌ scripts/.dbpass مش موجود — حط باسورد قاعدة الإنتاج فيه الأول (سطر واحد)")
PWD = open(_path).read().strip()
REF = "ttydfyqwzkwivucgiegy"
POOLER = "aws-0-eu-west-2.pooler.supabase.com"
DIRECT = f"db.{REF}.supabase.co"

# 1) حفظ الباسورد — scripts/.dbpass بصلاحيات 600 (نفس مكان سكريبتات التدقيق القديمة)
path = "/home/z/my-project/scripts/.dbpass"
with open(path, "w") as f:
    f.write(PWD + "\n")
os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 600
print(f".dbpass saved ({os.path.getsize(path)} bytes, chmod 600)")

# تأكيد إنه مش هيتحفظ في git
gi = "/home/z/my-project/.gitignore"
gi_content = open(gi).read() if os.path.exists(gi) else ""
if ".dbpass" not in gi_content:
    with open(gi, "a") as f:
        f.write("\nscripts/.dbpass\nscripts/.dbpass_candidates.json\n")
    print(".gitignore: added .dbpass rules")
else:
    print(".gitignore: .dbpass already ignored")

# 2) اختبار الاتصال — 3 محاولات (قراءة فقط: select 1 + عدّ الجداول)
import psycopg2
attempts = [
    ("direct 5432",   DIRECT,  5432, "postgres"),
    ("pooler 5432",   POOLER,  5432, f"postgres.{REF}"),
    ("pooler 6543",   POOLER,  6543, f"postgres.{REF}"),
]
winner = None
for name, host, port, user in attempts:
    try:
        conn = psycopg2.connect(host=host, port=port, user=user, password=PWD,
                                dbname="postgres", sslmode="require", connect_timeout=12)
        cur = conn.cursor()
        cur.execute("select 1")
        # عدّ الجداول في schema public (قراءة فقط)
        cur.execute("select count(*) from information_schema.tables where table_schema='public'")
        tables = cur.fetchone()[0]
        # السنترات الموجودة (قراءة فقط)
        centers = []
        try:
            cur.execute("select slug, (select count(*) from \"Student\" s where s.\"centerId\"=c.id) from \"Center\" c")
            centers = cur.fetchall()
        except Exception as e:
            centers = f"(Center read: {str(e)[:80]})"
        print(f"✓ {name}: CONNECTED | public tables={tables} | centers={centers}")
        winner = (name, host, port, user)
        conn.close()
    except Exception as e:
        msg = str(e).strip().replace("\n", " ")[:110]
        print(f"✗ {name}: {msg}")

print("\nWINNER:", json.dumps(winner))
