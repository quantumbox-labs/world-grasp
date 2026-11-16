// Route-search animation: replays, cell by cell, the order in which the Rust Dijkstra (grid.rs
// plan_route) settled the Jezero grid on the way to the destination, coloured by cost (blue near
// the base → yellow near the destination's cost), over the cells you could not walk back from
// (dim red). The search itself is already done; only the drawing is spread over time. At the end
// the best path is drawn and onDone fires.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { mapOf } from '../map/mapHook';
import type { T } from '../i18n';
import { lastPlanSide } from '../core';

export interface Trace {
  order: Uint32Array; cost: Float32Array;
  rows: number; cols: number;
  /** [[south, west], [north, east]] of the grid. */
  bounds: [[number, number], [number, number]];
  /** Out + back share of the budget per cell (> 1 or null: cannot walk back). */
  ratio: (number | null)[] | null;
  path: [number, number][];
}

const SPEEDS = { slow: 14000, normal: 6000, fast: 1800 } as const;
type Speed = keyof typeof SPEEDS;

// ImageOverlay that draws a canvas instead of an <img> (Leaflet positions it on pan / zoom).
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage(this: L.ImageOverlay & { _image: HTMLElement; _url: unknown; _zoomAnimated: boolean }) {
    const c = this._url as HTMLCanvasElement;
    this._image = c;
    c.classList.add('leaflet-image-layer', 'search-viz-canvas');
    if (this._zoomAnimated) c.classList.add('leaflet-zoom-animated');
    (c.style as CSSStyleDeclaration).imageRendering = 'pixelated';
  },
}) as unknown as new (c: HTMLCanvasElement, b: L.LatLngBoundsExpression, o?: L.ImageOverlayOptions) => L.ImageOverlay;

export function SearchViz({ host, trace, onDone, t }: { host: HTMLElement | null; trace: Trace | null; onDone: () => void; t: T }) {
  const [speed, setSpeed] = useState<Speed>('normal');
  const [shown, setShown] = useState(0);
  const live = useRef({ speed, onDone });
  live.current = { speed, onDone };
  const skip = useRef(false);

  useEffect(() => {
    const map = mapOf(host);
    if (!map || !trace) return;
    skip.current = false;
    const { rows, cols, order, cost, ratio } = trace;
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    // Cells you cannot walk back from: dim red underlay.
    if (ratio) for (let i = 0; i < ratio.length; i++) {
      const r = ratio[i];
      if (r == null || r > 1) { const o = i * 4; img.data[o] = 120; img.data[o + 1] = 20; img.data[o + 2] = 30; img.data[o + 3] = 90; }
    }
    ctx.putImageData(img, 0, 0);
    const overlay = new CanvasOverlay(c, trace.bounds, { opacity: 0.85, interactive: false }).addTo(map);
    // Bidirectional search: cells settled from the base (blue → teal) and from the destination
    // (orange → yellow), each side coloured by its own cost; they meet in the middle.
    const side = lastPlanSide().length === order.length ? lastPlanSide() : new Uint8Array(order.length);
    const maxSide = [0, 0];
    for (let k = 0; k < order.length; k++) maxSide[side[k]] = Math.max(maxSide[side[k]], cost[k]);
    let line: L.Polyline | null = null;
    let done = 0, last = performance.now(), raf = 0;
    const paint = (from: number, to: number) => {
      for (let k = from; k < to; k++) {
        const i = order[k], o = i * 4, sd = side[k], f = Math.min(1, cost[k] / (maxSide[sd] || 1));
        if (sd === 0) { img.data[o] = Math.round(40 + 40 * f); img.data[o + 1] = Math.round(120 + 110 * f); img.data[o + 2] = 255; }
        else { img.data[o] = 255; img.data[o + 1] = Math.round(120 + 110 * f); img.data[o + 2] = Math.round(40 * (1 - f)); }
        img.data[o + 3] = 200;
      }
    };
    const finish = () => {
      paint(done, order.length); done = order.length;
      ctx.putImageData(img, 0, 0); (overlay as unknown as { _reset?: () => void })._reset?.();
      setShown(order.length);
      line = L.polyline(trace.path, { color: '#ffffff', weight: 5, opacity: 0.95, className: 'search-viz-path' }).addTo(map);
      setTimeout(() => live.current.onDone(), 500);
    };
    const tick = (now: number) => {
      if (skip.current) { finish(); return; }
      const dt = now - last; last = now;
      const step = Math.max(1, Math.round((order.length * dt) / SPEEDS[live.current.speed]));
      const to = Math.min(order.length, done + step);
      paint(done, to); done = to;
      ctx.putImageData(img, 0, 0);
      setShown(done);
      if (done >= order.length) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); overlay.remove(); line?.remove(); };
  }, [host, trace]);

  if (!trace) return null;
  const n = trace.order.length;
  return (
    <div className="search-viz" role="group" aria-label={t('経路探索の再生', 'Route search playback')}>
      <span>{t(`探索中のマス ${shown.toLocaleString()} / ${n.toLocaleString()}`, `Cells searched ${shown.toLocaleString()} / ${n.toLocaleString()}`)}</span>
      {(['slow', 'normal', 'fast'] as Speed[]).map((s) => (
        <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s === 'slow' ? t('ゆっくり', 'Slow') : s === 'normal' ? t('ふつう', 'Normal') : t('早送り', 'Fast')}</button>
      ))}
      <button onClick={() => { skip.current = true; }}>{t('スキップ', 'Skip')}</button>
      <div className="search-viz-legend"><i className="near" style={{ background: 'rgb(60,170,255)' }} />{t('基地から探索', 'from the base')}<i className="far" style={{ background: 'rgb(255,170,30)' }} />{t('目的地から探索', 'from the destination')}<i className="no" />{t('帰れない', 'no way back')}</div>
    </div>
  );
}
