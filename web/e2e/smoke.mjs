// Headless smoke test of the built app: both views, world switching, route + pins, Rust results.
//   BASE_URL=http://localhost:4173 node e2e/smoke.mjs   (mise run e2e builds and serves first)
// External tiles are stubbed, and elevation APIs return fake values, so it runs offline.
import { createRequire } from 'node:module';

// Resolved via require so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)('playwright');
const walkReady = async (pg, ms = 30000) => {
  // #walk starts with only the base: wait for the data, then load the example route (★).
  await pg.waitForFunction(() => { const v = document.querySelector('.walk .verdict'); return v && !/読み込み中|Loading/.test(v.textContent); }, null, { timeout: ms });
  if (!(await pg.locator('.walk .verdict.ok, .walk .verdict.ng').count())) await pg.locator('.draw-toolbar a[data-m=example]').click();
  await pg.waitForSelector('.walk .verdict.ok, .walk .verdict.ng', { timeout: ms });
};

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ja-JP' });
await p.addInitScript(() => { try { localStorage.setItem('walkback.guide.closed', '1'); } catch { /* */ } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
let elev = 0; // legacy elevation stubs (analogs view)
await p.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('identify') || u.includes('getelevation')) {
    elev++;
    const v = 100 + (elev * 37) % 400;
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ value: String(v), elevation: v }) });
  }
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({ status: 204 });
});

// #10 target-first: Mons Mouton × each test ranks every site, shows numbered gaps, both languages.
await p.goto(`${BASE}/#target/mons_mouton/ice`);
await p.locator('#mode-tabs button[data-mode=sites]').click(); // the scan is the default now
await p.waitForSelector('#rank-list li');
const nr = await p.locator('#rank-list li').count();
console.log('target ranking', nr); if (nr < 10) fail('target ranking');
const ov = await p.locator('#overview tbody tr').count();
console.log('overview tests', ov); if (ov !== 5) fail('overview rows');
const cold = await p.locator('#gaps .gap.critical', { hasText: 'ΔT' }).first().innerText().catch(() => '');
console.log('cold gap', cold); if (!/ΔT \d+ K/.test(cold)) fail('cold gap');
await p.locator('#test-tabs button[data-test=walk]').click();
await p.locator('#rank-list li').nth(2).click();
await p.waitForTimeout(300);
if (!(await p.evaluate(() => location.hash)).startsWith('#target/mons_mouton/walk/')) fail('target hash');
await p.locator('.lang-switch button', { hasText: '日本語' }).click();
const ja = await p.locator('#gaps h4').innerText();
console.log('ja gaps title', ja); if (!/再現できない/.test(ja)) fail('japanese');
await p.locator('.lang-switch button', { hasText: 'English' }).click();
await p.locator('#target-body').selectOption('jezero');
await p.waitForTimeout(300);
const air = await p.locator('#gaps').innerText();
if (!/CO₂/.test(air)) fail('mars atmosphere gap');
await p.screenshot({ path: 'e2e/shot-target.png' });
// Whole-Hokkaido scan: the grid loads, the heat map and best candidates appear, sites are checked.
await p.locator('#mode-tabs button[data-mode=scan]').click();
await p.waitForSelector('#scan-top li', { timeout: 20000 }).catch(() => fail('scan candidates'));
// Treasure hunt: the sweep finishes with the scan's #1 card (with its caveats).
await p.waitForSelector('#scan-best', { timeout: 20000 }).catch(() => fail('scan #1 card'));
console.log('scan #1:', (await p.locator('#scan-best').innerText()).replace(/\s+/g, ' ').slice(0, 160));
if (!/岩石|Rock type/.test(await p.locator('#scan-best').innerText())) fail('scan #1 card states what is not scored');
const nTop = await p.locator('#scan-top li').count();
console.log('scan top', nTop, '|', await p.locator('#scan .scan-head').innerText());
if (nTop < 1) fail('scan top');
if (!(await p.locator('.leaflet-image-layer').count())) fail('scan heat map');
await p.locator('#scan-top li').first().click();
await p.waitForSelector('#scan-cell .total b');
await p.locator('#scan-more summary').click();
console.log('scan check:', await p.locator('#scan .check-line').innerText());
await p.screenshot({ path: 'e2e/shot-scan.png' });

// #10 inside #11: Mars by default; explore_hokkaido runs DuckDB over the scan; view_scan drives the view.
await p.goto(`${BASE}/?fresh#target`); // new document: no state from the scan above
await p.waitForSelector('#scan-top li', { timeout: 20000 }).catch(() => fail('scan is the default'));
const defBody = await p.locator('#target-body').inputValue();
console.log('default target', defBody); if (defBody !== 'jezero') fail('default target jezero');
const ex = await p.evaluate(async () => {
  for (let i = 0; i < 100 && !window.analogScan; i++) await new Promise((r) => setTimeout(r, 100));
  const r = await window.analogScan.explore({ target: 'jezero', test: 'walk', n: 5, where: 'elev_m >= 500' });
  const bare = await window.analogScan.explore({ target: 'jezero', test: 'walk', n: 5, bare_only: true });
  const km = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
  const minKm = Math.min(...r.data.flatMap((a, i) => r.data.slice(i + 1).map((b) => km(a, b))));
  return { n: r.data.length, top: r.data[0], sql: r.sql, text: r.text, sources: r.sources.length, minKm,
    bareN: bare.data.length, bareOk: bare.data.every((x) => x.ndvi !== null && x.ndvi < 0.4) };
}).catch((e) => ({ error: String(e) }));
console.log('explore_hokkaido:', ex.text ?? ex.error);
console.log('explore spacing', ex.minKm?.toFixed(1), 'km | bare_only rows', ex.bareN);
if (!(ex.minKm >= 15) || !(ex.bareN >= 1) || !ex.bareOk) fail('explore spacing / bare_only');
if (!(ex.n >= 1) || !/FROM cells c JOIN score_jezero_walk/.test(ex.sql ?? '') || !(ex.top?.elev_m >= 500)) fail('explore_hokkaido');
const bad = await p.evaluate(() => window.analogScan.explore({ where: 'elev_m > 0; DROP TABLE cells' }).then(() => 'ran', (e) => String(e)));
if (!/where:/.test(bad)) fail('explore where validation');
await p.evaluate((t) => window.analogScan.view({ target: 'arcadia', test: 'landing', mode: 'scan', focus: { lat: t.lat, lon: t.lon } }), ex.top);
await p.waitForSelector('#scan-cell .total b', { timeout: 20000 }).catch(() => fail('view_scan cell'));
const cellHead = await p.locator('#scan-cell h4').first().innerText();
console.log('view_scan:', await p.locator('#target-body').inputValue(), '|', cellHead);
if ((await p.locator('#target-body').inputValue()) !== 'arcadia' || !cellHead.includes(ex.top.lat.toFixed(3))) fail('view_scan');

await p.goto(`${BASE}/#analogs`);
await p.waitForSelector('#site-list li');
const n = await p.locator('#site-list li').count();
console.log('sites', n); if (n < 10) fail('site list');
await p.locator('#site-list li').nth(1).click();
await p.waitForTimeout(1300);
const total = await p.locator('#detail .total b').innerText();
console.log('top match score', total); if (!(+total > 0)) fail('score');
console.log('dim bars', await p.locator('#detail .bar').count());
await p.locator('.maplabel.tabs button[data-w=moon]').click();
await p.waitForTimeout(300);
console.log('body scale', await p.locator('.maps .mapwrap').nth(1).locator('.planet-scale').innerText());
await p.screenshot({ path: 'e2e/shot-analogs.png' });

// WALKBACK: bundled Jezero data loads, the example route is judged, and a clicked route is too.
await p.locator('.lang-switch button', { hasText: '日本語' }).click(); // the language is global: back to the default for #walk
await p.goto(`${BASE}/#walk`);
await walkReady(p, 15000);
const verdict = await p.locator('.walk .verdict').innerText();
console.log('walk example:', verdict, '|', (await p.locator('.walk .panel').innerText()).split('\n').slice(4, 14).join(' | '));
if (!/帰れる|引き返す/.test(verdict)) fail('walk verdict');
await p.locator('.draw-toolbar a[data-m=clear]').click();
await p.locator('.draw-toolbar a[data-m=route]').click();
const box = await p.locator('.maps.single .map').boundingBox();
const click = (dx, dy) => p.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
for (const [dx, dy] of [[60, -40], [140, -20], [200, 60]]) { await click(dx, dy); await p.waitForTimeout(150); }
await p.waitForTimeout(400);
const clicked = await p.locator('.walk .verdict').innerText();
console.log('walk clicked:', clicked); if (!/帰れる|引き返す/.test(clicked)) fail('walk clicked route');
await p.locator('.walk .btns button.primary').click();
await p.waitForSelector('.hud', { timeout: 5000 }).catch(() => fail('helmet HUD'));
await p.waitForTimeout(800);
await p.screenshot({ path: 'e2e/shot-walk.png' });
await p.locator('.walk .btns button.primary').click();
await p.goto(`${BASE}/#analogs`);
await p.waitForTimeout(300);
console.log('elevation calls', elev, 'errors', errs);
if (errs.length) fail('console errors');
await b.close();
