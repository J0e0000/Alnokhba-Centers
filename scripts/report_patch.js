/** post-process per toc.md: footer instrText format switches + remove empty pgNumType (cover) */
const fs = require("fs");
const { execSync } = require("child_process");
const path = "/home/z/my-project/download/تقرير-اختبار-الحمل-النخبة-التعليمية.docx";
const tmp = "/tmp/docx-patch";

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execSync(`cd ${tmp} && unzip -q "${path}"`);

// 1) remove empty pgNumType (cover section)
let docXml = fs.readFileSync(`${tmp}/word/document.xml`, "utf-8");
const before = docXml.length;
docXml = docXml.replace(/<w:pgNumType\/>/g, "");
fs.writeFileSync(`${tmp}/word/document.xml`, docXml);
console.log("pgNumType removed:", before !== docXml.length);

// 2) patch footers: footer order — find which footer is referenced by which section.
// Simpler robust approach: docx-js emits footer2.xml (TOC section) and footer3.xml (body)? enumerate:
const files = fs.readdirSync(`${tmp}/word`).filter((f) => /^footer\d+\.xml$/.test(f));
console.log("footers:", files.join(", "));
// Determine section→footer mapping from document.xml order of footerReference r:ids
const rels = fs.readFileSync(`${tmp}/word/_rels/document.xml.rels`, "utf-8");
const ridToFile = {};
for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"/g)) ridToFile[m[1]] = m[2];
const refs = [...docXml.matchAll(/<w:footerReference w:type="default" r:id="(rId\d+)"\/>/g)].map((m) => ridToFile[m[1]]);
console.log("section footer order:", refs.join(", "));
// First footer-bearing section = TOC (roman), later = body (arabic)
refs.forEach((f, idx) => {
  if (!f) return;
  const fmt = idx === 0 ? "ROMAN" : "arabic";
  let xml = fs.readFileSync(`${tmp}/word/${f}`, "utf-8");
  xml = xml.replace(/(<w:instrText[^>]*>)\s*PAGE\s*(<\/w:instrText>)/g, `$1 PAGE \\* ${fmt} \\* MERGEFORMAT $2`);
  fs.writeFileSync(`${tmp}/word/${f}`, xml);
  console.log(`patched ${f} -> ${fmt}`);
});

execSync(`cd ${tmp} && zip -q -r out.docx . -x out.docx && mv out.docx "${path}"`);
console.log("repacked OK");
