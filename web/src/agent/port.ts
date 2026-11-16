// Registry of agent tools and agents, plus window.__walkback: the socket an outside harness
// (pi-rs in the desktop app, or anything else) uses to list and call the tools.
import type { AgentEvent, AgentPort, ToolDef, ToolResult, ToolSpec } from './types';

const tools = new Map<string, ToolDef>();
const agents = new Map<string, AgentPort>();
const changed = new Set<() => void>();
const notify = () => changed.forEach((fn) => fn());

export function registerTool(t: ToolDef): () => void {
  tools.set(t.name, t);
  notify();
  return () => unregisterTool(t.name, t);
}
/** Remove a tool (only if it is still the same definition, when `t` is given). */
export function unregisterTool(name: string, t?: ToolDef) {
  if (t && tools.get(name) !== t) return;
  if (tools.delete(name)) notify();
}
export const getTools = (): ToolDef[] => [...tools.values()];
export const toolSpecs = (): ToolSpec[] => getTools().map(({ name, description, parameters }) => ({ name, description, parameters }));

export function registerAgent(a: AgentPort): () => void {
  agents.set(a.id, a);
  notify();
  return () => { if (agents.get(a.id) === a) { agents.delete(a.id); notify(); } };
}
export const listAgents = (): AgentPort[] => [...agents.values()];
export const getAgent = (id: string) => agents.get(id);

/** Called whenever tools or agents change. */
export function onRegistryChange(fn: () => void): () => void {
  changed.add(fn);
  return () => { changed.delete(fn); };
}

let seq = 0;
export const newCallId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Run a tool by name, reporting the call and its result as agent events. Never throws. */
export async function callTool(name: string, args: unknown, onEvent?: (e: AgentEvent) => void, id = newCallId()): Promise<{ ok: boolean; result: ToolResult }> {
  onEvent?.({ type: 'tool_call', id, name, args });
  const t = tools.get(name);
  let ok = true, result: ToolResult;
  if (!t) { ok = false; result = { text: `Unknown tool "${name}". Available: ${[...tools.keys()].join(', ')}` }; }
  else {
    try { result = await t.run(args ?? {}); }
    catch (e) { ok = false; result = { text: `Error in ${name}: ${e instanceof Error ? e.message : String(e)}` }; }
  }
  onEvent?.({ type: 'tool_result', id, name, result, ok });
  return { ok, result };
}

declare global {
  interface Window {
    __walkback?: {
      registerAgent: typeof registerAgent;
      tools: () => ToolSpec[];
      callTool: (name: string, args: unknown) => Promise<{ ok: boolean; result: ToolResult }>;
    };
  }
}
if (typeof window !== 'undefined') {
  window.__walkback = { registerAgent, tools: toolSpecs, callTool: (name, args) => callTool(name, args) };
}

/** Settles once the lazily loaded tools (query_nasa, #10's explore tools) are registered, so a
 * question asked right after the page opens still sees them (their chunks come over the network). */
let ready: Promise<void> = Promise.resolve();
export const toolsReady = () => ready;
export function setToolsReady(p: Promise<void>) { ready = p; }
