const sharp = require('sharp');
const fs = require('fs');

const SRC = 'brand/zoclo-mark.png'; // 292x154 pasted ZOCLO tile (opaque, dark bg)
const OUT = 'client/public/icons';

(async () => {
  const meta = await sharp(SRC).metadata();

  // The mark is an opaque dark tile — its corner color extends to the full
  // canvas so the icon looks seamless (no visible letterbox edges).
  const raw = await sharp(SRC)
    .extract({ left: 4, top: 4, width: 1, height: 1 })
    .raw()
    .toBuffer();
  const [r, g, b] = raw;
  const canvasColor = { r, g, b, alpha: 1 };
  console.log(`src: ${meta.width}x${meta.height}, canvas color rgb(${r},${g},${b})`);

  const sizes = [
    { file: 'zoclo-icon.png', size: 512, markW: 400 },
    { file: 'zoclo-icon-192.png', size: 192, markW: 150 },
    { file: 'apple-touch-icon.png', size: 180, markW: 140 },
  ];

  for (const { file, size, markW } of sizes) {
    const markH = Math.round(markW * (meta.height / meta.width));
    const left = Math.round((size - markW) / 2);
    const top = Math.round((size - markH) / 2);

    // Pre-resize the mark to the target width before compositing (sharp
    // requires composite inputs no larger than the canvas).
    const markBuf = await sharp(SRC).resize(markW, markH).png().toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 4, background: canvasColor },
    })
      .composite([{ input: markBuf, left, top }])
      .png()
      .toFile(`${OUT}/${file}`);

    const out = fs.statSync(`${OUT}/${file}`);
    console.log(`${file}: ${size}x${size}, mark ${markW}x${markH} @ (${left},${top}) — ${Math.round((out.size / 1024) * 10) / 10}KB`);
  }
  console.log('DONE');
})();
