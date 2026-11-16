// #11 question panel, rules agent (no AI): the five example questions all work and every number in
// the answers matches what the screen shows.
//   BASE_URL=http://localhost:4173 node e2e/agent.mjs   (scripts/e2e.sh serves web/dist first)
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const walkReady = async (pg, ms = 30000) => {
  // #walk starts with only the base: wait for the data, then load the example route (★).
  await pg.waitForFunction(() => { const v = document.querySelector('.walk .verdict'); return v && !/読み込み中|Loading/.test(v.textContent); }, null, { timeout: ms });
  if (!(await pg.locator('.walk .verdict.ok, .walk .verdict.ng').count())) await pg.locator('.draw-toolbar a[data-m=example]').click();
  await pg.waitForSelector('.walk .verdict.ok, .walk .verdict.ng', { timeout: ms });
};

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SHOTS = process.env.SHOTS !== '0';
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
await p.addInitScript(() => { try { localStorage.setItem('walkback.guide.closed', '1'); } catch { /* */ } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text()));
await p.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204 })));

await p.goto(`${BASE}/#walk`);
await walkReady(p, 20000);
await p.waitForSelector('.agent-panel');
const agent = await p.locator('.agent-panel select').inputValue();
console.log('agent:', agent); if (agent !== 'rules') fail('web default agent is the rules version');

/** Ask a question, wait for the answer, return its text and tool chips. */
async function ask(q, timeout = 60000) {
  const n = await p.locator('.msg.agent').count();
  await p.locator('.agent-input input').fill(q);
  await p.locator('.agent-input button[type=submit]').click();
  const last = p.locator('.msg.agent').nth(n);
  await last.locator('xpath=self::*[@data-done="1"]').waitFor({ timeout });
  const text = await last.locator('.msg-text').innerText().catch(() => '');
  const chips = await last.locator('.tool-chip').evaluateAll((els) => els.map((e) => `${e.dataset.tool}:${e.classList.contains('ok') ? 'ok' : 'ng'}`));
  console.log(`\nQ: ${q}\n  tools: ${chips.join(', ')}\n  A: ${text.replace(/\n/g, ' / ')}`);
  if (chips.some((c) => c.endsWith(':ng'))) fail(`tool failed for "${q}"`);
  return { text, chips };
}
const kv = async (label) => (await p.locator('.walk .kv', { hasText: label }).first().locator('b').innerText()).trim();
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `e2e/agent-${name}.png` }); };

// 1) Can I walk back from 3 km out? → answer says 帰れる / 引き返す and quotes the panel's numbers.
{
  const { text, chips } = await ask('基地から3km先まで歩いて帰れる？');
  await p.waitForTimeout(300);
  const verdict = await p.locator('.walk .verdict').innerText();
  if (!chips.includes('walkback_check:ok')) fail('walkback_check called');
  if (!(/帰れる/.test(text) && /帰れる/.test(verdict)) && !(/引き返す/.test(text) && /引き返す/.test(verdict))) fail(`verdict matches screen (${verdict})`);
  const [out, back] = (await kv('行き / 帰り')).split(' / ');
  if (!text.includes(`行き ${out} / 帰り（まっすぐ）${back}`)) fail(`out/back km match the screen (${out} / ${back})`);
  if (!text.includes(`かかる時間 ${await kv('かかる時間')}`)) fail('time matches the screen');
  const effort = (await kv('体力の消費')).replace(' h', '').split(' / ');
  if (!text.includes(`体力の消費 ${effort[0]} / 使える分 ${effort[1]} h`)) fail('effort matches the screen');
  const area = await kv('歩いて帰れる範囲');
  if (!text.includes(area.replace('（最遠', '（最遠'))) fail(`walk-home area matches the screen (${area})`);
  await shot('return');
}

// 2) Practice course in Hokkaido with the same slopes → top course and score match the panel's tabs.
{
  const { text, chips } = await ask('同じ坂の練習コースを北海道で探して', 90000);
  if (!chips.includes('walkback_check:ok') || !chips.includes('view_overlay:ok')) fail('rehearsal tools');
  await p.waitForSelector('.rehearsal-card .tabs button', { timeout: 10000 }).catch(() => fail('rehearsal panel'));
  const tab = (await p.locator('.rehearsal-card .tabs button').first().innerText()).trim(); // "1. 十勝岳 62-2火口周辺 87"
  const m = tab.match(/^1\.\s*(.+?)\s+(\d+)$/);
  if (!m || !text.includes(m[1]) || !text.includes(`スコア ${m[2]}`)) fail(`top course matches the panel (${tab})`);
  const rms = await p.locator('.rehearsal-card .kv', { hasText: '坂の違い' }).locator('b').innerText();
  if (!text.includes(`坂の違い ${rms}`)) fail(`slope difference matches (${rms})`);
  await shot('rehearsal');
}

// 3) Where and when in Hokkaido → explore_hokkaido over the 1 km scan, season from the engine.
{
  const { text, chips } = await ask('この訓練、北海道のどこでいつやる？', 90000);
  if (!chips.includes('explore_hokkaido:ok')) fail('explore_hokkaido called');
  if (!/時期: /.test(text) || !/スコア \d/.test(text)) fail('explore answer has places and season');
  await p.waitForTimeout(1500);
  if (!(await p.evaluate(() => location.hash)).startsWith('#target')) fail('view_scan opened the Hokkaido map');
  await shot('explore');
}

// 4) Show the evidence → back on WALKBACK with the cards highlighted and real-data numbers.
{
  const { text, chips } = await ask('根拠を見せて');
  if (chips.filter((c) => c.startsWith('open_evidence:ok')).length < 3) fail('open_evidence ×3');
  const roverKm = (await p.locator('#ev-rover .muted').innerText()).match(/([\d.]+) km/)?.[1];
  if (!roverKm || !text.includes(`${roverKm} km`)) fail(`rover km matches the card (${roverKm})`);
  const evaCount = (await p.locator('#ev-eva .big-line span').innerText()).match(/(\d+) 回/)?.[1];
  if (!evaCount || !text.includes(`${evaCount} 回`)) fail(`EVA count matches the card (${evaCount})`);
  if (!text.includes('1.15')) fail('Gernhardt ratio quoted');
  if ((await p.locator('.flash').count()) < 1) fail('evidence card highlighted');
  await shot('evidence');
}

// 5) Walk it in 3D → 3D terrain and the helmet display.
{
  const { chips } = await ask('3Dで歩いて見せて');
  if (!chips.includes('view_3d:ok') || !chips.includes('view_walk:ok')) fail('3D + walk tools');
  await p.waitForSelector('.terrain3d canvas', { timeout: 10000 }).catch(() => fail('3D view'));
  await p.waitForSelector('.hud', { timeout: 15000 }).catch(() => fail('helmet HUD'));
  await p.waitForTimeout(2500);
  await shot('3d-walk');
}

// B) Crewed rover breaks down on Perseverance's path → flag and share match the card.
{
  await p.locator('.walk .btns button.primary').click().catch(() => undefined); // stop the walk
  const { text, chips } = await ask('有人ローバーが壊れたら歩いて帰れる？');
  if (!chips.includes('rover_walkback:ok')) fail('rover_walkback called');
  await p.waitForSelector('#rover-walkback .big-line', { timeout: 10000 }).catch(() => fail('rover walkback card'));
  const share = (await p.locator('#rover-walkback .big-line b').innerText()).trim();
  if (!text.includes(`${share} の区間`)) fail(`share matches the card (${share})`);
  const flag = (await p.locator('#rover-walkback .kv b').innerText()).trim(); // 走行 X km・sol Y | なし…
  const m = flag.match(/走行 ([\d.]+) km・sol (\d+)/);
  if (m ? !text.includes(`走行 ${m[1]} km（sol ${m[2]}）`) : !text.includes('どこで壊れても')) fail(`flag matches the card (${flag})`);
  await shot('rover-walkback');
  // Less oxygen → the flag moves closer to the base.
  const before = m ? Number(m[1]) : Infinity;
  const r2 = await ask('酸素4時間で有人ローバーが壊れたら？');
  const m2 = r2.text.match(/走行 ([\d.]+) km（sol/);
  console.log('  flag with O2 8 h →', before, 'km; with O2 4 h →', m2?.[1], 'km');
  if (!m2 || !(Number(m2[1]) <= before)) fail('flag moves with the O2 slider');
}

// A) Recorded walk (GPX) → Hokkaido and Mars side by side; numbers match the card.
{
  await p.locator('.walk .btns button.primary', { hasText: '止める' }).click().catch(() => undefined);
  const { text, chips } = await ask('歩いた記録で火星を歩いて見せて');
  if (!chips.includes('import_walk:ok') || !chips.includes('mars_replay:ok')) fail('import_walk + mars_replay');
  const card = await p.locator('#walk-import').innerText();
  const km = card.match(/歩いた距離\s*([\d.]+) km/)?.[1], speed = card.match(/平地に直した速さ\s*([\d.]+) km\/h/)?.[1];
  if (!km || !text.includes(`${(+km).toFixed(1)} km`)) fail(`walk km matches the card (${km})`);
  if (!speed || !text.includes(`${speed} km/h`)) fail(`measured speed matches the card (${speed})`);
  if (!/仮の自作データ/.test(card) || !/仮の自作データ/.test(text)) fail('synthetic sample labelled as such');
  if (!(await p.locator('.earth-walk').count())) fail('Hokkaido walk map');
  await p.waitForSelector('.hud', { timeout: 5000 }).catch(() => fail('helmet HUD replay'));
  await p.waitForTimeout(3000);
  await shot('gpx');
  // A GPX picked with the file input (same sample file, renamed: not labelled synthetic by name).
  await p.locator('#walk-import input[type=file]').setInputFiles({
    name: 'team-walk.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from((await (await fetch(`${BASE}/data/walks/sample-sapporo-maruyama-SYNTHETIC.gpx`)).text())),
  });
  await p.waitForTimeout(800);
  if (!/仮の自作データ/.test(await p.locator('#walk-import').innerText())) fail('desc marks the sample as synthetic even when renamed');
  // A GPX without times: a clear message, no crash.
  await p.locator('#walk-import input[type=file]').setInputFiles({ name: 'no-time.gpx', mimeType: 'application/gpx+xml',
    buffer: Buffer.from('<gpx><trk><trkseg><trkpt lat="43.05" lon="141.3"/><trkpt lat="43.06" lon="141.3"/></trkseg></trk></gpx>') });
  await p.waitForTimeout(500);
  if (!/時刻がありません/.test(await p.locator('#walk-import').innerText())) fail('no-time GPX message');
  await p.locator('#walk-import button', { hasText: 'やめる' }).click();
}

// English question, slider values typed in it.
{
  const { text } = await ask('Can I walk back with 6 hours of oxygen?');
  if (!/Verdict: /.test(text) || !/O₂ 6 h/.test(text)) fail('English answer with O2 6 h');
  const o2 = await p.locator('#o2').inputValue();
  if (o2 !== '6') fail(`O2 slider moved to 6 (${o2})`);
}

// query_nasa: a counting question answered with read-only SQL over the parquet tables; the SQL and
// its source come back with the rows.
{
  const { text, chips } = await ask('8時間を超えた船外活動は何回？');
  if (!chips.includes('query_nasa:ok')) fail('query_nasa called');
  if (!/evas=\d+/.test(text)) fail(`query_nasa rows in the answer (${text})`);
  const last = p.locator('.msg.agent').last();
  await last.locator('.tool-chip-head').first().click();
  const body = await last.locator('.tool-chip-body').first().innerText();
  if (!/FROM eva WHERE hours > 8/.test(body) || !/data\.nasa\.gov/.test(body)) fail('query_nasa shows its SQL and source');
  // Gazetteer table: a named feature and the landing sites.
  const g = await ask('Gusev クレーターはどこ？');
  if (!/name=Gusev.*lat=-14\.\d+/.test(g.text)) fail(`mars_names finds Gusev (${g.text.slice(0, 200)})`);
  const l = await ask('過去の着陸地点を全部教えて');
  if (!/10 行|10 rows/.test(l.text) || !/Viking 1/.test(l.text)) fail('mars_names lists the 10 landing sites');
}

// Globe: the whole-Mars globe opens, shows the landing sites, and flying down opens the Jezero map.
{
  const { chips } = await ask('火星の全球を見せて');
  if (!chips.includes('view_globe:ok')) fail('view_globe called');
  await p.waitForSelector('.globe canvas', { timeout: 10000 }).catch(() => fail('globe shown'));
  await p.waitForFunction(() => !document.querySelector('.globe-msg'), null, { timeout: 15000 }).catch(() => fail('globe mosaic loaded'));
  // Place names appear once the camera stops (hidden during a flight).
  await p.waitForFunction(() => [...document.querySelectorAll('.globe-label.name')].filter((x) => x.style.display !== 'none').length > 5, null, { timeout: 15000 }).catch(() => fail('globe place names shown'));
  const labs = await p.locator('.globe-label').evaluateAll((e) => e.filter((x) => x.style.display !== 'none').map((x) => x.textContent));
  console.log('\nglobe labels', labs.join(' | '));
  if (!labs.some((l) => /Jezero/.test(l))) fail('globe marks the base at Jezero');
  if (!labs.some((l) => /▲ Viking 1|▲ Curiosity|▲ InSight|▲ Zhurong/.test(l)) || !labs.some((l) => /◆ /.test(l))) fail('globe shows landing sites ▲ and crewed candidates ◆');
  // Clicking a place name opens its card (name, type, size, origin, coordinates).
  const pt = await p.evaluate(() => { for (const e of document.querySelectorAll('.globe-label.name.feature')) { if (e.style.display === 'none') continue; const r = e.getBoundingClientRect(); const x = r.left + 10, y = r.top + r.height / 2; if (document.elementFromPoint(x, y) === e) return { x, y }; } return null; });
  if (!pt) fail('a place name is clickable');
  else {
    await p.mouse.click(pt.x, pt.y);
    const card = await p.locator('.globe-card').innerText({ timeout: 3000 }).catch(() => '');
    console.log('globe card:', card.replace(/\s+/g, ' '));
    if (!/\d+\.\d+°[NS] \d+\.\d+°[EW]/.test(card) || !/ここへ降りる/.test(card)) fail('place card with coordinates and fly button');
    await p.locator('.globe-card-x').click();
  }
  await shot('globe');
  await p.locator('.globe-ctl button.primary').click();
  await p.waitForFunction(() => !document.querySelector('.globe'), null, { timeout: 15000 }).catch(() => fail('flying down opens the Jezero map'));
}

// Empty state: with only the base left, the panel says what to do next.
{
  await p.goto(`${BASE}/#walk`);
  await walkReady(p, 20000);
  await p.locator('.draw-toolbar a[data-m=clear]').click();
  const empty = await p.locator('.walk .verdict').innerText();
  console.log('\nempty route:', empty);
  if (!/地図をクリック/.test(empty)) fail('empty route tells what to do');
  // Undo / redo: ↶ brings the cleared route back (and its verdict), ⌘/Ctrl+Z and ↷ / Shift+Z too.
  const before = await p.locator('.walk .verdict').innerText();
  await p.locator('.draw-toolbar a[data-m=undo]').click();
  const restored = await p.locator('.walk .verdict').innerText();
  console.log('undo restores:', restored);
  if (/地図をクリック/.test(restored)) fail('↶ undoes the clear');
  // The labelled undo bar over the map does the same.
  if (!(await p.locator('.undo-bar button').count())) fail('undo bar shown once there is history');
  await p.locator('.undo-bar button').first().click();
  await p.locator('.undo-bar button').nth(1).click();
  await p.locator('.draw-toolbar a[data-m=redo]').click();
  if (!/地図をクリック/.test(await p.locator('.walk .verdict').innerText())) fail('↷ redoes the clear');
  await p.locator('.walk .maps .map').first().hover();
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  if (/地図をクリック/.test(await p.locator('.walk .verdict').innerText())) fail('Cmd/Ctrl+Z undoes');
  if (!before) fail('verdict before undo');
  // Route editing: rubber band with the engine's numbers, right-click deletes, Esc stops drawing,
  // easy-path mode toggles.
  {
    await p.locator('.draw-toolbar a[data-m=example]').click();
    await p.locator('.draw-toolbar a[data-m=route]').click();
    await p.waitForTimeout(400); // the editor arms the rubber band after the mode switch renders
    const box = await p.locator('.walk .maps .map').first().boundingBox();
    await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await p.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.52);
    const tip = await p.locator('.band-tip').innerText({ timeout: 3000 }).catch(() => '');
    console.log('rubber band:', tip.replace(/\s+/g, ' '));
    if (!/行き [\d.]+ km/.test(tip)) fail('rubber band shows distance');
    const n = await p.locator('.wp-handle').count();
    await p.locator('.wp-handle').nth(n - 1).click({ button: 'right' });
    if ((await p.locator('.wp-handle').count()) !== n - 1) fail('right-click deletes a point');
    // Hover a point: "out to here and back" numbers; Backspace while drawing takes back the last point.
    { const hb = await p.locator('.wp-handle').nth(1).boundingBox(); await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 4 }); await p.waitForTimeout(300); }
    const wtip = await p.locator('.wp-tip').innerText({ timeout: 3000 }).catch(() => '');
    if (!/WP1.*行き [\d.]+ km/s.test(wtip)) fail(`point hover shows distance (${wtip})`);
    await p.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.52);
    const n2 = await p.locator('.wp-handle').count();
    await p.keyboard.press('Backspace');
    if ((await p.locator('.wp-handle').count()) !== n2 - 1) fail('Backspace removes the last point while drawing');
    await p.keyboard.press('Escape');
    if (await p.locator('.draw-toolbar a[data-m=route].on').count()) fail('Esc stops drawing');
    await p.locator('.draw-toolbar a[data-m=easy]').click();
    if (!(await p.locator('.draw-toolbar a[data-m=easy].on').count())) fail('easy-path toggle');
    await p.locator('.draw-toolbar a[data-m=easy]').click();
    // Destination mode: one click plans the route from the base (Rust Dijkstra).
    await p.locator('.draw-toolbar a[data-m=goal]').click();
    await p.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.3);
    await p.waitForTimeout(800);
    const hint = await p.locator('.draw-hint').innerText();
    console.log('goal:', hint.slice(0, 80));
    if (!/自動で経路|帰れる範囲の外|見つかりません/.test(hint)) fail('destination mode plans a route');
    if (/自動で経路/.test(hint)) {
      const cmpText = await p.locator('#route-compare').innerText({ timeout: 3000 }).catch(() => '');
      console.log('compare:', cmpText.replace(/\s+/g, ' ').slice(0, 120));
      if (!/最短距離/.test(cmpText) || !/最大の坂/.test(cmpText)) fail('shortest vs safer comparison table');
      if (!/坂 \+\d+ 分/.test(await p.locator('#route-breakdown').innerText())) fail('cost breakdown per route');
      await p.locator('.search-viz button', { hasText: 'スキップ' }).click().catch(() => {});
      // A click right on the route's end point still plans (no handles in destination mode).
      await p.waitForTimeout(800);
      const end = await p.evaluate(() => [...document.querySelectorAll('.leaflet-overlay-pane path')].length);
      await p.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.3);
      await p.waitForSelector('.search-viz', { timeout: 3000 }).then(() => p.locator('.search-viz button', { hasText: 'スキップ' }).click()).catch(() => fail(`a click on the route itself plans in destination mode (${end} paths)`));
    }
    await p.locator('.draw-toolbar a[data-m=pan]').click();
  }
  // Desktop: the panel folds away to a chip and the map is full screen.
  await p.locator('.panel-fold').click();
  if (!(await p.locator('.panel-chip').count())) fail('panel folds to a chip');
  await p.locator('.panel-chip').click();
  await p.locator('.draw-toolbar a[data-m=example]').click();
  await shot('pc-ja');
}

// English: the header switch changes the screen, and English questions get English answers.
{
  await p.locator('.lang-switch button', { hasText: 'English' }).click();
  await p.waitForTimeout(300);
  const v = await p.locator('.walk .verdict').innerText();
  console.log('english verdict:', v);
  if (!/Can walk back|Turn back/.test(v)) fail('English verdict');
  // Suggestions are hidden once questions were asked; the small link shows them again.
  if (await p.locator('.agent-examples').count()) fail('suggestions hidden after a question');
  await p.locator('.agent-examples-show').click().catch(() => fail('link to show the suggestions again'));
  if (!(await p.locator('.agent-examples button', { hasText: 'Can I walk back from 3 km out?' }).count())) fail('English examples');
  const { text } = await ask('Can I walk back from 3 km out?');
  // The verdict depends on the footing (THEMIS thermal inertia), so either is valid here.
  if (!/Verdict: (can walk back|cannot complete)/.test(text) || !/Out 6\.1 km/.test(text)) fail('English answer from the English example');
  await shot('pc-en');
  await p.locator('.lang-switch button', { hasText: '日本語' }).click();
}

// Phone width: map on top and usable, the question panel starts as a button and opens as a sheet.
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('walkback.guide.closed', '1'); } catch { /* */ } });
  const m = await ctx.newPage();
  m.on('pageerror', (e) => errs.push(e.message));
  await m.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204 })));
  await m.goto(`${BASE}/#walk`);
  await m.waitForSelector('.panel-chip', { timeout: 20000 }); // empty start: no verdict colour yet
  const mapBox = await m.locator('.maps .map').first().boundingBox();
  console.log('phone map', Math.round(mapBox.width), 'x', Math.round(mapBox.height), 'at y', Math.round(mapBox.y));
  if (!(mapBox.height > 844 * 0.75 && mapBox.y < 120)) fail('phone: the map fills the screen');
  await m.locator('.panel-chip').click();
  await m.waitForSelector('.walk .verdict', { timeout: 5000 }).catch(() => fail('phone: the chip opens the panel sheet'));
  if (SHOTS) await m.screenshot({ path: 'e2e/agent-phone-sheet.png' });
  await m.locator('.panel-fold').click();
  if (await m.locator('.agent-panel').count()) fail('phone: question panel starts closed');
  if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)) fail('phone: no sideways scroll');
  await m.locator('.agent-fab').click();
  await m.locator('.agent-examples button').first().click();
  await m.locator('.msg.agent[data-done="1"]').first().waitFor({ timeout: 30000 });
  const sheet = await m.locator('.agent-panel').boundingBox();
  if (!(sheet.height <= 844 * 0.65)) fail('phone: sheet leaves the map visible');
  if (SHOTS) await m.screenshot({ path: 'e2e/agent-phone.png' });
  await ctx.close();
}

// Voice (desktop path): the mic is recorded to 16 kHz WAV and handed to whisper (mocked here; the
// real transcription is checked by the Rust test voice::transcribes_a_recording). The question goes
// through the panel and the answer shows inside the helmet HUD.
{
  const vb = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${new URL('./fixtures/voice-ja.wav', import.meta.url).pathname}`] });
  const ctx = await vb.newContext({ locale: 'ja-JP', viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('walkback.guide.closed', '1'); } catch { /* */ }
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, args) => {
        if (cmd === 'voice_status') return { ok: true, model: 'ggml-medium.bin' };
        if (cmd === 'voice_transcribe') { window.__wav = args.wav.length; window.__head = String.fromCharCode(...args.wav.slice(0, 4)); window.__rate = args.wav[24] | (args.wav[25] << 8); return '基地から3キロ先まで歩いて帰れますか酸素は6時間あります'; }
        throw new Error(`${cmd}: not in this test`);
      },
    };
  });
  const v = await ctx.newPage();
  v.on('pageerror', (e) => errs.push(e.message));
  await v.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204 })));
  await v.goto(`${BASE}/#walk`);
  await walkReady(v, 20000);
  await v.locator('.agent-input .mic').click();
  await v.waitForTimeout(3000);
  await v.locator('.agent-input .mic').click();
  await v.locator('.msg.agent[data-done="1"]').first().waitFor({ timeout: 30000 });
  const w = await v.evaluate(() => ({ n: window.__wav, head: window.__head, rate: window.__rate }));
  const text = await v.locator('.msg.agent .msg-text').first().innerText();
  console.log('\nvoice wav', w, '|', text.slice(0, 60));
  if (w.head !== 'RIFF' || w.rate !== 16000 || !(w.n > 40000)) fail('voice: 16 kHz WAV recorded');
  if (!/判定: 帰れ(る|ない)/.test(text) || !/酸素 6 時間/.test(text)) fail('voice question answered with the spoken conditions');
  if (!/QA/.test(await v.locator('.msg-who').first().innerText())) fail('voice: no model → QA says so');
  await v.locator('.walk .btns button.primary').click();
  await v.waitForSelector('.hud-qa', { timeout: 5000 }).catch(() => fail('answer shown in the helmet HUD'));
  if (!/3キロ/.test(await v.locator('.hud-q').innerText().catch(() => ''))) fail('HUD shows the spoken question');
  await v.waitForTimeout(1500);
  if (SHOTS) await v.screenshot({ path: 'e2e/agent-voice-hud.png' });
  await vb.close();
}

console.log('\nerrors', errs);
if (errs.length) fail('console errors');
await b.close();
