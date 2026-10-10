#!/usr/bin/env python3
"""Assemble the extracted spec chunks into one file.
The chunks were produced by `agent-browser eval` which wraps output in quotes
and JSON-escapes newlines. Decode them properly."""
import json

parts = []
# part1 came from a single substring(0, 8000)
with open('/home/z/my-project/spec_part1.txt', 'r', encoding='utf-8') as f:
    raw = f.read().strip()
# The eval output is a JSON string literal (quoted). Parse it.
try:
    decoded = json.loads(raw)
except Exception:
    decoded = raw
parts.append(decoded)

for start in (8000, 16000, 24000, 32000, 40000):
    path = f'/home/z/my-project/spec_chunk_{start}.txt'
    with open(path, 'r', encoding='utf-8') as f:
        raw = f.read().strip()
    try:
        decoded = json.loads(raw)
    except Exception:
        decoded = raw
    parts.append(decoded)

full = ''.join(parts)
print('Total length:', len(full))
with open('/home/z/my-project/alnokhba_spec_full.txt', 'w', encoding='utf-8') as f:
    f.write(full)
print('Saved to /home/z/my-project/alnokhba_spec_full.txt')
# Show beginning and end sanity check
print('--- FIRST 200 ---')
print(full[:200])
print('--- LAST 300 ---')
print(full[-300:])
