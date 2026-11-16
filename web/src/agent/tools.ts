// Agent tools for WALKBACK. Compute tools return numbers from the Rust core and the bundled NASA
// data (the same functions the screen uses, walk/plan.ts); view tools only move the screen.
import type { Core, Waypoint } from '../core';
import { LANDING, exampleRoute, loadHokkaidoGrid, type WalkData } from '../walk/data';
import { fmtH } from '../walk/geo';
import { DEFAULT_START, MAX_SLOPE, reachFrom, computePlan, evaluateRouteMaterial, evaParams, evaluate, planRoute, steepLeg, rehearsalPoints, roverWalkbackSql, turnIndex, turnWaypoint, WATER_PER_O2, type PlanParams } from '../walk/plan';
import { nextFrame, peekWalkController, walkController, type EvidenceTopic } from '../walk/controller';
import { reportObstacle } from '../walk/obstacle';
import { registerTool, setToolsReady } from './port';
import { getLang } from '../i18n';
import { SPOT_SRC, loadSpotSources, pickSpots, spotNote } from '../walk/spots';
import type { ToolDef, ToolResult } from './types';

type Lang = 'ja' | 'en';
type Src = NonNullable<ToolResult['sources']>;

export const SRC = {
  rover: { label: 'Mars 2020 Perseverance traverse (NASA/JPL MMGIS)', url: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json' },
  hirise: { label: 'MRO HiRISE DTMs (NASA/UArizona, USGS Astrogeology)', url: 'https://stac.astrogeology.usgs.gov/browser-dev/#/collections/mro_hirise_socet_dtms' },
  mola: { label: 'MGS MOLA MEGDR via Mars Trek (NASA)', url: 'https://trek.nasa.gov/mars/' },
  eva: { label: 'data.nasa.gov: Extra-vehicular Activity (EVA) - US and Russia', url: 'https://data.nasa.gov/docs/legacy/Extra-vehicular_Activity_EVA_-_US_and_Russia/Extra-vehicular_Activity_EVA_-_US_and_Russia_rows.csv' },
  gernhardt: { label: 'Gernhardt et al. 2010, NASA walkback / EVA metabolic tests (NTRS)', url: 'https://ntrs.nasa.gov/search?q=Gernhardt%20walkback%20EVA' },
  nasadem: { label: 'NASADEM (NASA/JPL, 1 arc-second)', url: 'https://lpdaac.usgs.gov/products/nasadem_hgtv001/' },
  engine: { label: 'WALKBACK calculation (walk time, walk-home area, practice course)' },
} satisfies Record<string, Src[number]>;

const LANG = { type: 'string', enum: ['ja', 'en'], description: 'Language of the returned text (default ja).' };
const lang = (a: { lang?: string } | undefined): Lang => (a?.lang === 'en' ? 'en' : 'ja');
const t = (l: Lang, ja: string, en: string) => (l === 'ja' ? ja : en);
const r1 = (x: number) => x.toFixed(1);

// ---------- route arguments ----------
export type RouteArg = { lat: number; lon: number }[] | 'example' | 'current' | { along_rover_km: number } | { away_km: number };

/** Perseverance's path from the landing site, cut at `km` of driving, as waypoints every ~0.5 km. */
export function alongRover(core: Core, raw: [number, number, number][][], km: number): Waypoint[] {
  const pts: Waypoint[] = [LANDING];
  let done = 0, next = Math.min(0.5, km), prev: { lat: number; lng: number } | null = null;
  for (const line of raw) {
    for (const p of line) {
      const cur = { lat: p[1], lng: p[0] };
      if (prev) done += core.distanceKm('mars', prev, cur);
      prev = cur;
      if (done >= next - 1e-9) {
        pts.push({ lat: p[1], lon: p[0] });
        if (next >= km - 1e-9) return pts;
        next = Math.min(km, next + 0.5);
      }
    }
  }
  return pts;
}

export function resolveRoute(core: Core, data: WalkData, arg: unknown, current: Waypoint[]): Waypoint[] {
  if (typeof arg === 'string' && /^[[{]/.test(arg.trim())) { try { arg = JSON.parse(arg); } catch { /* fall through */ } }
  // No route on screen (the map starts empty): a question without a route uses the example route.
  if (arg == null || arg === 'current') return current.length >= 2 ? current : exampleRoute(data.traverseRaw);
  if (arg === 'example') return exampleRoute(data.traverseRaw);
  if (Array.isArray(arg)) {
    const r = arg.map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }));
    if (r.length < 2 || r.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) throw new Error('route needs at least 2 points {lat, lon}');
    return r;
  }
  if (typeof arg === 'object' && 'away_km' in (arg as object)) {
    const km = Number((arg as { away_km: unknown }).away_km);
    if (!(km > 0 && km <= 15)) throw new Error('away_km must be between 0 and 15');
    return exampleRoute(data.traverseRaw, Math.min(0.6, km), km);
  }
  if (typeof arg === 'object' && 'along_rover_km' in (arg as object)) {
    const km = Number((arg as { along_rover_km: unknown }).along_rover_km);
    if (!(km > 0 && km <= 30)) throw new Error('along_rover_km must be between 0 and 30');
    return alongRover(core, data.traverseRaw, km);
  }
  throw new Error('route must be an array of {lat, lon}, "example", "current", {away_km} or {along_rover_km}');
}

const paramsFrom = (a: Record<string, unknown>, cur: PlanParams): PlanParams => {
  const n = (k: string, lo: number, hi: number, d: number) => {
    const v = a[k];
    if (v == null) return d;
    const x = Number(v);
    if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
    return x;
  };
  return { speed: n('speed_kmh', 0.5, 5, cur.speed), o2: n('o2_h', 2, 12, cur.o2), water: n('water_h', 2, 12, cur.water), reserve: n('reserve', 0, 50, cur.reserve), footing: cur.footing, start: cur.start };
};

// ---------- walkback_check ----------
const walkbackCheck: ToolDef = {
  name: 'walkback_check',
  kind: 'compute',
  description: 'Plan a walk on Mars (Jezero crater) from a base and check whether the astronaut can walk home before oxygen or suit cooling water runs out. Shows the route on the map and returns: can return or not, out/back km, time, effort used vs usable, which consumable runs out first, the turn-back point, the walk-home area (km²); with_rehearsal also finds the 3 best practice courses in Hokkaido with the same slopes. Unset parameters keep the screen\'s current values.',
  parameters: {
    type: 'object',
    properties: {
      // Kept loose on purpose: small local models often send numbers as strings or a bare object;
      // run() checks the value and explains a wrong one.
      route: {
        description: 'Route: array of {lat, lon} (first point is the base), "example" (the default 3 km route along Perseverance\'s path), "current" (what is on screen), {away_km: N} (follow Perseverance\'s path until N km in a straight line from the landing site, e.g. "3 km out" → {"away_km": 3}), or {along_rover_km: N} (Perseverance\'s path from the landing site for N km of driving).',
      },
      speed_kmh: { type: ['number', 'string'], description: 'Walking speed on flat ground, km/h (0.5–5)' },
      o2_h: { type: ['number', 'string'], description: 'Oxygen supply in hours (2–12)' },
      water_h: { type: ['number', 'string'], description: 'Cooling water supply in hours (2–12)' },
      reserve: { type: ['number', 'string'], description: 'Reserve kept at arrival, percent (0–50; at least 30 min)' },
      with_rehearsal: { type: ['boolean', 'string'], description: 'true: also search Hokkaido for practice courses with the same slopes (use for "practice course", "練習コース", "同じ坂")' },
      lang: LANG,
    },
  },
  async run(a: Record<string, unknown> = {}) {
    const l = lang(a);
    const c = await walkController();
    const data = await c.data();
    const route = resolveRoute(c.core, data, a.route, c.route());
    const params = paramsFrom(a, c.params());
    c.setRoute(route);
    c.setParams(params);
    const plan = computePlan(c.core, data, route, params);
    const { ev, dense, reach } = plan;
    const ti = turnIndex(ev);
    const lines: string[] = [];
    if (ev.ok) lines.push(t(l, '判定: 帰れる。', 'Verdict: can walk back.'));
    else lines.push(t(l,
      `判定: 帰れない。途中で引き返す（WP${turnWaypoint(ev, dense)} の手前、出発から ${r1(ev.ticks[ti!]?.km ?? 0)} km 地点）。`,
      `Verdict: cannot complete it. Turn back before WP${turnWaypoint(ev, dense)} (${r1(ev.ticks[ti!]?.km ?? 0)} km from the base).`));
    const st = steepLeg(ev);
    if (st != null) lines.push(t(l, `ただし ${Math.abs(ev.legs[st].slope_deg).toFixed(0)}° の通れない坂がある（上限 ${MAX_SLOPE}°＝火星の砂丘の安息角、Atwood-Stone & McEwen 2013）。`,
      `But the route has an impassable ${Math.abs(ev.legs[st].slope_deg).toFixed(0)}° slope (limit ${MAX_SLOPE}°, the angle of repose of Martian dunes, Atwood-Stone & McEwen 2013).`));
    lines.push(t(l,
      `行き ${r1(ev.out_km)} km / 帰り（まっすぐ）${r1(ev.back_km)} km、かかる時間 ${fmtH(ev.total_h)}、体力の消費 ${r1(ev.total_effort_h)} / 使える分 ${r1(ev.usable_h)} h、先に尽きるもの: ${ev.limiting === 'water' ? '冷却水' : '酸素'}。`,
      `Out ${r1(ev.out_km)} km / back (straight) ${r1(ev.back_km)} km, time ${fmtH(ev.total_h)}, effort ${r1(ev.total_effort_h)} of ${r1(ev.usable_h)} usable h, runs out first: ${ev.limiting === 'water' ? 'cooling water' : 'oxygen'}.`));
    if (reach) lines.push(t(l, `基地から歩いて帰れる範囲: ${reach.area_km2.toFixed(0)} km²（最遠 ${r1(reach.max_km)} km）。`,
      `Walk-home area from the base: ${reach.area_km2.toFixed(0)} km² (farthest ${r1(reach.max_km)} km).`));
    if (ev.unknown_segments > 0) lines.push(t(l, `地形が分からない区間 ${ev.unknown_segments} か所は急な登り（約17°）として計算。`, `${ev.unknown_segments} segments without terrain data are counted as a steep climb (~17°).`));
    // Air temperature (Perseverance MEDA) over the walk: how it changes the cooling water (Rust).
    try {
      const st = params.start ?? DEFAULT_START, w = c.core.weatherWalk(st, params.o2);
      if (w.temp_k != null) lines.push(t(l, `気温: 出発 ${st} 時（火星の地方時）の Jezero は ${(w.temp_k - 273.15).toFixed(0)} °C（Perseverance MEDA）。冷却水の減り方 ×${w.water_factor.toFixed(2)}（目安）。`,
        `Air: ${(w.temp_k - 273.15).toFixed(0)} °C at Jezero at the ${st}:00 local-time departure (Perseverance MEDA); cooling water use ×${w.water_factor.toFixed(2)} (estimate).`));
    } catch { /* core without weather */ }
    // Radiation: the third budget (Curiosity RAD rate × hours, NASA career limit), from Rust.
    try {
      const rx = c.core.radiationExposure(ev.total_h);
      lines.push(t(l, `放射線: この船外活動で ${rx.dose_msv.toFixed(2)} mSv（NASA の生涯上限 600 mSv の ${(rx.career_share * 100).toFixed(2)}%、Curiosity RAD の地表の線量率から）。1 回の船外活動では放射線より酸素・冷却水が先に尽きる。`,
        `Radiation: ${rx.dose_msv.toFixed(2)} mSv on this EVA (${(rx.career_share * 100).toFixed(2)}% of NASA's 600 mSv career limit, from Curiosity RAD's surface rate). On one EVA, O₂ or water runs out long before radiation.`));
    } catch { /* core without radiation */ }
    // Footing: how much of the time the loose ground adds (same route on firm ground, Rust).
    if (params.footing !== false && data?.footing) {
      const firm = evaluate(c.core, dense, { ...evaParams(params), footing: false });
      const extra = ev.total_h - firm.total_h;
      if (extra >= 1 / 60) lines.push(t(l, `足場（THEMIS 熱慣性・TES ダスト）で時間が +${fmtH(extra)}（かたい地面なら ${fmtH(firm.total_h)}）。足場の係数は目安。`,
        `Footing (THEMIS thermal inertia, TES dust) adds ${fmtH(extra)} (on firm ground ${fmtH(firm.total_h)}). The footing factors are estimates.`));
    }
    lines.push(t(l, `条件: 速さ ${params.speed} km/h、酸素 ${params.o2} 時間、冷却水 ${params.water} 時間、余裕 ${params.reserve}%${params.footing === false ? '、足場は計算に入れない' : ''}。`,
      `Settings: speed ${params.speed} km/h, O₂ ${params.o2} h, water ${params.water} h, reserve ${params.reserve}%${params.footing === false ? ', footing not counted' : ''}.`));

    let rehearsal: { site: string; score: number; slope_diff_deg: number; climb_mars_m: number; climb_earth_m: number }[] | undefined;
    if (a.with_rehearsal === true || a.with_rehearsal === 'true') {
      const found = await c.runRehearsal(rehearsalPoints(c.core, data, route));
      rehearsal = found.slice(0, 3).map((f) => ({ site: f.site.name, score: Math.round(f.m.score), slope_diff_deg: +f.m.rms_deg.toFixed(1), climb_mars_m: Math.round(f.m.climb_mars_m), climb_earth_m: Math.round(f.m.climb_earth_m) }));
      lines.push(rehearsal.length
        ? t(l, '北海道の練習コース: ', 'Practice courses in Hokkaido: ') + rehearsal.map((x, i) => t(l,
          `${i + 1}) ${x.site} スコア ${x.score}、坂の違い ${x.slope_diff_deg}°、登り合計 火星 ${x.climb_mars_m} m / 北海道 ${x.climb_earth_m} m`,
          `${i + 1}) ${x.site} score ${x.score}, slope difference ${x.slope_diff_deg}°, total climb Mars ${x.climb_mars_m} m / Hokkaido ${x.climb_earth_m} m`)).join('; ') + '。'
        : t(l, '北海道の候補地の範囲（約21km四方）に収まる練習コースが見つかりませんでした。', 'No Hokkaido practice course fits (each area is about 21 km across).'));
    }
    return {
      text: lines.join(' '),
      data: {
        ok: ev.ok, out_km: ev.out_km, back_km: ev.back_km, total_h: ev.total_h, effort_h: ev.total_effort_h, usable_h: ev.usable_h,
        limiting: ev.limiting, turn_back_km: ti != null ? ev.ticks[ti]?.km ?? null : null, turn_back_point: ti != null ? dense.pts[ti] : null,
        reach_km2: reach?.area_km2 ?? null, reach_max_km: reach?.max_km ?? null, params, waypoints: route.length, rehearsal,
      },
      sources: [SRC.engine, SRC.rover, SRC.hirise, SRC.mola, SRC.gernhardt, ...(a.with_rehearsal === true || a.with_rehearsal === 'true' ? [SRC.nasadem] : [])],
    };
  },
};

// ---------- rover_walkback (B) ----------
const PARAM_PROPS = {
  speed_kmh: { type: ['number', 'string'], description: 'Walking speed on flat ground, km/h (0.5–5)' },
  o2_h: { type: ['number', 'string'], description: 'Oxygen supply in hours (2–12)' },
  water_h: { type: ['number', 'string'], description: 'Cooling water supply in hours (2–12)' },
  reserve: { type: ['number', 'string'], description: 'Reserve kept at arrival, percent (0–50; at least 30 min)' },
};
const roverWalkbackTool: ToolDef = {
  name: 'rover_walkback',
  kind: 'compute',
  description: 'Crewed rover breakdown check: assume a crew drove Perseverance\'s real path from the landing site (the base). For each point, could they walk home if the rover broke down there (walk-home only, same O₂/cooling-water settings)? Colours the path on the map (green ok / yellow tight / red no) and returns the first point they could not walk home from (flag: km driven, sol) and the share of the path they could walk home from. Unset parameters keep the screen\'s values.',
  parameters: { type: 'object', properties: { ...PARAM_PROPS, lang: LANG } },
  async run(a: Record<string, unknown> = {}) {
    const l = lang(a);
    const c = await walkController();
    const data = await c.data();
    const params = paramsFrom(a, c.params());
    c.setParams(params);
    c.setRoverMode(true);
    const res = await roverWalkbackSql(c.core, data, evaParams(params));
    if (!res) throw new Error('Jezero grid not loaded');
    const r = res.r;
    const flag = r.first_stranded != null ? r.points[r.first_stranded] : null;
    c.set3d(false);
    if (flag) c.flyTo((flag.lat + LANDING.lat) / 2, (flag.lon + LANDING.lon) / 2, 12);
    const total = r.points.at(-1)?.km ?? 0;
    const text = t(l,
      (flag
        ? `有人ローバーが Perseverance の道を走って壊れた場合、歩いて基地に帰れなくなる最初の点は 走行 ${r1(flag.km)} km（sol ${flag.sol}）。人が乗っていたらここで引き返し。`
        : '有人ローバーが Perseverance の道のどこで壊れても、歩いて基地に帰れる。') +
        ` 地形データのある走行 ${r1(r.inside_km)} km のうち ${Math.round(r.ok_share * 100)}% の区間から歩いて帰れる（記録全体 ${r1(total)} km）。条件: 速さ ${params.speed} km/h、酸素 ${params.o2} 時間、冷却水 ${params.water} 時間、余裕 ${params.reserve}%。`,
      (flag
        ? `If a crewed rover drove Perseverance's path and broke down, the first point the crew could not walk home from is at ${r1(flag.km)} km driven (sol ${flag.sol}): turn back there.`
        : 'Wherever a crewed rover broke down on Perseverance\'s path, the crew could walk home.') +
        ` They could walk home from ${Math.round(r.ok_share * 100)}% of the ${r1(r.inside_km)} km with terrain data (whole record ${r1(total)} km). Settings: speed ${params.speed} km/h, O₂ ${params.o2} h, water ${params.water} h, reserve ${params.reserve}%.`);
    return {
      text,
      data: { flag: flag && { lat: flag.lat, lon: flag.lon, km: flag.km, sol: flag.sol, ratio: flag.ratio }, ok_share: r.ok_share, inside_km: r.inside_km, total_km: total, budget_h: r.budget_h, params },
      sql: res.sql,
      sources: [SRC.rover, SRC.hirise, SRC.mola, { label: 'Apollo LRV walkback constraint (concept; numbers are this app\'s calculation)', url: 'https://www.hq.nasa.gov/alsj/lrvhand.html' }, SRC.engine],
    };
  },
};

// ---------- import_walk / mars_replay (A) ----------
const importWalkTool: ToolDef = {
  name: 'import_walk',
  kind: 'compute',
  description: 'Walk in Hokkaido, move on Mars: load a recorded walk (GPX) and lay the same shape onto Jezero from the base. Elevation comes from NASADEM (Hokkaido) and the Jezero DEM (Mars), never from the GPS. The walkers\' flat-ground speed is measured from the GPX times. Returns the walk (km, time, climb, measured speed) and whether the same walk on Mars could return. Without gpx it uses the walk already loaded on screen, else the bundled synthetic sample.',
  parameters: {
    type: 'object',
    properties: {
      gpx: { type: 'string', description: 'GPX file contents (optional)' },
      sample: { type: 'boolean', description: 'Use the bundled synthetic sample walk (Sapporo, made up, not a recording)' },
      lang: LANG,
    },
    additionalProperties: false,
  },
  async run(a: { gpx?: string; sample?: boolean; lang?: string } = {}) {
    const l = lang(a);
    const c = await walkController();
    const data = await c.data();
    const rec = typeof a.gpx === 'string' && a.gpx.trim() ? await c.importWalk(a.gpx, 'gpx') : !a.sample && c.walk() ? c.walk()! : await c.importSample();
    const params = c.params();
    const plan = computePlan(c.core, data, rec.route, params);
    const s = rec.summary, ev = plan.ev;
    const who = rec.synthetic ? t(l, '仮の自作データ（実測ではありません）', 'synthetic sample (not a recording)') : t(l, 'チームの実測', "the team's own recording");
    const text = t(l,
      `歩いた記録（${who}）: ${r1(s.km)} km、${fmtH(s.elapsed_h)}（歩いていた時間 ${fmtH(s.moving_h)}）、登り ${rec.area ? `${Math.round(s.climb_m)} m（NASADEM）` : '不明（標高データの範囲外）'}、平地に直した速さ ${s.flat_kmh.toFixed(2)} km/h。` +
        ` 同じ道を火星の基地から歩くと: ${ev.ok ? '帰れる' : `帰れない（途中で引き返す、出発から ${r1(ev.ticks[turnIndex(ev)!]?.km ?? 0)} km 地点）`}。かかる時間 ${fmtH(ev.total_h)}、体力の消費 ${r1(ev.total_effort_h)} / 使える分 ${r1(ev.usable_h)} h、先に尽きるもの: ${ev.limiting === 'water' ? '冷却水' : '酸素'}。`,
      `Recorded walk (${who}): ${r1(s.km)} km, ${fmtH(s.elapsed_h)} (moving ${fmtH(s.moving_h)}), climb ${rec.area ? `${Math.round(s.climb_m)} m (NASADEM)` : 'unknown (outside the elevation data)'}, flat-ground speed ${s.flat_kmh.toFixed(2)} km/h.` +
        ` The same walk from the Mars base: ${ev.ok ? 'can walk back' : `cannot complete it (turn back ${r1(ev.ticks[turnIndex(ev)!]?.km ?? 0)} km out)`}. Time ${fmtH(ev.total_h)}, effort ${r1(ev.total_effort_h)} of ${r1(ev.usable_h)} usable h, runs out first: ${ev.limiting === 'water' ? 'cooling water' : 'oxygen'}.`);
    return {
      text,
      data: { synthetic: rec.synthetic, name: rec.name, summary: s, area: rec.area?.id ?? null, mars: { ok: ev.ok, total_h: ev.total_h, effort_h: ev.total_effort_h, usable_h: ev.usable_h, limiting: ev.limiting }, params },
      sources: [SRC.nasadem, SRC.hirise, SRC.mola, SRC.engine],
    };
  },
};

const marsReplay: ToolDef = {
  name: 'mars_replay',
  kind: 'view',
  description: `Replay the loaded walk: the Hokkaido walk and the same walk on Mars move together while the helmet display shows O₂ and cooling water going down. ${'Only changes what is shown; returns no numbers.'}`,
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'stop'] } }, additionalProperties: false },
  async run(a: { action?: string } = {}) {
    const c = await walkController();
    await c.data();
    if (!c.walk()) await c.importSample();
    c.set3d(false);
    await nextFrame();
    if (a.action === 'stop') { c.stop(); return { text: 'Stopped.' }; }
    c.play();
    return { text: 'Replaying the walk in Hokkaido and on Mars.' };
  },
};

// ---------- open_evidence ----------
const TOPICS: EvidenceTopic[] = ['rover', 'eva', 'terrain', 'consumables', 'hokkaido_terrain'];
const openEvidence: ToolDef = {
  name: 'open_evidence',
  kind: 'compute',
  description: 'Show the evidence behind the plan and open its card on screen. topic: rover (Perseverance\'s real drives: km, slope distribution, how much of this route follows them), eva (real EVA durations: count, median, share longer than this plan), terrain (the Mars elevation data used), consumables (O₂/cooling-water model, Gernhardt 2010 coefficients 3.1/2.7, reserve rule), hokkaido_terrain (the Hokkaido elevation grids). Returns numbers from the loaded data and source links.',
  parameters: { type: 'object', properties: { topic: { type: 'string', enum: TOPICS }, lang: LANG }, required: ['topic'], additionalProperties: false },
  async run(a: { topic?: string; lang?: string } = {}) {
    const l = lang(a);
    const topic = a.topic as EvidenceTopic;
    if (!TOPICS.includes(topic)) throw new Error(`topic must be one of ${TOPICS.join(', ')}`);
    const c = await walkController();
    const data = await c.data();
    const plan = computePlan(c.core, data, c.route(), c.params());
    c.openEvidence(topic);
    const R = c.core.world('mars').radius_km * 1000;
    switch (topic) {
      case 'rover': {
        const r = data.rover;
        if (!r) throw new Error('rover traverse not loaded');
        const k = plan.check;
        return {
          text: t(l,
            `Perseverance の走行記録: 着陸から ${r.last_sol} 火星日、${r1(r.km)} km。走った坂（${r.window_m}m ごと）: 中央値 ${r1(r.slope_p50)}°、9割 ${r1(r.slope_p90)}°、最大 ${r1(r.slope_max)}°。` +
              (k ? ` 今のルートは ${Math.round(k.near_share * 100)}% が実走路から ${k.near_m}m 以内、最大の坂 ${r1(k.route_max_slope)}°、坂が探査車の9割以内の区間 ${Math.round(k.within_rover_share * 100)}%。` : ''),
            `Perseverance traverse: ${r1(r.km)} km over ${r.last_sol} sols. Slopes driven (per ${r.window_m} m): median ${r1(r.slope_p50)}°, 90% ${r1(r.slope_p90)}°, max ${r1(r.slope_max)}°.` +
              (k ? ` This route: ${Math.round(k.near_share * 100)}% within ${k.near_m} m of the real drives, max slope ${r1(k.route_max_slope)}°, ${Math.round(k.within_rover_share * 100)}% of it within the rover's 90% slope.` : '')),
          data: { rover: r, route_check: k && { near_share: k.near_share, near_m: k.near_m, route_max_slope: k.route_max_slope, within_rover_share: k.within_rover_share } },
          sources: [SRC.rover, SRC.engine],
        };
      }
      case 'eva': {
        const e = data.eva;
        if (!e) throw new Error('EVA records not loaded');
        const apolloMax = e.apollo_hours.at(-1) ?? 0;
        return {
          text: t(l,
            `実際の船外活動 ${e.count} 回: 中央値 ${r1(e.median_h)} h、9割 ${r1(e.p90_h)} h、最長 ${r1(e.max_h)} h。Apollo の月面活動 ${e.apollo_hours.length} 回、最長 ${r1(apolloMax)} h。今の計画（${r1(plan.ev.total_h)} 時間）より長かったのは ${Math.round(plan.longer * 100)}%。`,
            `${e.count} real EVAs: median ${r1(e.median_h)} h, 90% ${r1(e.p90_h)} h, longest ${r1(e.max_h)} h. Apollo lunar EVAs: ${e.apollo_hours.length}, longest ${r1(apolloMax)} h. ${Math.round(plan.longer * 100)}% were longer than this plan (${r1(plan.ev.total_h)} h).`),
          data: { count: e.count, median_h: e.median_h, p90_h: e.p90_h, max_h: e.max_h, longest: e.longest, apollo_count: e.apollo_hours.length, apollo_max_h: apolloMax, plan_h: plan.ev.total_h, longer_share: plan.longer },
          sources: [SRC.eva],
        };
      }
      case 'terrain': {
        const d = data.dem;
        if (!d) throw new Error('Jezero elevation grid not loaded');
        const cellM = (d.dlat * Math.PI / 180) * R;
        return {
          text: t(l,
            `火星の地形: Jezero クレーターの標高グリッド ${d.cols}×${d.rows}（1マス約 ${Math.round(cellM)} m）。出典: ${d.src ?? 'n/a'}`,
            `Mars terrain: Jezero elevation grid ${d.cols}×${d.rows} (cells ~${Math.round(cellM)} m). Source: ${d.src ?? 'n/a'}`),
          data: { rows: d.rows, cols: d.cols, cell_m: cellM, src: d.src },
          sources: [SRC.hirise, SRC.mola],
        };
      }
      case 'consumables': {
        const ev = plan.ev;
        return {
          text: t(l,
            `消耗品のモデル: 急いで歩くと冷却水は酸素の ${r1(3.1)}/${r1(2.7)} = ${WATER_PER_O2.toFixed(2)} 倍の速さで減る（Gernhardt 2010 の歩行帰還試験）。帰着時に ${plan.params.reserve}%・最低30分を残す。今の条件で使える酸素 ${r1(ev.usable_o2_h)} h、冷却水 ${r1(ev.usable_water_h)} h、先に尽きるもの: ${ev.limiting === 'water' ? '冷却水' : '酸素'}。`,
            `Consumables model: walking hard uses cooling water ${r1(3.1)}/${r1(2.7)} = ${WATER_PER_O2.toFixed(2)}× as fast as O₂ (Gernhardt 2010 walkback tests). Keep ${plan.params.reserve}% and at least 30 min at arrival. Usable now: O₂ ${r1(ev.usable_o2_h)} h, water ${r1(ev.usable_water_h)} h; runs out first: ${ev.limiting === 'water' ? 'cooling water' : 'oxygen'}.`),
          data: { water_coef: 3.1, o2_coef: 2.7, ratio: WATER_PER_O2, reserve_pct: plan.params.reserve, min_reserve_h: 0.5, usable_o2_h: ev.usable_o2_h, usable_water_h: ev.usable_water_h, limiting: ev.limiting },
          sources: [SRC.gernhardt, SRC.engine],
        };
      }
      case 'hokkaido_terrain': {
        const sites = data.hokkaido;
        if (!sites.length) throw new Error('Hokkaido grids not loaded');
        const g = await loadHokkaidoGrid(c.core, sites[0].id);
        const cellM = Math.round((g.dlat * Math.PI / 180) * 6371000);
        return {
          text: t(l,
            `北海道の地形: 候補地 ${sites.length} か所の標高グリッド（各 約${g.cols}×${g.rows}、1マス約 ${cellM} m）。出典: ${g.src ?? 'NASADEM'}。候補地: ${sites.map((s) => s.name).join('、')}。`,
            `Hokkaido terrain: elevation grids around ${sites.length} candidate sites (~${g.cols}×${g.rows} each, cells ~${cellM} m). Source: ${g.src ?? 'NASADEM'}. Sites: ${sites.map((s) => s.name).join(', ')}.`),
          data: { sites: sites.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon })), cell_m: cellM, src: g.src },
          sources: [SRC.nasadem],
        };
      }
    }
  },
};

// ---------- view tools ----------
const VIEW_NOTE = 'Only changes what is shown; returns no numbers.';
const view3d: ToolDef = {
  name: 'view_3d',
  kind: 'view',
  description: `Switch the Jezero map between 2D and 3D and move the 3D camera (heading: direction the camera looks, degrees clockwise from north; tilt: degrees below the horizon, 90 = straight down; exaggeration: height scale). ${VIEW_NOTE}`,
  parameters: {
    type: 'object',
    properties: {
      on: { type: 'boolean' }, lat: { type: 'number' }, lon: { type: 'number' },
      distance_m: { type: 'number', minimum: 100, maximum: 60000 }, heading_deg: { type: 'number' },
      tilt_deg: { type: 'number', minimum: 5, maximum: 89 }, exaggeration: { type: 'number', minimum: 1, maximum: 6 },
    },
    additionalProperties: false,
  },
  async run(a: { on?: boolean; lat?: number; lon?: number; distance_m?: number; heading_deg?: number; tilt_deg?: number; exaggeration?: number } = {}) {
    const c = await walkController();
    await c.data();
    const on = a.on ?? true;
    c.set3d(on);
    if (on) {
      await nextFrame();
      c.setCamera({ lat: a.lat, lon: a.lon, distance_m: a.distance_m, heading_deg: a.heading_deg, tilt_deg: a.tilt_deg, exaggeration: a.exaggeration });
    }
    return { text: on ? 'Showing the 3D view.' : 'Showing the 2D map.' };
  },
};

const viewGlobe: ToolDef = {
  name: 'view_globe',
  kind: 'view',
  description: `Show the whole-Mars 3D globe (NASA Viking / MOLA mosaic) and turn it to a place (lat, lon in degrees; distance 1.1 close – 6 far). on=false goes back to the Jezero map. Zooming in over Jezero also opens the map. ${VIEW_NOTE}`,
  parameters: { type: 'object', properties: { on: { type: 'boolean' }, lat: { type: 'number' }, lon: { type: 'number' }, distance: { type: 'number' } } },
  async run(a: { on?: boolean; lat?: number; lon?: number; distance?: number } = {}) {
    const c = await walkController();
    await c.data();
    const on = a.on ?? true;
    c.setGlobe(on, on && a.lat != null && a.lon != null ? { lat: Number(a.lat), lon: Number(a.lon), distance: a.distance != null ? Number(a.distance) : undefined } : undefined);
    return { text: on ? 'Showing the Mars globe.' : 'Back to the Jezero map.' };
  },
};

const viewOverlay: ToolDef = {
  name: 'view_overlay',
  kind: 'view',
  description: `Show or hide map layers: rover (Perseverance's real path), reach (walk-home area); rehearsal_index (0-2) picks which Hokkaido practice course is shown after walkback_check with_rehearsal. ${VIEW_NOTE}`,
  parameters: {
    type: 'object',
    properties: { rover: { type: 'boolean' }, reach: { type: 'boolean' }, rehearsal_index: { type: 'integer', minimum: 0, maximum: 2 } },
    additionalProperties: false,
  },
  async run(a: { rover?: boolean; reach?: boolean; rehearsal_index?: number } = {}) {
    const c = await walkController();
    c.setOverlay({ rover: a.rover, reach: a.reach });
    if (a.rehearsal_index != null) c.selectRehearsal(a.rehearsal_index);
    return { text: 'Map layers updated.' };
  },
};

const viewSetParams: ToolDef = {
  name: 'view_set_params',
  kind: 'view',
  description: `Move the sliders on screen (walking speed km/h, O₂ hours, cooling water hours, reserve %). ${VIEW_NOTE} Call walkback_check to get the numbers.`,
  parameters: {
    type: 'object',
    properties: {
      speed_kmh: { type: 'number', minimum: 0.5, maximum: 5 }, o2_h: { type: 'number', minimum: 2, maximum: 12 },
      water_h: { type: 'number', minimum: 2, maximum: 12 }, reserve: { type: 'number', minimum: 0, maximum: 50 },
    },
    additionalProperties: false,
  },
  async run(a: Record<string, unknown> = {}) {
    const c = await walkController();
    const p = paramsFrom(a, c.params());
    c.setParams(p);
    return { text: 'Sliders updated.' };
  },
};

const viewWalk: ToolDef = {
  name: 'view_walk',
  kind: 'view',
  description: `Play the route through the helmet display (out to the turn-back point and home), or stop it. ${VIEW_NOTE}`,
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'stop'] } }, required: ['action'], additionalProperties: false },
  async run(a: { action?: string } = {}) {
    const c = await walkController();
    await c.data();
    await nextFrame();
    if (a.action === 'stop') { c.stop(); return { text: 'Stopped the walk.' }; }
    c.play();
    return { text: 'Playing the walk in the helmet display.' };
  },
};

/** evaluate_route: the evaluation material of the current route (plan.ts evaluateRouteMaterial). */
const evaluateRouteTool: ToolDef = {
  name: 'evaluate_route',
  kind: 'compute',
  description: 'Evaluation material of the route on screen (or the given one): totals (distance, round trip, climb/descent, max/mean slope, legs over the 30° slope limit, poor footing share, verdict, margin, radiation, closeness to Perseverance\'s path), O₂ and cooling water left for departures at 6/9/12/15/18 h local time, and per-segment numbers, each with its source. Use it to compare or explain a route; quote its numbers as they are.',
  parameters: { type: 'object', properties: { route: { description: 'Same as walkback_check route (omit for the route on screen)' }, lang: { type: 'string', enum: ['ja', 'en'] } } },
  async run(a) {
    const c = await walkController();
    const data = await c.data();
    const route = a.route ? resolveRoute(c.core, data, a.route, c.route()) : c.route();
    const m = evaluateRouteMaterial(c.core, data, route, evaParams(c.params()));
    if (!m) throw new Error('no route to evaluate');
    const T = m.totals, l = a.lang === 'en' ? 'en' : 'ja';
    const verdict = T.verdict === 'ok' ? (l === 'ja' ? '帰れる' : 'can walk back') : T.verdict === 'impassable' ? (l === 'ja' ? '通れない坂がある' : 'impassable slope') : (l === 'ja' ? '途中で引き返す' : 'turn back');
    const dep = m.by_departure.map((d) => `${d.start_h}:00 O₂ ${Math.round(d.o2_left * 100)}% / ${l === 'ja' ? '冷却水' : 'water'} ${Math.round(d.water_left * 100)}%`).join(', ');
    const text = l === 'ja'
      ? `評価: ${verdict}。行き ${T.out_km.toFixed(2)} km・往復 ${fmtH(T.round_trip_h)}・登り ${Math.round(T.climb_m)} m / 下り ${Math.round(T.descent_m)} m・最大の坂 ${T.max_slope_deg.toFixed(1)}°（平均 ${T.mean_slope_deg.toFixed(1)}°、上限超え ${T.over_limit_legs} 区間）・足場の悪い区間 ${Math.round(T.poor_footing * 100)}%・放射線 ${T.radiation_msv?.toFixed(2) ?? '—'} mSv。出発時刻別: ${dep}。区間 ${m.segments.length} 個。`
      : `Evaluation: ${verdict}. Out ${T.out_km.toFixed(2)} km, round trip ${fmtH(T.round_trip_h)}, climb ${Math.round(T.climb_m)} m / descent ${Math.round(T.descent_m)} m, steepest ${T.max_slope_deg.toFixed(1)}° (mean ${T.mean_slope_deg.toFixed(1)}°, ${T.over_limit_legs} legs over the limit), poor footing ${Math.round(T.poor_footing * 100)}%, radiation ${T.radiation_msv?.toFixed(2) ?? '—'} mSv. By departure: ${dep}. ${m.segments.length} segments.`;
    return { text, data: m, sources: Object.values(m.sources).map((label) => ({ label })) };
  },
};

/** plan_route: the route to a destination, searched by the Rust core (grid.rs plan_route), then judged. */
const planRouteTool: ToolDef = {
  name: 'plan_route',
  kind: 'compute',
  description: 'Plan the walk from the base to a destination automatically (Dijkstra over the Jezero terrain, only through cells the astronaut can walk back from; cost = walking time with slope, footing and the departure-time cooling water). Puts the route on the map and returns the same verdict as walkback_check. Use it for "go to X", "the way to this point", "plan a route to …".',
  parameters: {
    type: 'object',
    properties: {
      lat: { type: 'number', description: 'Destination latitude (°N) inside the Jezero map' },
      lon: { type: 'number', description: 'Destination longitude (°E)' },
      lang: { type: 'string', enum: ['ja', 'en'] },
    },
    required: ['lat', 'lon'],
  },
  async run(a) {
    const c = await walkController();
    const data = await c.data();
    const params = c.params();
    const base = c.route()[0] ?? LANDING;
    const r = planRoute(c.core, data, base, { lat: Number(a.lat), lon: Number(a.lon), elev: undefined }, evaParams(params));
    if (!r.route) {
      const l = a.lang === 'en' ? 'en' : 'ja';
      const why = r.plan?.status === 'outside_reach'
        ? (l === 'ja' ? `目的地は歩いて帰れる範囲の外（往復で使える分の ${r.plan.goal_ratio != null ? Math.round(r.plan.goal_ratio * 100) + '%' : '100% 超'}）。` : `The destination is outside the walk-home area (${r.plan.goal_ratio != null ? Math.round(r.plan.goal_ratio * 100) + '%' : 'over 100%'} of the budget).`)
        : (l === 'ja' ? '目的地までの道が見つからない（地形データの外か、歩けない坂）。' : 'No path to the destination (outside the terrain data or too steep).');
      return { text: why, data: { status: r.plan?.status ?? 'error', goal_ratio: r.plan?.goal_ratio ?? null } };
    }
    const res = await walkbackCheck.run({ route: r.route.map((w) => ({ lat: w.lat, lon: w.lon })), lang: a.lang });
    return { ...res, text: `${a.lang === 'en' ? `Route planned automatically (${r.route.length - 1} legs, search ${Math.round(r.ms)} ms). ` : `目的地までの経路を自動で引きました（${r.route.length - 1} 区間、探索 ${Math.round(r.ms)} ms）。`}${res.text}` };
  },
};

/** report_obstacle: an obstacle ahead of the astronaut (astronaut view) → blocked cells, route searched again. */
const reportObstacleTool: ToolDef = {
  name: 'report_obstacle',
  kind: 'compute',
  description: 'The astronaut reports an obstacle in front of them while walking (rocks, a crack, a ridge, loose sand, "障害物", "前に…がある", "通れない", "ルート再検索"). Marks a rectangle across the walking direction as impassable (width_m across, depth_m deep, starting ahead_m in front), searches the route again from where the astronaut stands (to the destination on the way out, to the base on the way back) with the same Rust planner, and puts the new route on screen. Returns old and new distance and time and whether the walk is still within oxygen/water. Use it whenever the user says something is blocking the way ahead or asks to re-search the route. Example: "前に障害物が横50mにわたってある。ルート再検索して" → width_m=50.',
  parameters: {
    type: 'object',
    properties: {
      width_m: { type: 'number', description: 'How wide the obstacle is across the walking direction, in metres (e.g. 横50m → 50). Default 50.' },
      ahead_m: { type: 'number', description: 'How far in front of the astronaut it starts, in metres. Default 20.' },
      depth_m: { type: 'number', description: 'How deep it is along the walking direction, in metres. Default 10.' },
      note: { type: 'string', description: 'What it is, if said (e.g. rocks, crack).' },
      lang: LANG,
    },
  },
  async run(a) {
    const l = lang(a);
    const c = peekWalkController();
    if (!c) return { text: t(l, '宇宙飛行士ビューで歩いているときに使えます（先にルートを表示してください）。', 'Use this while walking in the astronaut view (show a route first).') };
    const data = await c.data();
    const r = reportObstacle(c.core, data, c.route(), c.params(), { width_m: a.width_m as number, ahead_m: a.ahead_m as number, depth_m: a.depth_m as number, note: a.note as string });
    if (!r.ok) {
      return { text: r.reason === 'no_view' ? t(l, '宇宙飛行士ビュー（#suit）でルートを歩いているときに使えます。', 'Use this while walking a route in the astronaut view (#suit).')
        : r.reason === 'no_terrain' ? t(l, '地形データが読み込めていないので、ルートを探し直せませんでした。', 'The terrain is not loaded, so the route could not be searched again.')
        : t(l, '障害物は登録しましたが、ここから先へ歩いて行ける道が見つかりませんでした（坂が急すぎるか、地形データの外）。引き返してください。', 'The obstacle is registered, but no walkable way on was found from here (too steep or outside the terrain data). Turn back.'),
        data: { status: r.reason } };
    }
    const dm = Math.round((r.after.km - r.before.km) * 1000), dmin = Math.round((r.after.hours - r.before.hours) * 60);
    const sign = (x: number) => (x >= 0 ? `+${x}` : `${x}`);
    const what = r.back ? t(l, '基地までの帰り道', 'the way home') : t(l, '往復全体', 'the whole walk');
    return {
      text: t(l,
        `障害物（幅 ${r.obstacle.widthM} m・${r.obstacle.aheadM} m 先）を通れない場所として登録し、ここからルートを探し直しました。${what}: ${r1(r.before.km)} km → ${r1(r.after.km)} km（${sign(dm)} m）、${fmtH(r.before.hours)} → ${fmtH(r.after.hours)}（${sign(dmin)} 分）。${r.walkable ? `新しいルートでも酸素・冷却水の範囲内で帰れます（O₂ 残り ${Math.round(r.o2_left * 100)}%）。` : (r.back ? '新しい帰り道では酸素・冷却水が足りません。' : '新しいルートで目的地まで往復するには酸素・冷却水が足りません。引き返し地点で戻ってください。')}`,
        `Registered the obstacle (${r.obstacle.widthM} m wide, ${r.obstacle.aheadM} m ahead) as impassable and searched the route again from here. ${what}: ${r1(r.before.km)} km → ${r1(r.after.km)} km (${sign(dm)} m), ${fmtH(r.before.hours)} → ${fmtH(r.after.hours)} (${sign(dmin)} min). ${r.walkable ? `Still within oxygen and water on the new route (O₂ left ${Math.round(r.o2_left * 100)}%).` : (r.back ? 'Not enough oxygen or water for the new way home.' : 'Not enough oxygen or water to reach the destination and back on the new route: turn back at the turn-back point.')}`),
      data: { phase: r.back ? 'way_back' : 'way_out', obstacle: { width_m: r.obstacle.widthM, ahead_m: r.obstacle.aheadM, depth_m: r.obstacle.depthM },
        before: { km: +r.before.km.toFixed(3), hours: +r.before.hours.toFixed(3) }, after: { km: +r.after.km.toFixed(3), hours: +r.after.hours.toFixed(3) },
        delta_m: dm, delta_min: dmin, walkable: r.walkable, o2_left: +r.o2_left.toFixed(2) },
      sources: [SRC.mola, SRC.engine],
    };
  },
};

/** nearby_spots: destination ideas from NASA data (named places, Perseverance's stops) in the walk-home area. */
const nearbySpotsTool: ToolDef = {
  name: 'nearby_spots',
  kind: 'compute',
  description: 'List destination ideas near the base: places that exist in NASA data (IAU Mars names from the USGS gazetteer, and the points where Perseverance stopped after each drive), kept only when they are inside the walk-home area for the current oxygen/water/speed. Returns name, lat, lon, straight distance from the base and the share of the out-and-back budget. Use it for "what is worth visiting nearby?", "where can I go?", "destination ideas"; then plan_route to one of them.',
  parameters: { type: 'object', properties: { max: { type: 'number', description: 'How many (default 8)' }, lang: LANG } },
  async run(a) {
    const l = lang(a);
    const c = await walkController();
    const data = await c.data();
    const base = c.route()[0] ?? LANDING;
    const reach = reachFrom(c.core, data, base, evaParams(c.params()));
    if (!reach || !data.dem) return { text: t(l, '地形データが読み込めていないので、帰れる範囲を計算できませんでした。', 'The terrain is not loaded, so the walk-home area could not be computed.') };
    const spots = pickSpots(await loadSpotSources(), reach, data.demGrid ?? data.dem, base, Math.max(1, Math.min(20, Number(a?.max) || 8)));
    if (!spots.length) return { text: t(l, '今の酸素・冷却水では、帰れる範囲の中に NASA データの地点がありません。', 'With the current oxygen and water, no NASA-data place is inside the walk-home area.'), data: { spots: [] } };
    const lines = spots.map((s, i) => `${i + 1}. ${s.name[l]} — ${r1(s.km)} km, ${spotNote(s, l)}`);
    return {
      text: `${t(l, `帰れる範囲の中にある行き先の候補（${spots.length} か所）:`, `Destination ideas inside the walk-home area (${spots.length}):`)}\n${lines.join('\n')}\n${t(l, '🎯 で地図の点か一覧を押すと、そこまでの経路を探します。', 'Press 🎯 and pick a point or list entry to plan the route there.')}`,
      data: { base: { lat: base.lat, lon: base.lon }, spots: spots.map((s) => ({ name: s.name.en, kind: s.kind, lat: s.lat, lon: s.lon, km: +s.km.toFixed(2), budget_share: +s.ratio.toFixed(2), sol: s.sol ?? null, height_vs_base_m: s.dz != null ? Math.round(s.dz) : null, note: spotNote(s, l) })) },
      sources: [SPOT_SRC.names, SPOT_SRC.rover, SRC.engine],
    };
  },
};

export const WALK_TOOLS: ToolDef[] = [walkbackCheck, planRouteTool, reportObstacleTool, nearbySpotsTool, evaluateRouteTool, roverWalkbackTool, importWalkTool, marsReplay, openEvidence, view3d, viewGlobe, viewOverlay, viewSetParams, viewWalk];

/**
 * Register the WALKBACK tools and #10's Hokkaido tools.
 */
export function registerAgentTools(core: Core): () => void {
  let live = true;
  const off = WALK_TOOLS.map(registerTool);
  // query_nasa: read-only SQL over the NASA tables (loads DuckDB only when called).
  const q = import('./queryNasa').then((m) => { if (live) off.push(registerTool(m.makeQueryNasa(core)), registerTool(m.makeListNasaTablesTool(core)), registerTool(m.makeSummarizeNasaTool(core)), registerTool(m.makeCompareNasaTool(core))); }).catch(() => undefined);
  // #10's explore.ts (explore_hokkaido, view_scan, …): every exported make…Tool(core). Loaded lazily
  // so duckdb-wasm stays out of the first load.
  const ex = import('./explore').then((m) => {
    if (!live) return;
    for (const [name, f] of Object.entries(m as Record<string, unknown>)) {
      if (/^make\w*Tool$/.test(name) && typeof f === 'function') {
        try {
          const tool = (f as (c: Core) => ToolDef)(core);
          if (tool.name === 'explore_hokkaido') {
            // DuckDB comes from jsDelivr on the web build: say what to do when it cannot load.
            const run = tool.run;
            tool.run = (args) => run(args).catch((e: unknown) => {
              const msg = e instanceof Error ? e.message : String(e);
              if (/where:|unknown (target|test)/.test(msg)) throw e;
              throw new Error(getLang() === 'ja'
                ? `北海道全域のデータベース（DuckDB）を読み込めませんでした。Web 版はネットから読み込むので、接続を確かめてもう一度聞いてください。デスクトップ版はオフラインでも動きます。（${msg}）`
                : `Could not load the Hokkaido database (DuckDB). The web version downloads it, so check the connection and ask again; the desktop app works offline. (${msg})`);
            });
          }
          off.push(registerTool(tool));
        } catch { /* skip a tool that cannot be built */ }
      }
    }
  }).catch(() => undefined);
  setToolsReady(Promise.all([q, ex]).then(() => undefined));
  return () => { live = false; off.forEach((f) => f()); };
}
