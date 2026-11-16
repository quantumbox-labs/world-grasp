// Whole-Mars 3D globe (drag to turn, wheel to zoom), textured with a NASA global mosaic bundled in
// web/public/data/globe/ (Viking MDIM 2.1 colour or MOLA shaded relief, 4096 × 2048,
// equirectangular). Shows the IAU place names by zoom (click one for its card), the landing sites
// and crewed-landing candidates, Jezero, the base and Perseverance's path. Zooming in
// close over Jezero hands over to the Jezero map (onEnter).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useT } from '../i18n';

export interface GlobeMark { lat: number; lon: number; label: string; kind: 'base' | 'site' | 'jezero' }
export interface GlobeCamera { lat: number; lon: number; distance?: number; seq: number }
/** One gazetteer row (web/public/data/globe/mars_names.json, built by scripts/build-mars-names.mjs). */
export interface MarsName { name: string; kind: 'feature' | 'landing' | 'crewed'; type: string; lat: number; lon: number; diameter_km: number | null; origin: string; link: string | null }
type NameRow = [string, MarsName['kind'], string, number, number, number | null, string, string | null];
let namesP: Promise<MarsName[]> | null = null;
const loadNames = () => (namesP ??= fetch('./data/globe/mars_names.json').then((r) => (r.ok ? r.json() : []))
  .then((rows: NameRow[]) => rows.map(([name, kind, type, lat, lon, diameter_km, origin, link]) => ({ name, kind, type, lat, lon, diameter_km, origin, link })))
  .catch(() => { namesP = null; return []; }));
/** Most labels on screen at once; the largest features win. */
const MAX_NAMES = 60;

interface Props {
  marks: GlobeMark[];
  /** Close-up photo patch draped on the sphere (e.g. the Jezero HiRISE mosaic) and its bounds. */
  patch?: { url: string; north: number; south: number; west: number; east: number } | null;
  /** Open already close over this point and pull back (coming back from the map). */
  startClose?: { lat: number; lon: number } | null;
  /** Polylines as [lat, lon] (Perseverance's path). */
  lines: [number, number][][];
  /** Where "enter" zooms to (Jezero / the base). */
  focus: { lat: number; lon: number };
  camera?: GlobeCamera | null;
  /** Hand-over to the map after a fly-down; lat/lon of where the camera came down. */
  onEnter: (lat: number, lon: number) => void;
}

const R = 1;
/** lat/lon (degrees) → point on the sphere, matching three's SphereGeometry UVs for an
 * equirectangular image that starts at longitude −180° on its left edge. */
export function toVec(lat: number, lon: number, r = R) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

const ENTER_DISTANCE = 1.32; // camera distance from the centre at which a zoom over the focus enters
/** Final camera distance over the focus: ~6 km above the surface, about what the 2D map shows at
 * zoom 13 on a laptop screen, so the hand-over does not jump. */
const CLOSE = 1 + 6.3 / 3389.5;
/** Fly-down height for places away from Jezero, where only the global mosaic is sharp. */
const CLOSE_FAR = 1 + 340 / 3389.5; // ≈ what the 2D map shows at zoom 7 (the Viking mosaic's own resolution)
const FLY_MS = 2600;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function Globe({ marks, lines, focus, camera, onEnter, patch, startClose }: Props) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [tex, setTex] = useState<'viking' | 'mola'>('viking');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fading, setFading] = useState<'in' | 'out' | null>(startClose ? 'in' : null);
  const [showNames, setShowNames] = useState(true);
  const showNamesRef = useRef(true);
  showNamesRef.current = showNames;
  const [card, setCard] = useState<MarsName | null>(null);
  const sc = useRef<{ cam: THREE.PerspectiveCamera; ctl: OrbitControls; mat: THREE.MeshStandardMaterial;
    goal: THREE.Vector3 | null; marks: { v: THREE.Vector3; el: HTMLElement }[]; entered: boolean;
    fly: { t0: number; d0: THREE.Vector3; d1: THREE.Vector3; r0: number; r1: number; bump: number; done?: () => void } | null } | null>(null);
  const enterRef = useRef(onEnter);
  enterRef.current = onEnter;
  /** Continuous flight to (lat, lon) at distance r1 (1 = surface). */
  const flyTo = (lat: number, lon: number, r1: number, done?: () => void) => {
    const s = sc.current;
    if (!s) return;
    const d0 = s.cam.position.clone().normalize(), d1 = toVec(lat, lon).normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, d0.dot(d1))));
    const r0 = s.cam.position.length();
    s.goal = null;
    s.ctl.enabled = false;
    s.fly = { t0: performance.now(), d0, d1, r0, r1, bump: Math.min(1.2, angle * 0.7) * Math.min(1, r0), done };
  };
  const flyRef = useRef(flyTo);
  flyRef.current = flyTo;
  /** Fade the globe out over the map, then hand over. */
  const enter = (lat = focus.lat, lon = focus.lon) => { setFading('out'); setTimeout(() => enterRef.current(lat, lon), 650); };

  useEffect(() => {
    const el = host.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05070d');
    const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(r.domElement);

    const mat = new THREE.MeshStandardMaterial({ color: '#b5643a', roughness: 1, metalness: 0 });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), mat);
    scene.add(globe);
    // Thin atmosphere rim.
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.015, 64, 32),
      new THREE.MeshBasicMaterial({ color: '#e8a27a', transparent: true, opacity: 0.08, side: THREE.BackSide })));
    // Brighter, softer light: the Viking mosaic is dull brown-grey, and strong one-sided shading
    // made the planet read as grey (owner: it looked like the Moon).
    scene.add(new THREE.AmbientLight('#fff1e6', 1.05));
    const sun = new THREE.DirectionalLight('#fff4e8', 0.95);
    sun.position.set(3, 1.5, 4);
    scene.add(sun);

    // Stars.
    const sg = new THREE.BufferGeometry(), sp = new Float32Array(1500 * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 80;
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#8899aa', size: 0.08 })));

    // Perseverance's path, lifted a hair above the surface.
    for (const l of lines) {
      if (l.length < 2) continue;
      const g = new THREE.BufferGeometry().setFromPoints(l.map(([la, lo]) => toVec(la, lo, R * 1.0008)));
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#36cfc9' })));
    }
    // Close-up photo patch: a piece of sphere spanning exactly the photo's bounds (three's sphere
    // angles: phi from longitude −180°, theta from the north pole), so its UVs map the image 1:1.
    if (patch) {
      const d = Math.PI / 180;
      const geo = new THREE.SphereGeometry(R * 1.00003, 96, 64, (patch.west + 180) * d, (patch.east - patch.west) * d, (90 - patch.north) * d, (patch.north - patch.south) * d);
      const pm = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, transparent: true, opacity: 0 });
      new THREE.TextureLoader().load(patch.url, (tx) => { tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; pm.map = tx; pm.opacity = 1; pm.needsUpdate = true; });
      scene.add(new THREE.Mesh(geo, pm));
    }
    // Marks: a dot on the sphere and an HTML label placed every frame.
    const markObjs: { v: THREE.Vector3; el: HTMLElement }[] = [];
    const dots: THREE.Mesh[] = [];
    for (const m of marks) {
      const v = toVec(m.lat, m.lon, R * 1.001);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(m.kind === 'site' ? 0.006 : 0.009, 12, 8),
        new THREE.MeshBasicMaterial({ color: m.kind === 'base' ? '#ffffff' : m.kind === 'jezero' ? '#ffd666' : '#9ec5ff' }));
      dot.position.copy(v);
      scene.add(dot);
      dots.push(dot);
      const lab = document.createElement('div');
      lab.className = `globe-label ${m.kind}`;
      lab.textContent = m.label;
      lab.addEventListener('click', () => { if (sc.current) sc.current.entered = true; flyRef.current(m.lat, m.lon, m.kind === 'base' ? CLOSE : CLOSE_FAR, () => enter(m.lat, m.lon)); });
      labels.current?.appendChild(lab);
      markObjs.push({ v, el: lab });
    }

    // Gazetteer labels: landing sites and crewed candidates always, IAU features by size for the
    // current height (bigger than ~280 km per planet radius of altitude), largest first.
    const names: { n: MarsName; v: THREE.Vector3; el: HTMLElement | null }[] = [];
    loadNames().then((rows) => {
      // A crewed candidate repeats its IAU feature, and the base mark already labels its spot: skip those.
      const crewed = new Set(rows.filter((n) => n.kind === 'crewed').map((n) => n.name));
      const nearMark = (n: MarsName) => marks.some((m) => Math.abs(m.lat - n.lat) < 0.3 && Math.abs(m.lon - n.lon) < 0.3);
      for (const n of rows) {
        if ((n.kind === 'feature' && crewed.has(n.name)) || (n.kind === 'landing' && nearMark(n))) continue;
        names.push({ n, v: toVec(n.lat, n.lon, R * 1.001), el: null });
      }
    });
    const nameEl = (x: (typeof names)[number]) => {
      if (x.el) return x.el;
      const lab = document.createElement('div');
      lab.className = `globe-label name ${x.n.kind}`;
      lab.textContent = x.n.kind === 'landing' ? `▲ ${x.n.name}` : x.n.kind === 'crewed' ? `◆ ${x.n.name}` : x.n.name;
      lab.addEventListener('click', () => setCard(x.n));
      labels.current?.appendChild(lab);
      x.el = lab;
      return lab;
    };
    let shown = new Set<(typeof names)[number]>();
    let frame = 0;

    const ctl = new OrbitControls(cam, r.domElement);
    ctl.enableDamping = true;
    ctl.enablePan = false;
    ctl.minDistance = 1.08;
    ctl.maxDistance = 6;
    ctl.rotateSpeed = 0.5;
    ctl.zoomSpeed = 0.8;
    const f = toVec(focus.lat, focus.lon);
    ctl.minDistance = 1.0005;
    cam.position.copy(startClose ? toVec(startClose.lat, startClose.lon, CLOSE) : f.clone().multiplyScalar(3.2).add(new THREE.Vector3(0, 0.6, 0)));
    ctl.target.set(0, 0, 0);
    sc.current = { cam, ctl, mat, goal: null, marks: markObjs, entered: !!startClose, fly: null };
    ctl.addEventListener('start', () => { if (sc.current) sc.current.goal = null; });
    // Click anywhere on the planet (not a drag): fly down there and hand over to the map.
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    r.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    r.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || sc.current?.fly) return;
      const rect = r.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), cam);
      const hit = ray.intersectObject(globe)[0];
      if (!hit) return;
      const v = hit.point.clone().normalize();
      const lat = (Math.asin(v.y) * 180) / Math.PI, lon = (Math.atan2(-v.z, v.x) * 180) / Math.PI;
      const nearFocus = Math.abs(lat - focus.lat) < 0.5 && Math.abs(lon - focus.lon) < 0.5;
      if (sc.current) sc.current.entered = true;
      flyRef.current(lat, lon, nearFocus ? CLOSE : CLOSE_FAR, () => enter(lat, lon));
    });

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      r.setSize(w, h, false);
      r.domElement.style.width = '100%'; r.domElement.style.height = '100%';
      cam.aspect = w / h; cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const tmp = new THREE.Vector3();
    let raf = 0;
    const loop = () => {
      const s = sc.current!;
      if (s.fly) {
        // One continuous move: turn along the great circle while the height follows an ease
        // curve, rising a little in the middle for long hops (like Google Earth).
        const u = Math.min(1, (performance.now() - s.fly.t0) / FLY_MS), e = ease(u);
        const dir = new THREE.Vector3().copy(s.fly.d0).lerp(s.fly.d1, e).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(s.fly.d0, s.fly.d1);
        const dir2 = s.fly.d0.clone().applyQuaternion(new THREE.Quaternion().slerp(q, e));
        if (Number.isFinite(dir2.x)) dir.copy(dir2);
        const r = s.fly.r0 + (s.fly.r1 - s.fly.r0) * e + s.fly.bump * Math.sin(Math.PI * u);
        cam.position.copy(dir.multiplyScalar(r));
        cam.up.set(0, 1, 0);
        if (u >= 1) { const done = s.fly.done; s.fly = null; ctl.enabled = true; done?.(); }
      } else if (s.goal) {
        cam.position.lerp(s.goal, 0.08);
        if (cam.position.distanceTo(s.goal) < 0.002) s.goal = null;
      }
      // Near plane follows the altitude, so the surface stays sharp when close.
      const alt = cam.position.length() - R;
      // Marker dots keep about the same size on screen (sized for the whole-planet view).
      const k = Math.min(1, alt / 1.2);
      for (const d of dots) d.scale.setScalar(k);
      const near = Math.max(alt * 0.05, 1e-6);
      if (Math.abs(cam.near - near) / near > 0.2) { cam.near = near; cam.far = Math.max(10, alt * 50 + 10); cam.updateProjectionMatrix(); }
      // Slower turning when close to the surface.
      ctl.rotateSpeed = Math.min(0.5, Math.max(0.02, (cam.position.length() - R) * 0.6));
      ctl.update();
      r.render(scene, cam);
      // Labels: project; hide those on the far side.
      const w = el.clientWidth, h = el.clientHeight, camDir = cam.position.clone().normalize();
      for (const m of s.marks) {
        const facing = m.v.clone().normalize().dot(camDir) > 0.15;
        tmp.copy(m.v).project(cam);
        m.el.style.display = facing ? '' : 'none';
        if (facing) m.el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
      }
      // Gazetteer: choose which names show every few frames, place the shown ones every frame.
      if (frame++ % 4 === 0) {
        const next = new Set<(typeof names)[number]>();
        if (showNamesRef.current && !s.fly) {
          const minKm = 280 * alt;
          // In front of the horizon (seen from height d, the horizon is at cos = R / d), with a margin.
          const horizon = Math.min(0.999, R / cam.position.length() + 0.05);
          const cand = names.filter((x) => (x.n.kind !== 'feature' || (x.n.diameter_km ?? 0) >= minKm) && x.v.dot(camDir) > horizon);
          cand.sort((a, b) => (a.n.kind === 'feature' ? 1 : 0) - (b.n.kind === 'feature' ? 1 : 0) || (b.n.diameter_km ?? 0) - (a.n.diameter_km ?? 0));
          // Screen boxes of the marks and placed labels: skip a name that would overlap one.
          const boxes: [number, number, number, number][] = [];
          const free = (x0: number, y0: number, bw: number) => !boxes.some(([a, b, c, d]) => x0 < c && x0 + bw > a && y0 < d && y0 + 14 > b);
          for (const m of s.marks) if (m.el.style.display !== 'none') { const r0 = m.el.getBoundingClientRect(), rh = el.getBoundingClientRect(); boxes.push([r0.left - rh.left, r0.top - rh.top, r0.right - rh.left, r0.bottom - rh.top]); }
          for (const x of cand) {
            tmp.copy(x.v).project(cam);
            if (Math.abs(tmp.x) > 1 || Math.abs(tmp.y) > 1 || tmp.z > 1) continue;
            const px = ((tmp.x + 1) / 2) * w, py = ((1 - tmp.y) / 2) * h - 7, bw = 7 + x.n.name.length * 6.4;
            if (!free(px, py, bw)) continue;
            boxes.push([px, py, px + bw, py + 14]);
            next.add(x);
            if (next.size >= MAX_NAMES) break;
          }
        }
        for (const x of shown) if (!next.has(x) && x.el) x.el.style.display = 'none';
        shown = next;
      }
      for (const x of shown) {
        const lab = nameEl(x);
        tmp.copy(x.v).project(cam);
        lab.style.display = '';
        lab.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
      }
      // Close over the focus → hand over to the Jezero map.
      const d = cam.position.length();
      const over = camDir.dot(toVec(focus.lat, focus.lon).normalize()) > Math.cos((8 * Math.PI) / 180);
      if (!s.entered && d < ENTER_DISTANCE && over && !s.goal && !s.fly) { s.entered = true; flyRef.current(focus.lat, focus.lon, CLOSE, () => enter()); }
      if (d > ENTER_DISTANCE + 0.1) s.entered = false;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mm = m.material as THREE.Material | undefined;
        (mm as THREE.MeshStandardMaterial | undefined)?.map?.dispose();
        mm?.dispose();
      });
      r.dispose(); el.removeChild(r.domElement);
      if (labels.current) labels.current.innerHTML = '';
      sc.current = null;
    };
    // marks/lines/focus are fixed for a mounted globe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Texture (bundled, so it loads offline in the desktop app).
  useEffect(() => {
    const s = sc.current;
    if (!s) return;
    let live = true;
    new THREE.TextureLoader().load(`./data/globe/mars_${tex}.jpg`, (texture) => {
      if (!live || !sc.current) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      s.mat.map?.dispose();
      s.mat.map = texture;
      // A warm multiply brings back the red of the Viking colour mosaic (display only).
      s.mat.color.set(tex === 'viking' ? '#ffd2b8' : '#ffffff');
      s.mat.needsUpdate = true;
      setReady(true);
    }, undefined, () => live && setFailed(true));
    return () => { live = false; };
  }, [tex]);

  // Camera requests (view_globe tool, "go to Jezero").
  useEffect(() => {
    const s = sc.current;
    if (!s || !camera) return;
    s.entered = false;
    flyTo(camera.lat, camera.lon, camera.distance ?? 2.2);
  }, [camera?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTo = () => { const s = sc.current; if (s) { s.entered = true; flyTo(focus.lat, focus.lon, CLOSE, () => enter()); } };
  // Coming back from the map: start close (faded in) and pull back out to the whole planet.
  useEffect(() => {
    if (!startClose) return;
    const id = setTimeout(() => { setFading(null); flyTo(startClose.lat, startClose.lon, 2.6); }, 60);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`globe${fading === 'out' ? ' fade-out' : fading === 'in' ? ' fade-in' : ''}`}>
      <div ref={host} className="globe-canvas" />
      <div ref={labels} className="globe-labels" aria-hidden="true" />
      <div className="maplabel">{t('火星（全球）', 'Mars (whole planet)')}</div>
      {card && (
        <div className="globe-card" role="dialog" aria-label={card.name}>
          <button className="globe-card-x" onClick={() => setCard(null)} aria-label={t('閉じる', 'Close')}>×</button>
          <h4>{card.kind === 'landing' ? '▲ ' : card.kind === 'crewed' ? '◆ ' : ''}{card.name}</h4>
          <p className="muted">{card.kind === 'landing' ? t('着陸地点', 'Landing site') : card.kind === 'crewed' ? t('有人着陸の候補地', 'Crewed-landing candidate') : card.type}
            {card.diameter_km != null && <> · {t('大きさ', 'size')} {card.diameter_km >= 10 ? Math.round(card.diameter_km) : card.diameter_km.toFixed(1)} km</>}</p>
          <p>{card.origin}</p>
          <p className="muted">{Math.abs(card.lat).toFixed(2)}°{card.lat >= 0 ? 'N' : 'S'} {Math.abs(card.lon).toFixed(2)}°{card.lon >= 0 ? 'E' : 'W'}
            {card.link && <> · <a href={card.link} target="_blank" rel="noreferrer">{card.kind === 'crewed' ? 'NASA' : 'IAU/USGS'}</a></>}</p>
          <button className="primary" onClick={() => {
            const c = card; setCard(null);
            if (sc.current) sc.current.entered = true;
            const nearFocus = Math.abs(c.lat - focus.lat) < 0.5 && Math.abs(c.lon - focus.lon) < 0.5;
            flyTo(c.lat, c.lon, nearFocus ? CLOSE : CLOSE_FAR, () => enter(c.lat, c.lon));
          }}>{t('ここへ降りる', 'Fly down here')}</button>
        </div>
      )}
      <div className="globe-ctl" role="group" aria-label={t('全球の表示', 'Globe view')}>
        <button className={tex === 'viking' ? 'on' : ''} onClick={() => setTex('viking')}>{t('写真（Viking）', 'Photo (Viking)')}</button>
        <button className={tex === 'mola' ? 'on' : ''} onClick={() => setTex('mola')}>{t('高さ（MOLA）', 'Height (MOLA)')}</button>
        <button className={showNames ? 'on' : ''} onClick={() => setShowNames((x) => !x)} aria-pressed={showNames}>{t('地名', 'Names')}</button>
        <button className="primary" onClick={zoomTo}>{t('Jezero へ降りる', 'Fly down to Jezero')}</button>
      </div>
      {!ready && !failed && <div className="globe-msg">{t('火星の全球画像を読み込み中…', 'Loading the Mars mosaic…')}</div>}
      {failed && <div className="globe-msg warn">{t('全球画像を読み込めませんでした。2D の地図に戻って使えます。', 'Could not load the Mars mosaic. The 2D map still works.')}</div>}
      <div className="terrain3d-help">{t('ドラッグで回転・ホイールで拡大・クリックでその場所へ降りる', 'Drag to turn, wheel to zoom, click to fly down there')}</div>
      <div className="globe-credit">{tex === 'viking' ? 'Viking MDIM 2.1 (NASA/USGS)' : 'MGS MOLA shaded relief (NASA/GSFC)'} · NASA Solar System Treks</div>
    </div>
  );
}
