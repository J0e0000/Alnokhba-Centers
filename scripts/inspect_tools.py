#!/usr/bin/env python3
"""Extract tool_calls structure - find file write operations to recover the codebase."""
import json

with open('/home/z/my-project/chat_batch.json') as f:
    batch = json.load(f)

data = batch['data']

# Find tool_calls blocks and inspect their content structure
seen_tools = {}
examples = {}

for mid, m in data.items():
    if m.get('role') != 'assistant':
        continue
    blocks = m.get('content_blocks') or []
    for b in blocks:
        if not isinstance(b, dict) or b.get('type') != 'tool_calls':
            continue
        content = b.get('content')
        # content may be a list of tool call objects
        calls = content if isinstance(content, list) else [content]
        for c in calls:
            if not isinstance(c, dict):
                continue
            name = c.get('name') or c.get('function', {}).get('name') if isinstance(c.get('function'), dict) else None
            if not name:
                # try to detect structure
                name = json.dumps(list(c.keys()))
            seen_tools[name] = seen_tools.get(name, 0) + 1
            if name not in examples:
                examples[name] = c

print('Tool names found:')
for name, n in seen_tools.items():
    print(f"  {name}: {n} calls")

# Print example structure for one write-like tool
for name, c in examples.items():
    print('\n=== Example for:', name[:60])
    s = json.dumps(c, ensure_ascii=False)
    print('  size:', len(s))
    print('  preview:', s[:400])
