// 3D terrain view: an elevation grid as a lit mesh with the route, rover path, walk-home area and
// walker draped on it. Everything comes from bundled data, so it works offline.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Reach } from '../core';
import type { GridData } from '../walk/data';
import { useT } from '../i18n';

export interface Line3D { pts: [number, number][]; color: string; width: number; opacity?: number }
export interface Point3D { lat: number; lon: number; color: string; size: number }
/**
 * Camera request (agent view_3d tool). heading: direction the camera looks, degrees clockwise from
 * north. tilt: how far it looks down from the horizon (90 = straight down). A new seq re-applies it.
 */
/** A sharper image for part of the grid (e.g. HiRISE tiles around the walker), draped over the base surface. */
export interface Patch3D { image: HTMLCanvasElement; north: number; south: number; west: number; east: number }
export interface Camera3D {
  target?: { lat: number; lon: number }; distance?: number; heading?: number; tilt?: number; seq: number;
  /** First person: stand at lat/lon, eyes heightM above the ground, look along heading, pitch degrees up (negative = down). */
  eye?: { lat: number; lon: number; heightM: number; pitch: number };
}
/** A flat translucent band draped on the terrain (e.g. the route as an AR bar). */
/** Sky for eye-level views: sun direction (deg; az clockwise from north) drives colours, light and stars. */
export interface Sky3D { sunAz: number; sunEl: number }
export interface Ribbon3D { pts: [number, number][]; color: string; widthM: number; opacity: number }
/** A translucent vertical pillar standing on the terrain (e.g. the base, seen from far away). */
export interface Beacon3D { lat: number; lon: number; color: string; heightM: number; radiusM: number }

interface Props {
  grid: GridData;
  radiusKm: number;
  /** Colour ramp: Mars ochre or Earth green/brown. */
  palette: 'mars' | 'earth';
  lines?: Line3D[];
  points?: Point3D[];
  reach?: Reach | null;
  walker?: [number, number] | null;
  /** [[south, west], [north, east]] the camera frames first. */
  focus?: [[number, number], [number, number]] | null;
  label?: string;
  /** Surface photo covering exactly the grid's extent (e.g. web/public/data/jezero_ortho.jpg). */
  photo?: string;
  camera?: Camera3D | null;
  /** Height exaggeration set from outside (the ×1/×2/×4 buttons still work). */
  exaggeration?: number;
  /** Optional sharper image over part of the grid; drawn on top of the base surface. */
  patch?: Patch3D | null;
  ribbons?: Ribbon3D[];
  beacons?: Beacon3D[];
  /** Camera near plane in metres (default: a 2000th of the grid; set ~0.5 for eye-level views). */
  near?: number;
  sky?: Sky3D | null;
}

const MAX_SIDE = 720; // the Jezero grid (700 × 467) at full resolution

/** Bilinear elevation at lat/lon; nulls fall back to the grid minimum. */
function sampler(g: GridData) {
  let min = Infinity;
  for (const v of g.z) if (v != null && v < min) min = v;
  if (!isFinite(min)) min = 0;
  const at = (r: number, c: number) => {
    const v = g.z[Math.max(0, Math.min(g.rows - 1, r)) * g.cols + Math.max(0, Math.min(g.cols - 1, c))];
    return v ?? min;
  };
  return {
    min,
    z(lat: number, lon: number) {
      const fr = (g.lat0 - lat) / g.dlat, fc = (lon - g.lon0) / g.dlon;
      const r = Math.floor(fr), c = Math.floor(fc), dr = fr - r, dc = fc - c;
      return at(r, c) * (1 - dr) * (1 - dc) + at(r, c + 1) * (1 - dr) * dc + at(r + 1, c) * dr * (1 - dc) + at(r + 1, c + 1) * dr * dc;
    },
  };
}

function ramp(t: number, palette: 'mars' | 'earth'): [number, number, number] {
  const stops: [number, [number, number, number]][] = palette === 'mars'
    ? [[0, [70, 40, 32]], [0.35, [140, 78, 50]], [0.7, [196, 128, 82]], [1, [236, 200, 160]]]
    : [[0, [46, 92, 60]], [0.4, [104, 140, 76]], [0.75, [168, 150, 104]], [1, [235, 232, 225]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (t - t0) / (t1 - t0 || 1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

/** Elevation colours with the walk-home area painted over them, one pixel per grid cell. */
/** The surface photo with the walk-home area tinted over it (one reach cell per grid cell). */
function photoTexture(g: GridData, img: HTMLImageElement, reach: Reach | null | undefined) {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (reach && reach.rows === g.rows && reach.cols === g.cols) {
    const rc = document.createElement('canvas');
    rc.width = g.cols; rc.height = g.rows;
    const rctx = rc.getContext('2d')!, im = rctx.createImageData(g.cols, g.rows);
    for (let i = 0; i < reach.ratio.length; i++) {
      const q = reach.ratio[i];
      if (q == null || q > 1) continue;
      const o = i * 4;
      // Over the photo: a light green tint inside, a thin yellow band at the limit.
      if (q > 0.94) { im.data[o] = 255; im.data[o + 1] = 214; im.data[o + 2] = 102; im.data[o + 3] = 150; }
      else { im.data[o] = 120; im.data[o + 1] = 220; im.data[o + 2] = 80; im.data[o + 3] = 26; }
    }
    rctx.putImageData(im, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rc, 0, 0, cv.width, cv.height);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function texture(g: GridData, palette: 'mars' | 'earth', reach: Reach | null | undefined) {
  const cv = document.createElement('canvas');
  cv.width = g.cols; cv.height = g.rows;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(g.cols, g.rows);
  let lo = Infinity, hi = -Infinity;
  for (const v of g.z) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const useReach = reach && reach.rows === g.rows && reach.cols === g.cols;
  for (let i = 0; i < g.z.length; i++) {
    const v = g.z[i], o = i * 4;
    let [r, gg, b] = v == null ? [90, 90, 90] : ramp((v - lo) / (hi - lo || 1), palette);
    const q = useReach ? reach!.ratio[i] : null;
    if (q != null && q <= 1) {
      const [cr, cg, cb, a] = q > 0.85 ? [255, 214, 102, 0.8] : [82, 196, 26, 0.28];
      r = r * (1 - a) + cr * a; gg = gg * (1 - a) + cg * a; b = b * (1 - a) + cb * a;
    }
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Ribbon texture: a soft band with forward-pointing chevrons (repeats along the ribbon). */
function chevrons() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.12, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.88, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(14, 22); ctx.lineTo(32, 6); ctx.lineTo(50, 22); ctx.stroke(); // v = up the ribbon = forward
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 0.25);
  return t;
}

export function Terrain3D({ grid, radiusKm, palette, lines = [], points = [], reach, walker, focus, label, camera, exaggeration, photo, patch, ribbons, beacons, near, sky }: Props) {
  const t = useT();
  // Surface photo (when given) or the elevation colours; the photo loads once and stays.
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [usePhoto, setUsePhoto] = useState(true);
  useEffect(() => {
    if (!photo) return;
    let live = true;
    const im = new Image();
    im.onload = () => live && setImg(im);
    im.src = photo;
    return () => { live = false; };
  }, [photo]);
  const surface = () => (img && usePhoto ? photoTexture(grid, img, reach) : texture(grid, palette, reach));
  const host = useRef<HTMLDivElement>(null);
  const [exag, setExag] = useState(exaggeration ?? (palette === 'mars' ? 2 : 1.5));
  useEffect(() => { if (exaggeration != null) setExag(exaggeration); }, [exaggeration]);
  const scene = useRef<{
    r: THREE.WebGLRenderer; s: THREE.Scene; cam: THREE.PerspectiveCamera; ctl: OrbitControls;
    project: (lat: number, lon: number, lift?: number) => THREE.Vector3; overlay: THREE.Group; walker: THREE.Mesh;
    terrain: THREE.Mesh; mats: LineMaterial[]; hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; span: number;
    goal: { pos: THREE.Vector3; target: THREE.Vector3; k?: number } | null;
  } | null>(null);

  // Terrain mesh + renderer: rebuilt when the grid or the height scale changes.
  useEffect(() => {
    const el = host.current!;
    const g = grid, smp = sampler(g);
    const k = (Math.PI / 180) * radiusKm * 1000;
    const latC = g.lat0 - (g.rows / 2) * g.dlat, lonC = g.lon0 + (g.cols / 2) * g.dlon;
    const cosC = Math.cos((latC * Math.PI) / 180);
    const project = (lat: number, lon: number, lift = 0) =>
      new THREE.Vector3((lon - lonC) * k * cosC, (smp.z(lat, lon) - smp.min) * exag + lift, -(lat - latC) * k);

    const step = Math.max(1, Math.ceil(Math.max(g.rows, g.cols) / MAX_SIDE));
    const nr = Math.floor((g.rows - 1) / step) + 1, nc = Math.floor((g.cols - 1) / step) + 1;
    const pos = new Float32Array(nr * nc * 3), uv = new Float32Array(nr * nc * 2);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const r = i * step, c = j * step, n = i * nc + j;
      const lat = g.lat0 - r * g.dlat, lon = g.lon0 + c * g.dlon;
      const v = g.z[r * g.cols + c] ?? smp.min;
      pos[n * 3] = (lon - lonC) * k * cosC; pos[n * 3 + 1] = (v - smp.min) * exag; pos[n * 3 + 2] = -(lat - latC) * k;
      uv[n * 2] = (c + 0.5) / g.cols; uv[n * 2 + 1] = 1 - (r + 0.5) / g.rows;
    }
    const idx: number[] = [];
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: surface(), roughness: 0.95, metalness: 0 });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.castShadow = true;
    terrain.receiveShadow = true;

    const s = new THREE.Scene();
    const span0 = Math.max(g.cols * g.dlon * k * cosC, g.rows * g.dlat * k);
    // Mars: no solid sky colour; the canvas is transparent over a butterscotch sky gradient (CSS),
    // and a matching haze fades distant ground. Earth keeps a plain dark background.
    if (palette === 'mars') s.fog = new THREE.Fog('#c9926a', span0 * 0.25, span0 * 1.6);
    else s.background = new THREE.Color('#0f1a24');
    s.add(terrain);
    const hemi = new THREE.HemisphereLight(palette === 'mars' ? '#ffd9c2' : '#dfefff', '#2a1a14', palette === 'mars' ? 0.55 : 0.9);
    s.add(hemi);
    // Low afternoon sun from the west-north-west: long shadows make the relief stand out.
    const sun = new THREE.DirectionalLight(palette === 'mars' ? '#fff1e0' : '#ffffff', palette === 'mars' ? 2.8 : 2.2);
    sun.position.set(-1, palette === 'mars' ? 0.42 : 1.1, -0.45).normalize().multiplyScalar(span0 * 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc0 = sun.shadow.camera as THREE.OrthographicCamera;
    sc0.left = -span0 * 0.75; sc0.right = span0 * 0.75; sc0.top = span0 * 0.75; sc0.bottom = -span0 * 0.75;
    sc0.near = span0 * 0.1; sc0.far = span0 * 3;
    sun.shadow.bias = -0.0005;
    s.add(sun);
    const overlay = new THREE.Group();
    s.add(overlay);
    const span = Math.max(g.cols * g.dlon * k * cosC, g.rows * g.dlat * k);
    const walkerMesh = new THREE.Mesh(new THREE.SphereGeometry(span / 220, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff7a45' }));
    walkerMesh.visible = false;
    s.add(walkerMesh);

    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: palette === 'mars' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(r.domElement);
    const cam = new THREE.PerspectiveCamera(near ? 60 : 45, 1, near ?? span / 2000, span * 10);
    const ctl = new OrbitControls(cam, r.domElement);
    ctl.enableDamping = true;
    ctl.maxPolarAngle = Math.PI * 0.49;

    // Frame the focus box (or the whole grid) from the south-west, looking down ~40°.
    const [[s0, w0], [n0, e0]] = focus ?? [[g.lat0 - g.rows * g.dlat, g.lon0], [g.lat0, g.lon0 + g.cols * g.dlon]];
    const target = project((s0 + n0) / 2, (w0 + e0) / 2);
    const fspan = Math.max(span / 12, (e0 - w0) * k * cosC, (n0 - s0) * k);
    ctl.target.copy(target);
    cam.position.copy(target).add(new THREE.Vector3(-0.55, 0.75, 0.9).normalize().multiplyScalar(fspan * 1.5));

    const mats: LineMaterial[] = [];
    scene.current = { r, s, cam, ctl, project, overlay, walker: walkerMesh, terrain, mats, goal: null, hemi, sun, span: span0 };
    ctl.addEventListener('start', () => { if (scene.current) scene.current.goal = null; }); // the user takes over

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      r.setSize(w, h, false);
      r.domElement.style.width = '100%'; r.domElement.style.height = '100%';
      cam.aspect = w / h; cam.updateProjectionMatrix();
      for (const m of scene.current?.mats ?? []) m.resolution.set(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = () => {
      const goal = scene.current?.goal;
      if (goal) { // ease towards a camera request
        cam.position.lerp(goal.pos, goal.k ?? 0.12); ctl.target.lerp(goal.target, goal.k ?? 0.12);
        if (cam.position.distanceTo(goal.pos) < span / 5000) { cam.position.copy(goal.pos); ctl.target.copy(goal.target); scene.current!.goal = null; }
      }
      ctl.update(); r.render(s, cam); raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose();
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((x) => { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); });
      });
      r.dispose(); el.removeChild(r.domElement);
      scene.current = null;
    };
    // focus is only used for the first framing; re-framing on every route edit would be jarring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, radiusKm, palette, exag]);

  // Sharper patch: a piece of the terrain mesh over the patch bounds, textured with the patch image,
  // drawn just in front of the base surface (polygon offset) so it covers it without z-fighting.
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !patch) return;
    const g = grid;
    const r0 = Math.max(0, Math.floor((g.lat0 - patch.north) / g.dlat)), r1 = Math.min(g.rows - 1, Math.ceil((g.lat0 - patch.south) / g.dlat));
    const c0 = Math.max(0, Math.floor((patch.west - g.lon0) / g.dlon)), c1 = Math.min(g.cols - 1, Math.ceil((patch.east - g.lon0) / g.dlon));
    if (r1 <= r0 || c1 <= c0) return;
    const nr = r1 - r0 + 1, nc = c1 - c0 + 1;
    const pos = new Float32Array(nr * nc * 3), uv = new Float32Array(nr * nc * 2);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const lat = g.lat0 - (r0 + i) * g.dlat, lon = g.lon0 + (c0 + j) * g.dlon, n = i * nc + j;
      sc.project(lat, lon).toArray(pos, n * 3);
      uv[n * 2] = (lon - patch.west) / (patch.east - patch.west);
      uv[n * 2 + 1] = (lat - patch.south) / (patch.north - patch.south);
    }
    const idx: number[] = [];
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
      const a = i * nc + j, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(patch.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = sc.r.capabilities.getMaxAnisotropy();
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    // The same image as a bump map: brightness → small relief, so ripples and rocks catch the low sun.
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.5, roughness: 0.95, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    sc.s.add(mesh);
    return () => { sc.s.remove(mesh); geo.dispose(); tex.dispose(); mat.dispose(); };
  }, [patch, grid, exag]);

  // Ribbons (flat bands on the ground, subdivided every ~5 m so they follow the relief) and beacons.
  useEffect(() => {
    const sc = scene.current;
    if (!sc || (!ribbons?.length && !beacons?.length)) return;
    const group = new THREE.Group();
    const k = (Math.PI / 180) * radiusKm * 1000;
    for (const rb of ribbons ?? []) {
      if (rb.pts.length < 2) continue;
      const pts: [number, number][] = [];
      for (let i = 0; i + 1 < rb.pts.length; i++) {
        const [a0, o0] = rb.pts[i], [a1, o1] = rb.pts[i + 1];
        const m = Math.hypot((a1 - a0) * k, (o1 - o0) * k * Math.cos(a0 * Math.PI / 180));
        const n = Math.max(1, Math.ceil(m / 5));
        for (let j = 0; j < n; j++) pts.push([a0 + (a1 - a0) * j / n, o0 + (o1 - o0) * j / n]);
      }
      pts.push(rb.pts[rb.pts.length - 1]);
      const c = pts.map(([la, lo]) => sc.project(la, lo, 0.5));
      const pos = new Float32Array(c.length * 6), uv = new Float32Array(c.length * 4);
      let dist = 0;
      for (let i = 0; i < c.length; i++) {
        const d = c[Math.min(c.length - 1, i + 1)].clone().sub(c[Math.max(0, i - 1)]);
        const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(rb.widthM / 2);
        if (i) dist += c[i].distanceTo(c[i - 1]);
        c[i].clone().add(side).toArray(pos, i * 6); c[i].clone().sub(side).toArray(pos, i * 6 + 3);
        uv.set([0, dist / rb.widthM, 1, dist / rb.widthM], i * 4);
      }
      const idx: number[] = [];
      for (let i = 0; i + 1 < c.length; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ color: rb.color, transparent: true, opacity: rb.opacity, depthWrite: false, side: THREE.DoubleSide,
        map: chevrons(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 10; // after the see-through ground patch, which would otherwise paint over it
      group.add(mesh);
    }
    for (const b of beacons ?? []) {
      const geo = new THREE.CylinderGeometry(b.radiusM, b.radiusM, b.heightM, 24, 1, true);
      const mat = new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(sc.project(b.lat, b.lon, b.heightM / 2));
      m.renderOrder = 11;
      group.add(m);
    }
    sc.s.add(group);
    return () => {
      sc.s.remove(group);
      group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mm = m.material as THREE.MeshBasicMaterial | undefined; mm?.map?.dispose(); mm?.dispose(); });
    };
  }, [ribbons, beacons, grid, exag, radiusKm]);

  // Sky: day = dusty butterscotch, darker overhead; around sunrise/sunset a blue glow near the sun;
  // night = near black with stars. Light on the ground and the haze follow.
  const [skyBg, setSkyBg] = useState<string | null>(null);
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !sky) { setSkyBg(null); return; }
    const el = sky.sunEl, az = (sky.sunAz * Math.PI) / 180, e = (Math.max(-10, el) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e));
    const day = Math.max(0, Math.min(1, (el + 2) / 14)), night = Math.max(0, Math.min(1, (-el - 2) / 8));
    sc.sun.position.copy(dir.clone().multiplyScalar(sc.span * 1.2));
    sc.sun.intensity = 0.15 + 2.6 * day;
    sc.hemi.intensity = 0.12 + 0.45 * day;
    const fog = new THREE.Color().lerpColors(new THREE.Color('#3a3f55'), new THREE.Color('#b98462'), day).lerp(new THREE.Color('#07070b'), night);
    sc.s.fog = new THREE.Fog(fog, 400, sc.span * (0.35 + 0.5 * day));
    const sunX = 50 + (((sky.sunAz - 180) / 2) % 50), sunY = 70 - Math.max(-10, el) * 1.2;
    setSkyBg(night > 0.6
      ? 'linear-gradient(#000 0%, #03040a 55%, #0c0a0c 100%)'
      : day > 0.6
        ? 'linear-gradient(#2b1d18 0%, #6e4632 28%, #b07a58 58%, #c9926a 100%)'
        : `radial-gradient(circle at ${sunX}% ${sunY}%, rgba(150,190,255,.9) 0%, rgba(90,120,190,.55) 12%, transparent 35%), linear-gradient(#07080f 0%, #1c1f2e 45%, #4a4650 75%, #7a6050 100%)`);
    const g = new THREE.Group();
    if (night > 0.05) { // stars: a few hundred points on a far sphere, no fog
      const n = 600, pos = new Float32Array(n * 3);
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // same stars every time
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 * Math.PI, v = Math.acos(rnd() * 1.9 - 0.9), r = sc.span * 6;
        pos.set([r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.9 * night, fog: false, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.onBeforeRender = () => { pts.position.copy(sc.cam.position); mat.opacity = night * (0.75 + 0.2 * Math.sin(performance.now() / 700)); };
      g.add(pts);
    }
    if (el > -4) { // sun disc (about 2/3 of the Sun seen from Earth) with a small glow
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const ctx = cv.getContext('2d')!, gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,245,1)'); gr.addColorStop(0.12, 'rgba(255,250,235,1)'); gr.addColorStop(0.16, day > 0.6 ? 'rgba(255,230,200,.35)' : 'rgba(170,200,255,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), fog: false, depthWrite: false, transparent: true }));
      const d = sc.span * 5, size = d * Math.tan((0.35 * Math.PI) / 180) * 6.5;
      sp.scale.set(size, size, 1);
      sp.onBeforeRender = () => sp.position.copy(sc.cam.position).add(dir.clone().multiplyScalar(d));
      g.add(sp);
    }
    sc.s.add(g);
    return () => {
      sc.s.remove(g);
      g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mm = m.material as THREE.SpriteMaterial | undefined; mm?.map?.dispose(); mm?.dispose(); });
    };
  }, [sky?.sunAz, sky?.sunEl, grid, exag]); // eslint-disable-line react-hooks/exhaustive-deps

  // Walk-home area: repaint the terrain texture.
  useEffect(() => {
    const sc = scene.current;
    if (!sc) return;
    const m = sc.terrain.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.map = surface();
    m.needsUpdate = true;
  }, [reach, grid, palette, exag, img, usePhoto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lines and points draped on the terrain.
  useEffect(() => {
    const sc = scene.current;
    if (!sc) return;
    sc.overlay.children.slice().forEach((o) => { sc.overlay.remove(o); (o as THREE.Mesh).geometry?.dispose(); });
    sc.mats.length = 0;
    const w = host.current?.clientWidth || 1, h = host.current?.clientHeight || 1;
    const lift = 4 * exag;
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      const g = new LineGeometry();
      g.setPositions(l.pts.flatMap(([la, lo]) => sc.project(la, lo, lift).toArray()));
      const m = new LineMaterial({ color: l.color, linewidth: l.width, transparent: (l.opacity ?? 1) < 1, opacity: l.opacity ?? 1, depthTest: true });
      m.resolution.set(w, h);
      sc.mats.push(m);
      sc.overlay.add(new Line2(g, m));
    }
    const span = (sc.cam.far / 10);
    for (const p of points) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(span / 1100 * p.size, 16, 12), new THREE.MeshBasicMaterial({ color: p.color }));
      mesh.position.copy(sc.project(p.lat, p.lon, lift * 2));
      sc.overlay.add(mesh);
    }
  }, [lines, points, exag, grid]);

  // Camera requests: look at target from distance, heading and tilt (missing parts keep the current view).
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !camera) return;
    if (camera.eye) {
      const e = camera.eye, hr = (camera.heading ?? 0) * Math.PI / 180, pr = e.pitch * Math.PI / 180;
      const pos = sc.project(e.lat, e.lon, e.heightM);
      const dir = new THREE.Vector3(Math.sin(hr) * Math.cos(pr), Math.sin(pr), -Math.cos(hr) * Math.cos(pr));
      sc.goal = { pos, target: pos.clone().add(dir.multiplyScalar(30)), k: 0.3 }; // eye level: keep up with the walker
      return;
    }
    const target = camera.target ? sc.project(camera.target.lat, camera.target.lon) : sc.ctl.target.clone();
    const off = sc.cam.position.clone().sub(sc.ctl.target);
    const dist = camera.distance ?? off.length();
    const curHeading = Math.atan2(-off.x, off.z) * 180 / Math.PI;
    const curTilt = Math.asin(Math.max(-1, Math.min(1, off.y / (off.length() || 1)))) * 180 / Math.PI;
    const h = ((camera.heading ?? curHeading) * Math.PI) / 180;
    const t = (Math.max(5, Math.min(89, camera.tilt ?? curTilt)) * Math.PI) / 180;
    const pos = target.clone().add(new THREE.Vector3(-Math.sin(h) * Math.cos(t), Math.sin(t), Math.cos(h) * Math.cos(t)).multiplyScalar(dist));
    sc.goal = { pos, target };
  }, [camera?.seq, exag, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sc = scene.current;
    if (!sc) return;
    sc.walker.visible = !!walker;
    if (walker) sc.walker.position.copy(sc.project(walker[0], walker[1], 12 * exag));
  }, [walker, exag]);

  return (
    <div className={`terrain3d ${palette}`}>
      <div ref={host} className="terrain3d-canvas" style={skyBg ? { background: skyBg } : undefined} />
      {label && <div className="maplabel">{label}</div>}
      <div className="terrain3d-ctl" role="group" aria-label={t('表示', 'Display')}>
        {photo && (
          <>
            <button className={img && usePhoto ? 'on' : ''} onClick={() => setUsePhoto(true)} disabled={!img}>{t('写真', 'Photo')}</button>
            <button className={!usePhoto || !img ? 'on' : ''} onClick={() => setUsePhoto(false)}>{t('高さの色', 'Height colours')}</button>
          </>
        )}
        <span>{t('高さ', 'Height')}</span>
        {[1, 2, 4].map((x) => (
          <button key={x} className={x === exag ? 'on' : ''} onClick={() => setExag(x)}>×{x}</button>
        ))}
      </div>
      <div className="terrain3d-help">{t('ドラッグで回転・右ドラッグで移動・ホイールで拡大', 'Drag to rotate, right-drag to pan, wheel to zoom')}</div>
    </div>
  );
}
