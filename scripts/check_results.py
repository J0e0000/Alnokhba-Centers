#!/usr/bin/env python3
"""Check tool results structure and extract final worklog."""
import json

with open('/home/z/my-project/reconstruct/timeline.json') as f:
    timeline = json.load(f)

# Check which calls have results and their shape
has_results = [t for t in timeline if t.get('result_preview')]
print(f"{len(has_results)} / {len(timeline)} calls have result previews")

# Find a Read call with results
for t in timeline:
    if t['name'] == 'Read' and t.get('result_preview'):
        print('\n=== Read result preview (seq', t['seq'], '):')
        print(t['result_preview'][:400])
        break

# Check raw batch for full results of a Write call
with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

data = batch['data']
found = 0
for mid, m in data.items():
    if m.get('role') != 'assistant':
        continue
    for b in (m.get('content_blocks') or []):
        if isinstance(b, dict) and b.get('type') == 'tool_calls' and b.get('results'):
            r = b['results']
            found += 1
            if found <= 2:
                print('\n=== results type:', type(r).__name__)
                if isinstance(r, list):
                    print('   results[0] keys:', list(r[0].keys()) if isinstance(r[0], dict) else type(r[0]).__name__)
                    s = json.dumps(r[0], ensure_ascii=False)
                    print('   size:', len(s), 'preview:', s[:300])
                elif isinstance(r, dict):
                    print('   keys:', list(r.keys()))
    if found >= 2:
        break

# Extract all worklog.md Write contents, show the last one
worklog_writes = [t for t in timeline if t['name'] == 'Write' and 'worklog' in (t['args'] or {}).get('filepath', '')]
print(f'\n=== {len(worklog_writes)} worklog Write calls')
if worklog_writes:
    last = worklog_writes[-1]
    content = last['args'].get('content', '')
    print('Last worklog at seq', last['seq'], 'len', len(content))
    with open('/home/z/my-project/reconstruct/worklog_final.md', 'w', encoding='utf-8') as f:
        f.write(content)
    print(content[:3000])
