// world-grasp: 複数ユニットの状況把握レイヤのデータモデルと判定。
// 判定はすべて原典エンジン (analog-core) の出力で、新しい計算モデルは足さない:
//   - 徒歩ユニット (eva / walker): walk/plan.ts の evaluate (RouteEval の ticks) で現在位置の余裕を見る
//   - ローバー (rover): 原典 #11 B と同じ roverWalkback (home_ratio による乗員の徒歩帰還判定)
// 地球ユニットは同じ effort-hours 予算モデルに乗り、EvaParams の o2_h 欄を「行動可能時間」として使う
// (water_h は大きく取り、制限側にならないようにする)。足場・気温の補正は Jezero 専用データなので
// 地球モードでは適用されない (evaluateRoute はグリッドの足場なしで評価する)。
import type { Core, Reach, RouteEval, RoverWalkback, Waypoint, World } from '../core';
import { JEZERO, LANDING, exampleRoute, type WalkData } from '../walk/data';
import {
  MAX_SLOPE, WALKBACK_COLOR, denseRoute, evaluate, evaParams, reachFrom, roverWalkback, turnIndex,
  walkbackState, type PlanParams,
} from '../walk/plan';
import { type Dense } from '../walk/geo';

export type UnitKind = 'eva' | 'rover' | 'walker' | 'vehicle';
export type UnitStatus = 'ok' | 'tight' | 'no' | 'out';

/** 余裕がこの時間 (h) を切ったら「要引き返し」。原典 Hud の警告 (margin < 0.5h) と同じ境目。 */
export const MARGIN_TIGHT_H = 0.5;

/** 状態色は原典のローバー徒歩帰還ライン (plan.ts WALKBACK_COLOR) と同じパレット。 */
export const STATUS_COLOR: Record<UnitStatus, string> = WALKBACK_COLOR;

export const KIND_LABEL: Record<UnitKind, [string, string]> = {
  eva: ['船外活動', 'EVA'],
  rover: ['有人ローバー', 'Crewed rover'],
  walker: ['徒歩隊', 'Foot team'],
  vehicle: ['車両', 'Vehicle'],
};

export interface GraspUnit {
  id: string;
  name: string;
  en: string;
  kind: UnitKind;
  world: World;
  /** 標高グリッドの登録名 (WASM 側)。火星は 'jezero'、地球は 'hk:<site>'。 */
  grid: string;
  base: Waypoint;
  /** eva / walker: 計画ルート ([0] = 基地、末尾 = 目的地)。rover: 空 (実走行路をコアが保持)。 */
  route: Waypoint[];
  params: PlanParams;
  color: string;
  /** 任務の進行の初期値 (0–1、ルート上の位置)。 */
  defaultProgress: number;
}

// ---------- 判定結果 ----------

/** 徒歩ユニットの現在位置での判定 (RouteEval の tick がそのまま根拠)。 */
export interface WalkJudge {
  mode: 'walk';
  dense: Dense;
  ev: RouteEval;
  /** dense.pts / ev.ticks の現在位置 index。 */
  idx: number;
  pos: Waypoint;
  status: UnitStatus;
  marginH: number;
  o2Left: number;
  waterLeft: number;
  homeH: number;
  tH: number;
  km: number;
  /** 引き返し地点の dense index (帰れるルートなら null)。 */
  turnIdx: number | null;
}

/** ローバーの現在位置での判定 (乗員が歩いて帰れるか、予算比 ratio が根拠)。 */
export interface RoverJudge {
  mode: 'rover';
  rw: RoverWalkback;
  idx: number;
  pos: { lat: number; lon: number };
  status: UnitStatus;
  ratio: number | null;
  km: number;
  sol: number;
}

export type Judge = WalkJudge | RoverJudge;

// ---------- 計算 ----------

/** 任意グリッドで標高を補完する densify (walk/geo.ts の densify は Jezero 専用なので汎用版を用意)。 */
export function densifyOn(core: Core, world: World, grid: string, route: Waypoint[], stepM = 40): Dense {
  if (route.length === 0) return { pts: [], wp: [] };
  const R = core.world(world).radius_km * 1000, k = (Math.PI / 180) * R;
  const pts: Waypoint[] = [], wp: number[] = [];
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    wp.push(pts.length);
    pts.push(a);
    const b = route[i + 1];
    if (!b) break;
    const d = Math.hypot((b.lon - a.lon) * k * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * k);
    const n = Math.floor(d / stepM);
    for (let j = 1; j < n; j++) {
      const f = j / n;
      pts.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, elev: undefined });
    }
  }
  try {
    const z = core.sampleGrid(grid, pts.map((p) => [p.lat, p.lon] as [number, number]));
    pts.forEach((p, i) => { if (z[i] != null) p.elev = z[i]; else if (p.elev === undefined) p.elev = null; });
  } catch {
    pts.forEach((p) => { if (p.elev === undefined) p.elev = null; });
  }
  return { pts: pts.map((p) => ({ ...p })), wp };
}

/** 徒歩ユニットのルート評価 (進捗に依らない部分)。火星は原典の evaluate (足場・気温込み)、地球は evaluateRoute。 */
export function evalWalkUnit(core: Core, data: WalkData | null, unit: GraspUnit): { dense: Dense; ev: RouteEval } | null {
  if (unit.route.length < 2) return null;
  const p = evaParams(unit.params);
  if (unit.world === 'mars') {
    if (!data?.dem) return null;
    const dense = denseRoute(core, data, unit.route);
    return { dense, ev: evaluate(core, dense, p) };
  }
  const dense = densifyOn(core, unit.world, unit.grid, unit.route);
  try { return { dense, ev: core.evaluateRoute(unit.world, dense.pts, p) }; } catch { return null; }
}

/** 評価済みルートの、進捗位置での判定 (tick がそのまま根拠)。 */
export function walkJudgeAt(e: { dense: Dense; ev: RouteEval }, progress: number): WalkJudge | null {
  const { dense, ev } = e;
  if (!dense.pts.length || !ev.ticks.length) return null;
  const idx = Math.min(dense.pts.length - 1, Math.max(0, Math.round(progress * (dense.pts.length - 1))));
  const tick = ev.ticks[idx];
  if (!tick) return null;
  return {
    mode: 'walk', dense, ev, idx,
    pos: dense.pts[idx],
    status: tick.margin_h < 0 ? 'no' : tick.margin_h < MARGIN_TIGHT_H ? 'tight' : 'ok',
    marginH: tick.margin_h, o2Left: tick.o2_left, waterLeft: tick.water_left,
    homeH: tick.home_h, tH: tick.t_h, km: tick.km,
    turnIdx: turnIndex(ev),
  };
}

/** ローバーの徒歩帰還判定 (進捗に依らない部分)。原典 plan.ts roverWalkback (基地 LANDING の B モード)。 */
export function evalRoverUnit(core: Core, data: WalkData | null, unit: GraspUnit): RoverWalkback | null {
  return roverWalkback(core, data, evaParams(unit.params));
}

/** 判定済み走行路の、進捗位置での判定 (予算比 ratio がそのまま根拠)。 */
export function roverJudgeAt(rw: RoverWalkback, progress: number): RoverJudge | null {
  if (!rw.points.length) return null;
  const idx = Math.min(rw.points.length - 1, Math.max(0, Math.round(progress * (rw.points.length - 1))));
  const pt = rw.points[idx];
  return {
    mode: 'rover', rw, idx,
    pos: { lat: pt.lat, lon: pt.lon },
    status: walkbackState(pt),
    ratio: pt.ratio, km: pt.km, sol: pt.sol,
  };
}

/** ユニットの帰還可能エリア (徒歩ユニットのみ。ローバーは home_ratio 判定のため対象外)。 */
export function unitReach(core: Core, data: WalkData | null, unit: GraspUnit): Reach | null {
  if (unit.kind === 'rover') return null;
  const p = evaParams(unit.params);
  if (unit.world === 'mars') return reachFrom(core, data, unit.base, p);
  try { return core.reach(unit.world, unit.grid, unit.base.lat, unit.base.lon, p, MAX_SLOPE); } catch { return null; }
}

// ---------- シナリオ ----------

/** 火星 (Jezero) の初期配置。EVA-1 は Perseverance 実走行路から作る原典の例ルート。 */
export function marsUnits(data: WalkData): GraspUnit[] {
  return [
    {
      id: 'eva-1', name: 'EVA-1', en: 'EVA-1', kind: 'eva', world: 'mars', grid: JEZERO, base: LANDING,
      route: exampleRoute(data.traverseRaw),
      params: { speed: 2, o2: 8, water: 8, reserve: 20, work: 1, start: 9 },
      color: '#69c0ff', defaultProgress: 0.55,
    },
    {
      id: 'eva-2', name: 'EVA-2', en: 'EVA-2', kind: 'eva', world: 'mars', grid: JEZERO, base: LANDING,
      route: [LANDING, { lat: 18.4520, lon: 77.4380 }, { lat: 18.4600, lon: 77.4240 }, { lat: 18.4710, lon: 77.4080 }],
      params: { speed: 2, o2: 6, water: 6, reserve: 20, work: 2, start: 9 },
      color: '#ffd666', defaultProgress: 0.65,
    },
    {
      id: 'rover-1', name: '有人ローバー', en: 'Crewed rover', kind: 'rover', world: 'mars', grid: JEZERO, base: LANDING,
      route: [],
      params: { speed: 2, o2: 8, water: 8, reserve: 20 },
      color: '#36cfc9', defaultProgress: 0.5,
    },
  ];
}

/** 地球モードの基地: 登別 地獄谷 (web/public/data/hokkaido/index.json の地点)。 */
export const EARTH_BASE: Waypoint = { lat: 42.4975, lon: 141.1475 };
export const EARTH_GRID = 'hk:noboribetsu';
export const EARTH_SITE_ID = 'noboribetsu';

/** 地球 (登別・NASADEM グリッド) の初期配置。o2 欄 = 行動可能時間 (h)、water は制限側にしない。 */
export function earthUnits(): GraspUnit[] {
  return [
    {
      id: 'walker-a', name: '徒歩隊A', en: 'Team A', kind: 'walker', world: 'earth', grid: EARTH_GRID, base: EARTH_BASE,
      route: [EARTH_BASE, { lat: 42.4975, lon: 141.1560 }, { lat: 42.5020, lon: 141.1597 }],
      params: { speed: 3.5, o2: 6, water: 999, reserve: 20, work: 0.5 },
      color: '#69c0ff', defaultProgress: 1,
    },
    {
      id: 'walker-b', name: '徒歩隊B', en: 'Team B', kind: 'walker', world: 'earth', grid: EARTH_GRID, base: EARTH_BASE,
      route: [EARTH_BASE, { lat: 42.5056, lon: 141.1475 }, { lat: 42.5092, lon: 141.1390 }],
      params: { speed: 3, o2: 4, water: 999, reserve: 20, work: 0.5 },
      color: '#ffd666', defaultProgress: 0.7,
    },
  ];
}

// ---------- 地球 v2: サイト切替とユニット追加 ----------

/**
 * サイト切替時の初期配置。登別は従来の earthUnits() (専用ルート) をそのまま使い、
 * 他サイトは基地 (index.json の地点 = グリッドの基準点) から登別 A/B と同じ方角・予算で
 * 置いた徒歩隊にする。判定はどちらも同じ evalWalkUnit (core.evaluateRoute) の出力。
 */
export function earthPresetUnits(siteId: string, base: Waypoint): GraspUnit[] {
  if (siteId === EARTH_SITE_ID) return earthUnits();
  const mk = (id: string, name: string, en: string, dLat: number, dLon: number,
    speed: number, o2: number, color: string, progress: number): GraspUnit => ({
    id, name, en, kind: 'walker', world: 'earth', grid: `hk:${siteId}`, base,
    route: [base, { lat: base.lat + dLat, lon: base.lon + dLon }],
    params: { speed, o2, water: 999, reserve: 20, work: 0.5 },
    color, defaultProgress: progress,
  });
  return [
    mk(`walker-a-${siteId}`, '徒歩隊A', 'Team A', 0.0045, 0.0122, 3.5, 6, '#69c0ff', 1),
    mk(`walker-b-${siteId}`, '徒歩隊B', 'Team B', 0.0117, -0.0085, 3, 4, '#ffd666', 0.7),
  ];
}

/**
 * 地図クリックで足す徒歩隊。目的地 = クリック地点で、初期状態は目的地に到達した位置
 * (progress 1) で判定する。予算は EvaParams の o2 欄 = 行動可能時間 (h) で、後から変更できる。
 */
export function customEarthUnit(id: string, siteId: string, base: Waypoint, dest: Waypoint,
  budgetH: number, color: string, name: string, en: string): GraspUnit {
  return {
    id, name, en, kind: 'walker', world: 'earth', grid: `hk:${siteId}`, base,
    route: [base, dest],
    params: { speed: 3.5, o2: budgetH, water: 999, reserve: 20, work: 0.5 },
    color, defaultProgress: 1,
  };
}
