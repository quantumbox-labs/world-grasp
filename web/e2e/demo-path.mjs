// The presentation path, end to end, timed: pick a candidate site → details and "what Hokkaido
// cannot reproduce" → WALKBACK route → walk it in the helmet → find a practice course in Hokkaido.
// Waits for map tiles at each step and reports how long they took and whether any stayed blank.
//   BASE_URL=https://walkback-preview.pages.dev node e2e/demo-path.mjs
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const walkReady = async (pg, ms = 30000) => {
  // #walk starts with only the base: wait for the data, then load the example route (★).
  await pg.waitForFunction(() => { const v = document.querySelector('.walk .verdict'); return v && !/読み込み中|Loading/.test(v.textContent); }, null, { timeout: ms });
  if (!(await pg.locator('.walk .verdict.ok, .walk .verdict.ng').count())) await pg.locator('.draw-toolbar a[data-m=example]').click();
  await pg.waitForSelector('.walk .verdict.ok, .walk .verdict.ng', { timeout: ms });
};
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OFFLINE = process.env.OFFLINE === '1'; // stub outside requests (local runs)
const SHOTS = process.env.SHOTS !== '0';
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
await p.addInitScript(() => { try { localStorage.setItem('walkback.guide.closed', '1'); } catch { /* */ } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
if (OFFLINE) await p.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204 })));

/** Wait until the visible Leaflet maps have no tile still loading; returns ms and blank tiles. */
async function tiles(label, timeout = 15000) {
  const t0 = Date.now();
  let pending = 0, loaded = 0;
  for (;;) {
    ({ pending, loaded } = await p.evaluate(() => {
      const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
      const all = [...document.querySelectorAll('.leaflet-tile')].filter(vis);
      return { pending: all.filter((t) => !t.classList.contains('leaflet-tile-loaded')).length, loaded: all.filter((t) => t.classList.contains('leaflet-tile-loaded')).length };
    }));
    if (pending === 0 || Date.now() - t0 > timeout) break;
    await p.waitForTimeout(200);
  }
  const ms = Date.now() - t0;
  console.log(`  tiles ${label}: ${loaded} loaded, ${pending} still loading after ${ms} ms`);
  if (pending > 0) fail(`${label}: ${pending} tiles still blank after ${timeout} ms`);
  return ms;
}
const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t0} ms)`);
};

await step('1. 候補地を選ぶ（#target）', async () => {
  await p.goto(`${BASE}/#target`);
  await p.locator('#mode-tabs button[data-mode=sites]').click();
  await p.waitForSelector('#rank-list li', { timeout: 30000 });
  await p.locator('#rank-list li').first().click();
  await tiles('target');
});
await step('2. 詳細と「再現できない点」', async () => {
  await p.waitForSelector('#gaps', { timeout: 10000 });
  const gaps = await p.locator('#gaps').innerText();
  console.log('  gaps:', gaps.replace(/\s+/g, ' ').slice(0, 140));
  if (!/重力|Gravity/.test(gaps)) fail('gaps show gravity');
  if (SHOTS) await p.screenshot({ path: 'e2e/demo-1-site.png' });
});
await step('3. WALKBACK でルートを引く', async () => {
  await p.goto(`${BASE}/#walk`);
  await walkReady(p, 30000);
  await p.locator('.draw-toolbar a[data-m=clear]').click();
  await p.locator('.draw-toolbar a[data-m=route]').click();
  const box = await p.locator('.walk .maps .map').first().boundingBox();
  for (const [dx, dy] of [[80, -60], [180, -20], [240, 80]]) {
    await p.mouse.click(box.x + box.width * 0.5 + dx - 100, box.y + box.height * 0.4 + dy);
    await p.waitForTimeout(200);
  }
  await p.waitForTimeout(600);
  console.log('  verdict:', await p.locator('.walk .verdict').innerText());
  // Route profile: elevation by distance, other items on the same axis.
  const prof = await p.locator('#route-profile .rp-axis').innerText({ timeout: 5000 }).catch(() => '');
  if (!/km/.test(prof)) fail('route profile under the plan');
  await p.locator('#route-profile .rp-tabs button', { hasText: 'O₂' }).click().catch(() => fail('profile O₂ tab'));
  await p.locator('#route-profile .rp-tabs button', { hasText: '標高' }).click().catch(() => {});
  // Evaluation material: totals, by departure time, by segment.
  await p.locator('#route-eval summary').click().catch(() => fail('route evaluation card'));
  const evalText = await p.locator('#route-eval').innerText().catch(() => '');
  if (!/登り/.test(evalText) || !/18:00/.test(evalText) || !/WP1/.test(evalText)) fail('route evaluation totals, departures and segments');
  await tiles('walk');
  if (SHOTS) await p.screenshot({ path: 'e2e/demo-2-route.png' });
});
await step('4. ヘルメットで歩く', async () => {
  await p.locator('.walk .btns button.primary').click();
  await p.waitForSelector('.hud', { timeout: 5000 });
  await p.waitForTimeout(2500);
  if (SHOTS) await p.screenshot({ path: 'e2e/demo-3-helmet.png' });
  await p.locator('.hud-stop').click();
});
await step('5. 北海道で練習コースを探す', async () => {
  await p.locator('.walk .btns button', { hasText: '北海道で練習コース' }).click();
  await p.waitForSelector('.rehearsal-card .tabs button, .warn.floating', { timeout: 60000 });
  const top = await p.locator('.rehearsal-card .tabs button').first().innerText().catch(() => '(none)');
  console.log('  top course:', top.replace(/\s+/g, ' '));
  const ch = await p.locator('#challenge').innerText({ timeout: 5000 }).catch(() => '');
  console.log('  challenge:', ch.replace(/\s+/g, ' ').slice(0, 200));
  if (!/片道 [\d.]+ km/.test(ch) || !/目安タイム/.test(ch)) fail('same-slope challenge card with distance and target time');
  await tiles('rehearsal');
  if (SHOTS) await p.screenshot({ path: 'e2e/demo-4-rehearsal.png' });
  // The split screen closes back to the Mars map alone (button, and Esc).
  await p.locator('#split-close').click().catch(() => fail('split screen has a close button'));
  await p.waitForSelector('.walk .maps.single', { timeout: 3000 }).catch(() => fail('closing the split leaves the Mars map alone'));
  const w = await p.locator('.walk .maps .map').first().evaluate((e) => e.getBoundingClientRect().width);
  if (w < 900) fail(`map takes the full width again (${Math.round(w)} px)`);
});
console.log('errors', errs);
if (errs.length) fail('page errors');
await b.close();
