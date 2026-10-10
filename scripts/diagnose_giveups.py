#!/usr/bin/env python3
"""Diagnose giveup files: find their first runtime mutation and prior bash context."""
import json

timeline = json.load(open('/home/z/my-project/reconstruct/timeline.json'))

gives = ['src/components/nokhba/scan.tsx', 'src/components/nokhba/dashboard.tsx',
         'src/components/nokhba/portal/portal.tsx', 'src/components/nokhba/print.tsx',
         'public/sw.js', 'src/components/nokhba/command-palette.tsx',
         'src/components/nokhba/staff-bell.tsx', 'src/components/nokhba/student-search.tsx',
         'src/components/nokhba/emergency.tsx', 'src/components/nokhba/message-queue.tsx']

for g in gives:
    fp_full = '/home/z/my-project/' + g
    ops = [t for t in timeline if (t['args'] or {}).get('filepath') == fp_full]
    if not ops:
        print(f'{g}: NO FILEPATH OPS FOUND')
        continue
    first = ops[0]
    print(f'\n{g}:')
    print(f'  first op: seq={first["seq"]} {first["name"]}')
    # show bash ops mentioning this file before the first filepath-op
    short = g.split('/')[-1]
    bash_refs = [t for t in timeline if t['name'] == 'Bash' and t['seq'] < first['seq'] and short in (t['args'] or {}).get('command', '')]
    for b in bash_refs[-3:]:
        cmd = (b['args'] or {}).get('command', '')
        print(f'  prior bash seq={b["seq"]}: {cmd[:150]}')
