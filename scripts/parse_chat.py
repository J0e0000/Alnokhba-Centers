import json, re

raw = open('/home/z/my-project/chatdata/share_raw.txt', 'r', encoding='utf-8').read().strip()
# The eval output is a JSON-quoted string; unwrap it
if raw.startswith('"'):
    raw = json.loads(raw)
data = json.loads(raw)

msgs = data['chat']['history']['messages']
print(f"Total messages: {len(msgs)}")
out = []
for mid, m in msgs.items():
    role = m.get('role')
    ts = m.get('timestamp')
    content = m.get('content', '')
    files = m.get('files', [])
    out.append({
        'id': mid,
        'role': role,
        'ts': ts,
        'files': files,
        'content': content
    })

out.sort(key=lambda x: x['ts'] or 0)
with open('/home/z/my-project/chatdata/messages.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

for i, m in enumerate(out):
    c = m['content'] or ''
    fnames = [f.get('name', '?') for f in m['files']]
    print(f"--- [{i}] {m['role']} ts={m['ts']} len={len(c)} files={fnames}")
    print(c[:300].replace('\n', ' | '))
    print()
