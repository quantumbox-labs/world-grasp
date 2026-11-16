// Mars globe textures for the WALKBACK 3D globe, bundled so the desktop app works offline.
//   NODE_PATH=<dir with playwright> node scripts/build-mars-globe.mjs
// Downloads the level-3 tiles (16 × 8 × 256 px, equirectangular) of two NASA Solar System Treks
// global mosaics into data/raw/globe/ and stitches them (in headless Chromium, so no image library
// is needed) into 4096 × 2048 JPEGs in web/public/data/globe/:
//   mars_viking.jpg  Viking MDIM 2.1 colour mosaic (NASA/USGS, via Mars Trek)
//   mars_mola.jpg    MGS MOLA colourised shaded relief (NASA/GSFC, via Mars Trek)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
const LAYERS = [
  { id: 'mars_viking', layer: 'Mars_Viking_MDIM21_ClrMosaic_global_232m' },
  { id: 'mars_mola', layer: 'Mars_MGS_MOLA_ClrShade_merge_global_463m' },
];
const Z = 3, COLS = 2 ** (Z + 1), ROWS = 2 ** Z, T = 256;
const raw = path.join(root, 'data/raw/globe');
const out = path.join(root, 'web/public/data/globe');
fs.mkdirSync(out, { recursive: true });

for (const L of LAYERS) {
  const dir = path.join(raw, L.id);
  fs.mkdirSync(dir, { recursive: true });
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const f = path.join(dir, `${y}_${x}.jpg`);
    if (fs.existsSync(f)) continue;
    const r = await fetch(`${TREK}/${L.layer}/1.0.0/default/default028mm/${Z}/${y}/${x}.jpg`);
    if (!r.ok) throw new Error(`${L.id} ${y}/${x}: HTTP ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  console.log(`${L.id}: ${COLS * ROWS} tiles`);
}

const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch();
const p = await b.newPage();
for (const L of LAYERS) {
  const tiles = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    tiles.push({ x, y, src: `data:image/jpeg;base64,${fs.readFileSync(path.join(raw, L.id, `${y}_${x}.jpg`)).toString('base64')}` });
  }
  const dataUrl = await p.evaluate(async ({ tiles, W, H, T }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    await Promise.all(tiles.map((t) => new Promise((ok, bad) => {
      const im = new Image(); im.onload = () => { ctx.drawImage(im, t.x * T, t.y * T); ok(); }; im.onerror = bad; im.src = t.src;
    })));
    return c.toDataURL('image/jpeg', 0.85);
  }, { tiles, W: COLS * T, H: ROWS * T, T });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(out, `${L.id}.jpg`), buf);
  console.log(`web/public/data/globe/${L.id}.jpg: ${(buf.length / 1024).toFixed(0)} KB`);
}
await b.close();
