import * as fs from "fs";
import jsQR from "jsqr";

/** إثبات قراءة كود Slot QR: بنفك صورة الكانفس المرسوم على الشاشة بـ jsQR
 *  (نفس عائلة مكتبات السكانر العادية) — لو الاتنين طلعوا زي بعض، يبقى
 *  أي سكانر عادي بيقرأ الكود فعلًا. */
const raw = fs.readFileSync("/tmp/qr-canvas-b64.txt", "utf8").trim().replace(/^"|"$/g, "");
const buf = Buffer.from(raw, "base64");
const data = new Uint8ClampedArray(buf);
const W = 330, H = 330;
const res = jsQR(data, W, H, { inversionAttempts: "dontInvert" });
if (!res) {
  console.log("DECODE=fail");
  process.exit(1);
}
console.log(`DECODE=ok`);
console.log(`PAYLOAD=${res.data}`);
