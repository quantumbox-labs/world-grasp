// #10 tier 2: the whole of Hokkaido cut into 1 km cells, every cell scored in Rust/WASM with the
// same formulas as the 14 known sites. Returns the side-panel content plus the map features
// (heat map + best candidates) for TargetView to place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Core, Gap, Scan } from '../core';
import type { Feature } from '../map/PlanetMap';
import { heatImage, percentiles } from '../scanHeat';

import type { Lang } from '../i18n';

/** Treasure-hunt sweep: how long the scan line takes to cross Hokkaido. */
const HUNT_MS = 1800;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const T = {
  en: {
    loading: 'Loading the map of Hokkaido…', failed: 'Could not load the scan data',
    headline: (n: number) => `All of Hokkaido's land, cut into ${n.toLocaleString()} squares, scored. Brighter = more like the target.`,
    legend: ['poorest', 'best in Hokkaido'],
    top: 'Top 5 places', topNote: 'At least 15 km apart. Tap one, or tap anywhere on the map.',
    near: (s: string, km: number) => `≈ ${s} (${km} km)`, newSpot: 'new candidate',
    check: 'Check against the 14 known sites',
    checkLine: (a: number, n: number) => `${a} of ${n} known sites are in the top 10% of Hokkaido`,
    rank: (r: number, n: number) => `#${r.toLocaleString()} / ${n.toLocaleString()}`,
    top10: 'top', outside: 'outside grid',
    cell: 'Selected place', elev: 'Elevation', relief: 'Relief', slope: 'Mean slope', p90: '90% slope',
    shadow: 'Winter noon shadow', temp: 'Air temperature', jan: 'Jan night', aug: 'Aug day', precip: 'Precipitation',
    ndvi: 'Plant cover in summer (0–1)', cover: 'Town / farm / forest / bare ground',
    excluded: { forest: 'Left out: mostly forest — no room to land, walk or build', water: 'Left out: mostly water', other: 'Left out: mostly town or farmland' },
    siteScreened: { forest: 'mostly forest', water: 'mostly water', other: 'town / farm' },
    checkNote: 'Small domes and craters are smaller than one square, so the square can be mostly forest.',
    note: 'Rock type is not in the map yet, so it is left out of this score. Temperature is corrected for height; plants and land use come from satellite images.',
    gaps: 'What this place cannot reproduce', match: 'Match',
    hunting: (a: number, n: number) => `Searching Hokkaido… ${a.toLocaleString()} / ${n.toLocaleString()}`,
    again: 'Search again', more: 'Check against the known sites, and notes',
    best: 'No. 1',
    bestWhy: (n: number, score: number) => `The best of all ${n.toLocaleString()} squares for this test (match ${score}).`,
    bestNear: (s: string, km: number) => `${km} km from the known candidate “${s}”.`,
    bestNew: 'Not near any of the 14 sites people picked.',
    bestCaveat: 'Rock type is not scored yet, and nobody has checked the ground there.',
    bestGreen: () => 'Plants cover it in summer.',
  },
  ja: {
    loading: '北海道の地図を読み込み中…', failed: 'スキャンのデータを読み込めませんでした',
    headline: (n: number) => `北海道の陸地を ${n.toLocaleString()} マスに区切って全部採点。明るいほど目的地に似ています。`,
    legend: ['遠い', '北海道で一番近い'],
    top: '上位5か所', topNote: '互いに 15 km 以上離れた場所。押すか、地図のどこかを押してください。',
    near: (s: string, km: number) => `≈ ${s}（${km} km）`, newSpot: '新しい候補',
    check: '人が選んだ14地点で答え合わせ',
    checkLine: (a: number, n: number) => `14地点のうち ${a}/${n} か所が、北海道全体の上位10%に入った`,
    rank: (r: number, n: number) => `${r.toLocaleString()} 位 / ${n.toLocaleString()}`,
    top10: '上位', outside: '範囲外',
    cell: '選んだ場所', elev: '標高', relief: '起伏', slope: '平均傾斜', p90: '傾斜（90%）',
    shadow: '冬の正午に影になる割合', temp: '気温', jan: '1月の夜', aug: '8月の昼', precip: '年降水量',
    ndvi: '夏の植物の多さ（0〜1）', cover: '市街地 / 農地 / 森林 / 裸地',
    excluded: { forest: '対象外：大部分が森林で、着陸・歩行・建設の練習ができない', water: '対象外：大部分が水面', other: '対象外：大部分が市街地か農地' },
    siteScreened: { forest: '大部分が森林', water: '大部分が水面', other: '市街地・農地' },
    checkNote: '小さな溶岩ドームや火口は1マスより小さく、マスとしては森が大部分になります。',
    note: '岩石の種類はまだ地図に入っていないので、この点数から外しています。気温は標高で補正した値、植物と土地の使われ方は衛星画像から。',
    gaps: 'この場所で再現できないこと', match: '一致度',
    hunting: (a: number, n: number) => `北海道を探しています… ${a.toLocaleString()} / ${n.toLocaleString()}`,
    again: 'もう一度探す', more: '人が選んだ14地点との答え合わせ・注意書き',
    best: '1位',
    bestWhy: (n: number, score: number) => `北海道の ${n.toLocaleString()} マスの中で、この練習に一番向いている場所（一致度 ${score}）。`,
    bestNear: (s: string, km: number) => `人が選んだ候補地「${s}」から ${km} km。`,
    bestNew: '人が選んだ 14 地点の近くにはない場所。',
    bestCaveat: '岩石の種類はまだ点数に入っておらず、現地の状況も確かめていません。',
    bestGreen: () => '夏は植物に覆われる場所です。',
  },
} as const;

/** Which screen excluded a cell, from the core's reason text (see scan::screen_reason). */
function screenKind(reason: string): 'forest' | 'water' | 'other' {
  return reason.includes('森林') ? 'forest' : reason.includes('Water Bodies') ? 'water' : 'other';
}

export function useScanSection({ core, enabled, bodyId, testId, lang, siteName, onFly }: {
  core: Core; enabled: boolean; bodyId: string; testId: string; lang: Lang;
  siteName: (id: string) => string; onFly: (lat: number, lon: number, z: number) => void;
}) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The selected cell belongs to one target/test pair, so switching pairs falls back to the best
  // cell, while focusAt() can pick the pair and the point together (view_scan tool).
  const pair = `${bodyId}/${testId}`;
  const [sel, setSel] = useState<{ pair: string; k?: number; at?: [number, number] } | null>(null);
  const setCellK = (kk: number) => setSel({ pair, k: kk });
  const focusAt = useCallback((lat: number, lon: number, body: string, test: string) => setSel({ pair: `${body}/${test}`, at: [lat, lon] }), []);
  const t = T[lang];

  useEffect(() => {
    if (!enabled || scan) return;
    core.loadScan(1).then(setScan, (e) => setError(String(e)));
  }, [core, enabled, scan]);

  const scores = useMemo(() => (scan && enabled ? scan.scores(bodyId, testId) : null), [scan, enabled, bodyId, testId]);
  const pct = useMemo(() => (scores ? percentiles(scores) : null), [scores]);
  const heat = useMemo(() => (scan && pct ? heatImage(scan.meta, scan.cells, pct) : null), [scan, pct]);
  const result = useMemo(() => (scan && scores ? scan.top(scores, 10, 15) : null), [scan, scores]);
  // Treasure hunt: when a target/test pair's result first appears, a line sweeps west → east, the
  // heat map fades in behind it and each top place "is found" as the line passes it; then #1.
  const [hunt, setHunt] = useState<{ pair: string; p: number } | null>(null);
  const hunted = useRef(new Set<string>());
  const startHunt = useCallback(() => {
    if (reducedMotion()) { setHunt({ pair, p: 1 }); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / HUNT_MS);
      setHunt({ pair, p });
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pair]);
  useEffect(() => {
    if (!result || hunted.current.has(pair)) return;
    hunted.current.add(pair);
    return startHunt();
  }, [result, pair, startHunt]);
  const huntP = hunt && hunt.pair === pair ? hunt.p : hunted.current.has(pair) ? 1 : 0;
  const sweepLon = heat ? heat.bounds[0][1] + (heat.bounds[1][1] - heat.bounds[0][1]) * huntP : 0;
  const found = (lon: number) => huntP >= 1 || lon <= sweepLon;
  const top1 = result?.top[0];
  const flewTo = useRef<string | null>(null);
  useEffect(() => {
    if (huntP >= 1 && top1 && flewTo.current !== pair && !(sel && sel.pair === pair)) { flewTo.current = pair; onFly(top1.lat, top1.lon, 10); }
  }, [huntP, top1, pair]); // eslint-disable-line react-hooks/exhaustive-deps

  const selK = sel && sel.pair === pair ? sel.k ?? (sel.at && scan ? scan.cellAt(sel.at[0], sel.at[1]) : null) : null;
  const k = selK ?? result?.top[0]?.k ?? null;
  const cell = useMemo(() => (scan && k !== null ? scan.cell(k, bodyId, testId) : null), [scan, k, bodyId, testId]);
  const gaps = useMemo<Gap[]>(() => (scan && k !== null ? scan.gaps(k, bodyId, testId) : []), [scan, k, bodyId, testId]);

  const features = useMemo<Feature[]>(() => {
    if (!enabled || !heat || !result) return [];
    const f: Feature[] = [{ kind: 'image', url: heat.url, bounds: heat.bounds, opacity: 0.75 * Math.min(1, huntP * 1.3) }];
    if (huntP < 1) f.push({ kind: 'line', pts: [[heat.bounds[0][0], sweepLon], [heat.bounds[1][0], sweepLon]], color: '#ffd666', weight: 3, opacity: 0.9 });
    result.top.slice(0, 5).forEach((c, i) => found(c.lon) && f.push({
      kind: 'point', lat: c.lat, lon: c.lon, radius: c.k === k ? 10 : 7, color: c.k === k ? '#ffffff' : '#ff7a45',
      tooltip: `#${i + 1} · ${Math.round(c.score * 100)}`, openTooltip: c.k === k,
      onClick: () => { setCellK(c.k); onFly(c.lat, c.lon, 11); },
    }));
    if (cell && !result.top.slice(0, 5).some((c) => c.k === k)) {
      f.push({ kind: 'pin', lat: cell.lat, lon: cell.lon, tooltip: `${Math.round(cell.score.total * 100)}` });
    }
    return f;
  }, [enabled, heat, result, k, cell, onFly, huntP]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMapClick = (lat: number, lon: number) => {
    if (!scan) return;
    const kk = scan.cellAt(lat, lon);
    if (kk !== null) setCellK(kk);
  };

  const selected = cell ? { lat: cell.lat, lon: cell.lon } : null;
  if (!enabled) return { panel: null, features, onMapClick: undefined, focusAt, selected: null };
  if (error) return { panel: <p className="warn">{t.failed}: {error}</p>, features, onMapClick, focusAt, selected };
  if (!scan || !result || !scores) return { panel: <p className="muted">{t.loading}</p>, features, onMapClick, focusAt, selected };

  const n = scan.meta.n;
  const known = result.sites.filter((s) => s.earth_id !== 'sapporo');
  const inTop = known.filter((s) => !s.excluded && (s.percentile ?? 0) >= 0.9).length;
  const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString();

  const panel = (
    <div id="scan">
      <p className="scan-head">{t.headline(n)}</p>
      <div className="legend"><span>{t.legend[0]}</span><i /><span>{t.legend[1]}</span></div>

      {huntP < 1 ? (
        <div className="scan-hunt" aria-live="polite">
          <span>{t.hunting(Math.round(n * huntP), n)}</span>
          <div className="track"><div className="fill" style={{ width: `${huntP * 100}%` }} /></div>
        </div>
      ) : top1 && (
        <div className="card scan-best" id="scan-best" onClick={() => { setCellK(top1.k); onFly(top1.lat, top1.lon, 11); }}>
          <div className="scan-best-head">
            <b>🏆 {t.best}</b>
            <button className="linkish" onClick={(e) => { e.stopPropagation(); startHunt(); }}>↻ {t.again}</button>
          </div>
          <div className="scan-best-where">{top1.lat.toFixed(3)}°N {top1.lon.toFixed(3)}°E · {Math.round(top1.elev_m)} m · {fmt1(top1.slope_deg)}°<b className="score">{Math.round(top1.score * 100)}</b></div>
          <p>{t.bestWhy(n, Math.round(top1.score * 100))} {top1.near ? t.bestNear(siteName(top1.near[0]), top1.near[1]) : t.bestNew}</p>
          <p className="muted">{(() => { const c = scan.cell(top1.k, bodyId, testId); return c.ndvi != null && c.ndvi >= 0.6 ? `${t.bestGreen()} ` : ''; })()}{t.bestCaveat}</p>
        </div>
      )}
      <h3 className="sub">{t.top}</h3>
      <p className="muted">{t.topNote}</p>
      <ol id="scan-top">
        {result.top.slice(0, 5).map((c, i) => !found(c.lon) ? null : (
          <li key={c.k} className={`${c.k === k ? 'active' : ''}${huntP < 1 ? ' found' : ''}`} onClick={() => { setCellK(c.k); onFly(c.lat, c.lon, 11); }}>
            <span className="rank">{i + 1}</span>
            <span className="name">{c.lat.toFixed(3)}°N {c.lon.toFixed(3)}°E · {Math.round(c.elev_m)} m · {fmt1(c.slope_deg)}°
              <small>{c.near ? t.near(siteName(c.near[0]), c.near[1]) : <b className="new">{t.newSpot}</b>}</small>
            </span>
            <b className="score">{Math.round(c.score * 100)}</b>
          </li>
        ))}
      </ol>

      {cell && (
        <div className="card" id="scan-cell">
          <h4>{t.cell}: {cell.lat.toFixed(3)}°N {cell.lon.toFixed(3)}°E</h4>
          <div className="total">{t.match} <b>{Math.round(cell.score.total * 100)}</b><small>/100</small></div>
          <div className="kv"><span>{t.elev}</span><b>{Math.round(cell.elev_m)} m</b></div>
          <div className="kv"><span>{t.relief}</span><b>{Math.round(cell.relief_m)} m</b></div>
          <div className="kv"><span>{t.slope} / {t.p90}</span><b>{fmt1(cell.slope_deg)}° / {fmt1(cell.slope_p90_deg)}°</b></div>
          <div className="kv"><span>{t.shadow}</span><b>{Math.round(cell.shadow * 100)}%</b></div>
          {cell.ndvi !== null && <div className="kv"><span>{t.ndvi}</span><b>{cell.ndvi.toFixed(2)}</b></div>}
          {cell.urban !== null && <div className="kv"><span>{t.cover}</span><b>{[cell.urban, cell.crop, cell.forest, cell.barren].map((x) => `${Math.round((x ?? 0) * 100)}%`).join(' / ')}</b></div>}
          {cell.score.excluded && <p className="warn">⛔ {t.excluded[screenKind(cell.score.excluded)]}</p>}
          {cell.climate && (
            <>
              <div className="kv"><span>{t.temp} ({t.jan} / {t.aug})</span><b>{fmt1(cell.climate.tmin[0])} / {fmt1(cell.climate.tmax[7])} °C</b></div>
              <div className="kv"><span>{t.precip}</span><b>{Math.round(cell.climate.precip)} mm</b></div>
            </>
          )}
          {cell.score.dims.filter((d) => d.key !== 'geology').map((d) => (
            <div key={d.key}>
              <div className="bar" title={d.formula}>
                <label>{lang === 'en' ? d.label_en : d.label}</label>
                <div className="track"><div className="fill" style={{ width: `${d.s * 100}%` }} /></div>
                <span>{Math.round(d.s * 100)}</span>
              </div>
            </div>
          ))}
          <div className="gaps">
            <h4>{t.gaps}</h4>
            {gaps.filter((g) => g.critical).map((g) => (
              <span key={g.key} className="gap critical">{lang === 'en' ? g.label_en : g.label} · {g.value}</span>
            ))}
          </div>
        </div>
      )}

      <details className="overview" id="scan-more">
        <summary>{t.more}</summary>
        <p className="muted">{t.note}</p>
        <h4>{t.check}</h4>
        <p className="check-line">{t.checkLine(inTop, known.length)}</p>
        <table id="scan-check">
          <tbody>
            {known.map((s) => (
              <tr key={s.earth_id} onClick={() => { if (s.k !== null) { setCellK(s.k); const c = scan.cell(s.k, bodyId, testId); onFly(c.lat, c.lon, 11); } }}>
                <th>{siteName(s.earth_id)}</th>
                {s.excluded ? (
                  <td colSpan={2} className="muted">⛔ {t.siteScreened[screenKind(s.excluded)]}</td>
                ) : (
                  <>
                    <td>{s.rank ? t.rank(s.rank, n) : t.outside}</td>
                    <td className={(s.percentile ?? 0) >= 0.9 ? 'good' : ''}>{s.percentile !== null ? `${t.top10} ${Math.max(0.1, Math.round((1 - s.percentile) * 1000) / 10)}%` : ''}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {known.some((s) => s.excluded) && <p className="muted">{t.checkNote}</p>}
      </details>
    </div>
  );
  return { panel, features, onMapClick, focusAt, selected };
}
