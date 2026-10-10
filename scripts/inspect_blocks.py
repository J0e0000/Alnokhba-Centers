#!/usr/bin/env python3
"""Extract content_blocks from assistant messages - these contain the
actual implementation narrative, tool calls, and code."""
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

os.makedirs('/home/z/my-project/chat_extract', exist_ok=True)

block_types = {}
total_by_type = {}

for i, m in enumerate(ordered):
    blocks = m.get('content_blocks') or []
    role = m.get('role', '?')
    for b in blocks:
        bt = b.get('type', '?') if isinstance(b, dict) else '?'
        block_types[bt] = block_types.get(bt, 0) + 1
        size = len(json.dumps(b, ensure_ascii=False))
        total_by_type[bt] = total_by_type.get(bt, 0) + size

print('Block types across all messages:')
for bt, n in block_types.items():
    print(f"  {bt}: {n} blocks, {total_by_type[bt]/1024/1024:.2f} MB total")

# Look at one message's block structure
for m in ordered:
    if m.get('role') == 'assistant':
        blocks = m.get('content_blocks') or []
        print(f"\n=== First assistant message has {len(blocks)} blocks")
        for b in blocks[:15]:
            if isinstance(b, dict):
                keys = list(b.keys())
                preview = ''
                if b.get('type') == 'text':
                    preview = b.get('text', '')[:100]
                elif b.get('type') == 'tool_use':
                    preview = json.dumps({k: b.get(k) for k in ('name',) if k in b})[:100]
                print(f"  type={b.get('type')} keys={keys} :: {preview}")
        break
