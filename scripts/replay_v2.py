#!/usr/bin/env python3
"""Improved replayer: v2 with Read-snapshot recovery + Bash heredoc/rm/mv/cp/sed handling.

Algorithm:
- Forward pass over all tool calls in order.
- Write/Edit/MultiEdit applied only if runtime result says success.
- On runtime-OK but replay-fail: recover file from latest Read snapshot before
  current seq, replay this file's mutation history after that snapshot, then
  apply current op. If impossible, mark file for manual attention.
- Bash: parse heredoc creates (cat > f << EOF), appends (cat >> f), rm, mv, cp,
  mkdir, and common sed -i patterns. Only when runtime result indicates success.
"""
import json
import os
import re
import sys
from collections import defaultdict

RECON_DIR = '/home/z/my-project/reconstruct'
OUT_DIR = '/home/z/my-project/reconstruct/codebase'
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
            results = b['results']
            if isinstance(results, list):
                for r in results:
                    if isinstance(r, dict) and r.get('tool_call_id'):
                        call_results[r['tool_call_id']] = r.get('content') or ''

data = batch['data']
roots = [mid for mid, m in data.items() if not m.get('parentId')]
ordered = []
visited = set()

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
            enriched.append({
                'seq': len(enriched),
                'msg': mi,
                'call_id': c.get('id'),
                'name': func.get('name') or c.get('name'),
                'args': args,
            })

# ---------------- Read snapshots ----------------
def decode_read_content(raw):
    if not raw:
        return None
    if 'Output too large' in raw[:200]:
        return None
    if raw.startswith('<persisted-output>'):
        return None
    if '\u2192' in raw:
        lines = raw.split('\n')
        cleaned = []
        ok = True
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

read_snapshots = {}   # filepath -> list of (seq, content)
for e in enriched:
    if e['name'] != 'Read':
        continue
    fp = e['args'].get('filepath')
    raw = call_results.get(e['call_id'], '')
    decoded = decode_read_content(raw)
    if fp and decoded and decoded.strip():
        read_snapshots.setdefault(fp, []).append((e['seq'], decoded))

print('Read snapshot files:', len(read_snapshots))

# ---------------- Replay state ----------------
files = {}
file_ops = defaultdict(list)   # fp -> list of (seq, opname, payload) for replay
manual_attention = set()
ops_log = []

def heredoc_parse(cmd):
    """Parse cat > f << 'EOF' ... EOF and cat >> f. Return list of (fp, content, append)."""
    out = []
    # match: cat (>>|>) file << 'TAG' \n ... \n TAG
    pattern = re.compile(
        r"cat\s+(?P<op>>|>>)\s*['\"]?(?P<fp>\S+?)['\"]?\s*<<\s*['\"]?(?P<tag>\w+)['\"]?\s*\n(?P<body>.*?)\n(?P=tag)(?:\n|$)",
        re.DOTALL,
    )
    for m in pattern.finditer(cmd):
        fp = m.group('fp')
        if fp.startswith('-'):
            continue
        body = m.group('body')
        out.append((fp, body, m.group('op') == '>>'))
    return out

def bash_apply(e, cmd, res):
    """Apply file-affecting bash ops. Returns list of affected files."""
    affected = []
    # rm
    for m in re.finditer(r"(?:^|&&|\||;)\s*rm\s+(?:-f\s+|(-[a-z]+)\s+)*['\"]?(\S+?)['\"]?\s*$", cmd, re.MULTILINE):
        pass
    # simple rm handling: rm -f path / rm path
    for m in re.finditer(r"rm\s+(?:-[a-zA-Z]+\s+)*['\"]?(\S+?)['\"]?(?=\s|$)", cmd):
        p = m.group(1)
        if p.startswith('/') and not p.startswith('/dev') and 'my-project' in p:
            full = MY_PREFIX + p[len(MY_PREFIX):] if p.startswith(MY_PREFIX) else p
            if full in files:
                del files[full]
                affected.append(('rm', full))
    # mv
    for m in re.finditer(r"mv\s+(?:-[a-zA-Z]+\s+)?['\"]?(\S+?)['\"]?\s+['\"]?(\S+?)['\"]?(?=\s|$)", cmd):
        src, dst = m.group(1), m.group(2)
        if src.startswith(MY_PREFIX) and src in files:
            files[dst] = files.pop(src)
            affected.append(('mv', f'{src} -> {dst}'))
    # cp
    for m in re.finditer(r"\bcp\s+(?:-[a-zA-Z]+\s+)?['\"]?(\S+?)['\"]?\s+['\"]?(\S+?)['\"]?(?=\s|$)", cmd):
        src, dst = m.group(1), m.group(2)
        if src.startswith(MY_PREFIX) and src in files:
            files[dst] = files[src]
            affected.append(('cp', f'{src} -> {dst}'))
    # heredocs
    for fp, body, append in heredoc_parse(cmd):
        if not (fp.startswith('/') or fp.startswith('~') or fp.startswith('$')):
            fp = MY_PREFIX + fp
        fp = fp.replace('~/', MY_PREFIX.replace('/home/z/', '~/') ) if fp.startswith('~') else fp
        if append and fp in files:
            files[fp] = files[fp] + '\n' + body
        else:
            files[fp] = body
        file_ops[fp].append((e['seq'], 'SET', body))
        affected.append(('heredoc', fp))
    return affected

def recover_file(fp, upto_seq, current_op):
    """Recover file from latest read snapshot before upto_seq and replay ops."""
    snaps = read_snapshots.get(fp) or []
    best = None
    for seq, content in snaps:
        if seq < upto_seq:
            best = (seq, content)
    if best is None:
        return False
    snap_seq, content = best
    files[fp] = content
    # replay ops after snapshot
    for s, opname, payload in file_ops[fp]:
        if s <= snap_seq or s >= upto_seq:
            continue
        if opname == 'EDIT':
            old, new, ra = payload
            if old in files[fp]:
                if ra:
                    files[fp] = files[fp].replace(old, new)
                else:
                    files[fp] = files[fp].replace(old, new, 1)
        elif opname == 'SET':
            files[fp] = payload
    return True

def register_op(fp, seq, opname, payload):
    file_ops[fp].append((seq, opname, payload))

mismatch_after_recovery = []

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
            register_op(fp, seq, 'SET', content)
            ops_log.append((seq, 'WRITE_OK', fp, ''))
        else:
            ops_log.append((seq, 'WRITE_FAIL', fp, res[:60]))

    elif name == 'Edit':
        fp = args.get('filepath')
        old = args.get('old_str')
        new = args.get('new_str')
        ra = args.get('replace_all', False)
        if not fp or old is None:
            continue
        runtime_ok = 'has been edited' in res
        if runtime_ok:
            applied = fp in files and old in files[fp]
            if not applied:
                # try recovery
                if recover_file(fp, seq, 'EDIT'):
                    applied = old in files[fp]
            if applied:
                if ra:
                    files[fp] = files[fp].replace(old, new)
                else:
                    files[fp] = files[fp].replace(old, new, 1)
                register_op(fp, seq, 'EDIT', (old, new, ra))
                ops_log.append((seq, 'EDIT_OK_RECOVERED' if True else '', fp, ''))
            else:
                manual_attention.add(fp)
                ops_log.append((seq, 'EDIT_GIVEUP', fp, res[:80]))
        else:
            register_op(fp, seq, 'NOP', None)
            ops_log.append((seq, 'EDIT_FAIL_SKIP', fp, res[:60]))

    elif name == 'MultiEdit':
        fp = args.get('filepath')
        edits = args.get('edits') or []
        if not fp or not edits:
            continue
        runtime_ok = 'has been edited' in res
        if runtime_ok:
            # try full application
            ok = fp in files
            if ok:
                # verify all old_strs present in order
                tmp = files[fp]
                positions = []
                for ed in edits:
                    old = ed.get('old_str')
                    if old is None:
                        continue
                    idx = tmp.find(old)
                    positions.append(idx)
                    if idx == -1:
                        ok = False
                        break
                    # simulate
                    tmp = tmp.replace(old, ed.get('new_str', ''), 1)
            if not ok:
                if recover_file(fp, seq, 'MULTIEDIT'):
                    tmp = files[fp]
                    ok = True
                    for ed in edits:
                        old = ed.get('old_str')
                        if old is None:
                            continue
                        idx = tmp.find(old)
                        if idx == -1:
                            ok = False
                            break
                        tmp = tmp.replace(old, ed.get('new_str', ''), 1)
            if ok:
                files[fp] = tmp
                for ed in edits:
                    register_op(fp, seq, 'EDIT', (ed.get('old_str'), ed.get('new_str'), ed.get('replace_all', False)))
                ops_log.append((seq, 'MULTIEDIT_OK', fp, f'{len(edits)} edits'))
            else:
                manual_attention.add(fp)
                ops_log.append((seq, 'MULTIEDIT_GIVEUP', fp, res[:80]))
        else:
            register_op(fp, seq, 'NOP', None)
            ops_log.append((seq, 'MULTIEDIT_FAIL_SKIP', fp, res[:60]))

    elif name == 'Bash':
        cmd = args.get('command', '')
        # only apply if the command actually ran successfully
        ran_ok = res and not res.startswith('Error') and 'command not found' not in res[:100] and 'No such file or directory' not in res[:200]
        if ran_ok and cmd:
            try:
                bash_apply(e, cmd, res)
            except Exception as ex:
                pass

print('Replay v2 complete. Files:', len(files))
print('Manual attention files:', len(manual_attention))
for fp in sorted(manual_attention):
    print('  !!', fp)

with open(os.path.join(RECON_DIR, 'ops_log_v2.txt'), 'w') as f:
    for seq, op, fp, info in ops_log:
        f.write(f'{seq:6d} {op:22s} {fp}  {info}\n')

with open(os.path.join(RECON_DIR, 'file_state.json'), 'w') as f:
    json.dump(files, f, ensure_ascii=False)

total = sum(len(c) for c in files.values())
print(f'Total size: {total/1024:.0f} KB')

# Save manual attention list
json.dump(sorted(manual_attention), open(os.path.join(RECON_DIR, 'manual_attention.json'), 'w'), indent=1)
