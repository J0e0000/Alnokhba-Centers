#!/usr/bin/env python3
"""Debug scan.tsx poisoning: show ops 1940-2700 with results."""
import json
import re

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

for e in enriched:
    if 1940 <= e['seq'] <= 1960 or 2680 <= e['seq'] <= 2695:
        fp = (e['args'] or {}).get('filepath', '')
        if 'scan' not in fp and e['name'] != 'Bash':
            continue
        res = call_results.get(e['call_id'], '')
        print(f"seq={e['seq']} {e['name']} {fp.split('/')[-1] if fp else ''}")
        if e['name'] in ('Edit', 'MultiEdit'):
            print('  result:', res[:200].replace(chr(10), ' | '))
        if e['name'] == 'Bash':
            print('  cmd:', (e['args'] or {}).get('command', '')[:150])
        print()
