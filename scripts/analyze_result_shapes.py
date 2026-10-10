#!/usr/bin/env python3
"""Analyze tool result formats to determine success/failure markers."""
import json

with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

data = batch['data']

# Collect results per call id
call_results = {}
for mid, m in data.items():
    if m.get('role') != 'assistant':
        continue
    for b in (m.get('content_blocks') or []):
        if isinstance(b, dict) and b.get('type') == 'tool_calls' and b.get('results'):
            results = b['results']
            if isinstance(results, list):
                for r in results:
                    if isinstance(r, dict) and r.get('tool_call_id'):
                        call_results[r['tool_call_id']] = r

print('Total results stored:', len(call_results))

# Sample Edit results - success and failure shapes
edit_results = []
for mid, m in data.items():
    if m.get('role') != 'assistant':
        continue
    for b in (m.get('content_blocks') or []):
        if not isinstance(b, dict) or b.get('type') != 'tool_calls':
            continue
        calls = b.get('content')
        calls = calls if isinstance(calls, list) else [calls]
        for c in calls:
            if not isinstance(c, dict):
                continue
            func = c.get('function') or {}
            name = func.get('name')
            if name in ('Edit', 'MultiEdit', 'Write'):
                cid = c.get('id')
                res = call_results.get(cid)
                if res:
                    content = res.get('content') or ''
                    edit_results.append((name, c, res, content))

print('Edit/Write results found:', len(edit_results))
# Show unique-ish result shapes
shapes = {}
for name, c, res, content in edit_results:
    # normalize: strip digits/paths
    import re
    norm = re.sub(r'/home/z/my-project/\S+', '<PATH>', content[:200])
    norm = re.sub(r'\d+', 'N', norm)
    key = (name, norm[:100])
    shapes.setdefault(key, (name, c, res, content))

for key, (name, c, res, content) in list(shapes.items())[:20]:
    print(f'\n--- {name} result shape ---')
    print(content[:250])
