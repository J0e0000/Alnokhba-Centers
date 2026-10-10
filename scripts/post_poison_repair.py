#!/usr/bin/env python3
"""Final repair: for each poisoned file, take v6 state (evolved up to poison)
and apply the runtime-successful ops that were skipped AFTER the poison point,
in runtime order, single pass. Restores the post-poison evolution."""
import json
import re
from collections import defaultdict

MY_PREFIX = '/home/z/my-project/'

files = json.load(open('/home/z/my-project/reconstruct/file_state_v6.json'))

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

# poison points from ops_log_v6
poison_at = {}
with open('/home/z/my-project/reconstruct/ops_log_v6.txt') as f:
    for line in f:
        m2 = re.match(r'\s*(\d+)\s+(\w+_POISON)\s+(\S+)', line)
        if m2:
            seq, op, fp = int(m2.group(1)), m2.group(2), m2.group(3)
            poison_at[fp] = min(poison_at.get(fp, 10**9), seq)

print('Poison points:', {k.split('my-project/')[-1]: v for k, v in poison_at.items()})

def apply_edits_to(content, edits):
    tmp = content
    for ed in edits:
        old = ed.get('old_str')
        if old is None or old not in tmp:
            return False, tmp
        tmp = tmp.replace(old, ed.get('new_str', ''), 1)
    return True, tmp

for fp, poison_seq in poison_at.items():
    if fp not in files:
        continue
    content = files[fp]
    applied = skipped = writes = 0
    for e in enriched:
        if e['seq'] <= poison_seq:
            continue
        if e['name'] not in ('Edit', 'MultiEdit', 'Write'):
            continue
        if (e['args'] or {}).get('filepath') != fp:
            continue
        res = call_results.get(e['call_id'], '')
        if e['name'] == 'Write':
            if 'File created successfully' in res or 'has been updated' in res or 'has been overwritten' in res:
                content = e['args'].get('content')
                writes += 1
                applied += 1
        else:
            if 'has been edited' in res:
                edits = (e['args'].get('edits') if e['name'] == 'MultiEdit' else None) or [
                    {'old_str': e['args'].get('old_str'), 'new_str': e['args'].get('new_str'),
                     'replace_all': e['args'].get('replace_all', False)}]
                ok, tmp = apply_edits_to(content, edits)
                if ok:
                    content = tmp
                    applied += 1
                else:
                    skipped += 1
    files[fp] = content
    print(f'{fp.split("my-project/")[-1]:50s} poison@{poison_seq:5d} +{applied}({writes}w) -{skipped} -> {len(content):6d}')

with open('/home/z/my-project/reconstruct/file_state_v8.json', 'w') as f:
    json.dump(files, f, ensure_ascii=False)
print('\nSaved file_state_v8.json')
