#!/usr/bin/env python3
"""Remove duplicate top-level function definitions, keeping the LAST (most
recent) version. Functions are matched by `^function NAME(` blocks and their
full brace-balanced body."""
import re
import sys

def remove_earlier_dup(path, name):
    src = open(path, encoding='utf-8').read()
    lines = src.split('\n')
    # find all occurrences of function <name> at top level
    starts = [i for i, ln in enumerate(lines) if re.match(rf'^function {re.escape(name)}\(', ln)]
    if len(starts) < 2:
        print(f'{path}: {name} no dup at top level ({len(starts)})')
        return
    # compute end (brace balance) for each start
    def block_end(start):
        depth = 0
        opened = False
        for i in range(start, len(lines)):
            for ch in lines[i]:
                if ch == '{':
                    depth += 1
                    opened = True
                elif ch == '}':
                    depth -= 1
            if opened and depth == 0:
                return i
        return len(lines) - 1

    blocks = []
    for s in starts:
        e = block_end(s)
        # extend over trailing blank line
        while e + 1 < len(lines) and lines[e + 1].strip() == '':
            e += 1
        blocks.append((s, e))
    # keep the LAST block; delete all earlier ones
    keep_s, keep_e = blocks[-1]
    delete = set()
    for s, e in blocks[:-1]:
        for i in range(s, e + 1):
            delete.add(i)
    out = [ln for i, ln in enumerate(lines) if i not in delete]
    open(path, 'w', encoding='utf-8').write('\n'.join(out))
    print(f'{path}: {name} removed {len(blocks)-1} earlier copies (kept {keep_s}-{keep_e})')

for arg in sys.argv[1:]:
    path, name = arg.rsplit(':', 1)
    remove_earlier_dup(path, name)
