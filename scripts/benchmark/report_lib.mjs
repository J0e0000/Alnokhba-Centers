// generate_report.mjs — Final benchmark report (Arabic RTL docx)
// Data source: benchmark.db (baseline-v1 + retest-v2). Master prompt §6 FINAL REPORT structure.
import { DatabaseSync } from 'node:sqlite';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, TableOfContents, PageBreak,
  SectionType, TableLayoutType,
} from 'docx';
import { writeFileSync } from 'fs';

const db = new DatabaseSync('/home/z/my-project/benchmark/benchmark.db');

// ---------------- data ----------------
const q = (sql, ...p) => db.prepare(sql).all(...p);
const okBase = q(`SELECT COUNT(*) c FROM results WHERE run_id='baseline-v1' AND status='ok'`)[0].c;
const errBase = q(`SELECT COUNT(*) c FROM results WHERE run_id='baseline-v1' AND status='error'`)[0].c;
const bySplit = q(`SELECT t.split s, COUNT(*) c FROM results r JOIN tasks t ON t.task_id=r.task_id WHERE r.run_id='baseline-v1' AND r.status='ok' GROUP BY t.split`);
const splitMap = Object.fromEntries(bySplit.map(r => [r.s, r.c]));
const scored = q(`SELECT s.task_id, s.score, s.method, s.error_class, t.domain, t.split FROM scores s JOIN tasks t ON t.task_id=s.task_id WHERE s.run_id='baseline-v1' AND s.score IS NOT NULL`);
const nScored = scored.length;
const mean = nScored ? (scored.reduce((a, r) => a + r.score, 0) / nScored) : 0;
const bands = { pass: 0, review: 0, fail: 0 };
for (const r of scored) { if (r.score >= 85) bands.pass++; else if (r.score >= 70) bands.review++; else bands.fail++; }
const domAgg = {};
for (const r of scored) (domAgg[r.domain] ??= { n: 0, sum: 0 });
for (const r of scored) { domAgg[r.domain].n++; domAgg[r.domain].sum += r.score; }
const domRows = Object.entries(domAgg).map(([d, v]) => ({ d, n: v.n, mean: v.sum / v.n })).sort((a, b) => a.mean - b.mean);
const meta = q(`SELECT * FROM runs WHERE run_id='baseline-v1'`)[0];
const lat = q(`SELECT AVG(latency_ms) a, SUM(prompt_tokens) p, SUM(completion_tokens) c FROM results WHERE run_id='baseline-v1' AND status='ok'`)[0];

// retest comparison
const retestIds = q(`SELECT task_id FROM results WHERE run_id='retest-v2'`).map(r => r.task_id);
const cmpRows = [];
let v2n = 0, v2sum = 0, bSum = 0, bN = 0, improved = 0, regressed = 0, same = 0;
for (const tid of retestIds) {
  const b = q(`SELECT score FROM scores WHERE run_id='baseline-v1' AND task_id=?`, tid)[0];
  const v = q(`SELECT score FROM scores WHERE run_id='retest-v2' AND task_id=?`, tid)[0];
  const bs = b?.score ?? null, vs = v?.score ?? null;
  if (vs !== null) { v2n++; v2sum += vs; }
  if (bs !== null) { bSum += bs; bN++; }
  if (bs !== null && vs !== null) {
    if (vs > bs) improved++; else if (vs < bs) regressed++; else same++;
  }
  cmpRows.push({ tid, bs, vs });
}
const guardIds = (await import('fs')).readFileSync('/home/z/my-project/benchmark/retest_guard.txt', 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const guardRegressed = guardIds.filter(tid => {
  const b = q(`SELECT score FROM scores WHERE run_id='baseline-v1' AND task_id=?`, tid)[0]?.score ?? 100;
  const v = q(`SELECT score FROM scores WHERE run_id='retest-v2' AND task_id=?`, tid)[0]?.score;
  return v !== null && v !== undefined && v < 85 && b >= 85;
});
const retestOk = q(`SELECT COUNT(*) c FROM results WHERE run_id='retest-v2' AND status='ok'`)[0].c;
const retestErr = q(`SELECT COUNT(*) c FROM results WHERE run_id='retest-v2' AND status='error'`)[0].c;

// ---------------- palette (DM-1 Deep Cyan — AI/tech) ----------------
const P = {
  bg: '162235', accent: '37DCF2', tableAccent: '1B6B7A',
  cover: { titleColor: 'FFFFFF', subtitleColor: 'B0B8C0', metaColor: '90989F', footerColor: '687078' },
  table: { headerBg: '1B6B7A', headerText: 'FFFFFF', innerLine: 'C8DDE2', surface: 'EDF3F5' },
  primary: '0A1628', body: '000000', secondary: '506070',
};
const AR = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' };
const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { ...noBorders, insideHorizontal: NB, insideVertical: NB };

// ---------------- helpers (RTL) ----------------
const run = (text, o = {}) => new TextRun({ text, rightToLeft: true, font: AR, sizeComplexScript: o.size ?? o.sz ?? 24, size: o.size ?? o.sz ?? 24, bold: o.bold ?? false, color: o.color ?? P.body, italics: o.i ?? false });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 360, after: 160, line: 340, lineRule: 'atLeast' }, children: [run(text, { size: 32, bold: true, color: P.primary })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 120, line: 320, lineRule: 'atLeast' }, children: [run(text, { size: 28, bold: true, color: P.primary })] });
const body = (text, o = {}) => new Paragraph({ bidirectional: true, alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: o.after ?? 120 }, children: [run(text, o)] });
const bodyRuns = (runs, o = {}) => new Paragraph({ bidirectional: true, alignment: AlignmentType.JUSTIFIED, spacing: { line: 312, after: o.after ?? 120 }, children: runs.map(r => run(r.t, r)) });
const caption = (text) => new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, keepNext: true, spacing: { before: 160, after: 80 }, children: [run(text, { size: 21, bold: true, color: P.secondary })] });

function mkTable(headers, rows, widths) {
  const cell = (t, isHeader, w, i) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: isHeader ? P.table.headerBg : (i % 2 === 1 ? P.table.surface : 'FFFFFF') },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { line: 280 }, children: [run(String(t), { size: 20, bold: isHeader, color: isHeader ? P.table.headerText : P.body })] })],
  });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.tableAccent },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.tableAccent },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, j) => cell(h, true, widths[j], 0)) }),
      ...rows.map((r, i) => new TableRow({ cantSplit: true, children: r.map((c, j) => cell(c, false, widths[j], i)) })),
    ],
  });
}
const fmt = (x) => Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : '—';
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

// ---------------- cover (R1 mirrored for RTL) ----------------
function calcCoverSpacingAr(p) {
  const SAFETY = 1200;
  const usable = 16838 - SAFETY;
  const titleH = p.titleLineCount * (p.titlePt * 23 + 200);
  const subH = p.hasSubtitle ? (12 * 23 + 600) : 0;
  const labelH = p.hasLabel ? (9 * 23 + 600) : 0;
  const metaH = p.metaLineCount * (10 * 23 + 100);
  const content = titleH + subH + labelH + metaH + 400 + 900;
  const rem = Math.max(usable - content, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(rem * 0.45), rawBottom = Math.floor(rem * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  return { topSpacing, bottomSpacing };
}
// Arabic title: ~pt*11 twips/char (Arabic avg narrower than CJK pt*20)
function calcTitleLayoutAr(title, maxW, prefPt = 40, minPt = 24) {
  const cplFor = (pt) => Math.floor(maxW / (pt * 11));
  let titlePt = prefPt, lines;
  const split = (t, cpl) => {
    if (t.length <= cpl) return [t];
    const words = t.split(' ');
    const out = []; let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > cpl && cur) { out.push(cur.trim()); cur = w; }
      else cur = (cur + ' ' + w).trim();
    }
    if (cur) out.push(cur);
    if (out.length > 1 && out[out.length - 1].length <= 4) { const last = out.pop(); out[out.length - 1] += ' ' + last; }
    return out;
  };
  while (titlePt >= minPt) { lines = split(title, cplFor(titlePt)); if (lines.length <= 3) break; titlePt -= 2; }
  if (!lines || lines.length > 3) { lines = split(title, cplFor(minPt)); titlePt = minPt; }
  return { titlePt, titleLines: lines };
}
function buildCoverR1RTL(cfg) {
  const padL = 800, padR = 1200;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayoutAr(cfg.title, availableWidth, 40, 24);
  const spacing = calcCoverSpacingAr({ titleLineCount: titleLines.length, titlePt, hasSubtitle: !!cfg.subtitle, hasLabel: !!cfg.label, metaLineCount: cfg.metaLines.length });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  children.push(new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    indent: { right: padR, left: padL }, spacing: { after: 500 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
    children: [new TextRun({ text: cfg.label.split('').join(' '), size: 18, color: P.accent, font: AR, sizeComplexScript: 18, characterSpacing: 40 })],
  }));
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [new TextRun({ text: titleLines[i], size: titlePt * 2, sizeComplexScript: titlePt * 2, bold: true, color: P.cover.titleColor, font: AR, rightToLeft: true })],
    }));
  }
  children.push(new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT, indent: { right: padR }, spacing: { after: 800 },
    children: [new TextRun({ text: cfg.subtitle, size: 24, sizeComplexScript: 24, color: P.cover.subtitleColor, font: AR, rightToLeft: true })],
  }));
  for (const line of cfg.metaLines) {
    children.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.RIGHT,
      indent: { right: padR + 200, left: padL }, spacing: { after: 80 },
      border: { right: accentRight },
      children: [new TextRun({ text: line, size: 24, sizeComplexScript: 24, color: P.cover.metaColor, font: AR, rightToLeft: true })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    bidirectional: true, alignment: AlignmentType.RIGHT,
    indent: { right: padR, left: padL },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: cfg.footerRight, size: 16, sizeComplexScript: 16, color: P.cover.footerColor, font: AR, rightToLeft: true }),
      new TextRun({ text: '                                        ' }),
      new TextRun({ text: cfg.footerLeft, size: 16, sizeComplexScript: 16, color: P.cover.footerColor, font: AR, rightToLeft: true }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders, children })],
    })],
  })];
}

export { db, q, run, h1, h2, body, bodyRuns, caption, mkTable, fmt, pct, buildCoverR1RTL, P, AR, allNoBorders, noBorders,
  okBase, errBase, splitMap, scored, nScored, mean, bands, domRows, meta, lat, cmpRows, guardRegressed, retestOk, retestErr, v2n, v2sum, bN, bSum, improved, regressed, same };
