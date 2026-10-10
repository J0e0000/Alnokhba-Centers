#!/usr/bin/env python3
"""Get final project state: last Complete summaries, last worklog Read, and Bash-created files."""
import json
import re

with open('/home/z/my-project/reconstruct/timeline.json') as f:
    timeline = json.load(f)

# 1. All Complete call summaries
print('================ COMPLETE CALLS ================')
completes = [t for t in timeline if t['name'] == 'Complete']
for c in completes:
    s = (c['args'] or {}).get('summary', '')
    print(f"\n--- seq={c['seq']} msg={c['msg']} ---")
    print(s[:800])

# 2. Last worklog Read results (full content)
print('\n\n================ WORKLOG READS (last) ================')
worklog_reads = []
for t in timeline:
    if t['name'] == 'Read' and 'worklog' in (t['args'] or {}).get('filepath', ''):
        worklog_reads.append(t)
print(f"{len(worklog_reads)} worklog reads")

# 3. Bash commands that create files (heredocs / redirects)
print('\n================ BASH FILE-CREATING COMMANDS ================')
bash_file_creates = []
for t in timeline:
    if t['name'] != 'Bash':
        continue
    cmd = (t['args'] or {}).get('command', '')
    if re.search(r"(cat\s*>\s*\S+\s*<<|tee\s+\S+|>\s*['\"]?/home/z/my-project/(src|prisma|scripts|public|tests)/)", cmd):
        bash_file_creates.append(t)
print(f"{len(bash_file_creates)} bash file-creating commands")

# 4. npm install commands (to know dependencies)
print('\n================ PACKAGE INSTALLS ================')
seen_install = set()
for t in timeline:
    if t['name'] == 'Bash':
        cmd = (t['args'] or {}).get('command', '')
        if ('npm install' in cmd or 'npm i ' in cmd or 'pnpm add' in cmd) and cmd not in seen_install:
            seen_install.add(cmd)
            print(' ', cmd[:150])

json.dump([t for t in bash_file_creates], open('/home/z/my-project/reconstruct/bash_file_creates.json', 'w'), ensure_ascii=False, indent=1)
