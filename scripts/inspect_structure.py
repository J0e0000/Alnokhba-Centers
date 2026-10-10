#!/usr/bin/env python3
"""Inspect the structure of assistant messages to find where the bulk is."""
import json

with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

data = batch['data']

# Find an assistant message and dump its keys with value sizes
for mid, m in data.items():
    if m.get('role') == 'assistant':
        print('Message id:', mid)
        for k, v in m.items():
            size = len(json.dumps(v, ensure_ascii=False)) if not isinstance(v, str) else len(v)
            print(f"  {k}: {type(v).__name__} ({size} chars)")
        break

# Check a few
count = 0
for mid, m in data.items():
    if m.get('role') == 'assistant' and count < 3:
        count += 1
        content = m.get('content')
        print('\n=== id', mid[:8], 'content type:', type(content).__name__)
        if isinstance(content, str):
            print('  content str len:', len(content))
        elif isinstance(content, list):
            print('  content blocks:', len(content))
            for b in content[:5]:
                print('    block:', b.get('type') if isinstance(b, dict) else type(b).__name__)
