// pi-rs in the browser: the pi-rs agent session runs as WASM
// (web/public/pirs-browser/pkg, built from quantum-box/pi-rs#238 plus page tools) and the model
// runs on the GPU in a worker (Qwen3 via WebGPU, web/public/pirs-browser/model-worker.mjs).
// pi-rs decides when to call our tools and calls them back here; numbers still come only from
// tool results. Nothing leaves the browser except the one-time model download.
import { callTool } from './port';
import { getLang } from '../i18n';
import { NoModelError } from './pirs';
import { getSettings, onSettings } from '../settings';
import type { AgentEvent, AgentPort, ToolDef } from './types';

const BASE = '/pirs-browser/';
const GATEWAY = '/pirs-browser/gateway'; // never reaches the network: answered by the worker below
const SESSION_KEY = 'walkback-pirs-web-v1';

const SYSTEM = `あなたは WALKBACK（火星の船外活動で歩いて帰れるかを判定するアプリ）の相棒。
質問には必ず先にツールを1つ呼ぶ。帰れるか・距離・酸素の質問は walkback_check（「Nkm先」は route={"away_km":N}、酸素N時間は o2_h=N）。ローバーが壊れたら rover_walkback。根拠は open_evidence。北海道のどこで訓練するかは explore_hokkaido。件数や距離の集計は query_nasa に SELECT を1つ（Perseverance の走行距離は rover_traverse 表、船外活動は eva 表）。表が分からなければ list_nasa_tables、1列の集計は summarize_nasa、比較は compare_nasa。
ツールの引数は質問に書かれた条件だけを入れる（書かれていなければ {} のまま。数値を勝手に決めない）。
答えの数字はツールの結果に書かれた数字だけをそのまま使う。自分で計算しない。短く答える。`;

/** Model per device. Qwen3 4B picked the right tool on all 3 test questions, 1.7B on 2, so 4B
 * wherever it fits; the settings screen (inAppModel) overrides.
 *   no WebGPU, or no 16-bit float shaders (shader-f16) → none (the panel keeps the rules version)
 *   phone / tablet, under 8 GB of memory, or GPU buffers under 1 GB → 1.7B (~1 GB download)
 *   otherwise → 4B (~2.5 GB download, ~3.4 GB of GPU memory) */
const SIZES = ['0.6b', '1.7b', '4b', '8b'];
export const DOWNLOAD: Record<string, string> = { '0.6b': '0.5GB', '1.7b': '1GB', '4b': '2.5GB', '8b': '5GB' };
export function pickModel(d: { webgpu: boolean; f16: boolean; mobile: boolean; memoryGB?: number; maxBufferGB: number; override?: string | null }): string | null {
  if (d.override && SIZES.includes(d.override)) return d.override;
  if (!d.webgpu || !d.f16) return null;
  if (d.mobile || (d.memoryGB !== undefined && d.memoryGB < 8) || d.maxBufferGB < 1) return '1.7b';
  return '4b';
}
let chosen: string | null = null;
/** What this device would get on 'automatic' (null: it cannot run the in-app AI). */
export let autoModel: string | null = null;
let deviceOk = false;
const modelSize = () => chosen ?? '1.7b';
const settingModel = () => { const m = getSettings().inAppModel; return m === 'auto' ? null : m; };
// A change on the settings screen applies from the next question (each question opens a new session).
onSettings(() => { if (deviceOk) chosen = settingModel() ?? autoModel; });
async function detectModel(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string>; limits: { maxBufferSize: number } } | null> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const d = {
    webgpu: !!adapter,
    f16: !!adapter?.features.has('shader-f16'),
    mobile: nav.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
    memoryGB: nav.deviceMemory,
    maxBufferGB: (adapter?.limits.maxBufferSize ?? 0) / 2 ** 30,
  };
  autoModel = pickModel(d);
  deviceOk = !!autoModel;
  return autoModel && (settingModel() ?? autoModel);
}

let worker: Worker | null = null;
let onProgress: ((pct: number) => void) | null = null;
/** The model is already stored in this browser (reported by the worker before it loads). */
let cachedModel: boolean | null = null;
let onCached: ((cached: boolean) => void) | null = null;
function runModel(body: { messages: unknown[]; tools: unknown[] }): Promise<{ text: string; calls: unknown[] }> {
  if (!worker) {
    // Ask the browser to keep stored data (the model) instead of evicting it under pressure.
    navigator.storage?.persist?.().catch(() => undefined);
    worker = new Worker(`${BASE}model-worker.mjs?v=8`, { type: 'module' });
  }
  const w = worker;
  return new Promise((resolve, reject) => {
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.progress);
      else if (data.type === 'cache') { cachedModel = !!data.cached; console.debug('[in-app AI] stored model', cachedModel); onCached?.(cachedModel); }
      else if (data.type === 'result') { console.debug('[pi-rs web] model output', data.raw); resolve({ text: data.text, calls: data.calls }); }
      else if (data.type === 'error') reject(new Error(data.message));
    };
    w.postMessage({ model: modelSize(), messages: body.messages, tools: body.tools });
  });
}

// pi-rs talks to its model over fetch; answer that one URL from the GPU worker.
let fetchHooked = false;
function hookFetch() {
  if (fetchHooked) return;
  fetchHooked = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith(GATEWAY)) return real(input, init);
    try {
      // pi-rs streams the request body, so read it whole whatever its form.
      const raw = init?.body != null ? await new Response(init.body).text() : input instanceof Request ? await input.text() : '{}';
      const req = JSON.parse(raw || '{}');
      const out = await runModel({ messages: req.messages ?? [], tools: req.tools ?? [] });
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: lastError }), { status: 500 });
    }
  };
}
let lastError = '';

// The tool callback reports into whichever question is being answered.
let emit: ((e: AgentEvent) => void) | null = null;
let question = '';
let n = 0;

/** Drop numeric arguments the question never mentioned. A small model tends to fill in conditions
 * (speed, oxygen hours…) on its own; only the person's numbers may change the calculation. */
export function keepAskedNumbers(args: unknown, q: string): unknown {
  const said = new Set((q.normalize('NFKC').match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const num = typeof x === 'number' ? x : typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : null;
        if (num !== null && !said.has(num)) continue;
        out[k] = num !== null ? num : walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(args);
}
async function pageTool(name: string, argsJson: string): Promise<{ ok: boolean; text: string }> {
  let args: unknown = {};
  try { args = JSON.parse(argsJson || '{}'); } catch { return { ok: false, text: `arguments are not JSON: ${argsJson}` }; }
  args = keepAskedNumbers(args, question);
  const { ok, result } = await callTool(name, args, emit ?? undefined, `pw${Date.now().toString(36)}${n++}`);
  const src = result.sources?.length ? `\n出典 / sources: ${result.sources.map((s) => s.label).join('; ')}` : '';
  return { ok, text: result.text + src };
}

interface Session { prompt(text: string): Promise<unknown>; cancel(): void; messages(): string; close(): Promise<void>; free(): void }
let session: Promise<Session> | null = null;
let sessionTools = '';
async function getSession(tools: ToolDef[], fresh = false): Promise<Session> {
  const specs = JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters })));
  if (session && specs === sessionTools && !fresh) return session;
  if (session) { const old = await session.catch(() => null); if (old) { await old.close().catch(() => undefined); old.free(); } }
  sessionTools = specs;
  // One question, one conversation: a small model answers worse with old turns (and failed ones) in view.
  if (fresh) { try { localStorage.removeItem(`pi-rs:session:${SESSION_KEY}`); } catch { /* storage off */ } }
  hookFetch();
  session = (async () => {
    const mod = await import(/* @vite-ignore */ `${BASE}pkg/pi_rs_browser_sdk.js`);
    await mod.default();
    return mod.BrowserSession.open_with_tools(SESSION_KEY, location.origin + GATEWAY, `qwen3-${modelSize()}`, '', 600000, SYSTEM, specs, pageTool) as Promise<Session>;
  })();
  session.catch(() => { session = null; });
  return session;
}

export const pirsWebAgent: AgentPort = {
  id: 'pi-rs-web',
  get label() {
    return getLang() === 'ja' ? 'アプリ内AI' : 'In-app AI';
  },
  async available() {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    // The desktop app has its own in-app AI (Rust pi-rs); offer one, not two with the same name.
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return false;
    chosen = await detectModel().catch(() => null);
    if (!chosen) return false;
    return fetch(`${BASE}pkg/pi_rs_browser_sdk.js`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  },
  async ask(prompt: string, tools: ToolDef[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
    // A small model does better with fewer tools: the compute tools only.
    const use = tools.filter((t) => t.kind === 'compute');
    let s: Session;
    try { s = await getSession(use, true); } catch (e) { throw new NoModelError(e instanceof Error ? e.message : String(e)); }
    emit = onEvent;
    question = prompt;
    lastError = '';
    let shown = -1;
    // Stored in this browser: say so and do not show download progress (it is read from storage).
    const savedText = () => (getLang() === 'ja' ? 'アプリ内AI: 保存済み・読み込み中…' : 'In-app AI: stored on this device, loading…');
    onCached = (c) => { if (c) onEvent({ type: 'status', text: savedText() }); };
    onProgress = (pct) => {
      if (cachedModel) return;
      const p = Math.min(100, Math.floor(pct / 5) * 5);
      if (p === shown) return;
      shown = p;
      onEvent({ type: 'status', text: getLang() === 'ja'
        ? `アプリ内AIをダウンロード中… ${p}%（初回だけ約${DOWNLOAD[modelSize()]}。次からは保存済みのものを使います）`
        : `Downloading the in-app AI… ${p}% (about ${DOWNLOAD[modelSize()]} the first time only; stored for next time)` });
    };
    const before = (JSON.parse(s.messages()) as unknown[]).length;
    const stop = () => s.cancel();
    signal?.addEventListener('abort', stop);
    try {
      await s.prompt(prompt);
      const msgs = (JSON.parse(s.messages()) as { role: string; content?: string }[]).slice(before);
      const answer = msgs.filter((m) => m.role === 'assistant' && m.content).map((m) => m.content).pop();
      onEvent({ type: 'status', text: '' });
      if (answer) onEvent({ type: 'text', text: answer });
      else onEvent({ type: 'error', message: getLang() === 'ja' ? 'アプリ内AIがうまく答えられませんでした。言い方を変えて、もう一度どうぞ。' : 'The in-app AI did not produce an answer. Try rephrasing.' });
    } catch (e) {
      onEvent({ type: 'error', message: lastError || (e instanceof Error ? e.message : String(e)) });
    } finally {
      signal?.removeEventListener('abort', stop);
      emit = null;
      onEvent({ type: 'done' });
    }
  },
};
