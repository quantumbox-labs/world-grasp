// Route editing on the WALKBACK map, as a layer on PlanetMap's Leaflet map:
//   · while drawing, a rubber-band line follows the cursor with the distance, round-trip time and
//     O₂ left if you clicked there (from the same Rust evaluation as the panel), red where the walk
//     could not get back;
//   · drag a point to move it, drag a segment's middle handle to insert one, right-click or
//     double-click a point to delete it, click to select and Delete/Backspace (while drawing,
//     Backspace with nothing selected takes back the last point), Esc or Enter to stop;
//   · hover a point for "out to here and back" numbers.
// Touch: tap adds (the map's click), long-press deletes, drag moves; bigger handles.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Waypoint } from '../core';
import { mapOf } from '../map/mapHook';
import { fmtH } from './geo';
import type { T } from '../i18n';

export interface Preview { ok: boolean; out_km: number; total_h: number; o2_left: number | null }

export function RouteEditor({ host, route, drawing, onChange, preview, connect, onFinish, t, editable = true }: {
  host: HTMLElement | null;
  route: Waypoint[];
  drawing: boolean;
  onChange: (r: Waypoint[]) => void;
  preview: (pts: Waypoint[]) => Preview | null;
  /** Easy-path mode: the points a click at `b` would add after `a` (null: straight). */
  connect?: (a: Waypoint, b: Waypoint) => Waypoint[] | null;
  onFinish: () => void;
  t: T;
  /** Draw the draggable handles (off in destination mode, so a click anywhere reaches the map). */
  editable?: boolean;
}) {
  const live = useRef({ route, onChange, preview, connect, onFinish, drawing, t });
  live.current = { route, onChange, preview, connect, onFinish, drawing, t };
  const selected = useRef<number | null>(null);
  // Rebuild the handles only when the points move, not when an elevation arrives (that would close
  // a tooltip or break a drag in progress).
  const geom = route.map((w) => `${w.lat.toFixed(7)},${w.lon.toFixed(7)}`).join(';');

  useEffect(() => {
    let map: L.Map | undefined;
    let group: L.LayerGroup | null = null;
    let band: L.Polyline | null = null;
    let tip: L.Tooltip | null = null;
    let raf = 0, retry = 0, rest = 0, pending: L.LatLng | null = null;
    const cleanup: (() => void)[] = [];

    const draw = () => {
      map = mapOf(host);
      if (!map) { retry = window.setTimeout(draw, 300); return; }
      const m = map;
      group = L.layerGroup().addTo(m);
      const r = live.current.route;
      const { t: tr } = live.current;
      const set = (next: Waypoint[]) => live.current.onChange(next);
      // Handlers read the latest route (elevations fill in after a point is drawn).
      const cur = () => live.current.route;
      let removed = false;
      const remove = (i: number) => { if (!removed && i > 0 && r.length > 1) { removed = true; set(cur().filter((_, j) => j !== i)); } };
      // Lifting the finger after a long-press would also "click" the map and add a point there.
      const swallowClick = () => {
        const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
        window.addEventListener('click', stop, true);
        setTimeout(() => window.removeEventListener('click', stop, true), 700);
      };

      const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
      const size = (i: number): [number, number] => (coarse ? (i === 0 ? [26, 26] : [22, 22]) : i === 0 ? [18, 18] : [14, 14]);
      const marks: L.Marker[] = [];
      const restyle = () => marks.forEach((mk, j) => mk.getElement()?.classList.toggle('sel', selected.current === j));
      // Numbers for "walk out to this point and back", from the same engine as the panel.
      const stats = (i: number) => {
        if (i === 0) return tr('基地（ドラッグで移動）', 'Base (drag to move)');
        const pv = live.current.preview(cur().slice(0, i + 1));
        const head = tr(`WP${i}`, `WP${i}`);
        if (!pv) return head;
        return `<b>${head}</b> ${tr('ここまで行って戻ると', 'out to here and back')}: ${tr('行き', 'out')} ${pv.out_km.toFixed(1)} km · ${fmtH(pv.total_h)}${pv.o2_left != null ? ` · O₂ ${Math.round(Math.max(0, pv.o2_left) * 100)}%` : ''}${pv.ok ? '' : ` · <span class="ng">${tr('帰れない', 'cannot get back')}</span>`}<br><small>${coarse ? tr('長押しで削除', 'Long-press to delete') : tr('ドラッグで移動・右クリックで削除', 'Drag to move · right-click to delete')}</small>`;
      };

      if (!editable) return;
      r.forEach((w, i) => {
        const mk = L.marker([w.lat, w.lon], {
          draggable: true, keyboard: false, autoPan: true,
          icon: L.divIcon({ className: `wp-handle${i === 0 ? ' base' : ''}${selected.current === i ? ' sel' : ''}`, iconSize: size(i) }),
        }).addTo(group!);
        marks.push(mk);
        mk.bindTooltip(() => stats(i), { direction: 'top', offset: [0, -8], className: 'wp-tip' });
        mk.on('dragstart', () => mk.closeTooltip());
        mk.on('dragend', () => { const p = mk.getLatLng(); set(cur().map((x, j) => (j === i ? { lat: p.lat, lon: p.lng, elev: undefined } : x))); });
        mk.on('contextmenu', (e) => { L.DomEvent.stop(e); if ((e.originalEvent as PointerEvent | undefined)?.pointerType === 'touch' || coarse) swallowClick(); remove(i); });
        mk.on('dblclick', (e) => { L.DomEvent.stop(e); remove(i); });
        mk.on('click', (e) => { L.DomEvent.stop(e); selected.current = i; restyle(); });
        // Touch: long-press deletes (iOS fires no contextmenu); moving first means a drag instead.
        const el = mk.getElement();
        if (el && i > 0) {
          let timer = 0, x0 = 0, y0 = 0;
          const cancel = () => { clearTimeout(timer); timer = 0; el.classList.remove('pressing'); };
          el.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            x0 = e.clientX; y0 = e.clientY; el.classList.add('pressing');
            timer = window.setTimeout(() => { cancel(); navigator.vibrate?.(30); swallowClick(); remove(i); }, 600);
          });
          el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) cancel(); });
          el.addEventListener('pointerup', cancel);
          el.addEventListener('pointercancel', cancel);
        }
      });
      // Middle handles: drag to insert a point there.
      for (let i = 0; i + 1 < r.length; i++) {
        const a = r[i], b = r[i + 1];
        const mid = L.marker([(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], {
          draggable: true, keyboard: false, opacity: 0.85,
          icon: L.divIcon({ className: 'wp-mid', iconSize: coarse ? [16, 16] : [10, 10] }),
          title: tr('ドラッグで点を足す', 'Drag to add a point'),
        }).addTo(group!);
        mid.on('dragend', () => { const p = mid.getLatLng(); { const c = cur(); set([...c.slice(0, i + 1), { lat: p.lat, lon: p.lng, elev: undefined }, ...c.slice(i + 1)]); } });
      }

      // Rubber band while drawing.
      // Easy-path mode follows the Dijkstra path once the cursor rests (it costs a grid search).
      const update = (path = false) => {
        raf = 0;
        if (!pending || !live.current.drawing || !r.length) return;
        const last = r[r.length - 1], c = pending;
        const tipPt: Waypoint = { lat: c.lat, lon: c.lng, elev: undefined };
        const leg = path && live.current.connect ? live.current.connect(last, tipPt) : null;
        const added = leg ? [...leg.slice(0, -1), tipPt] : [tipPt];
        const pv = live.current.preview([...cur(), ...added]);
        const color = pv && !pv.ok ? '#ff4d4f' : '#ffd666';
        const ll: L.LatLngExpression[] = [[last.lat, last.lon], ...added.map((w) => [w.lat, w.lon] as [number, number])];
        if (!band) band = L.polyline(ll, { color, weight: 3, dashArray: '6 6', interactive: false }).addTo(group!);
        else band.setLatLngs(ll).setStyle({ color });
        const html = pv
          ? `${pv.ok ? '' : '⚠ '}${tr('行き', 'Out')} ${pv.out_km.toFixed(1)} km · ${tr('往復', 'Round trip')} ${fmtH(pv.total_h)}${pv.o2_left != null ? (pv.o2_left >= 0 ? ` · O₂ ${Math.round(pv.o2_left * 100)}%` : ` · O₂ ${Math.round(-pv.o2_left * 100)}% ${tr('不足', 'short')}`) : ''}${pv.ok ? '' : `<br>${tr('ここまで行くと帰れない', 'You could not get back from here')}`}`
          : '';
        if (!tip) tip = L.tooltip({ direction: 'right', offset: [14, 0], className: `band-tip${pv && !pv.ok ? ' ng' : ''}` }).setLatLng(c).setContent(html).addTo(m);
        else { tip.setLatLng(c).setContent(html); const el = tip.getElement(); el?.classList.toggle('ng', !!pv && !pv.ok); }
      };
      const onMove = (e: L.LeafletMouseEvent) => {
        pending = e.latlng;
        if (!raf) raf = requestAnimationFrame(() => update());
        if (live.current.connect) { clearTimeout(rest); rest = window.setTimeout(() => update(true), 180); }
      };
      const onOut = () => { pending = null; band?.remove(); band = null; tip?.remove(); tip = null; };
      if (live.current.drawing) {
        m.on('mousemove', onMove); m.on('mouseout', onOut);
        m.doubleClickZoom.disable();
        // Double-click finishes on desktop; on touch a long-press can look like a double tap.
        const onDbl = () => { if (!coarse) live.current.onFinish(); };
        m.on('dblclick', onDbl);
        cleanup.push(() => { m.off('mousemove', onMove); m.off('mouseout', onOut); m.off('dblclick', onDbl); m.doubleClickZoom.enable(); });
      }
    };
    draw();

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!host?.offsetParent) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && live.current.drawing)) { live.current.onFinish(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const r = live.current.route;
        // The selected point, or (while drawing) the last one.
        const i = selected.current != null && selected.current > 0 ? selected.current : live.current.drawing && r.length > 1 ? r.length - 1 : null;
        if (i == null || i >= r.length) return;
        e.preventDefault();
        selected.current = null;
        live.current.onChange(r.filter((_, j) => j !== i));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(retry); clearTimeout(rest); cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      cleanup.forEach((f) => f());
      tip?.remove(); group?.remove();
    };
  }, [host, geom, drawing, !!connect, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
