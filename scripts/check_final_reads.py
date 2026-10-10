#!/usr/bin/env python3
"""For each poisoned file: compare last mutation seq vs last read seq.
If last read > last mutation, the read snapshot IS the final state."""
import json
import re
from collections import defaultdict

with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

call_results = {}
for mid, m in batch['data'].items():
    if m.get('role') != 'assistant':
        continue
    for b in (m.get('content_blocks') or []):
        if isinstance(b, dict) and b.get('type') == 'tool_calls' and b.get('results'):
            for r in (b['results'] if isinstance(b['results'], list) else []):
                if isinstance(r, dict) and r.get('tool_call_id'):
                    call_results[r['tool_call_id']] = r.get('content') or ''

data = batch['data']
roots = [mid for mid, m in data.items() if not m.get('parentId')]
ordered, visited = [], set()

def walk(mid):
    if not mid or mid in visited or mid not in data:
        return
    visited.add(mid)
    ordered.append(data[mid])
    for c in data[mid].get('childrenIds', []) or []:
        walk(c)

for r in roots:
    walk(r)

enriched = []
for mi, m in enumerate(ordered):
    for b in (m.get('content_blocks') or []):
        if not isinstance(b, dict) or b.get('type') != 'tool_calls':
            continue
        content = b.get('content')
        calls = content if isinstance(content, list) else [content]
        for c in calls:
            if not isinstance(c, dict):
                continue
            func = c.get('function') or {}
            args_raw = func.get('arguments')
            if isinstance(args_raw, str):
                try:
                    args = json.loads(args_raw)
                except Exception:
                    args = {}
            else:
                args = args_raw or {}
            enriched.append({'seq': len(enriched), 'call_id': c.get('id'),
                             'name': func.get('name') or c.get('name'), 'args': args})

manual = json.load(open('/home/z/my-project/reconstruct/manual_attention.json'))

def decode(raw):
    if not raw or raw.startswith('<persisted-output>'):
        return None
    if 'Output too large' in raw[:200]:
        return None
    if '\u2192' in raw:
        lines = raw.split('\n')
        cleaned = []
        for ln in lines:
            m2 = re.match(r'^\s*(\d+)\u2192(.*)$', ln)
            if m2:
                cleaned.append(m2.group(2))
            elif ln.strip() == '':
                cleaned.append('')
            else:
                cleaned.append(ln)
        raw = '\n'.join(cleaned)
    return raw

for fp in manual:
    ops = [(e['seq'], e['name']) for e in enriched if (e['args'] or {}).get('filepath') == fp]
    reads = [(e['seq'], decode(call_results.get(e['call_id'], ''))) for e in enriched
             if e['name'] == 'Read' and (e['args'] or {}).get('filepath') == fp]
    reads = [(s, c) for s, c in reads if c and c.strip()]
    last_op = ops[-1][0] if ops else 0
    last_read = reads[-1][0] if reads else -1
    last_read_len = len(reads[-1][1]) if reads else 0
    status = 'READ_IS_FINAL' if last_read >= last_op else 'read-stale'
    print(f"{fp.split('my-project/')[-1]:55s} last_op={last_op:5d} last_read={last_read:5d} readlen={last_read_len:7d} {status}")
