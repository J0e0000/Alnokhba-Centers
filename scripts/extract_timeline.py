#!/usr/bin/env python3
"""Extract chronological tool-call log from the chat batch.
Save a full timeline JSON: every tool call in order with parsed arguments."""
import json
import os

with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

data = batch['data']
by_id = data

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

timeline = []  # sequential list of tool calls
msg_texts = []  # narrative text blocks

for mi, m in enumerate(ordered):
    blocks = m.get('content_blocks') or []
    for bi, b in enumerate(blocks):
        if not isinstance(b, dict):
            continue
        bt = b.get('type')
        if bt == 'text':
            content = b.get('content')
            txt = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
            if txt and txt.strip():
                msg_texts.append({'msg': mi, 'role': m.get('role'), 'text': txt[:2000]})
        elif bt == 'tool_calls':
            content = b.get('content')
            calls = content if isinstance(content, list) else [content]
            for c in calls:
                if not isinstance(c, dict):
                    continue
                func = c.get('function') or {}
                name = func.get('name') or c.get('name')
                args_raw = func.get('arguments')
                args = None
                if isinstance(args_raw, str):
                    try:
                        args = json.loads(args_raw)
                    except Exception:
                        args = {'_raw': args_raw}
                elif isinstance(args_raw, dict):
                    args = args_raw
                entry = {
                    'seq': len(timeline),
                    'msg': mi,
                    'role': m.get('role'),
                    'name': name,
                    'args': args,
                }
                # result summary if present
                results = b.get('results')
                if results:
                    entry['result_preview'] = str(results)[:500]
                timeline.append(entry)

os.makedirs('/home/z/my-project/reconstruct', exist_ok=True)
with open('/home/z/my-project/reconstruct/timeline.json', 'w', encoding='utf-8') as f:
    json.dump(timeline, f, ensure_ascii=False)
with open('/home/z/my-project/reconstruct/narratives.json', 'w', encoding='utf-8') as f:
    json.dump(msg_texts, f, ensure_ascii=False, indent=1)

print('Total tool calls:', len(timeline))
print('Text blocks:', len(msg_texts))

# Count by tool
from collections import Counter
counts = Counter(t['name'] for t in timeline)
for name, n in counts.most_common():
    print(f'  {name}: {n}')

# Write calls summary
writes = [t for t in timeline if t['name'] == 'Write']
print('\nWrite call filepaths (first 40):')
for w in writes[:40]:
    fp = (w['args'] or {}).get('filepath', '?')
    clen = len((w['args'] or {}).get('content', '') or '')
    print(f"  seq={w['seq']:5d} msg={w['msg']:3d} {clen:7d} chars  {fp}")
