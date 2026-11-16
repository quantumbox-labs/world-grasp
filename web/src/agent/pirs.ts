// pi-rs agent (desktop app only). The Rust side (src-tauri/src/agent.rs) owns the model session;
// it calls our tools back through Tauri events. Talks to Tauri through window.__TAURI_INTERNALS__
// so the web build needs no Tauri package.
import { callTool, toolSpecs } from './port';
import { getLang } from '../i18n';
import { getSettings } from '../settings';
import type { AgentEvent, AgentPort, ToolDef } from './types';

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  transformCallback(cb: (payload: unknown) => void, once?: boolean): number;
}
declare global { interface Window { __TAURI_INTERNALS__?: TauriInternals } }

const tauri = () => (typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : undefined);

/** Same calls as @tauri-apps/api/event listen / unlisten. */
async function listen<T>(event: string, fn: (payload: T) => void): Promise<() => void> {
  const t = tauri()!;
  const handler = t.transformCallback((e) => fn((e as { payload: T }).payload));
  const eventId = await t.invoke<number>('plugin:event|listen', { event, target: { kind: 'Any' }, handler });
  return () => { t.invoke('plugin:event|unlisten', { event, eventId }).catch(() => undefined); };
}

export interface ModelInfo { provider: string; model: string }
/** Thrown when no model is reachable (no ANTHROPIC_API_KEY and no Ollama): the panel falls back to rules. */
export class NoModelError extends Error {}

export let lastModel: ModelInfo | null = null;

/** Desktop app: local models the settings screen can offer ([] on the web or with no local server). */
export async function desktopModels(): Promise<string[]> {
  const t = tauri();
  if (!t) return [];
  return t.invoke<string[]>('agent_models').catch(() => []);
}

export const pirsAgent: AgentPort = {
  id: 'pi-rs',
  get label() { return getLang() === 'ja' ? 'アプリ内AI' : 'In-app AI'; },
  available: () => !!tauri(),
  async ask(prompt: string, tools: ToolDef[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
    const t = tauri();
    if (!t) throw new NoModelError('pi-rs runs only in the desktop app');
    const names = new Set(tools.map((x) => x.name));
    try {
      lastModel = await t.invoke<ModelInfo>('agent_start', { tools: toolSpecs().filter((s) => names.has(s.name)), model: getSettings().desktopModel || null });
    } catch (e) {
      throw new NoModelError(String(e));
    }
    const offs = await Promise.all([
      listen<{ id: string; name: string; args: unknown }>('agent-tool-call', async ({ id, name, args }) => {
        const { ok, result } = await callTool(name, args, onEvent, id);
        await t.invoke('agent_tool_result', { id, ok, output: result.text, details: result }).catch(() => undefined);
      }),
      listen<{ type: string; text?: string; message?: string }>('agent-event', (e) => {
        if (e.type === 'text' && e.text) onEvent({ type: 'text', text: e.text });
        else if (e.type === 'error') onEvent({ type: 'error', message: e.message ?? 'error' });
      }),
    ]);
    const abort = () => { t.invoke('agent_abort').catch(() => undefined); };
    signal?.addEventListener('abort', abort);
    try {
      await t.invoke<string>('agent_prompt', { text: prompt });
    } catch (e) {
      onEvent({ type: 'error', message: String(e) });
    } finally {
      signal?.removeEventListener('abort', abort);
      offs.forEach((f) => f());
      onEvent({ type: 'done' });
    }
  },
};
