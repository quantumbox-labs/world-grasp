// Claude agent for the web build. The model runs behind our relay (web/public/_worker.js, which
// holds the API key); the tool loop runs here, in the browser, over the same tools as the rules
// version and pi-rs. Every number in an answer comes from a tool result: the relay's system prompt
// tells the model to copy numbers from tool results only, and the tool chips show each result.
import { callTool, toolSpecs } from './port';
import { getLang } from '../i18n';
import { NoModelError } from './pirs';
import { getSettings } from '../settings';
import { openaiTurn, openaiOn } from './openai';
import type { AgentEvent, AgentPort, ToolDef } from './types';

const RELAY = '/api/agent';
const MAX_TURNS = 8; // model ↔ tools round trips per question
const KEEP_MESSAGES = 24; // conversation kept for follow-up questions

type Block = { type: string; [k: string]: unknown };
interface Msg { role: 'user' | 'assistant'; content: string | Block[] }
interface Reply { content?: Block[]; stop_reason?: string; model?: string; error?: { message?: string } | string; message?: string }

let history: Msg[] = [];
export let claudeModel: string | null = null;
let availability: Promise<boolean> | null = null;

/** Forget the conversation (a new question then starts fresh). */
export const resetClaude = () => { history = []; };

/** Drop old turns, always restarting at a plain question so tool_use / tool_result pairs stay whole. */
function trim(msgs: Msg[]): Msg[] {
  if (msgs.length <= KEEP_MESSAGES) return msgs;
  let i = msgs.length - KEEP_MESSAGES;
  while (i < msgs.length && !(msgs[i].role === 'user' && typeof msgs[i].content === 'string')) i++;
  return msgs.slice(i);
}

async function turn(messages: Msg[], tools: ToolDef[], signal?: AbortSignal): Promise<Reply> {
  const names = new Set(tools.map((t) => t.name));
  const specs = toolSpecs().filter((s) => names.has(s.name)).map((s) => ({ name: s.name, description: s.description, input_schema: s.parameters }));
  if (openaiOn()) return openaiTurn(messages, specs, signal);
  const res = await fetch(RELAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, tools: specs, model: getSettings().cloudModel }), signal });
  const body = (await res.json().catch(() => ({}))) as Reply;
  if (res.status === 503 || res.status === 404) throw new NoModelError(getLang() === 'ja' ? '公開先に API キーが未設定です' : 'no API key is set on this deployment');
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.message ?? body.error : body.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export const claudeAgent: AgentPort = {
  id: 'claude',
  get label() { return getLang() === 'ja' ? 'クラウドAI' : 'Cloud AI'; },
  available() {
    if (openaiOn()) return Promise.resolve(true);
    availability ??= fetch(RELAY, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((j: { available?: boolean; model?: string }) => { claudeModel = j.model ?? null; return !!j.available; })
      .catch(() => false);
    return availability;
  },
  async ask(prompt: string, tools: ToolDef[], onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
    const msgs: Msg[] = trim([...history, { role: 'user', content: prompt }]);
    try {
      for (let i = 0; i < MAX_TURNS; i++) {
        const reply = await turn(msgs, tools, signal);
        if (reply.model) claudeModel = reply.model;
        const content = reply.content ?? [];
        // Keep the assistant content exactly as returned (thinking blocks included).
        msgs.push({ role: 'assistant', content });
        for (const b of content) if (b.type === 'text' && typeof b.text === 'string' && b.text) onEvent({ type: 'text', text: b.text });
        if (reply.stop_reason === 'refusal') {
          onEvent({ type: 'error', message: getLang() === 'ja' ? 'この質問には答えられませんでした。言い方を変えてもう一度どうぞ。' : 'The model declined this question. Try rephrasing it.' });
          break;
        }
        const uses = content.filter((b) => b.type === 'tool_use') as { id: string; name: string; input: unknown }[] & Block[];
        if (reply.stop_reason !== 'tool_use' || uses.length === 0) break;
        // One at a time: view tools move the same map.
        const results: Block[] = [];
        for (const u of uses) {
          const { ok, result } = await callTool(u.name as string, u.input, onEvent, u.id as string);
          const src = result.sources?.length ? `\n出典 / sources: ${result.sources.map((s) => s.label).join('; ')}` : '';
          results.push({ type: 'tool_result', tool_use_id: u.id, content: result.text + src, ...(ok ? {} : { is_error: true }) });
        }
        msgs.push({ role: 'user', content: results });
        if (i === MAX_TURNS - 1) onEvent({ type: 'error', message: getLang() === 'ja' ? '道具を呼ぶ回数の上限に達しました。' : 'Reached the tool-call limit.' });
      }
      // Keep the conversation only when it ended on a complete assistant turn.
      const last = msgs[msgs.length - 1];
      history = last?.role === 'assistant' ? msgs : [];
    } catch (e) {
      history = [];
      if (e instanceof NoModelError) throw e;
      if ((e as Error)?.name === 'AbortError') return;
      onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      onEvent({ type: 'done' });
    }
  },
};
