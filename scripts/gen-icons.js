// Generate PWA icons from the SVG via sharp
const sharp = require("sharp");
const fs = require("fs");

const svg = fs.readFileSync("/home/z/my-project/public/nokhba-icon.svg");

async function run() {
  const targets = [
    { name: "icon-192.png", size: 192 },
    { name: "icon-512.png", size: 512 },
    { name: "icon-maskable-512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180 },
    { name: "favicon.png", size: 64 },
  ];
  for (const t of targets) {
    let buf = svg;
    if (t.name.includes("maskable")) {
      // maskable: content within 80% safe zone — scale down & pad
      buf = Buffer.from(
        svg.toString().replace('width="64" height="64"', 'width="52" height="52" x="6" y="6"')
      );
    }
    await sharp(buf).resize(t.size, t.size).png().toFile(`/home/z/my-project/public/${t.name}`);
    console.log("generated", t.name);
  }
  // logo.png (brand logo used by print/whatsapp views) — larger rounded mark
  await sharp(svg).resize(320, 320).png().toFile("/home/z/my-project/public/logo.png");
  console.log("generated logo.png");
}
run().catch((e) => { console.error(e); process.exit(1); });
