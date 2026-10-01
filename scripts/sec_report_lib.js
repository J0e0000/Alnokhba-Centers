/* eslint-disable */
/**
 * Production Security Audit & Hardening Report — Alnokhba Centers
 * English LTR report — docx skill: R1 cover recipe (slate/crimson palette)
 * 3 sections: cover (margin 0) → TOC (roman) → body (arabic numbering, start 1)
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  PageBreak, Header, Footer, PageNumber, NumberFormat, SectionType,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, TableOfContents,
} = require("docx");
const fs = require("fs");

// ============================= palette (cool + heavy + security crimson accent) =============================
const PAL = {
  bg: "F2F4F7", primary: "1B2A41", accent: "8B2635",
  cover: { titleColor: "1B2A41", subtitleColor: "505A68", metaColor: "606A78", footerColor: "9AA2AE" },
  table: { headerBg: "1B2A41", headerText: "FFFFFF", accentLine: "1B2A41", innerLine: "D4D9E0", surface: "EEF1F5" },
};
const BODY = "14181F";
const FONT = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Calibri", cs: "Calibri" };

const allNoBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};

// ============================= LTR helpers =============================
function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, color: BODY, size: 22, ...opts });
}

function bodyP(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 140 },
    children: [run(text)],
    ...opts,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 380, after: 160, line: 380, lineRule: "atLeast" },
    children: [run(text, { bold: true, size: 30, color: PAL.primary })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120, line: 340, lineRule: "atLeast" },
    children: [run(text, { bold: true, size: 25, color: PAL.primary })],
  });
}

function noteP(text) {
  return new Paragraph({
    spacing: { line: 312, before: 60, after: 160 },
    children: [run(text, { italics: true, size: 19, color: "6A7280" })],
  });
}

function tableTitle(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 180, after: 80 },
    children: [run(text, { bold: true, size: 20, color: "3A4452" })],
  });
}

function dataTable(headers, rows, widths) {
  const mkCell = (text, isHeader, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: PAL.table.headerBg } : undefined,
    children: [new Paragraph({
      alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { line: 264 },
      children: [run(String(text), {
        bold: isHeader,
        size: isHeader ? 19 : 18,
        color: isHeader ? PAL.table.headerText : BODY,
      })],
    })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: PAL.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: PAL.table.innerLine },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((t, i) => mkCell(t, true, widths[i])) }),
      ...rows.map((r) => new TableRow({
        cantSplit: true,
        children: r.map((t, i) => mkCell(t, false, widths[i])),
      })),
    ],
  });
}

// ============================= cover (R1, LTR) =============================
function splitTitleLinesEn(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const words = title.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > charsPerLine && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur.trim());
  if (lines.length > 1 && lines[lines.length - 1].length <= 4) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}

function calcTitleLayoutEn(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 10;
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = Math.floor(maxWidthTwips / charWidth(titlePt));
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLinesEn(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLinesEn(title, Math.floor(maxWidthTwips / charWidth(minPt))); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayoutEn(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400, pageHeight: 16838, marginTop: 0, marginBottom: 0,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: P.accent, font: FONT, characterSpacing: 40 })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      indent: { left: padL, right: padR },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: P.cover.titleColor, font: FONT })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      indent: { left: padL, right: padR }, spacing: { after: 800, line: 340, lineRule: "atLeast" },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.cover.subtitleColor, font: FONT })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      indent: { left: padL + 200, right: padR }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 22, color: P.cover.metaColor, font: FONT })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: FONT }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.cover.footerColor, font: FONT }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg },
        borders: allNoBorders,
        children,
      })],
    })],
  })];
}

// ============================= footers / headers =============================
function pageNumFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080", font: FONT })],
    })],
  });
}

function docHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run("Production Security Audit — Alnokhba Centers Management System", { size: 17, color: "808080" })],
    })],
  });
}

module.exports = { PAL, BODY, FONT, run, bodyP, h1, h2, noteP, tableTitle, dataTable, buildCoverR1, pageNumFooter, docHeader,
  Document, Packer, Paragraph, TextRun, PageBreak, TableOfContents, SectionType, NumberFormat, AlignmentType, fs };