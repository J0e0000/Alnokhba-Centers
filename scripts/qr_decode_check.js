// Decode-proof: PNG (from displayed QR canvas) -> jsQR -> must equal expected payload
// Usage: node scripts/qr_decode_check.js <png-file> <expected-substring>
const fs = require("fs");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

const [file, expected] = process.argv.slice(2);
const buf = fs.readFileSync(file);
const png = PNG.sync.read(buf);
const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
if (!res) {
  console.log(`DECODE=FAIL size=${png.width}x${png.height}`);
  process.exit(1);
}
const ok = expected ? res.data.includes(expected) : true;
console.log(`DECODE=${ok ? "OK" : "MISMATCH"} size=${png.width}x${png.height} modules=${res.data.version} text=${res.data.slice(0, 90)}`);
process.exit(ok ? 0 : 1);
