# -*- coding: utf-8 -*-
"""Extract full text (paragraphs + tables) from the two Arabic reports."""
import sys
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

def iter_block_items(parent):
    from docx.document import Document as _Doc
    from docx.oxml.ns import qn
    if isinstance(parent, _Doc):
        parent_elm = parent.element.body
    else:
        parent_elm = parent._element
    for child in parent_elm.iterchildren():
        if child.tag == qn('w:p'):
            yield Paragraph(child, parent)
        elif child.tag == qn('w:tbl'):
            yield Table(child, parent)

def dump(path):
    doc = Document(path)
    out = []
    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            style = block.style.name if block.style else ''
            txt = block.text.strip()
            if txt:
                prefix = ''
                if 'Heading' in style:
                    try:
                        lvl = int(style.split()[-1])
                    except Exception:
                        lvl = 1
                    prefix = '#' * lvl + ' '
                out.append(prefix + txt)
        else:  # Table
            rows = []
            for r in block.rows:
                cells = [c.text.strip().replace('\n', ' / ') for c in r.cells]
                rows.append(' | '.join(cells))
            out.append('[TABLE]\n' + '\n'.join(rows) + '\n[/TABLE]')
    return '\n\n'.join(out)

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print('=' * 70)
        print('FILE:', p)
        print('=' * 70)
        print(dump(p))
        print()
