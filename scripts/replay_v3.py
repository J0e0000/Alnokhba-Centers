#!/usr/bin/env python3
"""Replayer v3: adds sed -i / python-rewrite parsing + forward snapshot recovery.

On a giveup (runtime-OK but replay-fail), the file is 'poisoned' until the next
Read snapshot of that file, which resets its state and un-poisons it.
"""
import json
import os
import re
from collections import defaultdict

RECON_DIR = '/home/z/my-project/reconstruct'
MY_PREFIX = '/home/z/my-project/'

with open('/home/z/my-project/reconstruct/timeline.json') as f:
    timeline_old = json.load(f)
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

# ---------------- Read snapshots ----------------
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
    fp = e['args'].get('filepath')
    decoded = decode_read_content(call_results.get(e['call_id'], ''))
    if fp and decoded and decoded.strip():
        read_snapshots[fp].append((e['seq'], decoded))

print('Read snapshot files:', len(read_snapshots))

# ---------------- Replay state ----------------
files = {}
poisoned = set()
poison_history = []
manual_attention = set()
ops_log = []

def resolve(p):
    if p.startswith(MY_PREFIX):
        return p
    if p.startswith('node_modules') or p.startswith('.next'):
        return MY_PREFIX + p
    if p.startswith('/'):
        return p
    return MY_PREFIX + p

def sed_apply(cmd, seq):
    """Apply sed -i expressions to files in memory."""
    # split sed script from file args: sed -i 'script' file1 file2
    # handle multiple sed -i chained with &&
    parts = re.split(r'&&', cmd)
    for part in parts:
        part = part.strip()
        m = re.search(r"sed\s+-i\s+(?:-E\s+)?['\"](.*?)['\"]\s+(.*)$", part, re.DOTALL)
        if not m:
            continue
        script, rest = m.group(1), m.group(2)
        # file list = tokens not starting with - and not part of another command
        file_toks = []
        for tok in rest.split():
            if tok.startswith('-') or tok.startswith('&') or tok == 'rg' or tok == 'grep':
                break
            if '/' in tok or tok.endswith('.tsx') or tok.endswith('.ts') or tok.endswith('.js') or tok.endswith('.css') or tok.endswith('.json') or tok.endswith('.webmanifest'):
                file_toks.append(tok)
        if script.startswith('/'):
            # delete pattern: /pattern/d
            dm = re.match(r"/(.*?)/d$", script)
            if dm:
                pat = re.compile(dm.group(1))
                for ft in file_toks:
                    fp = resolve(ft)
                    if fp in files:
                        lines = files[fp].split('\n')
                        files[fp] = '\n'.join(l for l in lines if not pat.search(l))
            continue
        # substitute: [range]s<delim>old<delim>new<delim>flags
        sm = re.match(r"(?:(\d+)(?:,(\d+))?s)?(.)(.*?)\2(.*?)\2([gGI]*)$", script, re.DOTALL)
        if not sm:
            continue
        lstart, lend, delim, old, new, flags = sm.group(1), sm.group(2), sm.group(3), sm.group(4), sm.group(5), sm.group(6) or ''
        # unescape sed escapes for literal-ish matching: try literal first then regex
        old_lit = old.replace('\\/', '/').replace('\\|', '|').replace('\\\\', '\\')
        new_lit = new.replace('\\/', '/').replace('\\|', '|').replace('&', '\\g<0>')
        for ft in file_toks:
            fp = resolve(ft)
            if fp not in files:
                continue
            content = files[fp]
            try:
                if lstart:
                    # line-targeted substitution
                    lines = content.split('\n')
                    a = int(lstart) - 1
                    b = int(lend) - 1 if lend else a
                    for i in range(a, min(b, len(lines) - 1) + 1):
                        if old_lit in lines[i]:
                            lines[i] = lines[i].replace(old_lit, new_lit.replace('\\g<0>', old_lit))
                    files[fp] = '\n'.join(lines)
                    continue
                pat = re.compile(re.escape(old_lit))
                if 'g' in flags:
                    files[fp] = pat.sub(new_lit.replace('\\g<0>', lambda mm: old_lit) if False else new_lit.replace('\\g<0>', old_lit), content)
                else:
                    m2 = pat.search(content)
                    if m2:
                        files[fp] = content[:m2.start()] + new_lit.replace('\\g<0>', old_lit) + content[m2.end():]
            except Exception:
                pass

def python_apply(cmd, seq):
    """Apply python3 -c inline file rewrites using .replace chains."""
    # find patterns: s=open(p).read() ... s=s.replace(A,B) ... open(p,'w').write(s)
    m = re.search(r"p\s*=\s*['\"]([^'\"]+)['\"]", cmd)
    if not m:
        return
    fp = resolve(m.group(1))
    if fp not in files:
        return
    content = files[fp]
    # extract .replace('old', 'new') pairs applied to the buffer var
    for rm in re.finditer(r"(\w+)\s*=\s*\1\.replace\((.*?),\s*(.*?)\)\n", cmd, re.DOTALL):
        a = rm.group(2).strip()
        b = rm.group(3).strip()
        def unquote(x):
            x = x.strip()
            if x and x[0] in "'\"" and x[-1] == x[0]:
                try:
                    return json.loads('"'.join([x[0]]) + x[1:-1] + x[-1]) if False else eval(x)
                except Exception:
                    return x[1:-1]
            return None
        va = unquote(a)
        vb = b
        if vb and vb[0] in "'\"" and vb[-1] == vb[0]:
            vb = unquote(b)
        else:
            vb = None  # skip complex exprs
        if va is not None and vb is not None:
            content = content.replace(va, vb)
    files[fp] = content

for e in enriched:
    seq = e['seq']
    name = e['name']
    args = e['args']
    res = call_results.get(e['call_id'], '')

    if name == 'Write':
        fp = resolve(args.get('filepath') or '')
        content = args.get('content')
        if not fp or content is None:
            continue
        if 'File created successfully' in res or 'has been updated' in res or 'has been overwritten' in res:
            files[fp] = content
            poisoned.discard(fp)
            ops_log.append((seq, 'WRITE_OK', fp, ''))
        else:
            ops_log.append((seq, 'WRITE_FAIL', fp, res[:60]))

    elif name in ('Edit', 'MultiEdit'):
        fp = resolve(args.get('filepath') or '')
        if name == 'MultiEdit':
            edits = args.get('edits') or []
        else:
            edits = [{'old_str': args.get('old_str'), 'new_str': args.get('new_str'), 'replace_all': args.get('replace_all', False)}]
        if not fp or not edits:
            continue
        runtime_ok = 'has been edited' in res
        if not runtime_ok:
            ops_log.append((seq, name.upper() + '_FAIL_SKIP', fp, res[:50]))
            continue
        if fp in poisoned:
            ops_log.append((seq, name.upper() + '_POISON_SKIP', fp, ''))
            continue
        applied, missing = True, -1
        if fp in files:
            tmp = files[fp]
            for i, ed in enumerate(edits):
                old = ed.get('old_str')
                if old is None:
                    continue
                if old not in tmp:
                    applied, missing = False, i
                    break
                tmp = tmp.replace(old, ed.get('new_str', ''), 1)
        else:
            applied = False
        if applied:
            files[fp] = tmp
        else:
            # backward recovery: latest snapshot before now
            snaps = read_snapshots.get(fp) or []
            best = None
            for s2, content in snaps:
                if s2 < seq:
                    best = (s2, content)
            if best is not None:
                files[fp] = best[1]
                tmp = files[fp]
                ok2 = True
                for ed in edits:
                    old = ed.get('old_str')
                    if old is None:
                        continue
                    if old not in tmp:
                        ok2 = False
                        break
                    tmp = tmp.replace(old, ed.get('new_str', ''), 1)
                if ok2:
                    files[fp] = tmp
                    ops_log.append((seq, name.upper() + '_BACK_RECOVER', fp, f'from snap {best[0]}'))
                else:
                    poisoned.add(fp)
                    poison_history.append((seq, fp))
                    manual_attention.add(fp)
                    ops_log.append((seq, name.upper() + '_POISON', fp, ''))
            else:
                poisoned.add(fp)
                poison_history.append((seq, fp))
                manual_attention.add(fp)
                ops_log.append((seq, name.upper() + '_POISON', fp, 'no snapshot'))

    elif name == 'Read':
        fp = resolve(args.get('filepath') or '')
        decoded = decode_read_content(call_results.get(e['call_id'], ''))
        if fp and decoded and decoded.strip():
            if fp in poisoned:
                poisoned.discard(fp)
                poison_history.append((seq, fp))
                ops_log.append((seq, 'UNPOISON_BY_READ', fp, ''))
            files[fp] = decoded

    elif name == 'Bash':
        cmd = args.get('command', '')
        ran_ok = bool(res) and 'command not found' not in res[:100] and 'No such file or directory' not in res[:200]
        if ran_ok and ('sed -i' in cmd):
            try:
                sed_apply(cmd, seq)
            except Exception:
                pass
        if ran_ok and 'python3 -c' in cmd and 'node_modules' not in cmd:
            try:
                python_apply(cmd, seq)
            except Exception:
                pass

print('Replay v3 complete. Files:', len(files))
print('Still poisoned:', len(poisoned))
for fp in sorted(poisoned):
    print('  !!', fp)
print('Ever poisoned:', len(set(p for _, p in poison_history)))

with open(os.path.join(RECON_DIR, 'ops_log_v3.txt'), 'w') as f:
    for seq, op, fp, info in ops_log:
        f.write(f'{seq:6d} {op:22s} {fp}  {info}\n')

with open(os.path.join(RECON_DIR, 'file_state.json'), 'w') as f:
    json.dump(files, f, ensure_ascii=False)

total = sum(len(c) for c in files.values())
print(f'Total size: {total/1024:.0f} KB')
