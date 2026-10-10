#!/usr/bin/env python3
"""Replayer v6 — FINAL FIX:
- Track per-file op history (only applied ops)
- On runtime-OK but replay-fail: try snapshot recovery = snapshot content +
  replay file's ops after snapshot + current op. If that fails, RESTORE the
  pre-op state and poison (never leave corrupted state behind).
- Unpoison on subsequent full read.
- Literal-mode sed -i handling.
"""
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

read_snapshots = defaultdict(list)
for e in enriched:
    if e['name'] != 'Read':
        continue
    a = e['args']
    if 'offset' in a or 'limit' in a:
        continue
    fp = a.get('filepath')
    decoded = decode_read_content(call_results.get(e['call_id'], ''))
    if fp and decoded and decoded.strip():
        read_snapshots[fp].append((e['seq'], decoded))

print('Full-read snapshot files:', len(read_snapshots))

files = {}
file_ops = defaultdict(list)   # fp -> list of (seq, 'EDIT', edits) applied
poisoned = set()
manual_attention = set()
ops_log = []
sed_applied = 0

def apply_edits_to(content, edits):
    tmp = content
    for ed in edits:
        old = ed.get('old_str')
        if old is None:
            continue
        if old not in tmp:
            return False, None
        tmp = tmp.replace(old, ed.get('new_str', ''), 1)
    return True, tmp

def resolve(p):
    if not p:
        return p
    if p.startswith(MY_PREFIX) or p.startswith('/usr') or p.startswith('/tmp') or p.startswith('/etc'):
        return p
    return MY_PREFIX + p

def parse_sed_expressions(script):
    ops = []
    i, n = 0, len(script)
    while i < n:
        ch = script[i]
        if ch in ' ;':
            i += 1
            continue
        if ch == '/':
            j = script.find('/', i + 1)
            if j == -1:
                break
            pat = script[i + 1:j]
            rest = script[j + 1:]
            if rest.startswith('d'):
                ops.append(('d', pat))
                i = j + 2
                continue
            break
        if ch == 's':
            delim = script[i + 1] if i + 1 < n else None
            if delim not in ('/', '|', '#', ','):
                break
            parts, cur, j = [], [], i + 2
            while j < n and len(parts) < 3:
                c = script[j]
                if c == '\\' and j + 1 < n:
                    cur.append(c)
                    cur.append(script[j + 1])
                    j += 2
                    continue
                if c == delim:
                    parts.append(''.join(cur))
                    cur = []
                    j += 1
                    continue
                cur.append(c)
                j += 1
            if len(parts) == 3:
                ops.append(('s', delim, parts[0], parts[1], parts[2]))
                i = j
                continue
            break
        break
    return ops

def sed_apply(cmd):
    global sed_applied
    for seg in cmd.split('&&'):
        seg = seg.strip()
        m = re.match(r"sed\s+-i\s+(?:-E\s+)?['\"](.*?)['\"]\s*(.*)$", seg, re.DOTALL)
        if not m:
            continue
        script, rest = m.group(1), m.group(2)
        file_toks = []
        for tok in rest.split():
            t = tok.strip("'\"")
            if t.startswith('-') or t in ('rg', 'grep', 'bun', 'node', 'npx', 'curl'):
                break
            if '/' in t or t.endswith(('.tsx', '.ts', '.js', '.css', '.json', '.webmanifest', '.md', '.prisma')):
                file_toks.append(t)
        for op in parse_sed_expressions(script):
            if op[0] == 's':
                _, delim, old, new, flags = op
                if '\\' in old or '\\' in new or not old:
                    continue
                for ft in file_toks:
                    fp = resolve(ft)
                    if fp in files and old in files[fp]:
                        files[fp] = files[fp].replace(old, new) if 'g' in flags else files[fp].replace(old, new, 1)
                        sed_applied += 1
            elif op[0] == 'd':
                pat = op[1]
                if '\\' in pat:
                    continue
                for ft in file_toks:
                    fp = resolve(ft)
                    if fp in files:
                        lines = files[fp].split('\n')
                        files[fp] = '\n'.join(l for l in lines if pat not in l)
                        sed_applied += 1

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
            file_ops[fp].append((seq, 'SET', None))
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
        saved = files.get(fp)
        if fp in files:
            ok, newc = apply_edits_to(files[fp], edits)
            if ok:
                files[fp] = newc
                file_ops[fp].append((seq, 'EDITS', edits))
        if not ok:
            # snapshot recovery: snapshot + replay ops after it + current
            snaps = [s for s in read_snapshots.get(fp, []) if s[0] < seq]
            if snaps:
                snap_seq, snap_content = snaps[-1]
                content = snap_content
                ok_ops = True
                for s2, kind, payload in file_ops[fp]:
                    if s2 <= snap_seq:
                        continue
                    if kind == 'SET':
                        continue  # a write supersedes snapshot; stop here
                    elif kind == 'EDITS':
                        ok2, content = apply_edits_to(content, payload)
                        if not ok2:
                            ok_ops = False
                            break
                    elif kind == 'SED':
                        continue
                if ok_ops:
                    ok2, newc = apply_edits_to(content, edits)
                    if ok2:
                        files[fp] = newc
                        file_ops[fp].append((seq, 'EDITS', edits))
                        ok = True
                        ops_log.append((seq, name.upper() + '_SNAP_RECOVERED', fp, f'snap@{snap_seq}'))
            if not ok:
                if saved is not None:
                    files[fp] = saved          # RESTORE pre-op state!
                elif fp in files and saved is None:
                    del files[fp]
                poisoned.add(fp)
                manual_attention.add(fp)
                ops_log.append((seq, name.upper() + '_POISON', fp, ''))

    elif name == 'Read':
        a = args
        if 'offset' in a or 'limit' in a:
            continue
        fp = a.get('filepath')
        decoded = decode_read_content(call_results.get(e['call_id'], ''))
        if fp and decoded and decoded.strip() and len(decoded) > 100:
            if fp in poisoned:
                poisoned.discard(fp)
                file_ops[fp].append((seq, 'SET', None))
                ops_log.append((seq, 'UNPOISON_BY_READ', fp, ''))
            files[fp] = decoded
            file_ops[fp].append((seq, 'SET', None))

    elif name == 'Bash':
        cmd = args.get('command', '')
        if cmd and 'sed -i' in cmd:
            ran_ok = bool(res) and 'command not found' not in res[:100]
            if ran_ok:
                try:
                    sed_apply(cmd)
                except Exception:
                    pass

print('Replay v6 complete. Files:', len(files))
print(f'sed applied: {sed_applied}')
print('Still poisoned:', len(poisoned))
for fp in sorted(poisoned):
    print('  !!', fp)

with open(os.path.join(RECON_DIR, 'ops_log_v6.txt'), 'w') as f:
    for seq, op, fp, info in ops_log:
        f.write(f'{seq:6d} {op:22s} {fp}  {info}\n')

with open(os.path.join(RECON_DIR, 'file_state_v6.json'), 'w') as f:
    json.dump(files, f, ensure_ascii=False)

total = sum(len(c) for c in files.values())
print(f'Total size: {total/1024:.0f} KB')

print('\nKey file sizes:')
for k in ['/home/z/my-project/prisma/schema.prisma', '/home/z/my-project/src/components/nokhba/scan.tsx',
          '/home/z/my-project/src/components/nokhba/portal/portal.tsx', '/home/z/my-project/src/components/nokhba/shell.tsx',
          '/home/z/my-project/src/components/nokhba/teacher/teacher-portal.tsx', '/home/z/my-project/public/sw.js',
          '/home/z/my-project/src/components/nokhba/dashboard.tsx', '/home/z/my-project/src/components/nokhba/students.tsx']:
    print(f'  {len(files.get(k, "")):7d}  {k.split("my-project/")[-1]}')
