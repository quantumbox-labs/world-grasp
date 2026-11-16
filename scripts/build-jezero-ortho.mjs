// Jezero surface photo for the 3D terrain and the globe's close-up patch: one equirectangular JPEG
// covering exactly the Jezero elevation grid (web/public/data/jezero_dem.json), stitched from the
// bundled map tiles (scripts/fetch-walk-tiles.mjs): MRO HiRISE orthomosaic (NASA/JPL/UArizona, via
// Mars Trek) at level 12 where it exists, Viking MDIM 2.1 colour (level 7) underneath elsewhere,
// with one Mars hue laid over the greyscale HiRISE (brightness unchanged).
//   NODE_PATH=<dir with playwright> node scripts/build-jezero-ortho.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tiles = path.join(root, 'web/public/tiles');
const g = JSON.parse(fs.readFileSync(path.join(root, 'web/public/data/jezero_dem.json'), 'utf8'));
const north = g.lat0 + g.dlat / 2, west = g.lon0 - g.dlon / 2;
const south = north - g.rows * g.dlat, east = west + g.cols * g.dlon;
const Z = 12, deg = 180 / 2 ** Z, px = deg / 256;
const W = Math.round((east - west) / px), H = Math.round((north - south) / px);
const layer = (id, z, ext) => {
  const d = 180 / 2 ** z, out = [];
  for (let y = Math.floor((90 - north) / d); y <= Math.floor((90 - south) / d); y++)
    for (let x = Math.floor((west + 180) / d); x <= Math.floor((east + 180) / d); x++) {
      const f = path.join(tiles, id, String(z), String(y), `${x}.${ext}`);
      if (fs.existsSync(f)) out.push({ x: (x * d - 180 - west) / (east - west) * W, y: (90 - y * d - north) / (south - north) * H, s: d / (east - west) * W, src: `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${fs.readFileSync(f).toString('base64')}` });
    }
  return out;
};
const base = layer('mars-viking', 7, 'jpg'), top = layer('mars-hirise', Z, 'png');
console.log(`${W}×${H} px, ${base.length} Viking + ${top.length} HiRISE tiles`);
const { chromium } = createRequire(import.meta.url)('playwright');
const b = await chromium.launch();
const p = await b.newPage();
const url = await p.evaluate(async ({ W, H, base, top }) => {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7a5a46'; ctx.fillRect(0, 0, W, H);
  const draw = (t) => new Promise((ok) => { const im = new Image(); im.onload = () => { ctx.drawImage(im, t.x, t.y, t.s, t.s); ok(); }; im.onerror = ok; im.src = t.src; });
  for (const t of base) await draw(t);
  for (const t of top) await draw(t);
  // HiRISE is greyscale: give the whole picture one Mars hue (luminance stays the photo's).
  ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#c47a4f'; ctx.fillRect(0, 0, W, H);
  return c.toDataURL('image/jpeg', 0.85);
}, { W, H, base, top });
const buf = Buffer.from(url.split(',')[1], 'base64');
fs.writeFileSync(path.join(root, 'web/public/data/jezero_ortho.jpg'), buf);
fs.writeFileSync(path.join(root, 'web/public/data/jezero_ortho.json'), JSON.stringify({ north, south, west, east, width: W, height: H,
  src: 'MRO HiRISE orthomosaic (NASA/JPL/UArizona, Mars 2020 landing site) over Viking MDIM 2.1 colour (NASA/USGS), via NASA Mars Trek' }, null, 1));
console.log(`web/public/data/jezero_ortho.jpg: ${(buf.length / 1024).toFixed(0)} KB`);
await b.close();
