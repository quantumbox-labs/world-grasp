// Astronaut view (#suit): walk the route on the real Jezero terrain with the helmet numbers on top.
// Shows only what NASA's EVA display work asks for on the way back (SUITS: path back to the
// airlock; Joint AR: direct return to the lander with a time estimate, distances): which way and
// how far the base is, how much margin is left, and how far to the turn-back point.
// Big area: the 3D terrain (MOLA/HRSC grid + HiRISE photo) seen from just behind the walker.
// Corner: the 2D map (Viking + HiRISE tiles) following the walker.
// It reads the route and settings drawn on the WALKBACK screen (same plan, same Rust numbers).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Core, Waypoint } from '../core';
import { JEZERO, LANDING, ensureFooting, exampleRoute, loadWalkData, type WalkData } from '../walk/data';
import { peekWalkController } from '../walk/controller';
import { DEFAULT_PARAMS, DEFAULT_START, MAX_SLOPE, WORLD, denseRoute, evaParams, evaluate, turnIndex, type PlanParams } from '../walk/plan';
import { fmtH } from '../walk/geo';
import { Terrain3D, type Beacon3D, type Camera3D, type Patch3D, type Ribbon3D, type Sky3D } from '../map/Terrain3D';
import { LAYERS } from '../layers';
import { PlanetMap, type Feature } from '../map/PlanetMap';
import { useT } from '../i18n';
import { callTool } from '../agent/port';
import { clearObstacles, getObstacles, onObstacles, setSuitLink, type Obstacle } from '../walk/obstacle';
import './suit.css';

const R_MARS_M = 3389.5e3;
const K = (Math.PI / 180) * R_MARS_M;
/** Planar distance (m) and bearing (deg, 0 = north) from a to b; fine at a few km. */
function vec(a: Waypoint, b: Waypoint) {
  const dx = (b.lon - a.lon) * K * Math.cos((a.lat * Math.PI) / 180), dy = (b.lat - a.lat) * K;
  return { m: Math.hypot(dx, dy), deg: (Math.atan2(dx, dy) * 180) / Math.PI };
}
const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const HIRISE = ['hirise'];
/** Follow camera: a little behind and above the walker, looking along the way. */
/** First person: eyes 1.7 m above the ground, looking a little down along the route. */
const EYE_M = 1.7, PITCH = -7;
const MAP_Z = 15;
/** Playback only: how fast ▶ and the keys move along the route. The calculation's walking speed is unchanged. */
const SPEEDS = [1, 10, 60, 300, 1000];

// Sharper ground near the walker: HiRISE z15 tiles (≈1.2 m/px; the whole-crater photo is ≈9.6 m/px),
// bundled copy first, NASA Trek as the fallback. EPSG:4326 tiles: 2^(z+1) × 2^z of 256 px.
const HZ = 15, TILE_DEG = 180 / 2 ** HZ, PATCH_TILES = 8, PATCH_MOVE_M = 700;
const hiriseTile = (y: number, x: number) => [`./tiles/mars-hirise/${HZ}/${y}/${x}.png`,
  LAYERS.marsOverlay.hirise.url.replace('{z}', String(HZ)).replace('{y}', String(y)).replace('{x}', String(x))];
const tileCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadTile(y: number, x: number) {
  const key = `${y}/${x}`;
  let p = tileCache.get(key);
  if (!p) {
    const [local, remote] = hiriseTile(y, x);
    p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => { if (im.src.endsWith(local.slice(1))) im.src = remote; else res(null); };
      im.src = local;
    });
    tileCache.set(key, p);
  }
  return p;
}
/** A PATCH_TILES² mosaic of HiRISE tiles centred on lat/lon, with the same light Mars tint as the 2D map. */
async function buildPatch(lat: number, lon: number): Promise<Patch3D | null> {
  const x0 = Math.floor((lon + 180) / TILE_DEG) - PATCH_TILES / 2, y0 = Math.floor((90 - lat) / TILE_DEG) - PATCH_TILES / 2;
  const tiles = await Promise.all(Array.from({ length: PATCH_TILES * PATCH_TILES }, (_, k) => loadTile(y0 + Math.floor(k / PATCH_TILES), x0 + (k % PATCH_TILES))));
  if (!tiles.some(Boolean)) return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = PATCH_TILES * 256;
  const ctx = cv.getContext('2d')!;
  ctx.filter = 'sepia(0.85) saturate(2.1) hue-rotate(-28deg) brightness(0.98)';
  tiles.forEach((im, k) => im && ctx.drawImage(im, (k % PATCH_TILES) * 256, Math.floor(k / PATCH_TILES) * 256));
  return { image: cv, west: -180 + x0 * TILE_DEG, east: -180 + (x0 + PATCH_TILES) * TILE_DEG, north: 90 - y0 * TILE_DEG, south: 90 - (y0 + PATCH_TILES) * TILE_DEG };
}
/** Half-size (deg of latitude) of the 2D map's window around the walker. */
const MAP_HALF = 0.004;

export function SuitView({ core }: { core: Core }) {
  const t = useT();
  const [data, setData] = useState<WalkData | null>(null);
  const [route, setRoute] = useState<Waypoint[]>([]);
  const [params, setParams] = useState<PlanParams>(DEFAULT_PARAMS);
  useEffect(() => { loadWalkData(core).then(setData, () => undefined); }, [core]);
  // Follow the route and sliders of the WALKBACK screen.
  useEffect(() => {
    const read = () => {
      const c = peekWalkController();
      if (!c) return;
      const r = c.route(), q = c.params();
      setRoute((old) => (JSON.stringify(old) === JSON.stringify(r) ? old : r));
      setParams((old) => (JSON.stringify(old) === JSON.stringify(q) ? old : q));
    };
    read();
    const id = setInterval(read, 700);
    return () => clearInterval(id);
  }, []);

  const p = useMemo(() => evaParams(params), [params]);
  const dense = useMemo(() => denseRoute(core, data, route), [core, data, route]);
  const ev = useMemo(() => (dense.pts.length >= 2 ? evaluate(core, dense, p) : null), [core, dense, p]);
  const turn = ev ? turnIndex(ev) : null;
  const last = dense.pts.length - 1;
  const outEnd = turn ?? last;
  /** The walk: out to the turn-back point (or the route end), then back to the base along the same route. pos runs 0 → total. */
  const total = outEnd >= 1 ? 2 * outEnd : last;

  // Where the astronaut is: a position along the route (slider, keys or ▶ walk).
  const [pos, setPos] = useState(0);
  const [walking, setWalking] = useState(false);
  /** Playback speed multiplier on the plan's own clock: ×1 = real walking pace (1 s per 1 s), ×60 = a minute per second. */
  const [speed, setSpeed] = useState(60);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const raf = useRef(0);
  // After an obstacle re-search the route changes under the walker: keep walking from where they stood.
  const resume = useRef<{ at: number; back: boolean; walking: boolean; km: number; h: number } | null>(null);
  // Distance and time walked before a re-search, so the totals carry on across it.
  const offset = useRef({ km: 0, h: 0 });
  const shown = useRef({ km: 0, h: 0 });
  useEffect(() => {
    const r = resume.current;
    resume.current = null;
    if (r && dense.wp[r.at] != null) {
      const k = dense.wp[r.at], oe = turn ?? dense.pts.length - 1;
      const np = r.back ? Math.min(2 * oe, 2 * oe - Math.min(k, oe) + 0.01) : Math.min(k, oe);
      offset.current = { km: r.km - atRef.current(np).walkedM / 1000, h: r.h - timeAt(np) };
      setPos(np);
      setWalking(false);
      if (r.walking) setTimeout(() => setWalking(true), 0); // restart playback on the new route's clock
      return;
    }
    offset.current = { km: 0, h: 0 };
    setPos(0); setWalking(false);
  }, [route, params]); // eslint-disable-line react-hooks/exhaustive-deps
  // Clock of the walk (hours) at each whole pos: out = the plan's elapsed time, back = + time already walked home.
  const clock = useMemo(() => {
    if (!ev || total < 1) return [0];
    const T = ev.ticks[outEnd];
    return Array.from({ length: total + 1 }, (_, k) => (k <= outEnd ? ev.ticks[k].t_h : T.t_h + T.home_h - ev.ticks[2 * outEnd - k].home_h));
  }, [ev, total, outEnd]);
  const timeAt = (x: number) => { const k = Math.max(0, Math.min(total - 1, Math.floor(x))); return clock[k] + ((clock[k + 1] ?? clock[k]) - clock[k]) * Math.min(1, x - k); };
  const posAt = (h: number) => {
    let lo = 0, hi = total;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (clock[m] <= h) lo = m; else hi = m; }
    const d = (clock[lo + 1] ?? clock[lo]) - clock[lo];
    return Math.min(total, lo + (d > 0 ? Math.min(1, (h - clock[lo]) / d) : 1));
  };
  useEffect(() => {
    if (!walking) return;
    let h = timeAt(pos), t0 = performance.now();
    const end = clock[total] ?? 0;
    const frame = (now: number) => {
      h += ((now - t0) / 1000 / 3600) * speed; t0 = now;
      setPos(posAt(h));
      if (h < end) raf.current = requestAnimationFrame(frame); else setWalking(false);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [walking, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys (only while this tab is shown): ↑/W walk on, ↓/S walk back, space ▶/■.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!location.hash.startsWith('#suit') || last < 1) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') { e.preventDefault(); setWalking(false); setPos((x) => Math.min(total, x + Math.min(3, 0.05 * speedRef.current))); }
      else if (k === 'arrowdown' || k === 's') { e.preventDefault(); setWalking(false); setPos((x) => Math.max(0, x - Math.min(3, 0.05 * speedRef.current))); }
      else if (k === ' ') { e.preventDefault(); setWalking((w) => !w); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [last, total]);

  // Position on the route at pos: point and direction of travel (looking a few steps ahead, so the camera does not jitter).
  const at = (x0: number) => {
    const back = outEnd >= 1 && x0 > outEnd, x = back ? 2 * outEnd - x0 : x0;
    const i = Math.max(0, Math.min(last, Math.floor(x))), j = Math.min(last, i + 1), u = Math.min(1, Math.max(0, x - i));
    const here: Waypoint = { lat: dense.pts[i].lat + (dense.pts[j].lat - dense.pts[i].lat) * u, lon: dense.pts[i].lon + (dense.pts[j].lon - dense.pts[i].lon) * u };
    const k0 = Math.min(Math.max(0, last - 1), i), k1 = Math.min(last, i + 3);
    // Feel of the ground: look up/down with the slope under the feet, and a small step bob (2.5 cm per 0.8 m stride).
    const leg = ev?.legs[Math.min(i, (ev?.legs.length ?? 1) - 1)];
    const slope = (leg?.known ? Math.max(-15, Math.min(15, leg.slope_deg)) : 0) * (back ? -1 : 1);
    const kmHere = ev ? ev.ticks[i].km + ((ev.ticks[j] ?? ev.ticks[i]).km - ev.ticks[i].km) * u : 0;
    const walkedM = (back && ev ? 2 * ev.ticks[outEnd].km - kmHere : kmHere) * 1000;
    const bob = 0.025 * Math.abs(Math.sin((walkedM / 0.8) * Math.PI));
    const fwd = vec(dense.pts[k0], dense.pts[k1]).deg;
    return { i, j, u, here, back, walkedM, heading: back ? (fwd + 180) % 360 : fwd, pitch: PITCH + slope * 0.6, eyeM: EYE_M + bob };
  };

  // 3D first-person camera (~20 per second) and 2D map follow (twice a second; a fit, not a fly, so it keeps up), from the latest pos.
  const posRef = useRef(pos);
  posRef.current = pos;
  const [camera, setCamera] = useState<Camera3D | null>(null);
  const [fit, setFit] = useState<{ bounds: [[number, number], [number, number]]; seq: number } | null>(null);
  const atRef = useRef(at);
  atRef.current = at;
  useEffect(() => {
    if (last < 1) return;
    let lastCam = -1, lastFly = -1, n = 0;
    const id = setInterval(() => {
      const x = posRef.current;
      const { here, heading, pitch, eyeM } = atRef.current(x);
      if (x !== lastCam) {
        lastCam = x;
        setCamera({ eye: { lat: here.lat, lon: here.lon, heightM: eyeM, pitch }, heading, seq: performance.now() });
      }
      if (++n % 10 === 0 && x !== lastFly) {
        lastFly = x;
        const dl = MAP_HALF / Math.cos((here.lat * Math.PI) / 180);
        setFit({ bounds: [[here.lat - MAP_HALF, here.lon - dl], [here.lat + MAP_HALF, here.lon + dl]], seq: performance.now() });
      }
    }, 50);
    return () => clearInterval(id);
  }, [last, dense]);

  // Sharper ground: rebuild the HiRISE patch when the walker is PATCH_MOVE_M from its centre.
  const [patch, setPatch] = useState<Patch3D | null>(null);
  const patchAt = useRef<Waypoint | null>(null);
  useEffect(() => {
    if (last < 1) return;
    let live = true;
    const id = setInterval(() => {
      const { here } = atRef.current(posRef.current);
      if (patchAt.current && vec(patchAt.current, here).m < PATCH_MOVE_M) return;
      patchAt.current = here;
      buildPatch(here.lat, here.lon).then((p) => { if (live && p) setPatch(p); }, () => undefined);
    }, 300);
    return () => { live = false; clearInterval(id); patchAt.current = null; };
  }, [last, dense]);

  // Route as an AR bar on the ground: cyan on the way out, red past the turn-back point;
  // light pillars at the base and the turn-back point so they show from far away.
  const [obst, setObst] = useState<Obstacle[]>(getObstacles());
  const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const ribbons = useMemo<Ribbon3D[]>(() => {
    if (last < 1) return [];
    const ll = (a: number, b: number) => dense.pts.slice(a, b + 1).map((q) => [q.lat, q.lon] as [number, number]);
    const r: Ribbon3D[] = [{ pts: ll(0, outEnd), color: '#4fd8ff', widthM: 4, opacity: 0.5 }];
    if (turn != null) r.push({ pts: ll(turn, last), color: '#ff4d4f', widthM: 4, opacity: 0.45 });
    // Obstacles: a red band over the blocked rectangle.
    for (const o of obst) r.push({ pts: [mid(o.corners[0], o.corners[1]), mid(o.corners[2], o.corners[3])], color: '#ff2a2a', widthM: o.widthM, opacity: 0.55 });
    return r;
  }, [dense, outEnd, turn, last, obst]);
  const beacons = useMemo<Beacon3D[]>(() => {
    if (last < 1) return [];
    const b: Beacon3D[] = [{ lat: dense.pts[0].lat, lon: dense.pts[0].lon, color: '#ffffff', heightM: 120, radiusM: 4 }];
    if (turn != null) b.push({ lat: dense.pts[turn].lat, lon: dense.pts[turn].lon, color: '#ff4d4f', heightM: 80, radiusM: 3 });
    for (const o of obst) for (const q of [mid(o.corners[0], o.corners[3]), mid(o.corners[1], o.corners[2])]) b.push({ lat: q[0], lon: q[1], color: '#ff2a2a', heightM: 10, radiusM: 1.5 });
    return b;
  }, [dense, turn, last, obst]);
  const features = useMemo<Feature[]>(() => {
    if (last < 1) return [];
    const f: Feature[] = ribbons.slice(0, turn != null ? 2 : 1).map((l) => ({ kind: 'line', pts: l.pts, color: l.color, weight: 4, opacity: 0.8 }));
    for (const o of obst) f.push({ kind: 'line', pts: [...o.corners, o.corners[0]], color: '#ff2a2a', weight: 3, tooltip: t('障害物', 'Obstacle') });
    f.push({ kind: 'point', lat: dense.pts[0].lat, lon: dense.pts[0].lon, radius: 7, color: '#ffffff', tooltip: t('基地', 'Base') });
    if (turn != null) f.push({ kind: 'point', lat: dense.pts[turn].lat, lon: dense.pts[turn].lon, radius: 7, color: '#ff4d4f', tooltip: t('引き返し地点', 'Turn-back point') });
    return f;
  }, [ribbons, dense, turn, last, obst]); // eslint-disable-line react-hooks/exhaustive-deps
  // Notices: a card only when the ground or the situation under the feet changes (existing data only:
  // route legs' slope, the Rust footing grid, the plan's margin), newest on top, each gone after 6 s.
  const foot = useMemo(() => {
    if (!data?.footing || dense.pts.length < 2) return null;
    try { ensureFooting(core, true); return core.sampleFooting(JEZERO, dense.pts.map((w) => [w.lat, w.lon] as [number, number])); }
    catch { return null; } finally { ensureFooting(core, params.footing ?? true); }
  }, [core, data, dense]); // eslint-disable-line react-hooks/exhaustive-deps
  const footMid = useMemo(() => { try { const m = core.footingModel(); return (m.eta_firm + m.eta_loose) / 2; } catch { return null; } }, [core]);
  const [feed, setFeed] = useState<{ id: number; text: string; tone: 'info' | 'warn' | 'bad' }[]>([]);
  const prevSig = useRef<Record<string, string> | null>(null);
  useEffect(() => { prevSig.current = null; }, [dense]);
  useEffect(() => {
    if (!ev || last < 1) return;
    const w = atRef.current(pos);
    const leg = ev.legs[Math.min(w.i, ev.legs.length - 1)];
    const sl = leg?.known ? Math.abs(leg.slope_deg) : null;
    const band = sl == null ? 'unknown' : sl < 8 ? 'gentle' : sl < 15 ? 'mid' : sl < MAX_SLOPE - 5 ? 'steep' : 'limit';
    const f = foot?.[w.i] ?? null;
    const fc = f == null || footMid == null ? 'none' : f < footMid ? 'firm' : 'loose';
    const lowM = !w.back && ev.ticks[w.i].margin_h < 0.75 ? 'low' : 'ok';
    const near = w.back && vec(w.here, dense.pts[0]).m < 500 ? 'near' : 'far';
    const sig: Record<string, string> = { band, fc, lowM, dir: w.back ? 'back' : 'out', near };
    const prev = prevSig.current;
    prevSig.current = sig;
    if (!prev) return;
    const add: { text: string; tone: 'info' | 'warn' | 'bad' }[] = [];
    const n = sl == null ? 0 : Math.round(sl);
    if (sig.band !== prev.band && band !== 'unknown') add.push(
      band === 'gentle' ? { text: t(`緩い坂 ${n}°`, `Gentle slope ${n}°`), tone: 'info' }
      : band === 'mid' ? { text: t(`坂 ${n}°`, `Slope ${n}°`), tone: 'info' }
      : band === 'steep' ? { text: t(`急な坂 ${n}°`, `Steep slope ${n}°`), tone: 'warn' }
      : { text: t(`歩行限界に近い坂 ${n}°（限界 ${MAX_SLOPE}°）`, `Near the walking limit: ${n}° (limit ${MAX_SLOPE}°)`), tone: 'bad' });
    if (sig.fc !== prev.fc && fc !== 'none') add.push(fc === 'firm'
      ? { text: t('固い地面（岩・締まった地表）', 'Firm ground (rock, packed surface)'), tone: 'info' }
      : { text: t(`砂・ちりでゆるい地面（歩く時間 ×${(f ?? 1).toFixed(2)}）`, `Loose sand and dust (walking time ×${(f ?? 1).toFixed(2)})`), tone: 'warn' });
    if (sig.lowM !== prev.lowM && lowM === 'low') add.push({ text: t('引き返しまでの余裕が 45 分を切った', 'Under 45 min of margin before turning back'), tone: 'warn' });
    if (sig.dir !== prev.dir) add.push(w.back ? { text: t('引き返し開始：基地へ', 'Turned back: heading to base'), tone: 'warn' } : { text: t('外へ向かって出発', 'Heading out'), tone: 'info' });
    if (sig.near !== prev.near && near === 'near') add.push({ text: t('基地まで 500 m', 'Base within 500 m'), tone: 'info' });
    if (!add.length) return;
    const now = Date.now();
    const cards = add.map((c, k) => ({ ...c, id: now + k + Math.random() }));
    setFeed((old) => [...cards.reverse(), ...old].slice(0, 5));
    for (const c of cards) setTimeout(() => setFeed((old) => old.filter((x) => x.id !== c.id)), 6000);
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Obstacle reports (report_obstacle tool, the 「前に障害物」 button): pose for the tool, the new route
  // continues from here, a red band where the obstacle is, and a card with the change.
  const walkingRef = useRef(walking);
  walkingRef.current = walking;
  useEffect(() => {
    setSuitLink({
      pose: () => {
        if (!ev || last < 1 || !location.hash.startsWith('#suit')) return null;
        const x = posRef.current, w = atRef.current(x);
        const T = ev.ticks[outEnd], idx = ev.ticks[w.i];
        const passed = dense.wp.filter((k) => k <= w.i).length;
        return { here: w.here, heading: w.heading, back: w.back, passed, i: w.i + w.u,
          homeH: idx?.home_h ?? 0, homeKm: w.back ? (idx?.km ?? 0) : T.km };
      },
      continueOn: (r, at, back) => {
        resume.current = { at, back, walking: walkingRef.current, km: shown.current.km, h: shown.current.h };
        peekWalkController()?.setRoute(r);
      },
    });
    return () => setSuitLink(null);
  }, [ev, last, outEnd, dense]);
  useEffect(() => onObstacles((list, r) => {
    setObst(list);
    if (!r) return;
    const dm = Math.round((r.after.km - r.before.km) * 1000), dmin = Math.round((r.after.hours - r.before.hours) * 60);
    const sg = (x: number) => (x >= 0 ? `+${x}` : `${x}`);
    const card = { id: Date.now() + Math.random(), tone: (r.walkable ? 'warn' : 'bad') as 'warn' | 'bad',
      text: t(`障害物を登録・ルート再検索：${sg(dm)} m / ${sg(dmin)} 分`, `Obstacle registered, route re-searched: ${sg(dm)} m / ${sg(dmin)} min`) };
    setFeed((old) => [card, ...old].slice(0, 5));
    setTimeout(() => setFeed((old) => old.filter((x) => x.id !== card.id)), 9000);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const obstacleAhead = async () => {
    setBusy(true);
    try {
      const r = await callTool('report_obstacle', { width_m: 50, ahead_m: 20, depth_m: 10, lang: t('ja', 'en') });
      if (!r.ok || (r.result.data as { status?: string } | undefined)?.status) {
        const card = { id: Date.now() + Math.random(), tone: 'bad' as const, text: r.result.text };
        setFeed((old) => [card, ...old].slice(0, 5));
        setTimeout(() => setFeed((old) => old.filter((x) => x.id !== card.id)), 9000);
      }
    } finally { setBusy(false); }
  };

  // Sky from the local solar time of the walk (departure hour + time walked), or forced night for showing the stars.
  const [skyMode, setSkyMode] = useState<'real' | 'night'>('real');
  const tH = ev && last >= 1 ? timeAt(pos) + offset.current.h : 0;
  const hour = ((params.start ?? DEFAULT_START) + tH) % 24;
  const sky = useMemo<Sky3D>(() => {
    if (skyMode === 'night') return { sunAz: 0, sunEl: -30 };
    const f = (hour - 6) / 12; // 0 at 6:00, 1 at 18:00 (rough: Jezero 18°N, equinox)
    return { sunAz: Math.round(90 + 180 * f), sunEl: Math.round(72 * Math.sin(Math.PI * f)) };
  }, [skyMode, Math.round(hour * 10)]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo<[number, number, number]>(() => [route[0]?.lat ?? LANDING.lat, route[0]?.lon ?? LANDING.lon, MAP_Z], [route]);

  if (!data) return <div className="suit"><p className="suit-empty">{t('NASA データを読み込み中…', 'Loading NASA data…')}</p></div>;
  if (!ev || route.length < 2) {
    return (
      <div className="suit">
        <div className="suit-empty">
          <p>{t('まだルートがありません。', 'No route yet.')}</p>
          <p className="muted">{t('「火星で歩いて帰る」でルートを引くと、ここでそのルートを 3D の地形の上で歩けます。', 'Draw a route on “Walk back on Mars” and you can walk it here on the 3D terrain.')}</p>
          <div className="suit-actions">
            <a className="btn" href="#walk">{t('ルートを引く', 'Draw a route')}</a>
            <button onClick={() => peekWalkController()?.setRoute(exampleRoute(data.traverseRaw))}>{t('サンプルのルートで見る', 'Use the sample route')}</button>
          </div>
        </div>
      </div>
    );
  }

  const { i, j, u, here, heading, back } = at(pos);
  const lerp = (x: number, y: number) => x + (y - x) * u;
  const a = ev.ticks[i], b = ev.ticks[j] ?? a;
  const T = ev.ticks[outEnd];
  // On the way back: time home from here (same Rust numbers), O2/water keep dropping at the rate of the way out.
  const homeHere = lerp(a.home_h, b.home_h), backH = back ? Math.max(0, T.home_h - homeHere) : 0;
  const rate = (left: number) => (1 - left) / Math.max(1e-6, T.t_h);
  const km = back ? 2 * T.km - lerp(a.km, b.km) : lerp(a.km, b.km), margin = back ? T.margin_h : lerp(a.margin_h, b.margin_h), home = homeHere;
  const o2 = back ? T.o2_left - rate(T.o2_left) * backH : lerp(a.o2_left, b.o2_left);
  const water = back ? T.water_left - rate(T.water_left) * backH : lerp(a.water_left, b.water_left);
  shown.current = { km: km + offset.current.km, h: tH };
  const base = dense.pts[0];
  const toBase = vec(here, base);
  // The arrow shows the base relative to the direction of travel (= the 3D camera's view).
  const rel = ((toBase.deg - heading) % 360 + 540) % 360 - 180;
  const turnKm = turn != null ? ev.ticks[turn]?.km ?? null : null;
  const toTurnKm = turnKm != null ? turnKm - km : null;
  const past = !back && turn != null && pos >= turn;
  const low = Math.min(o2, water);
  const state: 'ok' | 'soon' | 'now' = back ? (low < 0.1 ? 'now' : low < 0.25 ? 'soon' : 'ok') : past || margin <= 0 ? 'now' : margin < 0.75 ? 'soon' : 'ok';
  const msg = back ? (pos >= total - 0.05 ? t('基地に到着', 'Back at base') : t('基地へ帰還中', 'Heading home'))
    : state === 'now' ? t('今すぐ基地へ戻る', 'Head back to base now')
    : state === 'soon' ? t('まもなく引き返し', 'Turn back soon')
    : t('帰れる', 'You can get home');
  const live: Feature[] = [{ kind: 'walker', lat: here.lat, lon: here.lon, color: '#ff7a45' }];

  return (
    <div className={`suit suit-${state}`}>
      <div className="suit-stage">
        {data.demGrid
          ? <Terrain3D grid={data.demGrid} radiusKm={core.world(WORLD).radius_km} palette="mars" ribbons={ribbons} beacons={beacons} near={0.3} exaggeration={1} sky={sky}
              camera={camera} patch={patch} photo="./data/jezero_ortho.jpg" label={t('Jezero クレーター・一人称（AR）', 'Jezero crater, first person (AR)')} />
          : <p className="suit-empty">{t('3D の地形データを読み込めませんでした。', 'Could not load the 3D terrain data.')}</p>}

        <div className="suit-hud" role="status" aria-live="polite">
          <div className="suit-msg">{msg}</div>
          <div className="suit-hud-row">
            <div className="suit-compass" aria-label={t(`基地は ${Math.round(rel)}° の方向`, `Base at ${Math.round(rel)}°`)}>
              <svg viewBox="-60 -60 120 120" width="92" height="92" aria-hidden="true">
                <circle r="54" className="ring" />
                <g transform={`rotate(${rel})`}><path d="M0,-48 L16,-6 L5,-10 L5,30 L-5,30 L-5,-10 L-16,-6 Z" className="arrow" /></g>
              </svg>
              <div className="suit-big">{fmtKm(toBase.m)}</div>
              <div className="suit-sub">{t('基地まで（直線）', 'to base (straight)')}</div>
            </div>
            <div className="suit-figs">
              <div><span>{t('帰りに要る時間', 'Time to get home')}</span><b>{fmtH(home)}</b></div>
              <div className={state !== 'ok' ? 'warn' : ''}>
                <span>{t('引き返しまでの余裕', 'Margin before turn-back')}</span>
                <b>{back ? t('帰還中', 'returning') : past ? t('超過', 'passed') : fmtH(Math.max(0, margin))}</b>
              </div>
              <div className={state !== 'ok' ? 'warn' : ''}>
                <span>{t('帰れない境界まで', 'To the point of no return')}</span>
                <b className="small">{back ? t('引き返し済み', 'turned back') : toTurnKm == null ? t('最後まで帰れる', 'Whole route walkable') : past ? t('越えた', 'crossed') : fmtKm(toTurnKm * 1000)}</b>
              </div>
            </div>
          </div>
          <div className="suit-bars">
            <Bar label="O₂" v={o2} warn={ev.limiting === 'o2' && o2 < 0.35} />
            <Bar label={t('冷却水', 'Water')} v={water} warn={ev.limiting === 'water' && water < 0.35} />
          </div>
          <div className="suit-foot">{t(`歩いた距離 ${(km + offset.current.km).toFixed(2)} km`, `Walked ${(km + offset.current.km).toFixed(2)} km`)}</div>
        </div>

        <ol className="suit-feed" aria-live="polite">
          {feed.map((c) => <li key={c.id} className={`suit-card ${c.tone}`}>{c.text}</li>)}
        </ol>

        <div className="suit-map2d" aria-label={t('2D 地図', '2D map')}>
          <PlanetMap core={core} world={WORLD} view={view} fit={fit} baseKey="viking" overlayKeys={HIRISE} collapsedLayers features={features} live={live} />
          <div className="suit-legend"><i className="lg-base" />{t('基地', 'Base')} <i className="lg-turn" />{t('引き返し', 'Turn-back')} <i className="lg-me" />{t('いま', 'You')}</div>
        </div>
      </div>

      <div className="suit-controls">
        <button onClick={() => (walking ? setWalking(false) : (pos >= total && setPos(0), setWalking(true)))}>
          {walking ? t('■ 止める', '■ Stop') : t('▶ 歩いてみる', '▶ Walk')}
        </button>
        <span className="suit-speed" role="group" aria-label={t('再生の速さ', 'Playback speed')}>
          {t('再生の速さ', 'Playback speed')}
          {SPEEDS.map((x) => (
            <button key={x} className={x === speed ? 'on' : ''} aria-pressed={x === speed} onClick={() => setSpeed(x)}>×{x}</button>
          ))}
        </span>
        <label>
          {t('いまの位置', 'Position')}
          <input type="range" min={0} max={total} step={0.1} value={pos} onChange={(e) => { setWalking(false); setPos(+e.target.value); }} />
        </label>
        <span className="muted keys">{t('↑/W 進む・↓/S 戻る・スペース 歩く/止める', '↑/W forward, ↓/S back, space walk/stop')}</span>
        <span className="suit-speed" role="group" aria-label={t('空', 'Sky')}>
          {t('空', 'Sky')}
          <button className={skyMode === 'real' ? 'on' : ''} aria-pressed={skyMode === 'real'} onClick={() => setSkyMode('real')}>{t(`実際の時刻 ${Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`, `Real time ${Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`)}</button>
          <button className={skyMode === 'night' ? 'on' : ''} aria-pressed={skyMode === 'night'} onClick={() => setSkyMode('night')}>{t('夜にする', 'Night')}</button>
        </span>
        <button className="suit-obstacle" onClick={obstacleAhead} disabled={busy}>{t('⚠ 前に障害物', '⚠ Obstacle ahead')}</button>
        {obst.length > 0 && <button onClick={() => clearObstacles(core, data)}>{t('障害物を消す', 'Clear obstacles')}</button>}
        <a href="#walk">{t('ルートを変える', 'Change route')}</a>
        <a href="#sources">{t('出典', 'Sources')}</a>
      </div>
    </div>
  );
}

const Bar = ({ label, v, warn }: { label: string; v: number; warn: boolean }) => (
  <div className={`suit-bar${warn ? ' warn' : ''}`}>
    <span>{label}</span>
    <div className="suit-track"><div style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></div>
    <b>{Math.round(Math.max(0, v) * 100)}%</b>
  </div>
);
