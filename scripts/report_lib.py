#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""report_lib.py — shared setup for the ALNOKHBA Stage G verification report.

Chapter numbering plan (report.md Step 3.5 — the body is chapter 1):
| Outline Index | Type    | Chapter # | Title                                       |
|---------------|---------|-----------|---------------------------------------------|
| 1             | cover   | -         | Cover (Template 07, merged via pypdf)       |
| 2             | toc     | -         | Table of Contents (roman i)                 |
| 3             | content | 1         | Executive Summary                           |
| 4             | content | 2         | Scope, Method and Evidence Standard         |
| 5             | content | 3         | System Architecture as Verified             |
| 6             | content | 4         | Session Context and Coreference Resolution  |
| 7             | content | 5         | Verification and Test Evidence              |
| 8             | content | 6         | Production Deployment Evidence              |
| 9             | content | 7         | Voice Pipeline Status                       |
| 10            | content | 8         | Security and Governance Checklist           |
| 11            | content | 9         | Known Gaps and Honest Limitations           |
| 12            | content | 10        | Next Actions                                |
"""
import os
import sys
import hashlib

PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
_scripts = os.path.join(PDF_SKILL_DIR, "scripts")
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily, stringWidth
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    KeepTogether, CondPageBreak, HRFlowable, Image,
)
from reportlab.platypus.tableofcontents import TableOfContents

import arabic_reshaper
from bidi.algorithm import get_display

# ---------------------------------------------------------------- fonts
FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans", f"{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf"))

registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
registerFontFamily("DejaVuSans", normal="DejaVuSans", bold="DejaVuSans")

from pdf import install_font_fallback  # noqa: E402  (skill scripts on path)
install_font_fallback()

# ------------------------------------------------- palette (Template 07 body, fixed by cover.md spec)
PAGE_BG      = colors.HexColor("#f5f8fc")   # XL
SECTION_BG   = colors.HexColor("#edf2f9")   # XL
CARD_BG      = colors.HexColor("#e4ecf5")   # L
TABLE_STRIPE = colors.HexColor("#eef3fa")   # L
HEADER_FILL  = colors.HexColor("#1a4a7a")   # M
BORDER       = colors.HexColor("#c0d0e2")   # S
ACCENT       = colors.HexColor("#2d7ab3")   # XS
TEXT_PRIMARY = colors.HexColor("#142840")
TEXT_MUTED   = colors.HexColor("#5a7a96")

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ---------------------------------------------------------------- layout constants
MARGIN = 0.9 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN
H1_GUARD = AVAIL_H * 0.25
MAX_KEEP_HEIGHT = PAGE_H * 0.4

# ---------------------------------------------------------------- styles
S = {}
S["body"] = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=17,
                           alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY, spaceAfter=8)
S["h1"] = ParagraphStyle("H1", fontName="FreeSerif", fontSize=20, leading=26,
                         textColor=HEADER_FILL, spaceBefore=18, spaceAfter=4)
S["h2"] = ParagraphStyle("H2", fontName="FreeSerif", fontSize=14, leading=19,
                         textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=6)
S["h3"] = ParagraphStyle("H3", fontName="FreeSerif", fontSize=11.5, leading=16,
                         textColor=TEXT_PRIMARY, spaceBefore=10, spaceAfter=5)
S["bullet"] = ParagraphStyle("Bullet", fontName="FreeSerif", fontSize=10.5, leading=16.5,
                             alignment=TA_LEFT, textColor=TEXT_PRIMARY,
                             leftIndent=16, bulletIndent=4, spaceAfter=4,
                             bulletFontName="FreeSerif", bulletFontSize=10.5)
S["quote"] = ParagraphStyle("Quote", fontName="FreeSerif-Italic", fontSize=10.5, leading=16.5,
                            alignment=TA_LEFT, textColor=TEXT_MUTED, leftIndent=24, spaceAfter=8)
S["caption"] = ParagraphStyle("Caption", fontName="FreeSerif", fontSize=8.5, leading=12,
                              alignment=TA_CENTER, textColor=TEXT_MUTED, spaceBefore=3, spaceAfter=6)
S["th"] = ParagraphStyle("TH", fontName="FreeSerif", fontSize=9.5, leading=13,
                         alignment=TA_LEFT, textColor=colors.white)
S["td"] = ParagraphStyle("TD", fontName="FreeSerif", fontSize=9.5, leading=13.5,
                         alignment=TA_LEFT, textColor=TEXT_PRIMARY)
S["stat"] = ParagraphStyle("Stat", fontName="FreeSerif", fontSize=19, leading=23,
                           alignment=TA_CENTER, textColor=ACCENT)
S["statlabel"] = ParagraphStyle("StatLabel", fontName="FreeSerif", fontSize=8, leading=11,
                                alignment=TA_CENTER, textColor=TEXT_MUTED)
S["toc0"] = ParagraphStyle("TOC0", fontName="FreeSerif", fontSize=11.5, leading=18, leftIndent=6,
                           textColor=TEXT_PRIMARY)
S["toc1"] = ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=10, leading=15, leftIndent=26,
                           textColor=TEXT_MUTED)
S["toctitle"] = ParagraphStyle("TOCTitle", fontName="FreeSerif", fontSize=18, leading=24,
                               textColor=HEADER_FILL, spaceAfter=12)

# ---------------------------------------------------------------- helpers
def ar(text: str) -> str:
    """Shape + bidi Arabic text so ReportLab renders joined RTL correctly."""
    return get_display(arabic_reshaper.reshape(text))

def body(text: str) -> Paragraph:
    return Paragraph(text, S["body"])

def bullet(text: str) -> Paragraph:
    return Paragraph(text, S["bullet"], bulletText="\u2022")

def _bookmark(p: Paragraph, text: str, level: int) -> Paragraph:
    key = "h_" + hashlib.md5((text + str(level)).encode()).hexdigest()[:8]
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def H1(num: int, text: str, first_para: str | None = None) -> list:
    """Chapter heading: orphan guard + bookmarked title + accent rule (+ first paragraph bound)."""
    title = f"{num}.  {text}"
    probe = Paragraph(f"<b>{title}</b>", S["h1"])
    _bookmark(probe, f"{num}. {text}", 0)
    key = probe.bookmark_key
    p = Paragraph(f'<a name="{key}"/><b>{title}</b>', S["h1"])
    _bookmark(p, f"{num}. {text}", 0)
    rule = HRFlowable(width="100%", thickness=1.2, color=ACCENT, spaceBefore=0, spaceAfter=10)
    group = [p, rule]
    if first_para:
        group.append(Paragraph(first_para, S["body"]))
    return [CondPageBreak(H1_GUARD), KeepTogether(group)]

def H2(text: str, first_para: str | None = None) -> list:
    p = Paragraph(f"<b>{text}</b>", S["h2"])
    group = [p]
    if first_para:
        group.append(Paragraph(first_para, S["body"]))
    return [KeepTogether(group)]

def safe_keep_together(elements: list) -> list:
    total_h = 0
    for el in elements:
        w, h = el.wrap(AVAIL_W, PAGE_H)
        total_h += h
    if total_h <= MAX_KEEP_HEIGHT:
        return [KeepTogether(elements)]
    elif len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)

def make_table(headers: list, rows: list, ratios: list, caption: str | None = None) -> list:
    """Palette-compliant table: Paragraph cells, proportional widths, centered, header repeat."""
    assert abs(sum(ratios) - 1.0) < 0.01, "ratios must sum to 1"
    col_widths = [r * AVAIL_W * 0.98 for r in ratios]
    assert sum(col_widths) <= AVAIL_W + 0.5
    data = [[Paragraph(f"<b>{h}</b>", S["th"]) for h in headers]]
    for row in rows:
        data.append([c if isinstance(c, Paragraph) else Paragraph(str(c), S["td"]) for c in row])
    t = Table(data, colWidths=col_widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i), TABLE_ROW_EVEN if i % 2 == 1 else TABLE_ROW_ODD))
    t.setStyle(TableStyle(style))
    out = [Spacer(1, 10), t]
    if caption:
        out += [Paragraph(caption, S["caption"]), Spacer(1, 8)]
    else:
        out += [Spacer(1, 8)]
    return out

def stat_row(stats: list) -> list:
    """Row of metric callouts: [(value, label), ...] — data-to-ink rule."""
    n = len(stats)
    gap = 10
    cell_w = (AVAIL_W - gap * (n - 1)) / n
    cells, widths = [], []
    for i, (val, lab) in enumerate(stats):
        inner = Table(
            [[Paragraph(f"<b>{val}</b>", S["stat"])], [Paragraph(lab, S["statlabel"])]],
            colWidths=[cell_w],
        )
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
            ("BOX", (0, 0), (-1, -1), 1, ACCENT),
            ("TOPPADDING", (0, 0), (-1, 0), 8),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
            ("TOPPADDING", (0, 1), (-1, 1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        cells.append(inner)
        widths.append(cell_w)
        if i < n - 1:
            cells.append(Spacer(gap, 1))
            widths.append(gap)
    outer = Table([cells], colWidths=widths, hAlign="CENTER")
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [Spacer(1, 8), outer, Spacer(1, 10)]

def callout(text: str) -> list:
    inner = Table([[Paragraph(text, ParagraphStyle(
        "CO", parent=S["body"], alignment=TA_LEFT, spaceAfter=0, fontSize=10, leading=15.5))]],
        colWidths=[AVAIL_W * 0.97])
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SECTION_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 3, ACCENT),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [Spacer(1, 6), inner, Spacer(1, 8)]

# ---------------------------------------------------------------- doc template
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            # displayed body numbering = internal page - 1 (page 1 is the TOC, shown as roman i)
            self.notify("TOCEntry", (level, text, max(self.page - 1, 1), key))

DOC_TITLE = "ALNOKHBA MANAGEMENT - Autonomous AI System: Engineering Verification Report"

def _footer_roman(canvas, doc):
    canvas.saveState()
    canvas.setFont("FreeSerif", 9)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, "i")
    canvas.restoreState()

def _footer_arabic(canvas, doc):
    canvas.saveState()
    canvas.setFont("FreeSerif", 9)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, str(doc.page - 1))
    # header: muted title + accent rule
    canvas.setFont("FreeSerif", 7.5)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch, DOC_TITLE[:96])
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    canvas.restoreState()

def _page_painter(canvas, doc):
    # page background (Template 07 body: ultra-light blue)
    canvas.saveState()
    canvas.setFillColor(PAGE_BG)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.restoreState()
    if doc.page == 1:
        _footer_roman(canvas, doc)
    else:
        _footer_arabic(canvas, doc)

def build_toc() -> TableOfContents:
    toc = TableOfContents()
    toc.levelStyles = [S["toc0"], S["toc1"]]
    return toc
