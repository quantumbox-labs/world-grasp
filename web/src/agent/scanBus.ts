// Defaults of the #target view and the bus the view_scan tool (agent/explore.ts) uses to drive it.
// Kept apart from explore.ts so the view does not pull in duckdb-wasm.
export const DEFAULT_TARGET = 'jezero';
export const DEFAULT_TEST = 'walk';

export interface ScanViewRequest { target?: string; test?: string; mode?: 'scan' | 'sites'; focus?: { lat: number; lon: number }; seq: number }
type Listener = (r: ScanViewRequest) => void;
const listeners = new Set<Listener>();
let pending: ScanViewRequest | null = null;

export const scanViewBus = {
  /** Subscribe; a request sent before the view mounted is delivered right away. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    if (pending) { const p = pending; pending = null; fn(p); }
    return () => { listeners.delete(fn); };
  },
  emit(r: Omit<ScanViewRequest, 'seq'>) {
    const req = { ...r, seq: Date.now() };
    if (listeners.size) listeners.forEach((fn) => fn(req)); else pending = req;
  },
};

