#!/usr/bin/env python3
"""Replayer v4 (FINAL): v2 logic but ONLY full-file reads (no offset/limit) are
used for recovery snapshots. This is the definitive reconstruction."""
import json
import os
import re
from collections import defaultdict

RECON_DIR = '/home/z/my-project/reconstruct'
MY_PREFIX = '/home/z/my-project/'

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
            enriched.append({'seq': len(enriched), 'msg': mi, 'call_id': c.get('id'),
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
            m = re.match(r'^\s*(\d+)\u2192(.*)$', ln)
            if m:
                cleaned.append(m.group(2))
            elif ln.strip() == '':
                cleaned.append('')
            else:
                cleaned.append(ln)
        raw = '\n'.join(cleaned)
    return raw

# FULL reads only (no offset/limit args)
read_snapshots = defaultdict(list)
for e in enriched:
    if e['name'] != 'Read':
        continue
    args = e['args']
    if 'offset' in args or 'limit' in args:
        continue
    fp = args.get('filepath')
    decoded = decode_read_content(call_results.get(e['call_id'], ''))
    if fp and decoded and decoded.strip():
        read_snapshots[fp].append((e['seq'], decoded))

print('Full-read snapshot files:', len(read_snapshots))

files = {}
poisoned = set()
manual_attention = set()
ops_log = []

def apply_edits(fp, edits):
    """Try applying edits list. Returns (ok, result)."""
    tmp = files[fp]
    for ed in edits:
        old = ed.get('old_str')
        if old is None:
            continue
        if old not in tmp:
            return False, None
        tmp = tmp.replace(old, ed.get('new_str', ''), 1)
    return True, tmp

for e in enriched:
    seq = e['seq']
    name = e['name']
    args = e['args']
    res = call_results.get(e['call_id'], '')

    if name == 'Write':
        fp = args.get('filepath')
        content = args.get('content')
        if not fp or content is None:
            continue
        if 'File created successfully' in res or 'has been updated' in res or 'has been overwritten' in res:
            files[fp] = content
            poisoned.discard(fp)
            ops_log.append((seq, 'WRITE_OK', fp, ''))
        else:
            ops_log.append((seq, 'WRITE_FAIL', fp, res[:50]))

    elif name in ('Edit', 'MultiEdit'):
        fp = args.get('filepath')
        if name == 'MultiEdit':
            edits = args.get('edits') or []
        else:
            edits = [{'old_str': args.get('old_str'), 'new_str': args.get('new_str'),
                      'replace_all': args.get('replace_all', False)}]
        if not fp or not edits:
            continue
        runtime_ok = 'has been edited' in res
        if not runtime_ok:
            ops_log.append((seq, name.upper() + '_FAIL_SKIP', fp, ''))
            continue
        if fp in poisoned:
            ops_log.append((seq, name.upper() + '_POISON_SKIP', fp, ''))
            continue
        ok = False
        if fp in files:
            ok, newc = apply_edits(fp, edits)
            if ok:
                files[fp] = newc
        if not ok:
            # recover from latest FULL read snapshot
            snaps = read_snapshots.get(fp) or []
            best = None
            for s2, content in snaps:
                if s2 < seq:
                    best = (s2, content)
            if best is not None:
                files[fp] = best[1]
                ok, newc = apply_edits(fp, edits)
                if ok:
                    files[fp] = newc
                    ops_log.append((seq, name.upper() + '_RECOVERED', fp, f'snap@{best[0]}'))
            if not ok:
                poisoned.add(fp)
                manual_attention.add(fp)
                ops_log.append((seq, name.upper() + '_POISON', fp, ''))

    elif name == 'Read':
        args2 = args
        if 'offset' in args2 or 'limit' in args2:
            continue
        fp = args2.get('filepath')
        decoded = decode_read_content(call_results.get(e['call_id'], ''))
        if fp and decoded and decoded.strip() and len(decoded) > 100:
            if fp in poisoned:
                poisoned.discard(fp)
                ops_log.append((seq, 'UNPOISON_BY_READ', fp, ''))
            files[fp] = decoded

print('Replay v4 complete. Files:', len(files))
print('Still poisoned:', len(poisoned))
for fp in sorted(poisoned):
    print('  !!', fp)

with open(os.path.join(RECON_DIR, 'ops_log_v4.txt'), 'w') as f:
    for seq, op, fp, info in ops_log:
        f.write(f'{seq:6d} {op:22s} {fp}  {info}\n')

with open(os.path.join(RECON_DIR, 'file_state_v4.json'), 'w') as f:
    json.dump(files, f, ensure_ascii=False)

total = sum(len(c) for c in files.values())
print(f'Total size: {total/1024:.0f} KB')

# sanity check key file sizes
print('\nKey file sizes:')
for k in ['/home/z/my-project/prisma/schema.prisma', '/home/z/my-project/src/components/nokhba/scan.tsx',
          '/home/z/my-project/src/components/nokhba/portal/portal.tsx', '/home/z/my-project/src/components/nokhba/shell.tsx',
          '/home/z/my-project/src/components/nokhba/teacher/teacher-portal.tsx', '/home/z/my-project/public/sw.js',
          '/home/z/my-project/src/app/api/dashboard/route.ts', '/home/z/my-project/prisma/seed.ts',
          '/home/z/my-project/src/components/nokhba/dashboard.tsx']:
    print(f'  {len(files.get(k, "")):7d}  {k.split("my-project/")[-1]}')
