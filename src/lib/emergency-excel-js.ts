// مولّد الإكسل داخل نظام الطوارئ — ZIP + XML مكتوبين يدويًا بـ JavaScript خالص.
// صفر مكتبات خارجية: CRC32 + ZIP (stored) + OOXML مبني من الصفر.
// الهوية البصرية: كحلي 143159 / ذهبي D5A134 / Cairo / RTL / تجميد صفوف / فلاتر.

export const APP_EXCEL_JS = `
(function(){
"use strict";
// ================= CRC32 =================
var CRC_TABLE = (function(){
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf){
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ================= ZIP (stored, no compression) =================
function u16(v){ return [v & 255, (v >>> 8) & 255]; }
function u32(v){ return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
function strBytes(s){
  // TextEncoder متاح في كل المتصفحات الحديثة
  return new TextEncoder().encode(s);
}
function makeZip(files){
  // files: [{name: string, data: Uint8Array}]
  var localParts = [], centralParts = [], offset = 0;
  for (var f = 0; f < files.length; f++) {
    var nameB = strBytes(files[f].name);
    var data = files[f].data;
    var crc = crc32(data);
    var dosTime = u16(0), dosDate = u16(0x5821); // تاريخ ثابت — الملف للقراءة
    var local = [].concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), dosTime, dosDate,
      u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0)
    );
    var localArr = new Uint8Array(local.length + nameB.length + data.length);
    localArr.set(local, 0); localArr.set(nameB, local.length); localArr.set(data, local.length + nameB.length);
    localParts.push(localArr);

    var central = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), dosTime, dosDate,
      u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset)
    );
    var centralArr = new Uint8Array(central.length + nameB.length);
    centralArr.set(central, 0); centralArr.set(nameB, central.length);
    centralParts.push(centralArr);
    offset += localArr.length;
  }
  var centralSize = 0;
  for (var c = 0; c < centralParts.length; c++) centralSize += centralParts[c].length;
  var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0));
  var total = offset + centralSize + end.length;
  var out = new Uint8Array(total), pos = 0;
  for (var i = 0; i < localParts.length; i++) { out.set(localParts[i], pos); pos += localParts[i].length; }
  for (var j = 0; j < centralParts.length; j++) { out.set(centralParts[j], pos); pos += centralParts[j].length; }
  out.set(end, pos);
  return out;
}

// ================= أدوات XML =================
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    // strip control chars (XML-invalid)
    .replace(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/g, "");
}
function colLetter(n){ // 1 → A
  var s = "";
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function cellS(v, s, row, col){ // inline string
  return "<c r=\\"" + colLetter(col) + row + "\\" s=\\"" + s + "\\" t=\\"inlineStr\\"><is><t xml:space=\\"preserve\\">" + esc(v) + "</t></is></c>";
}
function cellN(v, s, row, col){ // number
  return "<c r=\\"" + colLetter(col) + row + "\\" s=\\"" + s + "\\"><v>" + (Math.round(v * 100) / 100) + "</v></c>";
}
function cellF(v, s, row, col){ // formula
  return "<c r=\\"" + colLetter(col) + row + "\\" s=\\"" + s + "\\"><f>" + esc(v) + "</f></c>";
}

// ================= صفحة (sheet) =================
function sheetXml(opts){
  // opts: {freeze: rowN, filter: {from: "A", to: colLetter, rows: n}, cols: [w,...], rows: [[cellXml,...]], dataBar: {ref, color}, merge: ["A1:F1"]}
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  x += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += "<sheetPr><outlinePr summaryBelow=\\"1\\"/></sheetPr>";
  var sv = '<sheetView rightToLeft=\\"1\\" showGridLines=\\"0\\" workbookViewId=\\"0\\">';
  if (opts.freeze) {
    sv += '<pane ySplit="' + opts.freeze + '" topLeftCell="A' + (opts.freeze + 1) + '" activePane="bottomLeft" state="frozen"/>';
  }
  sv += '<selection activeCell="A1" sqref="A1"/>';
  x += "<sheetViews>" + sv + "</sheetView>";
  x += "<sheetFormatPr defaultRowHeight=\\"15\\"/>";
  if (opts.cols) {
    x += "<cols>";
    for (var i = 0; i < opts.cols.length; i++) {
      x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + opts.cols[i] + '" customWidth="1"/>';
    }
    x += "</cols>";
  }
  x += "<sheetData>";
  for (var r = 0; r < opts.rows.length; r++) {
    var rowXml = "";
    for (var c = 0; c < opts.rows[r].length; c++) {
      if (opts.rows[r][c] !== "") rowXml += opts.rows[r][c];
    }
    if (rowXml) x += '<row r="' + (r + 1) + '" spans="1:' + Math.max(1, opts.rows[r].length) + '" ht="18" customHeight="1">' + rowXml + "</row>";
    else x += '<row r="' + (r + 1) + '"/>';
  }
  x += "</sheetData>";
  if (opts.merge && opts.merge.length) {
    x += "<mergeCells count=\\"" + opts.merge.length + "\\">";
    for (var m = 0; m < opts.merge.length; m++) x += '<mergeCell ref="' + opts.merge[m] + '"/>';
    x += "</mergeCells>";
  }
  if (opts.filter && opts.filter.rows > 0) {
    x += '<autoFilter ref="' + opts.filter.from + (opts.filter.freezeRow + 1) + ":" + opts.filter.to + (opts.filter.rows) + '"/>';
  }
  if (opts.dataBar) {
    x += '<conditionalFormatting sqref="' + opts.dataBar.ref + '"><dataBar showValue="1"><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="' + opts.dataBar.color + '"/></dataBar></conditionalFormatting>';
  }
  x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.2" footer="0.2"/>';
  x += "</worksheet>";
  return x;
}

// ================= المصفوفة إلى صفوف =================
function headerRow(cells, style, rowN){
  var out = [];
  for (var i = 0; i < cells.length; i++) out.push(cellS(cells[i], style, rowN, i + 1));
  return out;
}
function dataRow(cells, rowN, zebra){
  // cells: [{v, n: bool(number?), s: customStyle}]
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    if (c == null) { out.push(""); continue; }
    var base = c.s != null ? c.s : (zebra ? 7 : 4);
    out.push(c.n ? cellN(c.v, c.n2 != null ? c.n2 : (c.s != null ? c.s : (zebra ? 8 : 5)), rowN, i + 1) : cellS(c.v, base, rowN, i + 1));
  }
  return out;
}

var NAVY = "FF143159", GOLD = "FFD5A134", ZEBRA = "FFEDF1F7", SOFT = "FFEDF1F7";

function stylesXml(){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
'<numFmts count="1"><numFmt numFmtId="176" formatCode="#,##0.00&quot; ج&quot;"/></numFmts>' +
'<fonts count="7">' +
'<font><sz val="10.5"/><name val="Cairo"/><color rgb="FF1B2635"/></font>' + // 0 عادي
'<font><sz val="10.5"/><b/><name val="Cairo"/><color rgb="FF1B2635"/></font>' + // 1 عريض
'<font><sz val="12"/><b/><name val="Cairo"/><color rgb="' + NAVY + '"/></font>' + // 2 عنوان قسم
'<font><sz val="16"/><b/><name val="Cairo"/><color rgb="' + NAVY + '"/></font>' + // 3 قيمة KPI
'<font><sz val="18"/><b/><name val="Cairo"/><color rgb="' + NAVY + '"/></font>' + // 4 عنوان الملف
'<font><sz val="11"/><b/><name val="Cairo"/><color rgb="FFFFFFFF"/></font>' + // 5 هيدر أبيض
'<font><sz val="10.5"/><name val="Cairo"/><color rgb="FF64748B"/></font>' + // 6 خافت
'</fonts>' +
'<fills count="8">' +
'<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
'<fill><patternFill patternType="solid"><fgColor rgb="' + NAVY + '"/><bgColor indexed="64"/></patternFill></fill>' + // 2 كحلي
'<fill><patternFill patternType="solid"><fgColor rgb="' + GOLD + '"/><bgColor indexed="64"/></patternFill></fill>' + // 3 ذهبي
'<fill><patternFill patternType="solid"><fgColor rgb="' + ZEBRA + '"/><bgColor indexed="64"/></patternFill></fill>' + // 4 زيبرا
'<fill><patternFill patternType="solid"><fgColor rgb="FFFBF3E0"/><bgColor indexed="64"/></patternFill></fill>' + // 5 ذهبي فاتح
'<fill><patternFill patternType="solid"><fgColor rgb="FFF5F7FA"/><bgColor indexed="64"/></patternFill></fill>' + // 6 خلفية الصفحة
'</fills>' +
'<borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border>' +
'<border><left style="thin"><color rgb="FFE3E9F0"/></left><right style="thin"><color rgb="FFE3E9F0"/></right><top style="thin"><color rgb="FFE3E9F0"/></top><bottom style="thin"><color rgb="FFE3E9F0"/></bottom><diagonal/></border>' + // 1 حدود خفيفة
'<border><left style="thin"><color rgb="FFE3E9F0"/></left><right style="thin"><color rgb="FFE3E9F0"/></right><top style="medium"><color rgb="' + NAVY + '"/></top><bottom style="thin"><color rgb="FFE3E9F0"/></bottom><diagonal/></border>' + // 2 إجمالي (فوق متوسط)
'<border><left/><right/><top style="thin"><color rgb="' + GOLD + '"/></top><bottom style="thin"><color rgb="' + GOLD + '"/></bottom><diagonal/></border>' + // 3 ذهبي
'</borders>' +
'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
'<cellXfs count="16">' +
'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0 افتراضي
'<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 1 عنوان كبير
'<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 2 عنوان قسم
'<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 3 هيدر كحلي
'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 4 خلية عادية
'<xf numFmtId="176" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' + // 5 فلوس
'<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 6 عريض
'<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 7 زيبرا
'<xf numFmtId="176" fontId="1" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' + // 8 زيبرا فلوس
'<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/></xf>' + // 9 خافت
'<xf numFmtId="0" fontId="3" fillId="6" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 10 قيمة KPI
'<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 11 هيدر ذهبي
'<xf numFmtId="176" fontId="1" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' + // 12 إجمالي فلوس
'<xf numFmtId="0" fontId="1" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 13 خلية إجمالي
'<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 14 ذهبي فاتح
'<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' + // 15 عريض محاذاة شمال
'</cellXfs>' +
'<cellStyles count="1"><cellStyle name="افتراضي" xfId="0" builtinId="0"/></cellStyles>' +
'<dxfs count="0"/><tableStyles count="0" defaultTableStyle="0" defaultPivotStyle="0"/>' +
'</styleSheet>';
}

var SHEETS = [
  ["لوحة التقرير", "DASHBOARD"],
  ["الطلاب", "STUDENTS"],
  ["الاشتراكات", "SUBSCRIPTIONS"],
  ["الحضور", "ATTENDANCE"],
  ["الدفعات", "PAYMENTS"],
  ["الحصص", "SESSIONS"],
  ["مستحقات المدرسين", "TEACHER_EARNINGS"],
  ["معاملات الطوارئ", "TXNS"],
  ["ملاحظات الاستيراد", "NOTES"],
  ["معلومات التصدير", "EXPORT_INFO"],
];

function workbookXml(){
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  x += '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  x += '<workbookPr/>';
  x += "<sheets>";
  for (var i = 0; i < SHEETS.length; i++) {
    x += '<sheet name="' + esc(SHEETS[i][0]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
  }
  x += "</sheets></workbook>";
  return x;
}
function workbookRels(){
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  x += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (var i = 0; i < SHEETS.length; i++) {
    x += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
  }
  x += '<Relationship Id="rId' + (SHEETS.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  x += "</Relationships>";
  return x;
}
function contentTypes(){
  var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  x += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
  x += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
  x += '<Default Extension="xml" ContentType="application/xml"/>';
  x += '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  for (var i = 0; i < SHEETS.length; i++) {
    x += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  x += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  x += "</Types>";
  return x;
}
function rootRels(){
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";
}

// ================= البناء الكامل =================
// data: {centerName, generatedAt, expiresAt, exportedAt, days, kpis:{...},
//        students:[[..]], subs, att, pays, sess, earn, txns, notes, licenseInfo}
function buildXlsx(d){
  var files = [];
  function addSheet(rows, opts){
    files.push({ name: "xl/worksheets/sheet" + (files.length + 1) + ".xml", data: strBytes(sheetXml(Object.assign({ rows: rows }, opts || {}))) });
  }
  var pad = function(v){ return v < 10 ? "0" + v : "" + v; };
  function fmtDate(iso){
    try { var t = new Date(iso); return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()) + " " + pad(t.getHours()) + ":" + pad(t.getMinutes()); }
    catch (e) { return ""; }
  }

  // ===== 1) لوحة التقرير =====
  var rows = [];
  rows.push([cellS("ALNOKHBA MANAGEMENT — تقرير الطوارئ", 1, 1, 1)]);
  rows.push([cellS(d.centerName + " — وضع الطوارئ (" + fmtDate(d.generatedAt) + " ← " + fmtDate(d.expiresAt) + ")", 2, 2, 1)]);
  rows.push([cellS("اتصدّر: " + fmtDate(d.exportedAt), 9, 3, 1)]);
  rows.push([]);
  var kpiLabels = [
    ["إجمالي الطلاب", d.kpis.students],
    ["اشتراكات نشطة", d.kpis.subs],
    ["حصص اشتغلت", d.kpis.sessions],
    ["حضور مسجّل", d.kpis.attendance],
    ["تحصيلات (جنيه)", d.kpis.collected],
    ["أرصدة مدينة (جنيه)", d.kpis.outstanding],
    ["مستحقات المدرسين (جنيه)", d.kpis.earnings],
    ["معاملات طوارئ", d.kpis.txns],
    ["حاجات متخطاة/مراجعة", d.kpis.notes],
  ];
  for (var k = 0; k < kpiLabels.length; k++) {
    rows.push([cellS(kpiLabels[k][0], 6, k + 5, 1), cellN(kpiLabels[k][1], 10, k + 5, 2)]);
  }
  rows.push([]);
  var pStart = rows.length + 2;
  rows.push(headerRow(["اليوم", "عدد الدفعات", "التحصيل (ج)"], 3, 1));
  for (var pd = 0; pd < d.byDay.length; pd++) {
    rows.push(dataRow([{ v: d.byDay[pd][0] }, { v: d.byDay[pd][1], n: true }, { v: d.byDay[pd][2] / 100, n: true }], rows.length + 1, pd % 2 === 1));
  }
  var pEnd = rows.length;
  rows.push(dataRow([{ v: "الإجمالي", s: 13 }, { v: "", s: 13 }, { v: "", s: 13 }], rows.length + 1, false));
  rows[rows.length - 1][1] = cellF("SUM(B" + pStart + ":B" + pEnd + ")", 13, rows.length, 2);
  rows[rows.length - 1][2] = cellF("SUM(C" + pStart + ":C" + pEnd + ")", 12, rows.length, 3);
  rows.push([cellS("الرخصة: " + d.licenseInfo, 9, rows.length + 1, 1)]);
  addSheet(rows, {
    merge: ["A1:B1", "A2:B2", "A3:B3"],
    cols: [34, 16],
    dataBar: { ref: "C" + pStart + ":C" + pEnd, color: NAVY },
  });

  // ===== صفحات البيانات =====
  function tableSheet(header, widths, dataRows, moneyCols, filter, freeze){
    var r = [];
    r.push(headerRow(header, 3, 1));
    for (var i = 0; i < dataRows.length; i++) {
      var cells = [];
      for (var c = 0; c < dataRows[i].length; c++) {
        var raw = dataRows[i][c];
        if (raw == null) { cells.push({ v: "" }); continue; }
        var isMoney = moneyCols.indexOf(c) >= 0;
        cells.push(isMoney ? { v: raw / 100, n: true } : { v: raw });
      }
      r.push(dataRow(cells, r.length + 1, i % 2 === 1));
    }
    if (dataRows.length === 0) r.push([cellS("(مفيش بيانات)", 9, 2, 1)]);
    addSheet(r, {
      freeze: freeze != null ? freeze : 1,
      filter: { from: "A", to: colLetter(header.length), freezeRow: 0, rows: r.length },
      cols: widths,
    });
    return r.length;
  }

  // 2) الطلاب
  tableSheet(["الكود", "الاسم", "الموبايل", "ولي الأمر", "المرحلة", "المجموعات", "الحالة", "الرصيد (ج)"],
    [10, 26, 15, 15, 18, 30, 12, 14], d.students, [7]);
  // 3) الاشتراكات
  tableSheet(["الطالب", "الكود", "المجموعة", "سعر الحصة (ج)", "حصص اتعملت", "الرصيد الحالي (ج)", "الحالة"],
    [26, 10, 26, 14, 12, 16, 12], d.subs, [3, 5]);
  // 4) الحضور
  tableSheet(["التاريخ", "الحصة", "الطالب", "الكود", "الحالة", "الخصم (ج)", "الوقت", "مرجع العملية"],
    [12, 26, 26, 10, 12, 12, 18, 24], d.att, [5]);
  // 5) الدفعات
  tableSheet(["التاريخ", "الطالب", "الكود", "المبلغ (ج)", "الطريقة", "رصيد قبل (ج)", "رصيد بعد (ج)", "مرجع العملية"],
    [12, 26, 10, 14, 14, 14, 14, 24], d.pays, [3, 5, 6]);
  // 6) الحصص
  tableSheet(["التاريخ", "المجموعة", "المدرس", "الوقت", "القاعة", "الحالة", "حضور", "إيراد (ج)", "مرجع العملية"],
    [12, 26, 18, 14, 14, 12, 8, 14, 24], d.sess, [7]);
  // 7) مستحقات المدرسين
  tableSheet(["المدرس", "المجموعات", "مستحق اللقطة (ج)", "زي الطوارئ (ج)", "الإجمالي (ج)"],
    [26, 30, 16, 16, 16], d.earn, [2, 3, 4]);
  // 8) معاملات الطوارئ
  tableSheet(["#", "مرجع العملية", "النوع", "الكيان", "الفاعل", "الوقت", "المبلغ (ج)", "المجموع (تحقق)"],
    [6, 24, 20, 22, 16, 18, 14, 20], d.txns, [6]);
  // 9) ملاحظات الاستيراد
  tableSheet(["النوع", "التفاصيل", "المرجع"], [22, 50, 24], d.notes, []);
  // 10) معلومات التصدير
  var info = [];
  info.push(headerRow(["البند", "القيمة"], 3, 1));
  var infoRows = [
    ["المنتج", "ALNOKHBA MANAGEMENT — نظام الطوارئ"],
    ["السنتر", d.centerName],
    ["معرف السنتر", d.centerId],
    ["معرف الحزمة", d.packageId],
    ["معرف اللقطة", d.snapshotId],
    ["بداية الطوارئ", fmtDate(d.generatedAt)],
    ["انتهاء الصلاحية", fmtDate(d.expiresAt)],
    ["وقت التصدير", fmtDate(d.exportedAt)],
    ["بصمة اللقطة (SHA-256)", d.snapshotDigest],
    ["بصمة المفتاح", d.keyFp],
    ["إصدار التطبيق", d.appVersion],
    ["عدد المعاملات", d.kpis.txns],
    ["طريقة الاستيراد", "ارفع ملف الاسترداد (JSON) من: الطوارئ ← استيراد ملف الاسترداد"],
  ];
  for (var ir = 0; ir < infoRows.length; ir++) {
    info.push(dataRow([{ v: infoRows[ir][0], s: 6 }, { v: infoRows[ir][1] }], info.length + 1, ir % 2 === 1));
  }
  addSheet(info, { freeze: 1, filter: { from: "A", to: "B", freezeRow: 0, rows: info.length }, cols: [26, 46] });

  // ================= الحزمة النهائية =================
  files.unshift({ name: "[Content_Types].xml", data: strBytes(contentTypes()) });
  files.splice(1, 0, { name: "_rels/.rels", data: strBytes(rootRels()) });
  var wbIndex = 2;
  files.splice(wbIndex, 0, { name: "xl/workbook.xml", data: strBytes(workbookXml()) });
  files.splice(wbIndex + 1, 0, { name: "xl/_rels/workbook.xml.rels", data: strBytes(workbookRels()) });
  files.splice(wbIndex + 2, 0, { name: "xl/styles.xml", data: strBytes(stylesXml()) });
  // إعادة ترتيب: sheet names لازم تتطابق مع الترتيب — اتحلت بإنشاء sheets قبل الإضافة
  return makeZip(files);
}

// تصدير
window.NKEX = { buildXlsx: buildXlsx, crc32: crc32, makeZip: makeZip };
})();
`;
