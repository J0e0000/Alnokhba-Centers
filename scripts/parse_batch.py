#!/usr/bin/env python3
"""Parse the full chat batch: extract all messages in order, save each
assistant message + user message, and identify any attached files."""
import json
import os

with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

data = batch['data']
print('Messages in batch:', len(data))

# Build ordered walk
by_id = {}
for mid, m in data.items():
    by_id[mid] = m

roots = [mid for mid, m in by_id.items() if not m.get('parentId')]
ordered = []
visited = set()

def walk(mid):
    if not mid or mid in visited or mid not in by_id:
        return
    visited.add(mid)
    ordered.append(by_id[mid])
    for c in by_id[mid].get('childrenIds', []) or []:
        walk(c)

for r in roots:
    walk(r)

print('Ordered messages:', len(ordered))

os.makedirs('/home/z/my-project/chat_extract', exist_ok=True)

summary = []
files_found = []
for i, m in enumerate(ordered):
    role = m.get('role', '?')
    content = m.get('content') or ''
    entry = {
        'idx': i,
        'id': m.get('id'),
        'role': role,
        'len': len(content),
        'files': [],
    }
    if m.get('files'):
        for fobj in m['files']:
            entry['files'].append({
                'name': fobj.get('name') or fobj.get('filename'),
                'url': fobj.get('url'),
                'size': fobj.get('size'),
            })
            files_found.append(fobj)
    # Save content
    if content:
        with open(f"/home/z/my-project/chat_extract/msg_{i:03d}_{role}.md", 'w', encoding='utf-8') as f:
            f.write(content)
    summary.append(entry)

with open('/home/z/my-project/chat_summary.json', 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=1, ensure_ascii=False)

print('Files found:', len(files_found))
for fobj in files_found:
    print('  -', fobj.get('name') or fobj.get('filename'), fobj.get('url', '')[:120])

# Print message flow overview
print('\n--- MESSAGE FLOW (role + length) ---')
for e in summary:
    files_str = ' [FILES: ' + ', '.join(f['name'] or '?' for f in e['files']) + ']' if e['files'] else ''
    print(f"{e['idx']:3d} {e['role']:9s} {e['len']:7d}{files_str}")
