#!/usr/bin/env python3
"""Replay all Write/Edit/MultiEdit tool calls in chronological order to
reconstruct the AlNokhba Centers codebase.

Success markers (from runtime results):
  Write success:   "File created successfully at: <path>"
  Edit success:    "The file <path> has been edited."
  Write failure:   "parent directory does not exist", "File has not been read", etc.
  Edit failure:    "No replacement was performed", etc.

Files needing a base (Edited but never Written) get initialized from the
most recent full-content Read result preceding their first edit.
"""
import json
import os
import re
import sys
from collections import defaultdict

RECON_DIR = '/home/z/my-project/reconstruct'
OUT_DIR = '/home/z/my-project/reconstruct/codebase'

with open('/home/z/my-project/reconstruct/timeline.json') as f:
    timeline = json.load(f)

# ------------------------------------------------------------------
# 1. Build call_id -> result content map from raw batch
# ------------------------------------------------------------------
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

# We need to re-walk the timeline WITH call ids. Rebuild from raw batch in
# the same order as timeline.json was built (message walk order).
# Reproduce the walk:
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

# Rebuild enriched timeline (with call ids)
enriched = []
for mi, m in enumerate(ordered):
    blocks = m.get('content_blocks') or []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        if b.get('type') != 'tool_calls':
            continue
        content = b.get('content')
        calls = content if isinstance(content, list) else [content]
        for c in calls:
            if not isinstance(c, dict):
                continue
            func = c.get('function') or {}
            name = func.get('name') or c.get('name')
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
                'name': name,
                'args': args,
            })

print('Enriched calls:', len(enriched))
# sanity: matches timeline length
assert len(enriched) == len(timeline), f"mismatch {len(enriched)} vs {len(timeline)}"

# ------------------------------------------------------------------
# 2. Collect Read results (full file contents) with positions
# ------------------------------------------------------------------
LINE_NUM_RE = re.compile(r'^\s*\d+\u2192', re.MULTILINE)
PERSISTED_RE = re.compile(r'Output too large \(([\d.]+)KB\). Full output saved to: (\S+)')

def decode_read_content(raw):
    """Read results come as 'N->line' format possibly inside persisted-output wrapper."""
    if not raw:
        return None
    if 'Output too large' in raw[:200]:
        # Extract the preview part (first 2KB) - not full content
        return None
    # Remove cat -n line numbers
    text = raw
    if '\u2192' in text:
        lines = text.split('\n')
        cleaned = []
        for ln in lines:
            m = re.match(r'^\s*(\d+)\u2192(.*)$', ln)
            if m:
                cleaned.append(m.group(2))
            elif ln.strip() == '':
                cleaned.append('')
            else:
                cleaned.append(ln)
        text = '\n'.join(cleaned)
    return text

read_snapshots = []  # (seq, filepath, content)
for e in enriched:
    if e['name'] != 'Read':
        continue
    fp = e['args'].get('filepath')
    raw = call_results.get(e['call_id'], '')
    decoded = decode_read_content(raw)
    if fp and decoded is not None and decoded.strip():
        read_snapshots.append((e['seq'], fp, decoded))

print('Full Read snapshots:', len(read_snapshots))
read_by_file = defaultdict(list)
for seq, fp, content in read_snapshots:
    read_by_file[fp].append((seq, content))

# ------------------------------------------------------------------
# 3. Replay
# ------------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
files = {}          # filepath -> content
mutation_count = defaultdict(int)   # filepath -> number of mutations applied
ops_log = []
skipped = defaultdict(int)

def apply_edit(filepath, old, new, replace_all=False):
    if filepath not in files:
        return False, 'no-base'
    content = files[filepath]
    if old not in content:
        return False, 'old-str-not-found'
    if replace_all:
        content = content.replace(old, new)
    else:
        content = content.replace(old, new, 1)
    files[filepath] = content
    return True, 'ok'

for e in enriched:
    name = e['name']
    args = e['args']
    res = call_results.get(e['call_id'], '')

    if name == 'Write':
        fp = args.get('filepath')
        content = args.get('content')
        if not fp or content is None:
            skipped['write-noargs'] += 1
            continue
        if 'File created successfully' in res or 'has been updated' in res or 'has been overwritten' in res:
            files[fp] = content
            mutation_count[fp] += 1
            ops_log.append((e['seq'], 'WRITE_OK', fp, len(content)))
        else:
            ops_log.append((e['seq'], 'WRITE_FAIL', fp, res[:80]))
            skipped['write-fail'] += 1

    elif name == 'Edit':
        fp = args.get('filepath')
        old = args.get('old_str')
        new = args.get('new_str')
        ra = args.get('replace_all', False)
        if not fp or old is None:
            skipped['edit-noargs'] += 1
            continue
        ok, why = apply_edit(fp, old, new, ra)
        if ok:
            mutation_count[fp] += 1
            ops_log.append((e['seq'], 'EDIT_OK', fp, why))
        else:
            # did the runtime succeed but we can't replay? (bad sign)
            runtime_ok = 'has been edited' in res
            ops_log.append((e['seq'], 'EDIT_MISMATCH' if runtime_ok else 'EDIT_FAIL', fp, why + ' | ' + res[:60]))
            skipped[f'edit-{why}'] += 1

    elif name == 'MultiEdit':
        fp = args.get('filepath')
        edits = args.get('edits') or []
        if not fp or not edits:
            skipped['multiedit-noargs'] += 1
            continue
        ok_all = True
        why_all = 'ok'
        for ed in edits:
            old = ed.get('old_str')
            new = ed.get('new_str')
            ra = ed.get('replace_all', False)
            if old is None:
                continue
            ok, why = apply_edit(fp, old, new, ra)
            if not ok:
                ok_all = False
                why_all = why
                break
        if ok_all:
            mutation_count[fp] += 1
            ops_log.append((e['seq'], 'MULTIEDIT_OK', fp, f'{len(edits)} edits'))
        else:
            runtime_ok = 'has been edited' in res
            ops_log.append((e['seq'], 'MULTIEDIT_MISMATCH' if runtime_ok else 'MULTIEDIT_FAIL', fp, why_all + ' | ' + res[:60]))
            skipped[f'multiedit-{why_all}'] += 1

print('\n=== Replay complete ===')
print('Files in memory:', len(files))
print('Skip stats:', dict(skipped))

# Save ops log
with open(os.path.join(RECON_DIR, 'ops_log.txt'), 'w') as f:
    for seq, op, fp, info in ops_log:
        f.write(f'{seq:6d} {op:20s} {fp}  {info}\n')

# ------------------------------------------------------------------
# 4. Files that were mutated but never had a base (need Read init)
# ------------------------------------------------------------------
mutated = {fp for fp, n in mutation_count.items() if n > 0}
print('\nMutated files:', len(mutated))

# Save everything
state_path = os.path.join(RECON_DIR, 'file_state.json')
with open(state_path, 'w') as f:
    json.dump(files, f, ensure_ascii=False)

# Stats
total_size = sum(len(c) for c in files.values())
print(f'Total content size: {total_size/1024:.0f} KB')

# Show top 30 files by mutation count
print('\nTop mutated files:')
for fp, n in sorted(mutation_count.items(), key=lambda x: -x[1])[:30]:
    has_base = fp in files
    print(f'  {n:4d} mutations  base={"Y" if has_base else "N"}  {fp}')
