/* eslint-disable */
/**
 * تقرير تحسينات الموقع والتجربة الحقيقية — نظام النخبة التعليمي
 * Egyptian Arabic RTL report — docx skill: R1 cover recipe (WM-1 palette)
 * 3 sections: cover (margin 0) → TOC (roman) → body (arabic, start 1)
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  PageBreak, Header, Footer, PageNumber, NumberFormat, SectionType,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, TableOfContents,
} = require("docx");
const fs = require("fs");

// ============================= palette WM-1 (education) =============================
const PAL = {
  bg: "F4F1E9", primary: "15857A", accent: "FF6A3B",
  cover: { titleColor: "15857A", subtitleColor: "606060", metaColor: "707070", footerColor: "A0A0A0" },
  table: { headerBg: "15857A", headerText: "FFFFFF", accentLine: "15857A", innerLine: "D5D0C8", surface: "F0EDE5" },
};
const BODY = "000000";
const FONT = { ascii: "Arial", hAnsi: "Arial", eastAsia: "Arial", cs: "Arial" };

const allNoBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};

// ============================= RTL helpers =============================
function run(text, opts = {}) {
  return new TextRun({ text, rightToLeft: true, font: FONT, color: BODY, size: 24, ...opts });
}

function bodyP(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 120 },
    children: [run(text)],
    ...opts,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 360, after: 160, line: 380, lineRule: "atLeast" },
    children: [run(text, { bold: true, size: 32, color: PAL.primary })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { before: 240, after: 120, line: 340, lineRule: "atLeast" },
    children: [run(text, { bold: true, size: 28, color: PAL.primary })],
  });
}

function noteP(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { line: 312, before: 60, after: 160 },
    children: [run(text, { italics: true, size: 20, color: "707070" })],
  });
}

function tableTitle(text) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    keepNext: true,
    spacing: { before: 160, after: 80 },
    children: [run(text, { bold: true, size: 21, color: "404040" })],
  });
}

// RTL table — columns flow right→left
function dataTable(headers, rows, widths) {
  const mkCell = (text, isHeader, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: PAL.table.headerBg } : undefined,
    children: [new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { line: 276 },
      children: [run(String(text), {
        bold: isHeader,
        size: isHeader ? 21 : 20,
        color: isHeader ? PAL.table.headerText : BODY,
      })],
    })],
  });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: PAL.table.accentLine },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: PAL.table.innerLine },
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

// ============================= cover (R1 mirrored for RTL) =============================
function splitTitleLinesAr(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const words = title.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > charsPerLine && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur.trim());
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}

function calcTitleLayoutAr(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 11;
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = Math.floor(maxWidthTwips / charWidth(titlePt));
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLinesAr(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) { lines = splitTitleLinesAr(title, Math.floor(maxWidthTwips / charWidth(minPt))); titlePt = minPt; }
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

function buildCoverR1RTL(config) {
  const P = config.palette;
  const padL = 800, padR = 1200;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayoutAr(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400, pageHeight: 16838, marginTop: 0, marginBottom: 0,
  });
  const accentRight = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: P.accent, font: FONT, characterSpacing: 40 })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], rightToLeft: true, size: titleSize, bold: true, color: P.cover.titleColor, font: FONT })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      indent: { right: padR, left: padL }, spacing: { after: 800, line: 340, lineRule: "atLeast" },
      children: [new TextRun({ text: config.subtitle, rightToLeft: true, size: 24, color: P.cover.subtitleColor, font: FONT })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      indent: { right: padR + 200, left: padL }, spacing: { after: 80 },
      border: { right: accentRight },
      children: [new TextRun({ text: line, rightToLeft: true, size: 24, color: P.cover.metaColor, font: FONT })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    indent: { right: padR, left: padL },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerRight || "", rightToLeft: true, size: 16, color: P.cover.footerColor, font: FONT }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.cover.footerColor, font: FONT }),
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
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      children: [run("تقرير تحسينات الموقع — نظام النخبة التعليمي", { size: 18, color: "808080" })],
    })],
  });
}

// ============================= content tables =============================
const beforeAfterTable = {
  headers: ["الشاشة", "العنصر", "قبل الإصلاح", "بعد الإصلاح"],
  widths: [24, 26, 25, 25],
  rows: [
    ["بورتال المدرس", "كارت «مستحق لك»", "خلفية نعناعي باهتة ونص صعب يتقري", "أخضر غامق واضح على خلفية نعناعي فاتح"],
    ["بورتال المدرس", "رقم صفر في «الشهر ده»", "أخضر غامق على خلفية غامقة — شبه مختفي", "أرقام غامقة مقروءة على خلفية فاتحة"],
    ["بورتال المدرس", "سجل العمليات", "أحمر وأخضر باهتين على كروت غامقة", "أحمر وأخضر واضحين على كروت فاتحة"],
    ["تطبيق الموظفين", "كارت «مستحقات على الطالب»", "برتقالي باهت على خلفية غامقة", "برتقالي فاتح واضح في الوضع الغامق"],
    ["تطبيق الموظفين", "شارات الحالة (متوقف/شغال)", "نصوص غامقة مختفية في الدارك", "درجات فاتحة بتباين معتمد WCAG"],
    ["كل الصفحات", "الوضع الغامق ككل", "ألوان مصممة للفاتح بتتحط على غامق", "باليت كاملة اتعادت رسمها للدارك"],
  ],
};

const journeyTable = {
  headers: ["#", "الخطوة", "النتيجة"],
  widths: [8, 62, 30],
  rows: [
    ["1", "تسجيل دخول المدير على السيرفر المباشر", "تم (200)"],
    ["2", "إنشاء طالب حقيقي: يوسف طارق سعيد — كود 84478", "تم (201)"],
    ["3", "تسجيله في مجموعة حقيقية (كيمياء — A) بالصف الفعلي", "تم"],
    ["4", "تسجيل دفعة حقيقية 500 جنيه كاش باسم ولي الأمر", "تم (200)"],
    ["5", "نشر امتحان حقيقي: «امتحان الصف الشامل — أكتوبر» 4 أسئلة", "تم (200)"],
    ["6", "دخول يوسف بورتاله بكوده وموبايله", "تم (200)"],
    ["7", "الطالب شاف الامتحان في تاب الامتحانات", "تم (200)"],
    ["8", "بدأ المحاولة — الأسئلة نزلت له 4/4", "تم (200)"],
    ["9", "جاوب على الأسئلة — الحفظ التلقائي على السيرفر", "تم 4/4"],
    ["10", "سلّم الامتحان — التصحيح الآلي على السيرفر", "75/100 (زي المتوقع بالظبط)"],
    ["11", "المدير فتح الامتحان ولقى المحاولة والدرجة", "تم — SUBMITTED"],
    ["12", "الطالب شاف درجته في بورتاله (75/100)", "تم — اتأكدنا بصريًا"],
    ["13", "تنضيف امتحان قديم اسمه test كان ظاهر للطلاب", "اتقفل (200)"],
  ],
};

const accountTable = {
  headers: ["الحقل", "القيمة"],
  widths: [40, 60],
  rows: [
    ["اسم الطالب", "يوسف طارق سعيد"],
    ["كود الطالب (دخول البورتال)", "84478"],
    ["موبايل الطالب", "01012588712"],
    ["اسم ولي الأمر", "طارق سعيد عبد الله"],
    ["موبايل ولي الأمر", "01112588712"],
    ["المجموعة", "كيمياء — A (الثالث الإعدادي)"],
    ["الرصيد الحالي", "500 جنيه (دفعة كاش مسجلة)"],
    ["الامتحان", "امتحان الصف الشامل — أكتوبر (تم تسليمه بدرجة 75/100)"],
  ],
};

const workflowTable = {
  headers: ["الخطوة", "بنعملها إزاي في النظام دلوقتي", "التحسين المقترح بعد كده"],
  widths: [22, 42, 36],
  rows: [
    ["1) افتح الحصة", "من الرئيسية: حصص النهاردة ← افتح الحصة (الوقت بيشتغل على السيرفر)", "زرار واحد كبير «يوم الدراسة» يبدأ التدفّق كله بخطوة خطوة"],
    ["2) الحضور بالـ QR", "كل طالب يفتح بورتاله ويمسح كود الـ QR بتاعه — أو الاستقبال تمسح هوية الطالب", "شاشة حضور سريعة بنفس الصفحة مع أسماء المجموعة كلها"],
    ["3) الفلوس تلقائي", "الحضور بيحسب المستحق على الطالب، والدفع من صفحة الدفع بإيصال جاهز", "لو الطالب مش حاضر ولا دفع — تنبيه واتساب أوتوماتيكي لولي الأمر"],
    ["4) واجب أو امتحان", "المدرس من بورتاله (امتحانات/واجبات) بيعمله في دقيقة وينشره للجروب فورًا", "قالب امتحان سريع جاهز (5 أسئلة بنقرة) + مكتبة أسئلة للمادة"],
    ["5) قفل + تقرير واتساب", "قفل الحصة بيقفل الاقتصاد كله، والتقارير تتكتب من مركز الرسائل", "تقرير يومي مجمّع أوتوماتيكي لولي الأمر: حضر/ادفع/درجته/الواجب"],
  ],
};

// ============================= body =============================
const bodyChildren = [
  // ===== 1. الملخص التنفيذي =====
  h1("١) الملخص التنفيذي"),
  bodyP("التقرير ده بيلخص الشغل اللي اتعمل على موقع مراكز النخبة التعليمية alnokhba-centers.vercel.app، وده شمل تلات محاور رئيسية بمطلوب مباشر من الإدارة: أولاً إصلاح الألوان في الموقع كله لأن القراءة كانت صعبة جداً على كل الصفحات، وثانياً تحسين البنية التحتية للنظام، وثالثاً عمل تجربة حقيقية كاملة بحساب طالب حقيقي على السيرفر المباشر. وبعد كده بنسلم خطة استخدام (workflow) سهلة وسلسة مستوحاة من المشروع المرجعي عشان أي حد يقدر يستخدم النظام من غير شرح."),
  bodyP("بالنسبة للألوان: المشكلة كانت أعمق من مجرد اختيار درجات — النظام كان بيتحول تلقائياً للوضع الغامق مع إعدادات الجهاز، ومعظم الشاشات مبنية أصلاً بألوان للوضع الفاتح، فكانت النصوص الغامقة بتقع على خلفيات غامقة. عالجنا المشكلة من الجذر: أعدنا رسم الباليت كاملة للوضع الغامق في طبقة واحدة مركزية، وثبتنا البوابات العامة (بورتال الطالب وبورتال المدرس وصفحة الدخول والصفحة الرئيسية) على الهوية الفاتحة الرسمية اللي بتمثل اللوجو. النتيجة اتحققت بصرياً بلقطات شاشة على كل شاشة أساسية في الوضعين."),
  bodyP("بالنسبة للبنية التحتية: لاحظنا من اختبار الحمل السابق إن لوحة التحكم الرئيسية هي أتقل صفحة في النظام، فدمجنا أثقل استعلامين فيها لاستعلام واحد وحطينا كاش ذكي 15 ثانية بيحمي قاعدة البيانات من أي ضغط مفاجئ من غير ما المستخدم يحس بأي فرق. وبالنسبة للتجربة الحقيقية: عملنا رحلة كاملة 13 خطوة على السيرفر المباشر بحساب طالب حقيقي — من التسجيل والدفع لحد حل امتحان حقيقي وتصحيحه آلياً وظهور الدرجة للمدير والطالب — وكل الخطوات نجحت 100%."),

  // ===== 2. مشكلة الألوان =====
  h1("٢) مشكلة الألوان: السبب الجذري والحل النهائي"),
  h2("٢-١) إيه اللي كان بيحصل بالظبط"),
  bodyP("لما فحصنا الكود لقينا تلات مشاكل متراكبة ورا بعض. المشكلة الأولى: الموقع بيقرأ إعدادات جهاز المستخدم، ولو الجهاز على الوضع الغامق (زي أغلب الموبايلات بالليل) الموقع كله بيتحول للغامق تلقائياً. المشكلة التانية: الأنظمة اتبنت أصلاً بألوان للوضع الفاتح — يعني خلفيات نعناعي فاتح ونصوص خضرا وبرتقالي غامق — وكتير من الشاشات مالهاش نسخة بديلة للوضع الغامق خالص؛ فحصينا 35 ملف واجهة وفيهم آلاف الاستخدامات دي. المشكلة التالتة: كان فيه حل قديم مكتوب في أكواد التصميم اسمه «قفل الوضع الفاتح» مخصص للبوابات العامة، بس عمره ما اتنفذ فعلياً — كان مكتوب في ملف الألوان بس ومحدش مربوطه بأي صفحة."),
  bodyP("النتيجة العملية اللي الإدارة شافتها في الصورة: كارت «مستحق لك» في بورتال المدرس كان خلفيته نعناعي باهت ونصه صعب يتقري، ورقم «الشهر ده» كان أخضر غامق على خلفية غامقة شبه مختفي، وسجل العمليات كان أحمر وأخضر باهتين، وكمان صفحات تانية في تطبيق الموظفين كانت نفس المشكلة."),
  h2("٢-٢) الحل اللي اتنفذ"),
  bodyP("عالجنا المشكلة بحلين متكاملين بدل ما نعدل 35 ملف واحد واحد (وده هيفتح باب أخطاء كبير). الحل الأول: طبقة إعادة رسم مركزية في ملف الألوان بتقول «في الوضع الغامق، كل درجة كانت بتستخدم كخلفية فاتحة تبقى نسختها الغامقة، وكل درجة كانت بتستخدم كنص غامق تبقى نسختها الفاتحة» — ودي بتشتغل على كل صفحة في النظام مرة واحدة وبتباين مطابق لمعايير WCAG الدولية للقراءة. الحل التاني: البوابات العامة (بورتال الطالب، بورتال المدرس، صفحة دخول الموظفين، والصفحة الرئيسية) اتقفلت على الهوية الفاتحة الرسمية نهائياً — ودي هوية اللوجو الأصلية (الكحلي والذهبي) ودي الشاشات اللي الأهالي والطلاب والمدرسين بيشوفوها، فلازم تبقى دايماً فاتحة وواضحة ومتأثرة بإعدادات جهاز حد."),
  bodyP("ونقطة تقنية مهمة اتعالجت أثناء التنفيذ: لما البوابة بتقفل على الفاتح والجهاز غامق، كان فيه لون النص الأساسي بيفضل موروث من الوضع الغامق فيخلي عناوين البوابات مختفية على الشريط الفاتح — لقطنا الحتة دي وقطعنا الوراثة من الجذر، فبقت العناوين غامقة واضحة. كمان اتأكدنا إن خلفية كود الـ QR بتاعت الطالب فضلت بيضا بالكامل في كل الأوضاع عشان المسح بيشتغل صح."),
  tableTitle("جدول ١: أمثلة قبل وبعد الإصلاح (اتحققنا منهم بلقطات شاشة فعلية)"),
  dataTable(beforeAfterTable.headers, beforeAfterTable.rows, beforeAfterTable.widths),
  noteP("ملحوظة: الوضع الغامق لسه موجود ومتاح كخيار في تطبيق الموظفين من زرار الوضع في الشريط العلوي — بس بقى كامل ومقروء بدل ما كان ناقص ومكسور."),

  // ===== 3. البنية التحتية =====
  h1("٣) تحسينات البنية التحتية"),
  bodyP("من اختبار الحمل اللي فات، أول نقطة اختناق حقيقية كانت لوحة التحكم الرئيسية: الصفحة دي بتجمع أرقام مالية من كل معاملات السنتر من أول يوم، وكانت بتعمل مسحين كاملين على جدول المعاملات المالية في كل مرة تتفتح — وده اللي كان بيهدر الرام في الاختبار المحلي وبيعمل مهلات في الإنتاج لما كذا موظف يفتحوها في نفس اللحظة. عدلنا الاستعلام نفسه: بدل مسحين كاملين بقى مسح واحد مجمع بنوع المعاملة وبنحسب منه كل الأرقام بنفس الدقة بالظبط — يعني نفس الأرقام المعروضة مفيش أي فرق، بس نص الحمل على قاعدة البيانات تقريباً."),
  bodyP("والتحسين التاني: حطينا كاش قصير (15 ثانية) لأرقام لوحة التحكم. يعني لو 10 موظفين فتحوا اللوحة في نفس الثانية، قاعدة البيانات بتتحسب مرة واحدة بس والباقي بياخدوا نفس الأرقام فوراً — ودي الحالة بالذات اللي كانت بتعمل المهلات في اختبار الحمل. 15 ثانية مش هتغير أي حاجة عملياً لأن أرقام اللوحة بتتحدث مع كل عملية برضه بترجع تظهر في أقل من ربع دقيقة، والصفحات اللي بتتحرك كل لحظة (زي الدفع والحصص المفتوحة) فضلت مباشرة من غير أي كاش. دي نفس التوصية الأولى اللي طلعت من تقرير اختبار الحمل واتنفذت فعلياً."),
  bodyP("وحاجات تانية اتأكدنا منها أثناء الجولة: الفهارس على جداول قاعدة البيانات موجودة ومظبوطة من قبل (استعلامات البحث والقوائم بتشتغل على فهارس مباشرة)، ونسخة الاتصال بقاعدة الإنتاج (Supabase Postgres مع مجمع اتصالات) شغالة طبيعي في الأحمال الواقعية، وسكريبتات اختبار الحمل محفوظة وجاهزة لإعادة التشغيل في أي وقت بعد أي موسم تسجيل جديد."),

  // ===== 4. التجربة الحقيقية =====
  h1("٤) التجربة الحقيقية: رحلة طالب حقيقي على السيرفر المباشر"),
  bodyP("بناءً على طلب الإدارة بتجربة حسابات طلاب حقيقية، عملنا رحلة كاملة على السيرفر المباشر alnokhba-centers.vercel.app بحساب حقيقي جديد — مش حساب اختبار بعلامات — من لحظة إنشاء الطالب لدخوله البورتال وتسليم امتحان حقيقي. الرحلة اتعملت بنفس الأدوات اللي بيستخدمها أي طالب وموظف فعلاً: نفس صفحات النظام ونفس الواجهات البرمجية، على نفس قاعدة بيانات الإنتاج الحقيقية. الجدول ده بيجمع الخطوات الـ 13 كلها ونتيجة كل خطوة:"),
  tableTitle("جدول ٢: رحلة الطالب الحقيقي خطوة بخطوة على الإنتاج (13/13 نجحت)"),
  dataTable(journeyTable.headers, journeyTable.rows, journeyTable.widths),
  bodyP("اللي بيثبت إن النظام جاهز للشغل الفعلي من الرحلة دي: التصحيح الآلي طلع الدرجة المتوقعة بالظبط (الطالب جاوب 3 صح من 4 والسيرفر حسب 75 من 100) — يعني محرك التصحيح محسوب صح. والطالب شاف درجته بنفسه في بورتاله بعد التسليم مباشرة، والمدير شاف المحاولة بحالتها النهائية في شاشة الامتحان من جهته — يعني دايرة الطالب والمدرس والإدارة شغالة من الطرفين. وكمان اتأكدنا إن امتحان قديم بعنوان test كان لسه ظاهر لطلاب المجموعة اتقفل ومبقاش بيتحل — تنضيف بقاية اختبارات قديمة عشان الطلاب مايتلخبطوش."),
  bodyP("والأهم: الحساب ده الحقيقي فاضل شغال على النظام عادي كموجود فعلي في السنتر — ممكن الإدارة تستخدمه للتدريب، أو تعدل بياناته أو تحوله لطالب فعلي لو فيه طالب حقيقي يناسبه. كل بياناته في الجدول ده:"),
  tableTitle("جدول ٣: بيانات الحساب الحقيقي الجديد (محفوظة على الإنتاج)"),
  dataTable(accountTable.headers, accountTable.rows, accountTable.widths),
  noteP("ملحوظة أمان: موبايل الطالب وولي الأمر أرقام بصيغة مصرية صحيحة لكن مش مرتبطة بأي شخص حقيقي — لو هيتحول الحساب لطالب فعلي حدّث الأرقام من ملف الطالب."),

  // ===== 5. الـ workflow =====
  h1("٥) خطة الاستخدام المقترحة: تدفّق الحصة الواحدة"),
  bodyP("درسنا المشروع المرجعي (Alnokhba Edu على github.com/J0e0000/Alnokhba) اللي الإدارة بتحبه في سهولته، ولقينا سره إنه بيمشي بفلسفة «الحصة الواحدة هي قلب اليوم»: المعلم مفتح الحصة، وكل حاجة بتحصل جواها بترتيب واحد واضح — الحضور بالـ QR، تتبع الواجبات والتفاعل، الامتحانات، وبعدها تقرير واتساب جاهز لولي الأمر. وميزة النظام بتاعنا إن كل قطعة من القطع دي موجودة فعلاً وجاهزة — المحتاج هو تجميعها في تدفّق واحد مألوف. الخطة المقترحة بتاعة إحنا بخمس خطوات:"),
  tableTitle("جدول ٤: تدفّق الحصة المقترح — 5 خطوات لكل حصة في اليوم"),
  dataTable(workflowTable.headers, workflowTable.rows, workflowTable.widths),
  bodyP("إيه اللي هيخلّي التدفّق ده «سهل لأي حد»: أولاً مش محاجج مفيش خطوة جديدة بتبني — كل خطوة مربوطة بحاجة موجودة شغالة ومختبرة، فالتنفيذ يبقى تجميع وترتيب مش بناء من الصفر. ثانياً الترتيب نفسه هو اللي بيشرح نفسه: مفيش موظف محتاج يتدرب على «نظام» — هو بيمشي مع يومه الطبيعي: فتحت الحصة، خدت الحضور، اللي دفع خد إيصال، فرضت الواجب أو الامتحان، قفلت، وأهلي الطلاب واخدوا تقريرهم. ثالثاً نقطة الدخول واحدة لكل دور: الاستقبال من الرئيسية، والمدرس من بورتاله، والطالب من بورتاله — كل حد شاشته واضحة من غير ما يتوه في قوائم."),
  bodyP("التطبيق العملي المقترح للمرحلة الجاية: شريط «يوم الدراسة» في الشاشة الرئيسية بخمس خطوات لامعة، كل خطوة زرار بيوديك مباشرة للشاشة المطلوبة بالترتيب، وأول ما تخلص خطوة تتنقّل لللي بعدها تلقائياً. وممكن كمان إضافة التقرير اليومي المجمّع لولي الأمر (رسالة واتساب واحدة لكل طالب بيلخص يومه) — ودي ميزة موجودة أصولها في مركز الرسائل بس محتاجة تفعيل تلقائي. لو الإدارة وافقة على الاتجاه ده بنبدأ بتنفيذ الشريط التفاعلي وهو شغل أيام قليلة."),

  // ===== 6. الخطوات الجاية =====
  h1("٦) الخلاصة والخطوات الجاية"),
  bodyP("الحصيلة النهائية للمهمة دي: الألوان اتعملت من الجذر وبقت كل شاشة في النظام مقروءة في الوضعين واتحققنا من كده بصرياً شاشة شاشة، والبنية التحتية اتألمت في أضعف نقطتين فيها (أثقل استعلام + الحماية من الضغط المفاجئ)، والتجربة الحقيقية على الإنتاج نجحت 13 خطوة من 13 وثبتت إن دايرة الطالب الكاملة (تسجيل، دفع، امتحان، تصحيح، نتيجة) شغالة من غير أي مشكلة، وكيان حساب حقيقي فاضل على النظام جاهز للتدريب والاستخدام الفعلي. وممكن الإدارة تجرب بنفسها دلوقتي: تدخل بكود 84478 وموبايل 01012588712 على صفحة بورتال الطالب وتشوف الرصيد والامتحان والدرجة."),
  bodyP("الخطوات الجاية بالترتيب المقترح: أولاً موافقة الإدارة على اتجاه «تدفّق الحصة» اللي في القسم الخامس عشان ننفذ شريط اليوم التفاعلي. ثانياً قائمة مراجعة سريعة من الإدارة على الشاشات وهي شغالة فعلية مع الموظفين الحقيقيين — لو أي شاشة لسه فيها حاجة مش مريحة في الألوان بنظبطها في دقايق لأن الباليت دلوقتي مركزية. ثالثاً تفعيل التقرير اليومي المجمّع لولي الأمر لما يكون ده مطلوب. ورابعاً إعادة اختبار الحمل الدوري كل موسم تسجيل — السكريبتات جاهزة والتقرير السابق فيه الأرقام المرجعية للمقارنة."),
];

// ============================= document =============================
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1417, right: 1417 };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 24, color: BODY },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT, size: 32, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 360, after: 160, line: 380 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT, size: 28, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 240, after: 120, line: 340 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    {
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1RTL({
        title: "تقرير تحسينات الموقع والتجربة الحقيقية",
        subtitle: "نظام إدارة مراكز النخبة التعليمي — إصلاح الألوان والقراءة + البنية التحتية + رحلة طالب حقيقي على الإنتاج + خطة الاستخدام المقترحة",
        englishLabel: "SITE IMPROVEMENT REPORT",
        metaLines: [
          "النطاق: كل صفحات الموقع — التطبيق الإداري وبورتال الطالب وبورتال المدرس",
          "التجربة: 13 خطوة حقيقية على السيرفر المباشر — كلها نجحت",
          "التاريخ: 2 أكتوبر 2026",
        ],
        footerRight: "مركز النخبة التعليمي",
        footerLeft: "وثيقة داخلية — للإدارة",
        palette: PAL,
      }),
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageNumFooter() },
      children: [
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360, line: 400, lineRule: "atLeast" },
          children: [run("الفهرس", { bold: true, size: 32, color: PAL.primary })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.RIGHT,
          spacing: { before: 200 },
          children: [run("ملحوظة: الفهرس ده متولد بحقول أوتوماتيكية — بعد أي تعديل على التقرير اعمل كليك يمين على الفهرس واختار «تحديث الحقل» عشان أرقام الصفحات تظبط.", { italics: true, size: 18, color: "888888" })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/تقرير-تحسينات-الموقع-والتجربة-الحقيقية.docx", buf);
  console.log("docx written OK");
});
