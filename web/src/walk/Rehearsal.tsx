// "Rehearse it in Hokkaido": find the place where the same walk (same length, same climbs)
// can be practised, on the elevation grids around the #10 Hokkaido candidate sites.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Core, EvaParams, RehearsalMatch, Waypoint } from '../core';
import { fmtH } from './geo';
import { PlanetMap, type Feature } from '../map/PlanetMap';
import { Terrain3D, type Line3D } from '../map/Terrain3D';
import { loadHokkaidoGrid, type GridData, type HokkaidoSite } from './data';
import { useT } from '../i18n';

export interface Found { site: HokkaidoSite; m: RehearsalMatch }

/** Best rehearsal course on each Hokkaido grid, best first (Rust core: rehearse). */
export async function findRehearsals(core: Core, sites: HokkaidoSite[], marsPts: Waypoint[], onProgress?: (done: number, found: Found[]) => void): Promise<Found[]> {
  const found: Found[] = [];
  if (marsPts.length < 3) return found;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    await loadHokkaidoGrid(core, s.id).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0)); // let the progress paint
    try {
      const m = core.rehearse('mars', marsPts, `hk:${s.id}`, 5, 20, 1)[0];
      if (m) found.push({ site: s, m });
    } catch { /* grid missing or route larger than the area */ }
    onProgress?.(i + 1, [...found]);
  }
  return found.sort((a, b) => b.m.score - a.m.score);
}

export function useRehearsal(core: Core, sites: HokkaidoSite[]) {
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'error'; done: number; found: Found[]; error?: string }>(
    { status: 'idle', done: 0, found: [] });
  const run = async (marsPts: Waypoint[]): Promise<Found[]> => {
    if (marsPts.length < 3) return [];
    setState({ status: 'running', done: 0, found: [] });
    try {
      const found = await findRehearsals(core, sites, marsPts, (done, f) => setState({ status: 'running', done, found: f }));
      setState({ status: 'done', done: sites.length, found });
      return found;
    } catch (e) {
      setState({ status: 'error', done: 0, found: [], error: String(e) });
      throw e;
    }
  };
  return { ...state, run, total: sites.length };
}

function Profile({ mars, earth }: { mars: Waypoint[]; earth: [number, number, number][] }) {
  const t = useT();
  const W = 300, H = 110, P = 26;
  const R = 3389.5, k = (Math.PI / 180) * R;
  const dist: number[] = [0];
  for (let i = 1; i < mars.length; i++) {
    const a = mars[i - 1], b = mars[i];
    dist.push(dist[i - 1] + Math.hypot((b.lon - a.lon) * k * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * k));
  }
  const m0 = mars[0]?.elev ?? 0, e0 = earth[0]?.[2] ?? 0;
  const mz = mars.map((p) => (p.elev ?? m0) - m0), ez = earth.map((p) => p[2] - e0);
  const lo = Math.min(0, ...mz, ...ez), hi = Math.max(1, ...mz, ...ez), L = dist.at(-1) || 1;
  const x = (d: number) => P + (d / L) * (W - P - 6);
  const y = (z: number) => 6 + (1 - (z - lo) / (hi - lo)) * (H - 22);
  const path = (zs: number[]) => zs.map((z, i) => `${i ? 'L' : 'M'}${x(dist[Math.min(i, dist.length - 1)]).toFixed(1)},${y(z).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="profile" role="img" aria-label={t('火星と北海道の高低差の比較', 'Height profile: Mars vs Hokkaido')}>
      <line x1={P} x2={W - 6} y1={y(0)} y2={y(0)} className="axis" />
      <text x={2} y={y(hi) + 4} className="hist-label">+{Math.round(hi)}m</text>
      <text x={2} y={y(lo) + 4} className="hist-label">{Math.round(lo)}m</text>
      <text x={W - 40} y={H - 2} className="hist-label">{L.toFixed(1)} km</text>
      <path d={path(mz)} className="prof-mars" />
      <path d={path(ez)} className="prof-earth" />
    </svg>
  );
}

export function RehearsalPanel({ core, mars, found, selected, onSelect, params, onImportFile }: {
  core: Core; mars: Waypoint[]; found: Found[]; selected: number; onSelect: (i: number) => void;
  /** Walking conditions (speed etc.) the challenge's target time is computed with. */
  params?: EvaParams;
  /** A recorded walk (GPX) chosen from the challenge card. */
  onImportFile?: (f: File) => void;
}) {
  const t = useT();
  const f = found[selected];
  // Same-slope challenge: the course on Earth, evaluated by the same Rust engine (distance, steepest
  // slope, time at the planned flat speed). Comes to the front when a search finishes.
  const challenge = useMemo(() => {
    if (!f || !params) return null;
    try {
      const ev = core.evaluateRoute('earth', f.m.pts.map(([lat, lon, elev]) => ({ lat, lon, elev })), params);
      return { km: ev.out_km, h: ev.out_h, steep: ev.max_slope_deg };
    } catch { return null; }
  }, [core, f, params]);
  const [chOpen, setChOpen] = useState(true);
  const chRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setChOpen(true); window.dispatchEvent(new Event('walkback:front')); chRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [found]);
  const [is3d, setIs3d] = useState(false);
  const [grid, setGrid] = useState<GridData | null>(null);
  useEffect(() => {
    if (!f) return;
    let live = true;
    loadHokkaidoGrid(core, f.site.id).then((g) => live && setGrid(g)).catch(() => live && setGrid(null));
    return () => { live = false; };
  }, [core, f]);
  const lines3d = useMemo<Line3D[]>(() => (f ? [{ pts: f.m.pts.map((p) => [p[0], p[1]] as [number, number]), color: '#40a9ff', width: 5 }] : []), [f]);
  const features = useMemo<Feature[]>(() => {
    if (!f) return [];
    const pts = f.m.pts.map((p) => [p[0], p[1]] as [number, number]);
    return [
      { kind: 'line', pts, color: '#000', weight: 7, opacity: 0.5 },
      { kind: 'line', pts, color: '#40a9ff', weight: 4 },
      { kind: 'point', lat: pts[0][0], lon: pts[0][1], color: '#52c41a', radius: 8, tooltip: t('スタート（火星の基地にあたる場所）', 'Start (where the Mars base would be)') },
    ];
  }, [f]);
  const fit = useMemo(() => {
    if (!f) return null;
    const la = f.m.pts.map((p) => p[0]), lo = f.m.pts.map((p) => p[1]);
    return { bounds: [[Math.min(...la), Math.min(...lo)], [Math.max(...la), Math.max(...lo)]] as [[number, number], [number, number]], seq: selected + f.m.score };
  }, [f, selected]);
  if (!f) return null;
  return (
    <div className="mapwrap rehearsal">
      <PlanetMap core={core} world="earth" view={[f.site.lat, f.site.lon, 13]} fit={fit} baseKey="gsiphoto" features={features} />
      {is3d && grid && (
        <div className="terrain-over">
          <Terrain3D key={f.site.id} grid={grid} radiusKm={6371} palette="earth" lines={lines3d}
            points={[{ lat: f.m.pts[0][0], lon: f.m.pts[0][1], color: '#52c41a', size: 2 }]} focus={fit?.bounds ?? null} />
        </div>
      )}
      <div className="maplabel">{t('北海道の練習コース', 'Practice course in Hokkaido')}: {f.site.name}{is3d ? ' (3D)' : ''}</div>
      {grid && (
        <div className="view-toggle" role="group" aria-label={t('地図の表示', 'Map view')}>
          <button className={is3d ? '' : 'on'} onClick={() => setIs3d(false)}>2D</button>
          <button className={is3d ? 'on' : ''} onClick={() => setIs3d(true)}>3D</button>
        </div>
      )}
      <div className="rehearsal-card">
        <div className="tabs">
          {found.slice(0, 3).map((x, i) => (
            <button key={x.site.id} className={i === selected ? 'on' : ''} onClick={() => onSelect(i)}>
              {i + 1}. {x.site.name.replace(/（.*）/, '')} <b>{Math.round(x.m.score)}</b>
            </button>
          ))}
        </div>
        <Profile mars={mars} earth={f.m.pts} />
        <div className="legend"><span className="lg-mars">{t('火星のルート', 'Mars route')}</span><span className="lg-earth">{t('北海道のコース', 'Hokkaido course')}</span></div>
        <div className="kv"><span>{t('坂の違い（平均）', 'Slope difference (mean)')}</span><b>{f.m.rms_deg.toFixed(1)}°</b></div>
        <div className="kv"><span>{t('登りの合計 火星 / 北海道', 'Total climb Mars / Hokkaido')}</span><b>{Math.round(f.m.climb_mars_m)} m / {Math.round(f.m.climb_earth_m)} m</b></div>
        {challenge && (chOpen ? (
          <div className="challenge" id="challenge" ref={chRef}>
            <div className="challenge-head"><b>🥾 {t('同じ坂チャレンジ', 'Same-slope challenge')}</b>
              <button className="linkish" onClick={() => setChOpen(false)} aria-label={t('たたむ', 'Fold')}>—</button></div>
            <p>{t(`${f.site.name.replace(/（.*）/, '')}で、火星のルートと同じ坂を歩く: 片道 ${challenge.km.toFixed(1)} km・登り ${Math.round(f.m.climb_earth_m)} m・いちばん急な所 ${Math.round(challenge.steep)}°。`,
              `Walk the same slopes as the Mars route at ${f.site.name.replace(/（.*）/, '')}: ${challenge.km.toFixed(1)} km one way, ${Math.round(f.m.climb_earth_m)} m of climbing, steepest ${Math.round(challenge.steep)}°.`)}</p>
            <p>{t(`目安タイム（行き）: ${fmtH(challenge.h)}（平地 ${params!.speed_kmh} km/h で計算）`, `Target time (out): ${fmtH(challenge.h)} (at ${params!.speed_kmh} km/h on the flat)`)}</p>
            {onImportFile && (
              <>
                <button className="primary" onClick={() => fileRef.current?.click()}>{t('歩いた記録（GPX）で答え合わせ', 'Check with your recorded walk (GPX)')}</button>
                <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) onImportFile(x); e.target.value = ''; }} />
                <p className="muted">{t('記録を読み込むと、同じ形の道を火星で歩いたら帰れたかを判定します。', 'Load the record to see whether the same walk would have got you back on Mars.')}</p>
              </>
            )}
          </div>
        ) : (
          <button className="challenge-chip" onClick={() => setChOpen(true)}>🥾 {t('同じ坂チャレンジ', 'Same-slope challenge')}</button>
        ))}
        <p className="muted">{t('地球では再現できない点: 重力（火星は地球の38%なので、同じ坂でも地球の方が体への負担は約2.6倍）、薄い大気と低温、宇宙服の重さ。', 'What Earth cannot reproduce: gravity (Mars has 38% of Earth\'s, so the same slope is about 2.6× harder on Earth), the thin cold air, and the weight of the suit.')}</p>
      </div>
    </div>
  );
}
