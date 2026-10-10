#!/usr/bin/env python3
"""Repair poisoned files: rebuild from latest read snapshot + apply subsequent
runtime-successful edits in order. Produces file_state_final.json."""
import json
import re
from collections import defaultdict

MY_PREFIX = '/home/z/my-project/'
RECON = '/home/z/my-project/reconstruct'

with open(f'{RECON}/file_state_v2.json') as f:
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

manual = json.load(open(f'{RECON}/manual_attention.json'))

for fp in manual:
    # collect ops for this file
    file_ops = []
    for e in enriched:
        if (e['args'] or {}).get('filepath') != fp:
            continue
        res = call_results.get(e['call_id'], '')
        if e['name'] == 'Write':
            ok = 'File created successfully' in res or 'has been updated' in res
            file_ops.append((e['seq'], 'WRITE', e['args'].get('content'), ok))
        elif e['name'] == 'Edit':
            ok = 'has been edited' in res
            file_ops.append((e['seq'], 'EDIT',
                             (e['args'].get('old_str'), e['args'].get('new_str'), e['args'].get('replace_all', False)), ok))
        elif e['name'] == 'MultiEdit':
            ok = 'has been edited' in res
            file_ops.append((e['seq'], 'MULTIEDIT', e['args'].get('edits') or [], ok))
        elif e['name'] == 'Read':
            decoded = decode(res)
            if decoded and decoded.strip() and len(decoded) > 200:
                file_ops.append((e['seq'], 'READ', decoded, True))

    reads = [(s, c) for s, op, c, ok in file_ops if op == 'READ']
    if not reads:
        print(f'!! {fp}: no reads at all, keeping v2 state')
        continue
    last_read_seq, last_read_content = reads[-1]
    content = last_read_content
    applied = skipped = 0
    for s, op, payload, ok in file_ops:
        if s <= last_read_seq or not ok:
            continue
        if op == 'WRITE':
            content = payload
            applied += 1
        elif op == 'EDIT':
            old, new, ra = payload
            if old is not None and old in content:
                content = content.replace(old, new) if ra else content.replace(old, new, 1)
                applied += 1
            else:
                skipped += 1
        elif op == 'MULTIEDIT':
            ok_all = True
            tmp = content
            for ed in payload:
                old = ed.get('old_str')
                if old is None:
                    continue
                if old not in tmp:
                    ok_all = False
                    break
                tmp = tmp.replace(old, ed.get('new_str', ''), 1)
            if ok_all:
                content = tmp
                applied += 1
            else:
                skipped += 1
    files[fp] = content
    print(f'{fp.split("my-project/")[-1]:55s} baseline={len(last_read_content):7d} applied={applied:3d} skipped={skipped:2d} final={len(content):7d}')

with open(f'{RECON}/file_state_final.json', 'w') as f:
    json.dump(files, f, ensure_ascii=False)

total = sum(len(c) for c in files.values())
print(f'\nFinal total: {total/1024:.0f} KB across {len(files)} files')
