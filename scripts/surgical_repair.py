#!/usr/bin/env python3
"""Surgical repair: for each poisoned file, replay ALL its runtime-successful
edits (from the whole timeline) against the current state, applying any that
fit (later retries often subsume earlier gaps). Idempotent-ish repair pass."""
import json
import re
from collections import defaultdict

MY_PREFIX = '/home/z/my-project/'

with open('/home/z/my-project/reconstruct/file_state_v6.json') as f:
    files = json.load(f)

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

# For each poisoned file: collect ALL successful edit ops in order, then run a
# multi-pass application loop (later ops may become applicable after earlier ones)
for fp in manual:
    ops = []
    for e in enriched:
        if e['name'] not in ('Edit', 'MultiEdit', 'Write'):
            continue
        if (e['args'] or {}).get('filepath') != fp:
            continue
        res = call_results.get(e['call_id'], '')
        if e['name'] == 'Write':
            if 'File created successfully' in res or 'has been updated' in res:
                ops.append(('WRITE', e['args'].get('content'), e['seq']))
        else:
            if 'has been edited' in res:
                edits = (e['args'].get('edits') if e['name'] == 'MultiEdit' else None) or [
                    {'old_str': e['args'].get('old_str'), 'new_str': e['args'].get('new_str'),
                     'replace_all': e['args'].get('replace_all', False)}]
                ops.append(('EDITS', edits, e['seq']))

    if fp not in files:
        continue
    content = files[fp]
    total_applied = 0
    for _pass in range(4):  # multi-pass to resolve dependencies
        applied_this_pass = 0
        for kind, payload, seq in ops:
            if kind == 'WRITE':
                if payload and len(payload) > len(content) * 0.8:
                    # only take a full write if substantially bigger (avoid stale overwrites)
                    continue
            else:
                tmp = content
                fits = True
                for ed in payload:
                    old = ed.get('old_str')
                    if old is None or old not in tmp:
                        fits = False
                        break
                    tmp = tmp.replace(old, ed.get('new_str', ''), 1)
                if not fits:
                    continue
                content = tmp
                applied_this_pass += 1
                total_applied += 1
        if applied_this_pass == 0:
            break
    files[fp] = content
    print(f'{fp.split("my-project/")[-1]:55s} +{total_applied} late edits -> {len(content)} chars')

with open('/home/z/my-project/reconstruct/file_state_v7.json', 'w') as f:
    json.dump(files, f, ensure_ascii=False)
print('\nSaved file_state_v7.json')
