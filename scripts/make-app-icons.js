const sharp = require('sharp');
const fs = require('fs');

// Source: the finished square ZOCLO tile (lettering pre-composed on purple,
// black baked into its rounded corners). Full-bleed render = zoom the tile
// past its corner radius and crop the centered square — the black corners
// fall outside the crop, leaving edge-to-edge purple.
const SRC = 'brand/zoclo-app-icon.png';
const OUT = 'client/public/icons';
const ZOOM = 1.18; // edge loss (1-1/Z)/2 = 7.6% > the tile's corner radius

(async () => {
  const meta = await sharp(SRC).metadata();
  console.log(`src: ${meta.width}x${meta.height}`);

  const sizes = [
    { file: 'zoclo-icon.png', size: 512 },
    { file: 'zoclo-icon-192.png', size: 192 },
    { file: 'apple-touch-icon.png', size: 180 },
  ];

  for (const { file, size } of sizes) {
    const zoomed = Math.round(size * ZOOM);
    const crop = Math.round((zoomed - size) / 2);

    await sharp(SRC)
      .resize(zoomed, zoomed)
      .extract({ left: crop, top: crop, width: size, height: size })
      .png()
      .toFile(`${OUT}/${file}`);

    const out = fs.statSync(`${OUT}/${file}`);
    console.log(`${file}: ${size}x${size} (zoomed ${zoomed}, crop ${crop}) — ${Math.round((out.size / 1024) * 10) / 10}KB`);
  }
  console.log('DONE');
})();
