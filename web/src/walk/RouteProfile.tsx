// Route profile under the plan: x = distance from the base (km), y = one of elevation, slope,
// footing factor, elapsed time, O₂ left, water left — all taken from the existing evaluation
// (the Rust RouteEval ticks / legs and the footing grid), nothing new is computed here. Hovering
// moves a marker on the map (onHover with the dense point index); the turn-back point is marked.
import { useState } from 'react';
import type { RouteEval, Waypoint } from '../core';
import { fmtH } from './geo';
import type { T } from '../i18n';

type Key = 'elev' | 'slope' | 'foot' | 'time' | 'o2' | 'water';

export function RouteProfile({ pts, ev, foot, turn, onHover, t }: {
  pts: Waypoint[]; ev: RouteEval; foot: (number | null)[] | null; turn: number | null;
  onHover: (i: number | null) => void; t: T;
}) {
  const [key, setKey] = useState<Key>('elev');
  const [hi, setHi] = useState<number | null>(null);
  const n = Math.min(pts.length, ev.ticks.length);
  if (n < 2) return null;
  const xs = ev.ticks.slice(0, n).map((k) => k.km);
  const val = (i: number): number | null => {
    switch (key) {
      case 'elev': return pts[i].elev ?? null;
      case 'slope': return i > 0 ? (ev.legs[i - 1]?.known ? ev.legs[i - 1].slope_deg : null) : 0;
      case 'foot': return foot?.[i] ?? null;
      case 'time': return ev.ticks[i].t_h;
      case 'o2': return Math.max(0, ev.ticks[i].o2_left) * 100;
      case 'water': return Math.max(0, ev.ticks[i].water_left) * 100;
    }
  };
  const ys = Array.from({ length: n }, (_, i) => val(i));
  const known = ys.filter((y): y is number => y != null && Number.isFinite(y));
  const labels: [Key, string][] = [['elev', t('標高', 'Elevation')], ['slope', t('坂', 'Slope')], ['foot', t('足場', 'Footing')], ['time', t('時間', 'Time')], ['o2', 'O₂'], ['water', t('冷却水', 'Water')]];
  const tabs = (
    <div className="rp-tabs" role="tablist">
      {labels.map(([k, l]) => <button key={k} role="tab" aria-selected={key === k} className={key === k ? 'on' : ''} onClick={() => setKey(k)}>{l}</button>)}
    </div>
  );
  if (!known.length) return <div className="route-profile" id="route-profile">{tabs}<p className="muted">{t('この項目のデータがこの経路にありません', 'No data for this item on this route')}</p></div>;
  let lo = Math.min(...known), hiY = Math.max(...known);
  if (key === 'o2' || key === 'water') { lo = Math.min(0, lo); hiY = Math.max(100, hiY); }
  if (hiY - lo < 1e-9) { hiY = lo + 1; }
  const W = 320, H = 96, P = 4, xMax = xs[n - 1] || 1;
  const X = (x: number) => P + ((W - 2 * P) * x) / xMax, Y = (y: number) => H - P - ((H - 2 * P) * (y - lo)) / (hiY - lo);
  let d = '';
  ys.forEach((y, i) => { if (y == null) return; d += `${d && ys[i - 1] != null ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(y).toFixed(1)}`; });
  const unit = { elev: 'm', slope: '°', foot: '×', time: '', o2: '%', water: '%' }[key];
  const fmt = (y: number | null) => (y == null ? '—' : key === 'time' ? fmtH(y) : key === 'foot' ? `×${y.toFixed(2)}` : `${y.toFixed(key === 'slope' ? 1 : 0)}${unit}`);
  const move = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const km = ((x - P) / (W - 2 * P)) * xMax;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xs[i] - km) < Math.abs(xs[best] - km)) best = i;
    setHi(best); onHover(best);
  };
  return (
    <div className="route-profile" id="route-profile">
      {tabs}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => { setHi(null); onHover(null); }}
        role="img" aria-label={t('経路の断面', 'Route profile')}>
        <path d={d} fill="none" stroke="#69c0ff" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {turn != null && turn < n && <line x1={X(xs[turn])} x2={X(xs[turn])} y1={0} y2={H} stroke="#ff4d4f" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {hi != null && <line x1={X(xs[hi])} x2={X(xs[hi])} y1={0} y2={H} stroke="#fff" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="rp-axis"><span>0 km</span><span>{hi != null ? `${xs[hi].toFixed(2)} km · ${fmt(ys[hi])}` : `${fmt(Math.min(...known))} – ${fmt(Math.max(...known))}`}</span><span>{xMax.toFixed(1)} km</span></div>
      {turn != null && <div className="rp-turn">{t('赤い点線 = 引き返し地点', 'Red dashes = turn-back point')}</div>}
    </div>
  );
}
