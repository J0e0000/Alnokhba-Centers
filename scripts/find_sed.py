#!/usr/bin/env python3
"""Find sed -i and other in-place file modifications via bash."""
import json
import re

timeline = json.load(open('/home/z/my-project/reconstruct/timeline.json'))

print('=== sed -i commands ===')
sed_count = 0
for t in timeline:
    if t['name'] == 'Bash':
        cmd = (t['args'] or {}).get('command', '')
        if re.search(r'\bsed\s+-i', cmd):
            sed_count += 1
            if sed_count <= 25:
                print(f"seq={t['seq']}: {cmd[:180]}")
print('Total sed -i:', sed_count)

print('\n=== python-based file rewrites ===')
py_count = 0
for t in timeline:
    if t['name'] == 'Bash':
        cmd = (t['args'] or {}).get('command', '')
        if ('python3 -c' in cmd or 'python3 <<' in cmd or 'python <<' in cmd) and ('open(' in cmd and ("'w'" in cmd or '"w"' in cmd)):
            py_count += 1
            if py_count <= 10:
                print(f"seq={t['seq']}: {cmd[:180]}")
print('Total python rewrites:', py_count)

print('\n=== node-based file rewrites ===')
node_count = 0
for t in timeline:
    if t['name'] == 'Bash':
        cmd = (t['args'] or {}).get('command', '')
        if ('node -e' in cmd or 'node <<' in cmd) and ('writeFile' in cmd or "writeFileSync" in cmd):
            node_count += 1
            if node_count <= 10:
                print(f"seq={t['seq']}: {cmd[:150]}")
print('Total node rewrites:', node_count)
