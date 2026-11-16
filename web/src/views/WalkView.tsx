// #11 Martian Map "WALKBACK" (Jezero): plan a walk from a base on Mars, see where you can still
// walk home from (O₂ and cooling water), check the plan against Perseverance's real drives and
// real EVA durations, play it back through a helmet display, and find the same walk in Hokkaido.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Core, Waypoint, World } from '../core';
import { getElevation } from '../elevation';
import { PlanetMap, missionOverlay, type Feature, type FlyTarget } from '../map/PlanetMap';
import { JEZERO, LANDING, ensureFooting, exampleRoute, loadWalkData, setSurfaceOn, surface, type WalkData } from '../walk/data';
import { fmtH, footingImage, reachImage, slopeColor, surfaceImage } from '../walk/geo';
import { DEFAULT_START, WALKBACK_COLOR, WATER_PER_O2, WORLD, waterFactor, denseRoute, easyLeg, steepLeg, MAX_SLOPE, evaluateRouteMaterial, evaParams, planRoute, routeMetrics, type RouteMetrics, evaluate, reachFrom, rehearsalPoints, roverCheck, roverWalkbackSql, turnIndex, turnWaypoint, walkbackState } from '../walk/plan';
import { setWalkController, type EvidenceTopic } from '../walk/controller';
import { useLang, useT } from '../i18n';
import { GpxError, SAMPLE_GPX, atDistance, importWalk, type WalkImport } from '../walk/gpx';
import { EarthWalkPanel, WalkImportCard } from '../walk/WalkRecord';
import { Guide } from '../walk/Guide';
import { SearchViz, type Trace } from '../walk/SearchViz';
import { RouteProfile } from '../walk/RouteProfile';
import { RouteEditor, type Preview } from '../walk/RouteEditor';
import { Hud, type HudState } from '../walk/Hud';
import { EvaCard, RoverCard } from '../walk/Evidence';
import { RehearsalPanel, useRehearsal } from '../walk/Rehearsal';
import { Terrain3D, type Camera3D, type Line3D, type Point3D } from '../map/Terrain3D';
import { Globe, type GlobeCamera, type GlobeMark } from '../map/Globe';
import type { Reach, RoverWalkback } from '../core';
import { loadSpotSources, pickSpots, spotNote, type Spot, type SpotSources } from '../walk/spots';

type Mode = 'pan' | 'route' | 'base' | 'goal';
export interface WalkParams { world?: World; lat?: number; lon?: number; z?: number }

const HIRISE = ['hirise'];

export function WalkView({ core, params }: { core: Core; params: WalkParams }) {
  const t = useT();
  const lang = useLang();
  const [data, setData] = useState<WalkData | null>(null);
  const [route, setRouteRaw] = useState<Waypoint[]>([]);
  // Undo / redo for route edits (↶ ↷, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y). Every change of
  // the route goes through setRoute and is recorded; the verdict, HUD and 3D follow the route.
  const hist = useRef<{ past: Waypoint[][]; future: Waypoint[][] }>({ past: [], future: [] });
  const [, setHistVer] = useState(0);
  const routeNow = useRef<Waypoint[]>([]);
  routeNow.current = route;
  const setRoute = (next: Waypoint[] | ((r: Waypoint[]) => Waypoint[])) => {
    const cur = routeNow.current;
    const n = typeof next === 'function' ? next(cur) : next;
    if (n === cur) return;
    if (cur.length) { hist.current.past.push(cur); if (hist.current.past.length > 200) hist.current.past.shift(); }
    hist.current.future = [];
    routeNow.current = n;
    setRouteRaw(n);
    setHistVer((v) => v + 1);
  };
  const undo = () => {
    const prev = hist.current.past.pop();
    if (!prev) return;
    hist.current.future.push(routeNow.current);
    routeNow.current = prev;
    setRouteRaw(prev); setHistVer((v) => v + 1);
  };
  const redo = () => {
    const next = hist.current.future.pop();
    if (!next) return;
    hist.current.past.push(routeNow.current);
    routeNow.current = next;
    setRouteRaw(next); setHistVer((v) => v + 1);
  };
  const [mode, setMode] = useState<Mode>('route');
  const [speed, setSpeed] = useState(2);
  const [o2, setO2] = useState(8);
  const [water, setWater] = useState(8);
  const [reserve, setReserve] = useState(20);
  const [workH, setWorkH] = useState(1);
  const [showReach, setShowReach] = useState(true);
  const [showRover, setShowRover] = useState(true);
  // Footing (THEMIS thermal inertia, TES dust): counted in every walk number; layer off by default.
  const [footOn, setFootOn] = useState(true);
  // Sand ripples / rocky ground judged from HiRISE images (report page #hirise); off by default.
  const [surfOn, setSurfOn] = useState(true);
  setSurfaceOn(surfOn);
  // Departure, local solar hour at Jezero: MEDA air temperature over the walk sets the cooling water.
  const [start, setStart] = useState(DEFAULT_START);
  // Way home: straight back to the base (default, as before) or back along the route.
  const [retrace, setRetrace] = useState(false);
  const [showFoot, setShowFoot] = useState(false);
  const [view3d, setView3d] = useState(false);
  const [globeOn, setGlobeOn] = useState(false);
  const [globeCam, setGlobeCam] = useState<GlobeCamera | null>(null);
  const [globeFromMap, setGlobeFromMap] = useState(false);
  const [globeStart, setGlobeStart] = useState<{ lat: number; lon: number }>(LANDING);
  // The map fills the screen; the panel floats over it and can be folded away (closed on phones).
  const [panelOpen, setPanelOpen] = useState(() => typeof matchMedia === 'undefined' || !matchMedia('(max-width: 820px)').matches);
  const [fly, setFly] = useState<FlyTarget | null>(null);
  const [view] = useState<[number, number, number]>(() =>
    params.lat != null ? [params.lat, params.lon!, params.z ?? 13] : [LANDING.lat, LANDING.lon - 0.015, 13]);

  useEffect(() => {
    loadWalkData(core).then((d) => {
      setData(d);
      // Start with only the base (no example route; ★ brings it back).
      setRouteRaw((r) => (r.length ? r : [LANDING]));
    });
  }, [core]);
  useEffect(() => {
    if (params.lat != null && params.lon != null) setFly({ lat: params.lat, lon: params.lon, z: params.z ?? 13, seq: Date.now() });
  }, [params.lat, params.lon, params.z]);

  // Same functions as the agent tools (walk/plan.ts), so both always show the same numbers.
  // surfOn is read by ensureFooting (walk/data.ts); it is in the deps so every number recomputes.
  const p = useMemo(() => evaParams({ speed, o2, water, reserve, footing: footOn, start, retrace, work: workH }), [speed, o2, water, reserve, footOn, start, surfOn, retrace, workH]); // eslint-disable-line react-hooks/exhaustive-deps
  const dense = useMemo(() => denseRoute(core, data, route), [core, data, route]);
  const ev = useMemo(() => evaluate(core, dense, p), [core, dense, p]);
  // The same route on firm ground, to show how much time the footing adds.
  const evFirm = useMemo(() => (footOn && data?.footing ? evaluate(core, dense, { ...p, footing: false }) : null), [core, dense, p, footOn, data]);
  // Route profile: footing factor along the dense route (from the Rust grid) and the hovered point.
  const profFoot = useMemo(() => {
    if (dense.pts.length < 2 || !data?.footing) return null;
    try { ensureFooting(core, true); return core.sampleFooting(JEZERO, dense.pts.map((w) => [w.lat, w.lon] as [number, number])); }
    catch { return null; } finally { ensureFooting(core, footOn); }
  }, [core, dense, data, footOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const [profHi, setProfHi] = useState<number | null>(null);
  // Evaluation material (existing results gathered per route; plan.ts evaluateRouteMaterial).
  const evalMat = useMemo(() => evaluateRouteMaterial(core, data, route, p), [core, data, route, p]);
  const wx = useMemo(() => {
    if (!data?.weather) return null;
    try { return { ...core.weatherWalk(start, o2), f: waterFactor(core, p) }; } catch { return null; }
  }, [core, data, start, o2, p]);
  const rad = useMemo(() => { try { return core.radiationExposure(ev.total_h); } catch { return null; } }, [core, ev.total_h]);
  const footImg = useMemo(() => {
    if (!showFoot || !data?.dem || !data.footing) return null;
    ensureFooting(core, true);
    const img = footingImage(core.footingBadness(JEZERO), data.dem);
    ensureFooting(core, footOn);
    return img;
  }, [core, data, showFoot, surfOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // HiRISE ripples / rocks over the 2D map: only while searching a route, with the checkbox on.
  const surfImg = useMemo(() => (surface && data?.dem ? surfaceImage(surface, data.dem) : null), [data]);
  const check = useMemo(() => roverCheck(core, data, dense), [core, data, dense]);
  const longer = useMemo(() => (data?.eva ? core.evaLongerShare(ev.total_h) : 0), [core, data, ev.total_h]);

  // Walk-home area (recomputed shortly after the base or the budget changes).
  const base = route[0];
  const [reachRaw, setReachRaw] = useState<Reach | null>(null);
  const [reachImg, setReachImg] = useState<{ url: string; bounds: [[number, number], [number, number]]; area: number; max: number } | null>(null);
  useEffect(() => {
    if (!data?.dem || !base) return;
    const id = setTimeout(() => {
      const r = reachFrom(core, data, base, p);
      setReachImg(r ? { ...reachImage(r, data.dem!), area: r.area_km2, max: r.max_km } : null);
      setReachRaw(r);
    }, 60);
    return () => clearTimeout(id);
  }, [core, data, base?.lat, base?.lon, p]); // eslint-disable-line react-hooks/exhaustive-deps

  // B: crewed rover on Perseverance's path breaks down: can the crew walk home from each point?
  const [roverMode, setRoverMode] = useState(false);
  const [rw, setRw] = useState<RoverWalkback | null>(null);
  const [rwState, setRwState] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => {
    if (!roverMode || !data) { setRw(null); setRwState('idle'); return; }
    let live = true;
    // The path comes from the rover_traverse table (DuckDB loads on first use, ~1–2 s).
    setRwState('loading');
    roverWalkbackSql(core, data, p)
      .then((x) => { if (live) { setRw(x?.r ?? null); setRwState('idle'); } })
      .catch((e) => { console.warn('rover walkback', e); if (live) setRwState('error'); });
    return () => { live = false; };
  }, [core, data, p, roverMode]);
  const flag = rw?.first_stranded != null ? rw.points[rw.first_stranded] : null;
  const rwLines = useMemo(() => {
    if (!rw) return [] as { pts: [number, number][]; color: string }[];
    const out: { pts: [number, number][]; color: string }[] = [];
    let cur: { pts: [number, number][]; color: string } | null = null;
    for (const pt of rw.points) {
      const color = WALKBACK_COLOR[walkbackState(pt)];
      const ll: [number, number] = [pt.lat, pt.lon];
      if (!cur || cur.color !== color) {
        if (cur) cur.pts.push(ll);
        cur = { pts: cur ? [cur.pts[cur.pts.length - 1], ll] : [ll], color };
        out.push(cur);
      } else cur.pts.push(ll);
    }
    return out.filter((l) => l.pts.length > 1);
  }, [rw]);

  // Elevation for waypoints outside the Jezero grid (Trek MOLA identify).
  const [easy, setEasy] = useState(false);
  // Destination mode: plan the walk from the base to the clicked point (Rust Dijkstra over the
  // walk-home area); the result becomes the route (verdict, HUD, 3D, undo all follow).
  const [planMsg, setPlanMsg] = useState<string | null>(null);
  // Search animation: the trace of the last search; the route is applied when it finishes.
  const [vizTrace, setVizTrace] = useState<Trace | null>(null);
  const vizRoute = useRef<Waypoint[] | null>(null);
  // Stage 2: the planner's weights (sliders) and a comparison with the fastest route.
  // The three safety axes (slope, footing, air temperature via the departure time) and one overall
  // "speed first ⇄ safety first" dial that scales the penalties.
  const [weights, setWeights] = useState({ slope: 1, footing: 1, safety: 1 });
  const [compare, setCompare] = useState<{ fast: Waypoint[] | null; safe: Waypoint[] } | null>(null);
  const cmp = useMemo(() => {
    if (!compare) return null;
    return { fast: compare.fast ? routeMetrics(core, data, compare.fast, p) : null, safe: routeMetrics(core, data, compare.safe, p) };
  }, [core, data, compare, p]);
  const planTo = (lat: number, lon: number) => {
    const base = route[0] ?? LANDING;
    const goal = { lat, lon, elev: undefined };
    // Fastest first, then the weighted one, so the animation replays the weighted search.
    const fast = planRoute(core, data, base, goal, p, { distance: true });
    const r = planRoute(core, data, base, goal, p, { time: 1, slope: weights.slope * weights.safety, footing: weights.footing * weights.safety, margin: weights.safety });
    setCompare(r.route ? { fast: fast.route, safe: r.route } : null);
    if (r.route && data?.dem) {
      const { order, cost } = core.planTrace();
      const d = data.dem, north = d.lat0 + d.dlat / 2, west = d.lon0 - d.dlon / 2;
      vizRoute.current = r.route;
      setVizTrace({ order, cost, rows: d.rows, cols: d.cols, bounds: [[north - d.rows * d.dlat, west], [north, west + d.cols * d.dlon]], ratio: reachRaw?.ratio ?? null, path: r.route.map((w) => [w.lat, w.lon]) });
      setPlanMsg(t(`目的地まで自動で経路を引きました（帰れる範囲だけを通る、探索 ${Math.round(r.ms)} ms）`, `Route planned to the destination (inside the walk-home area only; search ${Math.round(r.ms)} ms)`));
    } else {
      const s = r.plan?.status;
      setPlanMsg(s === 'outside_reach' ? t(`そこは歩いて帰れる範囲の外です（往復で使える分の ${r.plan?.goal_ratio != null ? Math.round(r.plan.goal_ratio * 100) + '%' : '100% 超'}）。もっと近くを選んでください`, `That point is outside the walk-home area (${r.plan?.goal_ratio != null ? Math.round(r.plan.goal_ratio * 100) + '%' : 'over 100%'} of the budget out and back). Pick a closer one`)
        : s === 'outside_grid' ? t('Jezero の地形データの外です', 'Outside the Jezero terrain data')
        : t('そこまで歩いて行ける道が見つかりませんでした', 'No walkable path to that point'));
    }
  };
  // Destination ideas from NASA data (named places, Perseverance's stops) inside the walk-home area.
  const [spotSrc, setSpotSrc] = useState<SpotSources | null>(null);
  useEffect(() => { if (mode === 'goal' && !spotSrc) loadSpotSources().then(setSpotSrc).catch(() => undefined); }, [mode, spotSrc]);
  const spots = useMemo<Spot[]>(() => (mode === 'goal' && spotSrc && reachRaw && data?.dem && base ? pickSpots(spotSrc, reachRaw, data.demGrid ?? data.dem, base) : []),
    [mode, spotSrc, reachRaw, data, base?.lat, base?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const addPoint = (lat: number, lon: number) => {
    if (mode === 'goal') { planTo(lat, lon); return; }
    const wp: Waypoint = { lat, lon, elev: undefined };
    if (mode === 'base') setRoute((r) => [wp, ...r.slice(1)]);
    else {
      // Easy-path mode: follow the least-effort walk from the last point (Rust Dijkstra on the grid).
      const last = route[route.length - 1];
      const leg = easy && last ? easyLeg(core, data, last, wp, p) : null;
      if (leg) { leg[leg.length - 1] = wp; setRoute((r) => [...r, ...leg]); }
      else setRoute((r) => [...r, wp]);
    }
    getElevation(WORLD, lat, lon).then((elev) => setRouteRaw((r) => r.map((x) => (x.lat === lat && x.lon === lon ? { ...x, elev } : x))));
    if (mode === 'base') setMode('route');
  };

  // ---- playback ----
  const [hud, setHud] = useState<HudState | null>(null);
  const [walker, setWalker] = useState<[number, number] | null>(null);
  const raf = useRef(0);
  const stop = () => { cancelAnimationFrame(raf.current); setHud(null); setWalker(null); };
  const play = () => {
    if (dense.pts.length < 2) return;
    cancelAnimationFrame(raf.current);
    const pts = dense.pts, ticks = ev.ticks;
    const turn = turnIndex(ev) ?? pts.length - 1;
    const tt = ticks[turn];
    const eTurn = (1 - tt.o2_left) * ev.usable_o2_h;
    const homeE = Math.max(0, ev.usable_h - tt.margin_h - eTurn);
    const OUT_MS = 11000 * Math.min(1, Math.max(0.4, turn / 120)), BACK_MS = 5000, HOLD = 1400;
    const t0 = performance.now();
    const frame = (now: number) => {
      const el = Math.max(0, now - t0); // rAF time can be slightly before t0
      if (el < OUT_MS) {
        const f = (el / OUT_MS) * turn, i = Math.floor(f), j = Math.min(turn, i + 1), u = f - i;
        const a = ticks[i], b = ticks[j];
        const lerp = (x: number, y: number) => x + (y - x) * u;
        setWalker([lerp(pts[i].lat, pts[j].lat), lerp(pts[i].lon, pts[j].lon)]);
        setHud({ t_h: lerp(a.t_h, b.t_h), km: lerp(a.km, b.km), o2: lerp(a.o2_left, b.o2_left), water: lerp(a.water_left, b.water_left),
          home_h: lerp(a.home_h, b.home_h), margin_h: lerp(a.margin_h, b.margin_h), phase: 'out', slope: ev.legs[Math.min(i, ev.legs.length - 1)]?.slope_deg ?? null });
      } else if (el < OUT_MS + HOLD) {
        setWalker([pts[turn].lat, pts[turn].lon]);
        setHud({ t_h: tt.t_h, km: tt.km, o2: tt.o2_left, water: tt.water_left, home_h: tt.home_h, margin_h: tt.margin_h, phase: 'turn', slope: null });
      } else if (el < OUT_MS + HOLD + BACK_MS) {
        const u = (el - OUT_MS - HOLD) / BACK_MS;
        if (retrace) {
          // Back along the route: from the turn point down the drawn points to the base.
          const f = turn * (1 - u), i = Math.min(turn, Math.floor(f)), j = Math.max(0, Math.min(turn, i + 1)), w = f - i;
          setWalker([pts[i].lat + (pts[j].lat - pts[i].lat) * w, pts[i].lon + (pts[j].lon - pts[i].lon) * w]);
        } else setWalker([pts[turn].lat + (pts[0].lat - pts[turn].lat) * u, pts[turn].lon + (pts[0].lon - pts[turn].lon) * u]);
        setHud({ t_h: tt.t_h + tt.home_h * u, km: tt.km, o2: tt.o2_left - (homeE * u) / ev.usable_o2_h,
          water: tt.water_left - (homeE * WATER_PER_O2 * u) / ev.usable_water_h, home_h: tt.home_h * (1 - u),
          margin_h: tt.margin_h, phase: 'back', slope: null });
      } else {
        setWalker([pts[0].lat, pts[0].lon]);
        setHud((h) => (h ? { ...h, home_h: 0, phase: 'done' } : h));
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { stop(); }, [route, p]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- rehearsal in Hokkaido ----
  const reh = useRehearsal(core, data?.hokkaido ?? []);
  const [rehOpen, setRehOpen] = useState(false);
  const [rehSel, setRehSel] = useState(0);
  const marsForReh = useMemo(() => rehearsalPoints(core, data, route), [core, data, route]);
  const startRehearsal = () => { setRehOpen(true); setRehSel(0); reh.run(marsForReh); };

  // ---- A: a GPX walk in Hokkaido, replayed on Mars ----
  const [walkRec, setWalkRec] = useState<WalkImport | null>(null);
  const [walkErr, setWalkErr] = useState<string | null>(null);
  const [walkBusy, setWalkBusy] = useState(false);
  const loadWalk = async (text: string, file: string): Promise<WalkImport> => {
    setWalkBusy(true); setWalkErr(null);
    try {
      await loadWalkData(core);
      const rec = await importWalk(core, text, file);
      stop();
      setWalkRec(rec);
      setRoute(rec.route);
      live$.current.route = rec.route;
      const v = Math.min(5, Math.max(0.5, Math.round(rec.summary.flat_kmh * 100) / 100));
      setSpeed(v); live$.current.speed = v;
      setRehOpen(false);
      setFly({ lat: LANDING.lat, lon: LANDING.lon, z: 15, seq: Date.now() });
      return rec;
    } catch (e) {
      const code = e instanceof GpxError ? e.message : '';
      setWalkErr(code === 'no-time' ? t('この GPX には時刻がありません。時刻つきで記録した GPX（多くの登山・ランニングアプリの書き出し）を使ってください。', 'This GPX has no times. Use a GPX recorded with times (most hiking or running apps export one).')
        : code === 'no-points' ? t('GPX に歩いた点（trkpt）が見つかりませんでした。トラックとして書き出した GPX を使ってください。', 'No track points (trkpt) in this GPX. Export the walk as a track.')
        : code === 'not-gpx' ? t('GPX として読めませんでした。.gpx ファイルを選んでください。', 'This is not a GPX file. Choose a .gpx file.')
        : t('歩いた記録を読み込めませんでした。もう一度試すか、別の GPX を選んでください。', 'Could not load the walk. Try again or choose another GPX.'));
      throw e;
    } finally { setWalkBusy(false); }
  };
  const loadSample = async () => {
    const r = await fetch(SAMPLE_GPX);
    if (!r.ok) { setWalkErr(t('例の GPX を読み込めませんでした。', 'Could not load the sample GPX.')); throw new Error('sample'); }
    return loadWalk(await r.text(), SAMPLE_GPX.split('/').pop()!);
  };
  // Close the right half of a split screen (Hokkaido practice course or recorded walk) and give the
  // map its full width back (Leaflet re-measures on the window resize event).
  const closeSplit = () => {
    setWalkRec(null); setRehOpen(false);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  };
  const splitOpen = !!walkRec || (rehOpen && reh.found.length > 0);
  useEffect(() => {
    if (!splitOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) closeSplit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearWalk = () => { stop(); setWalkRec(null); setWalkErr(null); setRoute([route[0] ?? LANDING]); setSpeed(2); };
  const onDropFile = (f: File) => { f.text().then((t) => loadWalk(t, f.name)).catch(() => undefined); };
  const earthWalker = useMemo<[number, number] | null>(() => {
    if (!walkRec || !hud) return null;
    return atDistance(core, 'earth', walkRec.earth, hud.phase === 'done' ? 0 : hud.km);
  }, [core, walkRec, hud]);

  // Keyboard undo/redo for the route, only while this view is shown and not while typing.
  const sectionRef = useRef<HTMLElement>(null);
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !sectionRef.current?.offsetParent) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRef.current.redo(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // ---- agent controller (agent/tools.ts drives the screen through this) ----
  const [camera, setCamera] = useState<Camera3D | null>(null);
  const [exag, setExag] = useState<number | undefined>(undefined);
  const [flash, setFlash] = useState<EvidenceTopic | null>(null);
  const live$ = useRef({ route, speed, o2, water, reserve, workH, footOn, start, retrace, play, stop, startRehearsalWith: reh.run, found: reh.found, loadWalk, loadSample, walkRec });
  live$.current = { route, speed, o2, water, reserve, workH, footOn, start, retrace, play, stop, startRehearsalWith: reh.run, found: reh.found, loadWalk, loadSample, walkRec };
  useEffect(() => {
    setWalkController({
      core,
      data: () => loadWalkData(core),
      route: () => live$.current.route,
      params: () => ({ speed: live$.current.speed, o2: live$.current.o2, water: live$.current.water, reserve: live$.current.reserve, footing: live$.current.footOn, start: live$.current.start, retrace: live$.current.retrace, work: live$.current.workH }),
      setRoute: (r) => { live$.current.route = r; setRoute(r); },
      setParams: (q) => {
        if (q.speed != null) { setSpeed(q.speed); live$.current.speed = q.speed; }
        if (q.o2 != null) { setO2(q.o2); live$.current.o2 = q.o2; }
        if (q.water != null) { setWater(q.water); live$.current.water = q.water; }
        if (q.reserve != null) { setReserve(q.reserve); live$.current.reserve = q.reserve; }
        if (q.start != null) { setStart(q.start); live$.current.start = q.start; }
        if (q.retrace != null) { setRetrace(q.retrace); live$.current.retrace = q.retrace; }
        if (q.work != null) { setWorkH(q.work); live$.current.workH = q.work; }
      },
      runRehearsal: (pts) => { setRehOpen(true); setRehSel(0); return live$.current.startRehearsalWith(pts); },
      selectRehearsal: (i) => { setRehOpen(true); setRehSel(i); },
      set3d: (on) => { setGlobeOn(false); setView3d(on); },
      setCamera: (c) => {
        if (c.exaggeration != null) setExag(c.exaggeration);
        if ([c.lat, c.lon, c.distance_m, c.heading_deg, c.tilt_deg].some((x) => x != null)) {
          setCamera({ target: c.lat != null && c.lon != null ? { lat: c.lat, lon: c.lon } : undefined,
            distance: c.distance_m, heading: c.heading_deg, tilt: c.tilt_deg, seq: Date.now() });
        }
      },
      setOverlay: (o) => { if (o.rover != null) setShowRover(o.rover); if (o.reach != null) setShowReach(o.reach); },
      flyTo: (lat, lon, z) => setFly({ lat, lon, z, seq: Date.now() }),
      setGlobe: (on, cam) => { setGlobeFromMap(!cam); setGlobeOn(on); if (on && cam) setGlobeCam({ ...cam, seq: Date.now() }); },
      importWalk: (text, file) => live$.current.loadWalk(text, file),
      importSample: () => live$.current.loadSample(),
      walk: () => live$.current.walkRec,
      setRoverMode: (on) => {
        setRoverMode(on);
        if (on) setTimeout(() => document.getElementById('rover-walkback')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      },
      play: () => live$.current.play(),
      stop: () => live$.current.stop(),
      openEvidence: (topic) => {
        setFlash(topic);
        setTimeout(() => {
          const el = document.getElementById(`ev-${topic === 'hokkaido_terrain' ? 'terrain' : topic}`);
          if (el instanceof HTMLDetailsElement) el.open = true;
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        setTimeout(() => setFlash((f) => (f === topic ? null : f)), 4000);
      },
    });
    return () => setWalkController(null);
  }, [core]);
  const fl = (topic: EvidenceTopic) => (flash === topic ? 'flash' : undefined);

  // Route editor: where the map is, and what the walk would be with one more point there
  // (same functions as the panel, so the rubber band and the verdict agree).
  const [mapHost, setMapHost] = useState<HTMLDivElement | null>(null);
  const routePreview = (pts: Waypoint[]): Preview | null => {
    if (!data || pts.length < 2) return null;
    const e = evaluate(core, denseRoute(core, data, pts), p);
    return { ok: e.ok, out_km: e.out_km, total_h: e.total_h, o2_left: e.usable_o2_h > 0 ? 1 - e.total_effort_h / e.usable_o2_h : 0 };
  };

  // ---- map features ----
  const roverFeatures = useMemo<Feature[]>(() => {
    if (rw) {
      const f: Feature[] = rwLines.map((l) => ({ kind: 'line', pts: l.pts, color: l.color, weight: 4, opacity: 0.95 }));
      if (flag) f.push({ kind: 'point', lat: flag.lat, lon: flag.lon, radius: 10, color: '#ff4d4f', openTooltip: true,
        tooltip: t(`🚩 人が乗っていたらここで引き返し<br>走行 ${flag.km.toFixed(1)} km・sol ${flag.sol}`, `🚩 With a crew aboard, turn back here<br>${flag.km.toFixed(1)} km driven · sol ${flag.sol}`) });
      return f;
    }
    return data && showRover
      ? [{ kind: 'lines', lines: data.traverse, color: '#36cfc9', weight: 2.5, opacity: 0.85, tooltip: t('Perseverance が実際に走った道', "Perseverance's real path") }]
      : [];
  }, [data, showRover, rw, rwLines, flag, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const turnIdx = turnIndex(ev);
  // A leg steeper than the angle of repose makes a drawn route impassable (plan.ts MAX_SLOPE).
  const steep = route.length >= 2 ? steepLeg(ev) : null;
  const features = useMemo<Feature[]>(() => {
    const f: Feature[] = [];
    if (compare?.fast && !vizTrace) f.push({ kind: 'line', pts: compare.fast.map((w) => [w.lat, w.lon] as [number, number]), color: '#69c0ff', weight: 4, dash: '8 6', opacity: 0.95, tooltip: t('最短距離の経路', 'Shortest route') });
    if (profHi != null && dense.pts[profHi]) f.push({ kind: 'point', lat: dense.pts[profHi].lat, lon: dense.pts[profHi].lon, color: '#ffffff', radius: 7, tooltip: t('断面グラフの位置', 'Profile position'), openTooltip: false });
    if (steep != null && dense.pts[steep + 1]) f.push({ kind: 'pin', lat: dense.pts[steep + 1].lat, lon: dense.pts[steep + 1].lon, tooltip: t(`通れない坂 ${Math.abs(ev.legs[steep].slope_deg).toFixed(0)}°（上限 ${MAX_SLOPE}°、火星の砂の安息角）`, `Impassable ${Math.abs(ev.legs[steep].slope_deg).toFixed(0)}° slope (limit ${MAX_SLOPE}°, Mars sand angle of repose)`) });
    if (footImg) f.push({ kind: 'image', url: footImg.url, bounds: footImg.bounds, opacity: 0.7 });
    if (surfImg && surfOn && (mode === 'goal' || compare)) f.push({ kind: 'image', url: surfImg.url, bounds: surfImg.bounds, opacity: 0.6 });
    if (reachImg && showReach) f.push({ kind: 'image', url: reachImg.url, bounds: reachImg.bounds, opacity: 0.55 });
    f.push(...roverFeatures);
    for (const s of spots) f.push({ kind: 'point', lat: s.lat, lon: s.lon, color: '#eb2f96', radius: 6, onClick: () => planTo(s.lat, s.lon),
      tooltip: `${s.name[lang]}<br>${t('基地から', 'from base')} ${s.km.toFixed(1)} km<br>${spotNote(s, lang)}` });
    // Route coloured by slope, in runs of the same colour.
    const pts = dense.pts;
    let run: [number, number][] = [], col = '';
    for (let i = 1; i < pts.length; i++) {
      const c = slopeColor(ev.legs[i - 1]?.known ? ev.legs[i - 1].slope_deg : null);
      if (c !== col && run.length) { f.push({ kind: 'line', pts: run, color: col, weight: 5 }); run = [run[run.length - 1]]; }
      if (!run.length) run.push([pts[i - 1].lat, pts[i - 1].lon]);
      run.push([pts[i].lat, pts[i].lon]);
      col = c;
    }
    if (run.length > 1) f.push({ kind: 'line', pts: run, color: col, weight: 5 });
    if (pts.length > 1) {
      const last = pts[pts.length - 1];
      f.push({ kind: 'line', pts: [[last.lat, last.lon], [pts[0].lat, pts[0].lon]], color: '#ffffff', weight: 2, dash: '4 6', opacity: 0.7 });
    }
    // Hover a segment for its distance, steepest slope and time (summed from the engine's legs).
    // The waypoints themselves are drawn by RouteEditor as draggable handles.
    // (Not in destination mode: the invisible hover lines would catch the click meant for the map.)
    for (let i = 0; mode !== 'goal' && i + 1 < dense.wp.length; i++) {
      const a = dense.wp[i], b = dense.wp[i + 1], legs = ev.legs.slice(a, b);
      if (!legs.length) continue;
      const km = legs.reduce((x, l) => x + l.km, 0), h = legs.reduce((x, l) => x + l.hours, 0);
      const known = legs.filter((l) => l.known), steep = known.length ? Math.max(...known.map((l) => Math.abs(l.slope_deg))) : null;
      f.push({ kind: 'line', pts: pts.slice(a, b + 1).map((q) => [q.lat, q.lon] as [number, number]), color: '#000', weight: 16, opacity: 0.01,
        tooltip: `${i === 0 ? t('基地', 'Base') : `WP${i}`} → WP${i + 1}<br>${km.toFixed(2)} km · ${t('最大の坂', 'steepest')} ${steep == null ? '—' : `${steep.toFixed(0)}°`} · ${fmtH(h)}` });
    }
    if (turnIdx != null && pts[turnIdx]) {
      f.push({ kind: 'point', lat: pts[turnIdx].lat, lon: pts[turnIdx].lon, radius: 9, color: '#faad14', tooltip: t('🚩 引き返し地点', '🚩 Turn-back point'), openTooltip: true });
    }
    return f;
  }, [reachImg, showReach, footImg, surfImg, surfOn, compare, vizTrace, mode, profHi, steep, roverFeatures, dense, ev, route, turnIdx, lang, spots, weights, start]); // eslint-disable-line react-hooks/exhaustive-deps
  // The same layers for the 3D view.
  const lines3d = useMemo<Line3D[]>(() => {
    const l: Line3D[] = [];
    if (data && showRover && !rw) for (const t of data.traverse) l.push({ pts: t, color: '#36cfc9', width: 2.5, opacity: 0.9 });
    for (const f of features) if (f.kind === 'line' && (f.opacity ?? 1) > 0.05) l.push({ pts: f.pts, color: f.color, width: (f.weight ?? 3) >= 5 ? 5 : (f.weight ?? 3) >= 4 ? 3.5 : 2, opacity: f.opacity });
    return l;
  }, [data, showRover, features, rw]);
  const points3d = useMemo<Point3D[]>(() => {
    const ps: Point3D[] = route.map((w, i) => ({ lat: w.lat, lon: w.lon, color: i === 0 ? '#ffffff' : '#ffd666', size: i === 0 ? 2.2 : 1.2 }));
    if (turnIdx != null && dense.pts[turnIdx]) ps.push({ lat: dense.pts[turnIdx].lat, lon: dense.pts[turnIdx].lon, color: '#faad14', size: 2 });
    if (flag) ps.push({ lat: flag.lat, lon: flag.lon, color: '#ff4d4f', size: 3 });
    return ps;
  }, [route, turnIdx, dense, flag]);
  const focus3d = useMemo(() => {
    if (route.length < 2) return null;
    const la = route.map((w) => w.lat), lo = route.map((w) => w.lon);
    return [[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]] as [[number, number], [number, number]];
  }, [route]);
  const live = useMemo<Feature[]>(() => (walker ? [{ kind: 'walker', lat: walker[0], lon: walker[1], color: '#ff7a45' }] : []), [walker]);
  const overlays = useMemo(() => missionOverlay(core, WORLD), [core]);
  // The Jezero HiRISE photo as a close-up patch on the globe (same bounds as the elevation grid).
  const globePatch = useMemo(() => {
    const d = data?.dem;
    if (!d) return null;
    const north = d.lat0 + d.dlat / 2, west = d.lon0 - d.dlon / 2;
    return { url: './data/jezero_ortho.jpg', north, south: north - d.rows * d.dlat, west, east: west + d.cols * d.dlon };
  }, [data]);
  const globeMarks = useMemo<GlobeMark[]>(() => [
    { lat: LANDING.lat, lon: LANDING.lon, kind: 'base', label: t('基地: Jezero クレーター（Perseverance 着陸地点）', 'Base: Jezero crater (Perseverance landing site)') },
    // Other landing sites come from the gazetteer layer (with a card each).
  ], [core, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = route.length;
  const tools: [Mode | 'undo' | 'redo' | 'clear' | 'example' | 'easy', string, string][] = [
    ['pan', '✋', t('地図を動かす', 'Move the map')], ['route', '〰', t('ルートを引く', 'Draw the route')], ['base', '⌂', t('基地を置き直す', 'Move the base')],
    ['undo', '↶', t('戻す（⌘Z / Ctrl+Z）', 'Undo (⌘Z / Ctrl+Z)')], ['redo', '↷', t('やり直す（⌘⇧Z / Ctrl+Y）', 'Redo (⌘⇧Z / Ctrl+Y)')],
    ['clear', '🗑', t('ルートを消す', 'Clear the route')], ['example', '★', t('例のルートに戻す', 'Example route')],
    ['goal', '🎯', t('目的地を置く（基地から自動で経路を探す）', 'Set a destination (plan the route from the base)')],
    ['easy', '⤳', easy ? t('楽な道モード: オン（坂の楽な道で点をつなぐ）', 'Easy path: on (joins points along the easiest slopes)') : t('楽な道モード: オフ（まっすぐつなぐ）', 'Easy path: off (straight lines)')],
  ];

  return (
    <section ref={sectionRef} className="view walk" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); onDropFile(f); } }}>
      <aside className={`panel ${panelOpen ? 'open' : 'closed'}`} aria-label={t('計画パネル', 'Plan panel')}>
        <button className="panel-fold" onClick={() => setPanelOpen(false)} aria-label={t('パネルを畳む', 'Fold the panel')} title={t('パネルを畳んで地図を広く', 'Fold the panel to see more map')}>⟨</button>
        <h2 className="walk-title">{t('火星', 'Mars')} <small>{t('Jezero クレーター・Perseverance の着陸地点が基地', "Jezero crater · base at Perseverance's landing site")}</small></h2>
        <p className="muted">{t('基地から歩いて出て、酸素と冷却水が尽きる前に帰れるか。地図をクリックしてルートを引きます（最初の点が基地）。', 'Walk out from the base: can you get back before oxygen or cooling water runs out? Click the map to draw a route (the first point is the base).')}</p>
        {data?.errors.length ? <p className="warn">{data.errors.map((e) => ({
          dem: t('火星の地形データを読み込めませんでした（判定は「地形不明＝急な登り」として計算します）。', 'Could not load the Mars terrain (unknown ground is counted as a steep climb).'),
          traverse: t('探査車の走行記録を読み込めませんでした（実走ルートとの比較とローバーの判定は出ません）。', "Could not load Perseverance's path (no rover comparison)."),
          eva: t('船外活動の記録を読み込めませんでした（実際の船外活動との比較は出ません）。', 'Could not load the EVA records (no EVA comparison).'),
          hokkaido: t('北海道の地形データを読み込めませんでした（練習コース探しは使えません）。', 'Could not load the Hokkaido terrain (no practice courses).'),
        } as Record<string, string>)[e] ?? e).join(' ')} {t('ページを再読み込みしてください。', 'Reload the page to try again.')}</p> : null}

        <button className={`goal-cta${mode === 'goal' ? ' on' : ''}`} id="goal-cta" onClick={() => setMode(mode === 'goal' ? 'route' : 'goal')}>
          🎯 {mode === 'goal' ? t('地図で目的地をクリック（もう一度押すとやめる）', 'Click a destination on the map (press again to stop)') : t('目的地を置いて自動で経路を探す', 'Set a destination and plan the route')}
        </button>
        <div className={`verdict ${n < 2 ? '' : ev.ok && steep == null ? 'ok' : 'ng'}`}>
          {!data ? t('データを読み込み中…', 'Loading data…') : n < 2 ? t('地図をクリックしてルートを引く／🎯 で目的地を置く', 'Click the map to draw a route / 🎯 to set a destination')
            : steep != null ? t(`通れない坂がある（${Math.abs(ev.legs[steep].slope_deg).toFixed(0)}°、上限 ${MAX_SLOPE}°）`, `Impassable slope on the route (${Math.abs(ev.legs[steep].slope_deg).toFixed(0)}°, limit ${MAX_SLOPE}°)`)
            : ev.ok ? t('帰れる', 'Can walk back') : t(`途中で引き返す（引き返し地点: WP${turnWaypoint(ev, dense)} の手前）`, `Turn back before WP${turnWaypoint(ev, dense)}`)}
        </div>
        {n >= 2 && (
          <>
            <div className="kv"><span>{(retrace ? t('行き / 帰り（来た道）', 'Out / back (same way)') : t('行き / 帰り（まっすぐ）', 'Out / back (straight)'))}</span><b>{ev.out_km.toFixed(1)} km / {ev.back_km.toFixed(1)} km</b></div>
            <div className="kv"><span>{t('かかる時間', 'Time')}</span><b>{fmtH(ev.total_h)}</b></div>
            {(ev.work_h ?? 0) > 0 && <div className="kv sub" id="work-line"><span>{t('うち目的地での作業', 'of which working at the destination')}</span><b>{fmtH(ev.work_h ?? 0)}</b></div>}
            {evFirm && ev.total_h - evFirm.total_h >= 1 / 60 && <div className="kv sub" id="foot-extra"><span>{t('うち足場で増えた時間', 'of which footing adds')}</span><b>+{fmtH(ev.total_h - evFirm.total_h)}</b></div>}
            {rad && <div className="kv" id="rad-dose"><span>{t('放射線（この船外活動）', 'Radiation (this EVA)')}</span><b>{rad.dose_msv.toFixed(2)} mSv <small className="muted">{t(`生涯上限の ${(rad.career_share * 100).toFixed(2)}%`, `${(rad.career_share * 100).toFixed(2)}% of career limit`)}</small></b></div>}
            <div className="kv"><span>{t('体力の消費 / 使える分', 'Effort used / usable')}</span><b>{ev.total_effort_h.toFixed(1)} / {ev.usable_h.toFixed(1)} h</b></div>
            <div className="kv"><span>{t('先に尽きるもの', 'Runs out first')}</span><b className={ev.limiting === 'water' ? 'water' : ''}>{ev.limiting === 'water' ? t('冷却水', 'Cooling water') : t('酸素', 'Oxygen')}</b></div>
            {reachImg && <div className="kv"><span>{t('歩いて帰れる範囲', 'Walk-home area')}</span><b>{reachImg.area.toFixed(0)} km²{t('（最遠 ', ' (farthest ')}{reachImg.max.toFixed(1)} km{t('）', ')')}</b></div>}
            {ev.unknown_segments > 0 && <p className="warn">{t(`地形が分からない区間 ${ev.unknown_segments} か所は、急な登り（約17°）として安全側で計算しています。`, `${ev.unknown_segments} segments without terrain data are counted as a steep climb (~17°), to stay on the safe side.`)}</p>}
          </>
        )}
        {(mode === 'goal' || compare) && (
          <div className="card route-plan" id="route-plan">
            <h4>{t('🎯 目的地までの経路探索', '🎯 Route to a destination')}</h4>
            <p className="muted">{t('地図をクリックすると、基地から帰れる範囲だけを通る経路を自動で探します。重みを変えてからもう一度クリック。', 'Click the map: a route from the base is searched through the walk-home area only. Change the weights and click again.')}</p>
            {spots.length > 0 && (
              <div className="spots" id="spot-list">
                <b>{t('行き先の候補（NASAデータにある地点、帰れる範囲だけ）', 'Destination ideas (places in NASA data, inside the walk-home area)')}</b>
                <ul>{spots.map((s) => (
                  <li key={s.id}><button className="spot" onClick={() => planTo(s.lat, s.lon)} title={s.src}>{s.name[lang]}</button>
                    <small className="muted"> {s.km.toFixed(1)} km</small>
                    <small className="muted spot-note">{spotNote(s, lang)}</small></li>
                ))}</ul>
                <small className="muted">{t('出典: IAU 火星地名（USGS/NASA）、Perseverance 走行記録（NASA/JPL）', 'Sources: IAU Mars names (USGS/NASA), Perseverance traverse (NASA/JPL)')}</small>
              </div>
            )}
            {([['slope', t('坂を避ける', 'Avoid steep slopes')], ['footing', t('足場の悪さを避ける', 'Avoid poor footing')]] as ['slope' | 'footing', string][]).map(([k, label]) => (
              <label key={k} className="wt">{label} <b>{weights[k]}</b>
                <input id={`w-${k}`} type="range" min={0} max={3} step={0.5} value={weights[k]} onChange={(e) => setWeights((w) => ({ ...w, [k]: +e.target.value }))} /></label>
            ))}
            <label className="check" id="surface-toggle"><input type="checkbox" checked={surfOn} onChange={(e) => setSurfOn(e.target.checked)} /> {t('砂の波紋・岩（HiRISE写真から判定）を避ける', 'Avoid sand ripples and rocks (judged from HiRISE images)')} <a href="#hirise">{t('レポート', 'Report')}</a></label>
            {surfOn && <p className="report-key" id="surface-legend"><i className="k-rip" />{t('砂の波紋', 'sand ripples')}<i className="k-rock" />{t('岩・凹凸', 'rocky ground')}</p>}
            <label className="wt">{t('気温（出発時刻、火星の地方時）', 'Air temperature (departure, Mars local time)')} <b>{String(Math.floor(start)).padStart(2, '0')}:{start % 1 ? '30' : '00'}</b>
              <input id="w-start" type="range" min={5} max={19} step={0.5} value={start} onChange={(e) => setStart(+e.target.value)} /></label>
            <label className="wt">{t('速さ優先 ⇄ 安全優先', 'Speed first ⇄ safety first')} <b>{weights.safety}</b>
              <input id="w-safety" type="range" min={0} max={3} step={0.5} value={weights.safety} onChange={(e) => setWeights((w) => ({ ...w, safety: +e.target.value }))} /></label>
            {cmp && (
              <table className="cmp" id="route-compare">
                <thead><tr><th /><th><span className="sw fast" />{t('最短距離', 'Shortest')}</th><th><span className="sw safe" />{t('安全重視', 'Safer')}</th></tr></thead>
                <tbody>
                  {([
                    [t('行きの距離', 'Out'), (m: RouteMetrics) => `${m.km.toFixed(2)} km`],
                    [t('往復の時間', 'Round trip'), (m: RouteMetrics) => fmtH(m.total_h)],
                    [t('帰着時の O₂', 'O₂ at return'), (m: RouteMetrics) => `${Math.round(Math.max(0, m.o2_left) * 100)}%`],
                    [t('最大の坂', 'Steepest'), (m: RouteMetrics) => `${m.max_slope.toFixed(1)}°`],
                    [t('足場の悪い区間', 'Poor footing'), (m: RouteMetrics) => `${Math.round(m.poor_footing * 100)}%`],
                    [t('判定', 'Verdict'), (m: RouteMetrics) => (m.ok ? t('帰れる', 'OK') : t('引き返す', 'Turn back'))],
                  ] as [string, (m: RouteMetrics) => string][]).map(([label, f]) => (
                    <tr key={label}><th>{label}</th><td>{cmp!.fast ? f(cmp!.fast) : '—'}</td><td>{cmp!.safe ? f(cmp!.safe) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {cmp && (
              <div className="breakdown" id="route-breakdown">
                <h5>{t('往復の時間の内訳（どの要素でどれだけ増えたか）', 'Round-trip time breakdown (what adds how much)')}</h5>
                {([[t('最短距離', 'Shortest'), cmp.fast], [t('安全重視', 'Safer'), cmp.safe]] as [string, RouteMetrics | null][]).map(([name, m]) => m && (
                  <div key={name} className="bd-row">
                    <span className="bd-name">{name}</span>
                    <div className="bd-bar" title={fmtH(m.total_h)}>
                      {[['flat', m.flat_h], ['slope', m.slope_h], ['foot', m.footing_h]].map(([k, h]) => (
                        <i key={k as string} className={`bd-${k}`} style={{ width: `${(100 * (h as number)) / Math.max(cmp.fast?.total_h ?? 0, cmp.safe?.total_h ?? 0, 1e-6)}%` }} />
                      ))}
                    </div>
                    <span className="bd-nums">{t(`平地 ${fmtH(m.flat_h)}・坂 +${Math.round(m.slope_h * 60)} 分・足場 +${Math.round(m.footing_h * 60)} 分・冷却水 ×${m.water_factor.toFixed(2)}`, `flat ${fmtH(m.flat_h)} · slope +${Math.round(m.slope_h * 60)} min · footing +${Math.round(m.footing_h * 60)} min · water ×${m.water_factor.toFixed(2)}`)}</span>
                  </div>
                ))}
                <div className="bd-legend"><i className="bd-flat" />{t('平地を歩く時間', 'flat walking')}<i className="bd-slope" />{t('坂（Jezero の地形 HiRISE/MOLA）', 'slopes (Jezero terrain)')}<i className="bd-foot" />{t('足場（THEMIS 熱慣性・TES ダスト）', 'footing (THEMIS, TES)')}</div>
              </div>
            )}
            {compare && (
              <div className="row">
                {compare.fast && <button onClick={() => setRoute(compare.fast!)}>{t('最短距離を使う', 'Use the shortest')}</button>}
                <button onClick={() => setRoute(compare.safe)}>{t('安全重視を使う', 'Use the safer')}</button>
              </div>
            )}
          </div>
        )}
        {dense.pts.length > 1 && <RouteProfile pts={dense.pts} ev={ev} foot={profFoot} turn={turnIdx} onHover={setProfHi} t={t} />}
        {evalMat && (
          <details className="card route-eval" id="route-eval">
            <summary>{t('経路の評価（材料）', 'Route evaluation (material)')}</summary>
            <table className="cmp"><tbody>
              {([
                [t('判定', 'Verdict'), evalMat.totals.verdict === 'ok' ? t('帰れる', 'can walk back') : evalMat.totals.verdict === 'impassable' ? t('通れない坂', 'impassable slope') : t('途中で引き返す', 'turn back')],
                [t('行き / 帰り（まっすぐ）', 'Out / back (straight)'), `${evalMat.totals.out_km.toFixed(2)} / ${evalMat.totals.back_km.toFixed(2)} km`],
                [t('往復の時間', 'Round trip'), fmtH(evalMat.totals.round_trip_h)],
                [t('登り / 下りの累計（行き）', 'Climb / descent (out)'), `${Math.round(evalMat.totals.climb_m)} / ${Math.round(evalMat.totals.descent_m)} m`],
                [t('最大 / 平均の坂', 'Max / mean slope'), `${evalMat.totals.max_slope_deg.toFixed(1)}° / ${evalMat.totals.mean_slope_deg.toFixed(1)}°`],
                [t(`上限 ${MAX_SLOPE}° を超える区間`, `Legs over ${MAX_SLOPE}°`), String(evalMat.totals.over_limit_legs)],
                [t('足場の悪い区間', 'Poor footing'), `${Math.round(evalMat.totals.poor_footing * 100)}%`],
                [t('引き返しまでの余裕', 'Margin'), evalMat.totals.margin_h != null ? `${evalMat.totals.margin_h.toFixed(1)} h` : evalMat.totals.turn_back_km != null ? t(`${evalMat.totals.turn_back_km.toFixed(1)} km で引き返し`, `turn back at ${evalMat.totals.turn_back_km.toFixed(1)} km`) : '—'],
                [t('放射線', 'Radiation'), evalMat.totals.radiation_msv != null ? `${evalMat.totals.radiation_msv.toFixed(2)} mSv` : '—'],
                [t('Perseverance の走行路から 100 m 以内', 'Within 100 m of Perseverance\'s path'), evalMat.totals.near_rover_path != null ? `${Math.round(evalMat.totals.near_rover_path * 100)}%` : '—'],
              ] as [string, string][]).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
            </tbody></table>
            <h5>{t('出発時刻ごと（気温: Perseverance MEDA）', 'By departure (air: Perseverance MEDA)')}</h5>
            <table className="cmp" id="eval-departure"><thead><tr><th>{t('出発', 'Start')}</th><th>{t('気温', 'Air')}</th><th>{t('冷却水', 'Water')}</th><th>{t('帰着時 O₂', 'O₂ left')}</th><th>{t('冷却水の残り', 'Water left')}</th></tr></thead><tbody>
              {evalMat.by_departure.map((d) => <tr key={d.start_h}><th>{d.start_h}:00</th><td>{d.temp_c != null ? `${d.temp_c.toFixed(0)} °C` : '—'}</td><td>×{d.water_factor.toFixed(2)}</td><td>{Math.round(Math.max(0, d.o2_left) * 100)}%</td><td>{Math.round(Math.max(0, d.water_left) * 100)}%</td></tr>)}
            </tbody></table>
            <h5>{t('区間ごと（断面グラフと同じ区切り）', 'By segment (same cuts as the profile)')}</h5>
            <table className="cmp" id="eval-segments"><thead><tr><th>{t('区間', 'Leg')}</th><th>km</th><th>{t('時間', 'Time')}</th><th>{t('登り/下り', 'Up/down')}</th><th>{t('最大の坂', 'Max')}</th><th>{t('足場', 'Footing')}</th></tr></thead><tbody>
              {evalMat.segments.map((g) => <tr key={g.from_wp} className={g.over_limit ? 'over' : ''}><th>{g.from_wp === 0 ? t('基地', 'Base') : `WP${g.from_wp}`}→WP{g.to_wp}</th><td>{g.km.toFixed(2)}</td><td>{fmtH(g.hours)}</td><td>{Math.round(g.climb_m)}/{Math.round(g.descent_m)} m</td><td>{g.max_slope_deg.toFixed(0)}°</td><td>{Math.round(g.poor_footing * 100)}%</td></tr>)}
            </tbody></table>
          </details>
        )}
        <div className="btns">
          <button className="primary" onClick={hud ? stop : play} disabled={n < 2}>{hud ? t('■ 止める', '■ Stop') : t('▶ ヘルメットで歩く', '▶ Walk it (helmet view)')}</button>
          <button onClick={startRehearsal} disabled={marsForReh.length < 3 || !data?.hokkaido.length || reh.status === 'running'}>
            {reh.status === 'running' ? t(`探しています ${reh.done}/${reh.total}`, `Searching ${reh.done}/${reh.total}`) : t('北海道で練習コースを探す', 'Find a practice course in Hokkaido')}
          </button>
        </div>

        <details open id="ev-consumables" className={fl('consumables')}>
          <summary>{t('条件', 'Settings')}</summary>
          <label>{t('歩く速さ（平地）', 'Walking speed (flat)')} <b>{+speed.toFixed(2)}</b> km/h{walkRec && Math.abs(speed - walkRec.summary.flat_kmh) < 0.01 ? (walkRec.synthetic ? t('（仮データの値）', ' (sample value)') : t('（チームの実測）', " (team's measurement)")) : ''}
            <input id="speed" type="range" min={0.5} max={5} step={0.5} value={speed} onChange={(e) => setSpeed(+e.target.value)} /></label>
          <label>{t('酸素', 'Oxygen')} <b>{o2}</b> {t('時間分', 'h')}
            <input id="o2" type="range" min={2} max={12} step={0.5} value={o2} onChange={(e) => setO2(+e.target.value)} /></label>
          <label>{t('冷却水', 'Cooling water')} <b>{water}</b> {t('時間分', 'h')}
            <input id="water" type="range" min={2} max={12} step={0.5} value={water} onChange={(e) => setWater(+e.target.value)} /></label>
          <label>{t('残しておく余裕', 'Reserve at arrival')} <b>{reserve}</b>%{t('（最低30分）', ' (at least 30 min)')}
            <input id="reserve" type="range" min={0} max={50} step={5} value={reserve} onChange={(e) => setReserve(+e.target.value)} /></label>
          <label>{t('目的地での作業時間', 'Work time at destination')} <b>{workH}</b> {t('時間', 'h')}
            <input id="work-h" type="range" min={0} max={4} step={0.5} value={workH} onChange={(e) => setWorkH(+e.target.value)} />
            <small>{t('作業中も平地を歩くのと同じ速さで酸素と冷却水を使う前提（目安）', 'Assumes work uses O₂ and water at the same rate as walking on flat ground (estimate)')}</small></label>
          <label>{t('出発時刻（火星の地方時）', 'Departure (Mars local time)')} <b>{String(Math.floor(start)).padStart(2, '0')}:{start % 1 ? '30' : '00'}</b>
            <input id="start" type="range" min={5} max={19} step={0.5} value={start} onChange={(e) => setStart(+e.target.value)} /></label>
          {wx && wx.temp_k != null && (
            <div className="kv sub" id="wx-line"><span>{t('出発時の気温・気圧（MEDA）', 'Air at departure (MEDA)')}</span><b>{(wx.temp_k - 273.15).toFixed(0)} °C · {wx.pressure_pa != null ? `${(wx.pressure_pa / 100).toFixed(2)} hPa` : '—'}</b></div>
          )}
          {wx && <div className="kv sub" id="wx-water"><span>{t('冷却水の減り方（気温による・目安）', 'Cooling water use (air temperature, estimate)')}</span><b>×{wx.f.toFixed(2)}</b></div>}
          <p className="muted"><a href="#sources" id="sources-link">{t('根拠', 'Sources')}</a></p>
          <div className="seg" role="radiogroup" aria-label={t('帰り道', 'Way home')} id="retrace-toggle">
            <span className="muted">{t('帰り', 'Way home')}</span>
            <button role="radio" aria-checked={!retrace} className={!retrace ? 'on' : ''} onClick={() => setRetrace(false)}>{t('まっすぐ', 'Straight')}</button>
            <button role="radio" aria-checked={retrace} className={retrace ? 'on' : ''} onClick={() => setRetrace(true)}>{t('来た道を戻る', 'Back along the route')}</button>
          </div>
          <label className="check" id="foot-toggle"><input type="checkbox" checked={footOn} onChange={(e) => setFootOn(e.target.checked)} /> {t('足場（地面のやわらかさ）を計算に入れる', 'Count the footing (how loose the ground is)')}</label>
          <label className="check" id="surface-toggle2"><input type="checkbox" checked={surfOn} onChange={(e) => setSurfOn(e.target.checked)} /> {t('砂の波紋・岩（HiRISE写真から判定）を計算に入れる', 'Count sand ripples and rocks (judged from HiRISE images)')}</label>
        </details>

        <WalkImportCard rec={walkRec} error={walkErr} busy={walkBusy} onFile={onDropFile}
          onSample={() => { loadSample().catch(() => undefined); }} onClear={clearWalk} />
        <div id="ev-rover" className={fl('rover')}><RoverCard check={check} /></div>
        <div className={`card rover-walkback ${roverMode ? 'on' : ''}`} id="rover-walkback">
          <h4>{t('有人ローバーが壊れたら、歩いて帰れるか', 'If a crewed rover breaks down, can the crew walk back?')}</h4>
          <p className="muted">{t('Perseverance の実走ルートを人が乗ったローバーで走ったと仮定。着陸地点が基地。どこで壊れたら歩いて帰れなくなるか（上の条件と同じ酸素・冷却水）。', "Suppose a crew drove Perseverance's real path, with the landing site as the base. Where would a breakdown leave them unable to walk home (same oxygen and cooling water as above)?")}</p>
          <button onClick={() => setRoverMode(!roverMode)} disabled={!data?.rover}>{roverMode ? t('探査車の道を元に戻す', 'Show the plain rover path') : t('探査車の道を色分けする', 'Colour the rover path')}</button>
          {roverMode && rwState === 'loading' && !rw && <p className="muted">{t('探査車の走行記録を読み込み中…', 'Loading the rover record from the database (DuckDB)…')}</p>}
          {roverMode && rwState === 'error' && <p className="warn">{t('走行記録のデータベースを読み込めませんでした。Web 版はネットから読み込むので、接続を確かめてもう一度押してください。', 'Could not load the rover database. The web version downloads it; check the connection and press again.')}</p>}
          {rw && (
            <>
              <div className="big-line"><b>{Math.round(rw.ok_share * 100)}%</b><span>{t(`の区間から歩いて帰れる（地形データのある走行 ${rw.inside_km.toFixed(1)} km のうち）`, `of the path lets the crew walk home (of ${rw.inside_km.toFixed(1)} km driven with terrain data)`)}</span></div>
              <div className="kv"><span>🚩 {t('最初に帰れなくなる点', 'First point with no walk home')}</span><b className={flag ? 'ng' : ''}>{flag ? t(`走行 ${flag.km.toFixed(1)} km・sol ${flag.sol}`, `${flag.km.toFixed(1)} km driven · sol ${flag.sol}`) : t('なし（全区間から帰れる）', 'None (walk home from anywhere)')}</b></div>
              <p className="muted">{t('道の色: 緑 帰れる / 黄 ぎりぎり（使える分の85%超） / 赤 帰れない / 灰 地形データの外。Apollo の月面車も「壊れても歩いて帰れる距離」までしか離れませんでした（walkback 制約）。出典: Mars 2020 走行記録（NASA/JPL）、地形 HiRISE・MOLA。判定はこのアプリの計算です。', 'Path colours: green can walk home / yellow tight (over 85% of what is usable) / red cannot / grey outside the terrain data. Apollo rovers never drove farther than the crew could walk back (the walkback constraint). Sources: Mars 2020 traverse (NASA/JPL), HiRISE and MOLA terrain; the verdict is this app\'s calculation.')}</p>
            </>
          )}
        </div>
        <div id="ev-eva" className={fl('eva')}><EvaCard eva={data?.eva ?? null} planH={ev.total_h} longer={longer} /></div>

        <details>
          <summary>{t('地図の表示', 'Map layers')}</summary>
          <label className="check"><input type="checkbox" checked={showReach} onChange={(e) => setShowReach(e.target.checked)} /> {t('歩いて帰れる範囲', 'Walk-home area')}</label>
          <label className="check"><input type="checkbox" checked={showRover} onChange={(e) => setShowRover(e.target.checked)} /> {t('探査車の実走ルート', "Perseverance's real path")}</label>
          <label className="check"><input type="checkbox" id="show-foot" checked={showFoot} onChange={(e) => setShowFoot(e.target.checked)} /> {t('足場の悪さ（熱慣性・ダスト）', 'Poor footing (thermal inertia, dust)')}</label>
          {showFoot && <div className="foot-legend"><i /><span>{t('かたい地面', 'firm')}</span><span>{t('やわらかい砂・ちり（遅く・消費が増える）', 'loose sand / dust (slower, uses more)')}</span></div>}
          <p className="muted">{t('ルートの色: 緑 8°未満 / 黄 8〜15° / 赤 15°以上 / 灰 地形不明。帰れる範囲の黄色い縁が限界の線です。', 'Route colours: green under 8° / yellow 8–15° / red over 15° / grey unknown. The yellow edge of the walk-home area is the limit.')}</p>
        </details>
        <p id="ev-terrain" className={`muted src ${fl('terrain') ?? ''} ${fl('hokkaido_terrain') ?? ''}`}><a href="#sources">{t('データと根拠（出典・式）', 'Data and sources')}</a></p>
      </aside>

      {!panelOpen && (
        <button className={`panel-chip ${n < 2 ? '' : ev.ok ? 'ok' : 'ng'}`} onClick={() => setPanelOpen(true)} aria-label={t('パネルを開く', 'Open the panel')}>
          <span>☰</span><b>{!data ? t('読み込み中…', 'Loading…') : n < 2 ? t('ルートを引く', 'Draw a route') : ev.ok ? t('帰れる', 'Can walk back') : t('引き返す', 'Turn back')}</b>
          {n >= 2 && <small>{ev.out_km.toFixed(1)} km · {fmtH(ev.total_h)}</small>}
        </button>
      )}
      <div className={`maps ${walkRec || (rehOpen && reh.found.length) ? '' : 'single'} ${panelOpen ? 'panel-open' : ''}`}>
        <div className="mapwrap" ref={setMapHost}
          // Zooming out further at the smallest zoom (Leaflet greys out its − button there) goes back up to the globe.
          onWheel={(e) => { if (e.deltaY > 0 && !globeOn && e.currentTarget.querySelector('.leaflet-control-zoom-out.leaflet-disabled')) { setGlobeStart(route[0] ?? LANDING); setGlobeFromMap(true); setGlobeOn(true); } }}
          onClickCapture={(e) => { if (!globeOn && (e.target as HTMLElement).closest('.leaflet-control-zoom-out.leaflet-disabled')) { setGlobeStart(route[0] ?? LANDING); setGlobeFromMap(true); setGlobeOn(true); } }}>
          <PlanetMap core={core} world={WORLD} view={view} fly={fly} baseKey="viking" overlayKeys={HIRISE} collapsedLayers
            overlays={overlays} features={features} live={live} crosshair={mode !== 'pan'}
            onClick={(lat, lon) => mode !== 'pan' && !hud && addPoint(lat, lon)}>
            <div className="leaflet-bar draw-toolbar">
              {tools.map(([m, icon, title]) => (
                <a key={m} href="#" title={title} aria-label={title} data-m={m} className={`${m === mode || (m === 'easy' && easy) ? 'on' : ''}${(m === 'undo' && !hist.current.past.length) || (m === 'redo' && !hist.current.future.length) ? ' off' : ''}`} onClick={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (m === 'undo') undo();
                  else if (m === 'redo') redo();
                  else if (m === 'clear') setRoute((r) => r.slice(0, 1));
                  else if (m === 'example') { if (data) setRoute(exampleRoute(data.traverseRaw)); }
                  else if (m === 'easy') { setEasy((x) => !x); setMode('route'); }
                  else setMode(m);
                }}>{icon}</a>
              ))}
            </div>
          </PlanetMap>
          {view3d && data?.demGrid && (
            <div className="terrain-over">
              <Terrain3D grid={data.demGrid} radiusKm={core.world(WORLD).radius_km} palette="mars" lines={lines3d} points={points3d}
                reach={showReach ? reachRaw : null} walker={walker} focus={focus3d} label={t('Jezero クレーター（3D）', 'Jezero crater (3D)')}
                camera={camera} exaggeration={exag} photo="./data/jezero_ortho.jpg" />
            </div>
          )}
          {globeOn && (
            <div className="terrain-over globe-over">
              <Globe marks={globeMarks} lines={data?.traverse ?? []} focus={LANDING} camera={globeCam} patch={globePatch} startClose={globeFromMap ? globeStart : null}
                onEnter={(lat, lon) => {
                  // Inside the Jezero grid: the Jezero map at street level; elsewhere the global 2D map there.
                  const d = data?.dem;
                  const inJezero = !!d && lat <= d.lat0 && lat >= d.lat0 - d.rows * d.dlat && lon >= d.lon0 && lon <= d.lon0 + d.cols * d.dlon;
                  setGlobeOn(false); setView3d(false);
                  setFly({ lat, lon, z: inJezero ? 13 : 7, seq: Date.now() });
                }} />
            </div>
          )}
          {data?.demGrid && (
            <div className="view-toggle" role="group" aria-label={t('地図の表示', 'Map view')}>
              <button className={globeOn ? 'on' : ''} onClick={() => { setGlobeStart(route[0] ?? LANDING); setGlobeFromMap(true); setGlobeOn(true); }} title={t('火星全体を回して見る', 'Turn the whole planet')}>🌐 {t('全球', 'Globe')}</button>
              <button className={!globeOn && !view3d ? 'on' : ''} onClick={() => { setGlobeOn(false); setView3d(false); }}>2D</button>
              <button className={!globeOn && view3d ? 'on' : ''} onClick={() => { setGlobeOn(false); setView3d(true); }}>3D</button>
            </div>
          )}
          {hud && <Hud s={hud} limiting={ev.limiting} onStop={stop} rad={(h) => { try { return core.radiationExposure(h); } catch { return null; } }} />}
          {!hud && <Guide />}
          <SearchViz host={mapHost} trace={vizTrace} t={t} onDone={() => { if (vizRoute.current) setRoute(vizRoute.current); vizRoute.current = null; setVizTrace(null); }} />
          <RouteEditor host={mapHost} editable={mode !== 'goal'} route={route} drawing={mode === 'route' && !hud && !globeOn} onChange={setRoute}
            preview={routePreview} connect={easy ? (a, b) => easyLeg(core, data, a, b, p) : undefined} onFinish={() => setMode('pan')} t={t} />
          {!globeOn && !view3d && !hud && (hist.current.past.length > 0 || hist.current.future.length > 0) && (
            <div className="undo-bar" role="group" aria-label={t('元に戻す', 'Undo')}>
              <button onClick={undo} disabled={!hist.current.past.length} title={t('戻す（⌘Z / Ctrl+Z）', 'Undo (⌘Z / Ctrl+Z)')}>↶ {t('戻す', 'Undo')} <kbd>⌘Z</kbd></button>
              <button onClick={redo} disabled={!hist.current.future.length} title={t('やり直す（⌘⇧Z / Ctrl+Y）', 'Redo (⌘⇧Z / Ctrl+Y)')}>↷ {t('やり直す', 'Redo')}</button>
            </div>
          )}
          {!globeOn && !view3d && !walkRec && !(rehOpen && reh.found.length > 0) && (
            <div className="draw-hint" aria-live="polite">{mode === 'route'
              ? (easy ? t('⤳ 楽な道モード（坂の楽な道でつなぐ）・', '⤳ Easy path (follows the easiest slopes) · ') : '') + t('クリックで点を追加・点に乗せると距離と O₂・ドラッグで移動・線の中の小さな点で挿入・右クリックで削除・Backspace で最後の点を消す・Esc か Enter で終わる', 'Click to add · hover a point for distance and O₂ · drag to move · drag a middle dot to insert · right-click to delete · Backspace removes the last point · Esc or Enter to finish')
              : mode === 'base' ? t('クリックした所に基地を置き直す', 'Click to move the base')
              : mode === 'goal' ? (planMsg ?? t('🎯 目的地をクリック: 基地から、坂・足場・帰り道を計算して経路を自動で引きます', '🎯 Click a destination: the route from the base is planned with slopes, footing and the way back'))
              : t('〰 を押すとルートを引けます（点はドラッグで動かせます）', 'Press 〰 to draw a route (points can be dragged)')}</div>
          )}
        </div>
        {walkRec && <EarthWalkPanel core={core} rec={walkRec} walker={earthWalker} />}
        {(walkRec || (rehOpen && reh.found.length > 0)) && (
          <button className="split-close" id="split-close" onClick={closeSplit} title={t('右の画面を閉じる（Esc）', 'Close the right view (Esc)')}>✕ {t('閉じる', 'Close')}</button>
        )}
        {!walkRec && rehOpen && reh.found.length > 0 && (
          <RehearsalPanel core={core} mars={marsForReh} found={reh.found} selected={Math.min(rehSel, reh.found.length - 1)} onSelect={setRehSel}
            params={p} onImportFile={onDropFile} />
        )}
        {rehOpen && reh.status === 'done' && reh.found.length === 0 && (
          <p className="warn floating">{t('北海道の候補地の範囲（約21km四方）に収まるコースが見つかりませんでした。ルートを短くして（★で例のルートに戻すのが早いです）、もう一度探してください。', 'No Hokkaido practice course fits (each area is about 21 km across). Shorten the route (★ restores the example) and search again.')}</p>
        )}
      </div>
    </section>
  );
}
