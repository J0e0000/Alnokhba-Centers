#!/usr/bin/env python3
"""Lineage repair: rebuild each poisoned file from its LATEST full-file read
snapshot, then apply the runtime-successful ops that came after that snapshot
IN ORDER (they ran on exactly that lineage). Skips ops that don't fit (gaps
from sed/patch scripts) with logging."""
import json
import re
from collections import defaultdict

MY_PREFIX = '/home/z/my-project/'

v6 = json.load(open('/home/z/my-project/reconstruct/file_state_v6.json'))
files = dict(v6)

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

def decode_read_content(raw):
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

# Full reads per file
full_reads = defaultdict(list)
for e in enriched:
    if e['name'] != 'Read':
        continue
    a = e['args']
    if 'offset' in a or 'limit' in a:
        continue
    fp = a.get('filepath')
    decoded = decode_read_content(call_results.get(e['call_id'], ''))
    if fp and decoded and decoded.strip() and len(decoded) > 200:
        full_reads[fp].append((e['seq'], decoded))

manual = json.load(open('/home/z/my-project/reconstruct/manual_attention.json'))

def apply_edits_to(content, edits):
    tmp = content
    for ed in edits:
        old = ed.get('old_str')
        if old is None or old not in tmp:
            return False, tmp
        tmp = tmp.replace(old, ed.get('new_str', ''), 1)
    return True, tmp

for fp in manual:
    ops = []  # successful ops in order
    for e in enriched:
        if e['name'] not in ('Edit', 'MultiEdit', 'Write'):
            continue
        if (e['args'] or {}).get('filepath') != fp:
            continue
        res = call_results.get(e['call_id'], '')
        if e['name'] == 'Write':
            if 'File created successfully' in res or 'has been updated' in res or 'has been overwritten' in res:
                ops.append(('WRITE', e['args'].get('content'), e['seq']))
        else:
            if 'has been edited' in res:
                edits = (e['args'].get('edits') if e['name'] == 'MultiEdit' else None) or [
                    {'old_str': e['args'].get('old_str'), 'new_str': e['args'].get('new_str'),
                     'replace_all': e['args'].get('replace_all', False)}]
                ops.append(('EDITS', edits, e['seq']))

    snaps = full_reads.get(fp) or []
    v6_len = len(files.get(fp, ''))

    if snaps:
        snap_seq, snap_content = snaps[-1]
        # ops AFTER the snapshot in runtime order
        content = snap_content
        applied = skipped = writes = 0
        for kind, payload, seq in ops:
            if seq <= snap_seq:
                continue
            if kind == 'WRITE':
                content = payload
                writes += 1
                applied += 1
                continue
            ok, tmp = apply_edits_to(content, payload)
            if ok:
                content = tmp
                applied += 1
            else:
                skipped += 1
        # choose the better state: lineage vs v6
        pick = content if len(content) > v6_len * 0.9 else files[fp]
        reason = 'lineage' if pick is content else 'kept-v6'
        files[fp] = pick
        print(f'{fp.split("my-project/")[-1]:50s} snap@{snap_seq:5d} base={len(snap_content):6d} +{applied}({writes}w) -{skipped} -> {len(pick):6d} [{reason}]')
    else:
        print(f'{fp.split("my-project/")[-1]:50s} NO FULL READS, kept v6 ({v6_len})')

with open('/home/z/my-project/reconstruct/file_state_v8.json', 'w') as f:
    json.dump(files, f, ensure_ascii=False)
print('\nSaved file_state_v8.json')
