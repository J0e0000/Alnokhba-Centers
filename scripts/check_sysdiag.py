# check_sysdiag.py — يفحص استجابة /api/sysdiag من الإنتاج:
# 1) هل custom.db لسه جوّه /var/task بتاع الـ lambda؟ (المفروض اختفت بعد الدمج)
# 2) أي مفاتيح مفيدة: dbMode / dbRegion / dbPing / sha
# لا يطبع أي أسرار — أسماء مفاتيح ونتائج فحص فقط.
import json, sys

p = 'scripts/vc-probe/sysdiag.json'
try:
    d = json.load(open(p))
except Exception as e:
    print('sysdiag parse failed:', e)
    sys.exit(1)

def walk(o, path=''):
    hits = []
    if isinstance(o, dict):
        for k, v in o.items():
            hits += walk(v, path + '/' + str(k))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            hits += walk(v, f'{path}[{i}]')
    elif isinstance(o, str):
        if 'custom.db' in o or '/var/task' in o:
            hits.append((path, o[:140]))
    return hits

print('top keys:', list(d.keys()) if isinstance(d, dict) else type(d))
hits = walk(d)
print('custom.db//var-task mentions:', len(hits))
for pth, s in hits[:15]:
    print('  ', pth, '=>', s)

if isinstance(d, dict):
    for kk, vv in d.items():
        lk = str(kk).lower()
        if any(t in lk for t in ('dbmode', 'mode', 'dbregion', 'region', 'dbping', 'sha', 'commit', 'deployment', 'build')):
            print(f'{kk}: {str(vv)[:120]}')
