// world-grasp 状況把握画面 (#grasp): 複数ユニットを 1 つの地図に置き、各ユニットの
// 「まだ帰れるか」を原典エンジン (analog-core) の判定のまま並べる。
// 徒歩ユニットは RouteEval の tick (余裕 margin_h)、ローバーは原典 B モードの
// roverWalkback (徒歩帰還の予算比 ratio) が根拠。計算は grasp/units.ts に集約。
import { useEffect, useMemo, useState } from 'react';
import type { Core, Reach, RouteEval, RoverWalkback, Waypoint, World } from '../core';
import { PlanetMap, missionOverlay, type Feature, type FlyTarget } from '../map/PlanetMap';
import { LANDING, loadHokkaidoGrid, loadWalkData, type GridData, type HokkaidoSite, type WalkData } from '../walk/data';
import { fmtH, reachImage, type Dense } from '../walk/geo';
import { walkbackState } from '../walk/plan';
import { useLang, useT, type T } from '../i18n';
import {
  EARTH_BASE, EARTH_SITE_ID, KIND_LABEL, STATUS_COLOR, customEarthUnit, earthPresetUnits,
  evalRoverUnit, evalWalkUnit, marsUnits, roverJudgeAt, unitReach, walkJudgeAt,
  type GraspUnit, type Judge, type UnitStatus,
} from '../grasp/units';
import { EonetPanel } from '../grasp/EonetPanel';
import '../grasp/grasp.css';

type Tab = 'mars' | 'earth';
type UnitEval = { mode: 'walk'; dense: Dense; ev: RouteEval } | { mode: 'rover'; rw: RoverWalkback };

const STATUS_TEXT: Record<UnitStatus, [string, string]> = {
  ok: ['帰還可能', 'Can return'],
  tight: ['余裕わずか', 'Tight margin'],
  no: ['帰還不可', 'Cannot return'],
  out: ['データ外', 'Outside data'],
};

/** 余裕の表示 (負は − を付ける)。fmtH は 0 でクランプするので符号はこちらで扱う。 */
const fmtMargin = (h: number) => (h < 0 ? `−${fmtH(-h)}` : fmtH(h));

function statusText(t: T, j: Judge): string {
  const [ja, en] = STATUS_TEXT[j.status];
  return t(ja, en);
}

/** ローバーの走行路を徒歩帰還の状態色で塗り分けた線 (原典 WalkView の B モードと同じ見せ方)。 */
function roverLines(rw: RoverWalkback): { pts: [number, number][]; color: string }[] {
  const out: { pts: [number, number][]; color: string }[] = [];
  let cur: { pts: [number, number][]; color: string } | null = null;
  for (const pt of rw.points) {
    const color = STATUS_COLOR[walkbackState(pt)];
    const ll: [number, number] = [pt.lat, pt.lon];
    if (!cur || cur.color !== color) {
      if (cur) cur.pts.push(ll);
      cur = { pts: cur ? [cur.pts[cur.pts.length - 1], ll] : [ll], color };
      out.push(cur);
    } else cur.pts.push(ll);
  }
  return out.filter((l) => l.pts.length > 1);
}

export function GraspView({ core }: { core: Core }) {
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState<Tab>('mars');
  const [data, setData] = useState<WalkData | null>(null);
  const [hk, setHk] = useState<{ id: string; grid: GridData } | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fly, setFly] = useState<FlyTarget | null>(null);
  // 地球 v2: サイト切替と、サイトごとのユニット編集 (追加・予算変更・削除)。
  const [siteId, setSiteId] = useState<string>(EARTH_SITE_ID);
  const [edited, setEdited] = useState<{ siteId: string; units: GraspUnit[] } | null>(null);
  const [addMode, setAddMode] = useState(false);

  useEffect(() => { loadWalkData(core).then(setData).catch(() => undefined); }, [core]);
  useEffect(() => {
    if (tab === 'earth') {
      loadHokkaidoGrid(core, siteId).then((grid) => setHk({ id: siteId, grid })).catch(() => undefined);
    }
  }, [core, tab, siteId]);

  // 地球の基地はサイトの基準点 (index.json の lat/lon。登別は従来どおり地獄谷)。
  const sites = useMemo<HokkaidoSite[]>(() => data?.hokkaido ?? [], [data]);
  const site = sites.find((s) => s.id === siteId) ?? null;
  const siteBase = useMemo<Waypoint>(() => (site ? { lat: site.lat, lon: site.lon } : EARTH_BASE), [site]);
  const hkGrid = tab === 'earth' && hk?.id === siteId ? hk.grid : null;
  // 編集中のサイトでは編集済みリスト、それ以外はサイトの初期配置。
  const earthList = useMemo<GraspUnit[]>(
    () => (edited && edited.siteId === siteId ? edited.units : earthPresetUnits(siteId, siteBase)),
    [edited, siteId, siteBase]);

  const units = useMemo<GraspUnit[]>(() => (tab === 'mars' ? (data ? marsUnits(data) : []) : earthList),
    [tab, data, earthList]);

  const selectSite = (id: string) => {
    setSiteId(id);
    setSelectedId(null);
    setAddMode(false);
    const s = sites.find((x) => x.id === id);
    if (s) setFly({ lat: s.lat, lon: s.lon, z: 13, seq: Date.now() });
  };

  const CUSTOM_COLORS = ['#b37feb', '#36cfc9', '#ff85c0', '#ffa940', '#95de64'];
  const addUnitAt = (lat: number, lon: number) => {
    const n = earthList.filter((u) => u.id.startsWith('custom-')).length + 1;
    const u = customEarthUnit(`custom-${Date.now()}`, siteId, siteBase, { lat, lon }, 5,
      CUSTOM_COLORS[(n - 1) % CUSTOM_COLORS.length], `追加隊${n}`, `Added team ${n}`);
    setEdited({ siteId, units: [...earthList, u] });
    setSelectedId(u.id);
    setAddMode(false);
  };
  const removeUnit = (id: string) => {
    setEdited({ siteId, units: earthList.filter((u) => u.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };
  const setBudget = (id: string, h: number) => {
    setEdited({ siteId, units: earthList.map((u) => (u.id === id ? { ...u, params: { ...u.params, o2: h } } : u)) });
  };
  const progressOf = (u: GraspUnit) => progress[u.id] ?? u.defaultProgress;

  // 進捗に依らない評価 (ルート評価・ローバーの home_ratio) はユニットごとに 1 回だけ。
  const evals = useMemo(() => {
    const m = new Map<string, UnitEval>();
    for (const u of units) {
      if (u.kind === 'rover') {
        const rw = evalRoverUnit(core, data, u);
        if (rw) m.set(u.id, { mode: 'rover', rw });
      } else {
        const e = evalWalkUnit(core, data, u);
        if (e) m.set(u.id, { mode: 'walk', ...e });
      }
    }
    return m;
  }, [core, data, units, hk]); // eslint-disable-line react-hooks/exhaustive-deps

  const judged = useMemo(() => units.map((unit) => {
    const e = evals.get(unit.id);
    const judge = !e ? null : e.mode === 'walk' ? walkJudgeAt(e, progressOf(unit)) : roverJudgeAt(e.rw, progressOf(unit));
    return { unit, judge };
  }), [units, evals, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = judged.find((j) => j.unit.id === selectedId) ?? judged[0] ?? null;
  const alerts = judged.filter((j) => j.judge && j.judge.status !== 'ok');

  // 選択中ユニットの帰還可能エリア (徒歩ユニットのみ)。
  const reach = useMemo<Reach | null>(() => (selected ? unitReach(core, data, selected.unit) : null),
    [core, data, selected?.unit, hk]); // eslint-disable-line react-hooks/exhaustive-deps
  const reachImg = useMemo(() => {
    if (!reach) return null;
    const meta = tab === 'mars' ? data?.dem : hkGrid;
    return meta ? reachImage(reach, meta) : null;
  }, [reach, data, hkGrid, tab]);

  const select = (unit: GraspUnit, judge: Judge | null) => {
    setSelectedId(unit.id);
    if (judge) setFly({ lat: judge.pos.lat, lon: judge.pos.lon, z: 14, seq: Date.now() });
  };

  const features = useMemo<Feature[]>(() => {
    const f: Feature[] = [];
    if (reachImg) f.push({ kind: 'image', url: reachImg.url, bounds: reachImg.bounds, opacity: 0.55 });
    for (const { unit, judge } of judged) {
      if (!judge) continue;
      if (judge.mode === 'rover') {
        for (const l of roverLines(judge.rw)) f.push({ kind: 'line', pts: l.pts, color: l.color, weight: 3, opacity: 0.8 });
      } else {
        const pts = judge.dense.pts;
        const travelled = pts.slice(0, judge.idx + 1).map((p) => [p.lat, p.lon] as [number, number]);
        const rest = pts.slice(judge.idx).map((p) => [p.lat, p.lon] as [number, number]);
        if (travelled.length > 1) f.push({ kind: 'line', pts: travelled, color: unit.color, weight: 5 });
        if (rest.length > 1) f.push({ kind: 'line', pts: rest, color: unit.color, weight: 3, dash: '6 6', opacity: 0.85 });
        if (selected && unit.id === selected.unit.id) {
          f.push({ kind: 'line', pts: [[judge.pos.lat, judge.pos.lon], [unit.base.lat, unit.base.lon]], color: '#ffffff', weight: 2, dash: '4 6', opacity: 0.7 });
          if (judge.turnIdx != null && pts[judge.turnIdx]) {
            f.push({ kind: 'point', lat: pts[judge.turnIdx].lat, lon: pts[judge.turnIdx].lon, radius: 9, color: '#faad14',
              tooltip: t('🚩 引き返し地点', '🚩 Turn-back point'), openTooltip: true });
          }
        }
      }
      f.push({ kind: 'ring', lat: judge.pos.lat, lon: judge.pos.lon, radiusKm: 0.25, color: STATUS_COLOR[judge.status] });
      f.push({ kind: 'point', lat: judge.pos.lat, lon: judge.pos.lon, color: unit.color, radius: 8,
        tooltip: `${unit.name} — ${statusText(t, judge)}`, onClick: () => select(unit, judge) });
    }
    const base = tab === 'mars' ? LANDING : siteBase;
    f.push({ kind: 'point', lat: base.lat, lon: base.lon, color: '#ffffff', radius: 7, tooltip: t('基地', 'Base') });
    return f;
  }, [judged, reachImg, selected, tab, lang, siteBase]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlays = useMemo(() => missionOverlay(core, tab as World), [core, tab]);
  const view: [number, number, number] = tab === 'mars'
    ? [LANDING.lat, LANDING.lon - 0.015, 13]
    : [siteBase.lat, siteBase.lon, 13];
  const sel = selected;
  const selJudge = sel?.judge ?? null;

  return (
    <section className="view grasp">
      <aside className="panel" aria-label={t('状況把握パネル', 'Grasp panel')}>
        <h2 className="walk-title">{t('状況把握', 'Grasp')} <small>world-grasp — {t('全ユニットの「まだ帰れるか」', 'can every unit still get home?')}</small></h2>
        <p className="muted">{t('原典 WALKBACK のエンジン (analog-core) の判定をそのまま並べたプロトタイプ。ユニットを選んで進捗スライダを動かすと、現在位置での帰還判定が追従します。', 'A prototype that lists the original WALKBACK engine (analog-core) verdicts as they are. Pick a unit and move its progress slider: the return verdict at that position follows.')}</p>
        <div className="tabs" role="group" aria-label={t('戦域', 'Theatre')}>
          <button className={tab === 'mars' ? 'on' : ''} onClick={() => setTab('mars')}>🔴 {t('火星 Jezero', 'Mars · Jezero')}</button>
          <button className={tab === 'earth' ? 'on' : ''} onClick={() => setTab('earth')}>🌏 {t('地球', 'Earth')}</button>
        </div>
        {tab === 'mars' && !data && <p className="muted">{t('火星のデータを読み込み中…', 'Loading Mars data…')}</p>}
        {tab === 'earth' && !hkGrid && <p className="muted">{t('地形データ (NASADEM) を読み込み中…', 'Loading terrain (NASADEM)…')}</p>}

        {tab === 'earth' && (
          <div className="grasp-sitebar">
            <label>{t('サイト (北海道アナログ候補地)', 'Site (Hokkaido analog sites)')}
              <select value={siteId} onChange={(e) => selectSite(e.target.value)} aria-label={t('サイト選択', 'Select site')}>
                {(sites.length ? sites : [{ id: EARTH_SITE_ID, name: '登別 地獄谷', lat: EARTH_BASE.lat, lon: EARTH_BASE.lon, rows: 0, cols: 0, nulls: 0 }]).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <button className={addMode ? 'on' : ''} onClick={() => setAddMode((m) => !m)}>
              {addMode ? t('✕ 追加をやめる', '✕ Cancel adding') : t('＋ ユニット追加 (地図クリック)', '＋ Add unit (click the map)')}
            </button>
            {addMode && <p className="muted">{t('地図をクリックした地点を目的地として徒歩隊を追加します。行動可能時間は追加後、詳細で変更できます。', 'Click the map to add a foot team headed for that point. Its action-time budget can be changed afterwards in the details.')}</p>}
          </div>
        )}

        {alerts.length > 0 && (
          <div className="card grasp-alerts">
            <h4>⚠ {t('アラート', 'Alerts')}</h4>
            {alerts.map(({ unit, judge }) => (
              <button key={unit.id} className="grasp-alert" onClick={() => select(unit, judge)}>
                <span className="grasp-dot" style={{ background: STATUS_COLOR[judge!.status] }} />
                <span className="grasp-alert-name">{unit.name}</span>
                <span className="grasp-alert-msg">
                  {judge!.mode === 'walk'
                    ? judge!.status === 'no'
                      ? t(`帰還不可（余裕 ${fmtMargin(judge!.marginH)}）`, `Cannot return (margin ${fmtMargin(judge!.marginH)})`)
                      : t(`引き返し間近（余裕 ${fmtMargin(judge!.marginH)}）`, `Turn back soon (margin ${fmtMargin(judge!.marginH)})`)
                    : judge!.status === 'no'
                      ? t('徒歩帰還不可', 'Cannot walk home')
                      : t('徒歩帰還の余裕わずか', 'Walk-home margin is tight')}
                </span>
              </button>
            ))}
          </div>
        )}

        <h3 className="grasp-h">{t('ユニット', 'Units')}</h3>
        <div className="grasp-units">
          {judged.map(({ unit, judge }) => (
            <button key={unit.id} className={`grasp-unit${sel && unit.id === sel.unit.id ? ' on' : ''}`} onClick={() => select(unit, judge)}>
              <span className="grasp-dot" style={{ background: unit.color }} />
              <span className="grasp-unit-main">
                <span className="grasp-unit-name">{unit.name} <small className="muted">{t(...KIND_LABEL[unit.kind])}</small></span>
                <span className="grasp-unit-sub muted">
                  {judge
                    ? judge.mode === 'walk'
                      ? t(`歩いた距離 ${judge.km.toFixed(1)} km`, `${judge.km.toFixed(1)} km walked`)
                      : t(`走行 ${judge.km.toFixed(1)} km · sol ${judge.sol}`, `${judge.km.toFixed(1)} km driven · sol ${judge.sol}`)
                    : t('計算中…', 'Computing…')}
                </span>
              </span>
              {judge && (
                <span className="grasp-chip" style={{ borderColor: STATUS_COLOR[judge.status], color: STATUS_COLOR[judge.status] }}>
                  {statusText(t, judge)}
                </span>
              )}
            </button>
          ))}
        </div>

        {sel && selJudge && (
          <div className="card grasp-detail">
            <h4>{sel.unit.name} <small className="muted">{t(...KIND_LABEL[sel.unit.kind])}</small></h4>
            <div className={`verdict ${selJudge.status === 'ok' ? 'ok' : selJudge.status === 'tight' ? 'tight' : 'ng'}`}>
              {selJudge.mode === 'walk'
                ? selJudge.status === 'ok' ? t('帰還可能', 'Can return')
                  : selJudge.status === 'tight' ? t(`引き返し間近（余裕 ${fmtMargin(selJudge.marginH)}）`, `Turn back soon (margin ${fmtMargin(selJudge.marginH)})`)
                  : t('現在位置からは帰還不可', 'Cannot return from here')
                : selJudge.status === 'ok' ? t('乗員は歩いて帰還可能', 'Crew can walk home')
                  : selJudge.status === 'tight' ? t('徒歩帰還の余裕わずか', 'Walk-home margin is tight')
                  : selJudge.status === 'out' ? t('地形データの外', 'Outside the terrain data')
                  : t('乗員は歩いて帰還不可', 'Crew cannot walk home')}
            </div>
            <label>{t('任務の進行', 'Mission progress')} <b>{Math.round(progressOf(sel.unit) * 100)}%</b>
              <input type="range" min={0} max={100} step={1} value={Math.round(progressOf(sel.unit) * 100)}
                onChange={(e) => setProgress((p) => ({ ...p, [sel.unit.id]: +e.target.value / 100 }))} />
            </label>
            {sel.unit.world === 'earth' && selJudge.mode === 'walk' && (
              <label>{t('行動可能時間', 'Action time budget')} <b>{sel.unit.params.o2} h</b>
                <input type="range" min={1} max={12} step={0.5} value={sel.unit.params.o2}
                  onChange={(e) => setBudget(sel.unit.id, +e.target.value)} />
                <input type="number" min={0.5} max={24} step={0.5} value={sel.unit.params.o2} aria-label={t('行動可能時間 (h)', 'Action time (h)')}
                  onChange={(e) => { const v = +e.target.value; if (v > 0) setBudget(sel.unit.id, v); }} />
              </label>
            )}
            <div className="kv"><span>{t('現在位置', 'Position')}</span><b>{selJudge.pos.lat.toFixed(4)}, {selJudge.pos.lon.toFixed(4)}</b></div>
            {selJudge.mode === 'walk' ? (
              <>
                <div className="kv"><span>{t('歩いた距離 / 経過', 'Walked / elapsed')}</span><b>{selJudge.km.toFixed(2)} km · {fmtH(selJudge.tH)}</b></div>
                <div className="kv"><span>{t('帰りに要る時間', 'Time to get home')}</span><b>{fmtH(selJudge.homeH)}</b></div>
                <div className="kv"><span>{t('余裕', 'Margin')}</span><b>{fmtMargin(selJudge.marginH)}</b></div>
                <div className="kv"><span>{sel.unit.world === 'earth' ? t('行動可能時間の残り', 'Action time left') : t('O₂ の残り', 'O₂ left')}</span><b>{Math.round(Math.max(0, selJudge.o2Left) * 100)}%</b></div>
                {sel.unit.world === 'mars' && <div className="kv"><span>{t('冷却水の残り', 'Cooling water left')}</span><b>{Math.round(Math.max(0, selJudge.waterLeft) * 100)}%</b></div>}
                {sel.unit.world === 'mars' && <div className="kv"><span>{t('先に尽きるもの', 'Runs out first')}</span><b>{selJudge.ev.limiting === 'water' ? t('冷却水', 'Cooling water') : t('酸素', 'Oxygen')}</b></div>}
                <div className="kv"><span>{t('ルート全体の判定', 'Whole-route verdict')}</span><b>{selJudge.ev.ok ? t('最後まで行って帰れる', 'Can finish and return') : t('途中で引き返す', 'Turn back on the way')}</b></div>
                {selJudge.turnIdx != null && selJudge.dense.pts[selJudge.turnIdx] && (
                  <div className="kv"><span>{t('引き返し地点', 'Turn-back point')}</span><b>{t(`ルート ${selJudge.ev.ticks[selJudge.turnIdx]?.km.toFixed(1) ?? '—'} km 地点`, `at ${selJudge.ev.ticks[selJudge.turnIdx]?.km.toFixed(1) ?? '—'} km`)}</b></div>
                )}
                {reach && <div className="kv"><span>{t('歩いて帰れる範囲', 'Walk-home area')}</span><b>{reach.area_km2.toFixed(1)} km²{t('（最遠 ', ' (farthest ')}{reach.max_km.toFixed(1)} km{t('）', ')')}</b></div>}
              </>
            ) : (
              <>
                <div className="kv"><span>{t('走行距離', 'Driven')}</span><b>{selJudge.km.toFixed(1)} km · sol {selJudge.sol}</b></div>
                <div className="kv"><span>{t('徒歩帰還のコスト（予算比）', 'Walk-home cost (share of budget)')}</span><b>{selJudge.ratio != null ? `${Math.round(selJudge.ratio * 100)}%` : '—'}</b></div>
                <p className="muted">{t('ローバー自体の走行可否ではなく「ここで故障したら乗員が歩いて基地へ帰れるか」の判定です（原典 #11 のローバー故障チェックと同じ計算）。', 'Not whether the rover can drive on: whether the crew could walk back to base if it broke down here — the same check as the original #11 rover-breakdown mode.')}</p>
              </>
            )}
            {tab === 'earth' && (
              <button className="grasp-remove" onClick={() => removeUnit(sel.unit.id)}>{t('🗑 このユニットを削除', '🗑 Remove this unit')}</button>
            )}
          </div>
        )}
        {tab === 'earth' && <EonetPanel />}
        <p className="muted">{t('数値はすべて原典エンジン (analog-core) の出力です。地球モードでは足場・気温 (Jezero 専用データ) は未適用で、行動可能時間を同じ effort-hours 予算で数えます。', 'Every number comes from the original engine (analog-core). On Earth the footing / air-temperature corrections (Jezero-only data) are not applied; action time is counted in the same effort-hours budget.')}</p>
      </aside>
      <div className="maps single">
        <PlanetMap core={core} world={tab} view={view} features={features} fly={fly} overlays={overlays}
          onClick={tab === 'earth' && addMode ? addUnitAt : undefined}
          crosshair={tab === 'earth' && addMode} />
      </div>
    </section>
  );
}
