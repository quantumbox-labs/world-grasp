// The WALKBACK screen registers this controller while mounted; agent tools drive the screen
// through it (route, sliders, 3D camera, overlays, playback, evidence cards).
import type { Core, Waypoint } from '../core';
import type { WalkData } from './data';
import type { PlanParams } from './plan';
import type { Found } from './Rehearsal';
import type { WalkImport } from './gpx';

export interface Camera3D {
  lat?: number; lon?: number; distance_m?: number; heading_deg?: number; tilt_deg?: number;
}
export type EvidenceTopic = 'rover' | 'eva' | 'terrain' | 'consumables' | 'hokkaido_terrain';

export interface WalkController {
  core: Core;
  data(): Promise<WalkData>;
  route(): Waypoint[];
  params(): PlanParams;
  setRoute(r: Waypoint[]): void;
  setParams(p: Partial<PlanParams>): void;
  /** Search Hokkaido for the same walk (points from plan.rehearsalPoints) and show the panel. */
  runRehearsal(marsPts: Waypoint[]): Promise<Found[]>;
  selectRehearsal(i: number): void;
  set3d(on: boolean): void;
  setCamera(c: Camera3D & { exaggeration?: number }): void;
  setOverlay(o: { rover?: boolean; reach?: boolean }): void;
  /** B: colour Perseverance's path by whether a crew could walk home from there. */
  setRoverMode(on: boolean): void;
  /** Pan/zoom the 2D Jezero map. */
  flyTo(lat: number, lon: number, z: number): void;
  /** Whole-Mars globe on/off; cam turns it to a point (distance: 1 = surface, about 1.1–6). */
  setGlobe(on: boolean, cam?: { lat: number; lon: number; distance?: number }): void;
  /** A: load a GPX walk (text) and lay it onto Jezero; sets the route and the measured speed. */
  importWalk(text: string, file: string): Promise<WalkImport>;
  /** A: the bundled synthetic sample walk. */
  importSample(): Promise<WalkImport>;
  walk(): WalkImport | null;
  play(): void;
  stop(): void;
  openEvidence(topic: EvidenceTopic): void;
}

let current: WalkController | null = null;
const waiters: ((c: WalkController) => void)[] = [];

export function setWalkController(c: WalkController | null) {
  current = c;
  if (c) waiters.splice(0).forEach((fn) => fn(c));
}

/** The mounted screen's controller, or null when the WALKBACK screen is not open. */
export function currentWalkController(): WalkController | null { return current; }

/** The mounted WALKBACK screen's controller, or null; never changes the tab (for the astronaut view). */
export const peekWalkController = () => current;

/** The mounted screen's controller; opens the WALKBACK tab and waits for it if needed. */
export function walkController(timeoutMs = 15000): Promise<WalkController> {
  if (typeof location !== 'undefined' && !/^#(walk|mars)/.test(location.hash)) location.hash = '#walk';
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WALKBACK screen did not open')), timeoutMs);
    waiters.push((c) => { clearTimeout(t); resolve(c); });
  });
}

/** Let React render the last state change before reading the screen again. */
export const nextFrame = () => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), 30));
