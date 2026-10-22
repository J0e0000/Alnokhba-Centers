// عزل المشكلة: معالجة globals.css بنفس plugin البناء (@tailwindcss/postcss)
// ونشوف هل بلوك nkops بيطلع ولا بيترمي
import postcss from "postcss";
import tw from "@tailwindcss/postcss";
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("src/app/globals.css", "utf8");
const plugin = tw({ base: process.cwd() });
const result = await postcss([plugin]).process(src, { from: "src/app/globals.css" });
const out = result.css;
writeFileSync("/tmp/tw-out.css", out);
console.log("حجم الدخل:", src.length, "— حجم الخرج:", out.length);
console.log("nkops في الخرج:", (out.match(/nkops/gi) || []).length);
console.log("nk-menu-sheet في الخرج:", (out.match(/nk-menu-sheet/gi) || []).length);
const i = out.indexOf("nkops");
console.log("موقع أول nkops:", i, i >= 0 ? out.slice(i - 60, i + 80) : "(مش موجود)");
