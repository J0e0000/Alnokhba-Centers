/** post-process per toc.md: footer instrText format switches + remove empty pgNumType (cover) */
const fs = require("fs");
const { execSync } = require("child_process");
const path = "/home/z/my-project/download/Security-Audit-Report-Alnokhba-Centers.docx";
const tmp = "/tmp/docx-patch-sec";

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execSync(`cd ${tmp} && unzip -q "${path}"`);

// 1) remove empty pgNumType (cover section)
let docXml = fs.readFileSync(`${tmp}/word/document.xml`, "utf-8");
const before = docXml.length;
docXml = docXml.replace(/<w:pgNumType\/>/g, "");
fs.writeFileSync(`${tmp}/word/document.xml`, docXml);
console.log("pgNumType removed:", before !== docXml.length);

// 2) patch footers: first footer-bearing section = TOC (roman), later = body (arabic)
const files = fs.readdirSync(`${tmp}/word`).filter((f) => /^footer\d+\.xml$/.test(f));
console.log("footers:", files.join(", "));
const rels = fs.readFileSync(`${tmp}/word/_rels/document.xml.rels`, "utf-8");
const ridToFile = {};
for (const m of rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"/g)) ridToFile[m[1]] = m[2];
const refs = [...docXml.matchAll(/<w:footerReference w:type="default" r:id="(rId\d+)"\/>/g)].map((m) => ridToFile[m[1]]);
console.log("section footer order:", refs.join(", "));
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
